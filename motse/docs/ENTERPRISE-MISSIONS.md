# Enterprise Missions 1–3 — Dependency Intelligence, Adaptive Rate Limiting, Event Platform

The first slice of the enterprise-platform mission, chosen because each item
closes one **evidence-based finding** from the production-validation harness —
per the mission's own rule that every enhancement must be supported by
operational evidence. Everything is additive, reversible and backward
compatible; the harness now *asserts* all three fixes as regression guards
(65/65 checks).

- **M1 Dependency health** — `src/observability/dependency.health.js`
- **M2 Adaptive rate limiting** — `src/security/adaptive.rateLimiter.js`
- **M3 Event platform** — `src/persistence/outbox.js` (extended in place)
- **Tests** — `tests/enterprise.test.js` (41), coverage gate `motse:coverage:enterprise`
- **Evidence** — `docs/evidence/production-validation.json` (65 checks, PASS)

---

## Executive summary

Three operational weaknesses found by measurement are now fixed and
regression-guarded. **Readiness detects a Redis outage** (previously green
throughout — finding 1): a dependency health engine actively probes eight
dependencies with a real KV round-trip and a five-state machine
(healthy/degraded/recovering/maintenance/failed). **Authenticated users are no
longer starved by an exhausted anonymous IP bucket** (finding 2): rate limiting
classifies callers (admin/api-key/user/anonymous) before the quota decision,
with runtime-tunable class quotas, temporary bans and an emergency override —
and the same identity now keys the API-abuse blocker, which the harness proved
had the identical shared-NAT flaw. **Outbox drain cost no longer grows with
published-row accumulation** (finding 3): a transaction-safe pending index
replaces the full-collection scan (measured ~866µs → double-digit µs per op at
5.5k rows), plus retention/archival, replay by time/type/correlation,
scheduled/delayed events and priority queues — all without touching the
atomic-commit or at-least-once guarantees.

## Business justification

Finding 1 meant a Redis outage would keep pods in rotation while every
idempotency/lock/rate-limit call failed — user-visible errors with green
health. Finding 2 meant villages behind one shared operator NAT (the dominant
Botswana access pattern) could lose API access because of one abusive
neighbour. Finding 3 was the platform's one measured performance bottleneck,
directly bounding event throughput at national scale.

## Current state → gap → design (per mission)

### M1 — Intelligent health & dependency awareness
**Gap:** readiness checked that objects existed, not that they responded.
**Design:** `DependencyHealthEngine` — registered async probes with timeout,
per-dependency record (availability, latency, version, last success/failure,
consecutive counts, degradation reason, operational impact) and the
five-state machine. Recovery requires N consecutive successes (no flapping);
maintenance pins the state so planned work never pages. Probes read
`platform.*` at probe time, so failover/chaos swaps are observed. Eight
dependencies registered: redis (real setNx/del round-trip), event_bus,
event_store, outbox_relay, telemetry_exporter, workers, storage,
external_apis. **Integration:** the sync `HealthService.ready()` consumes
cached states (Kubernetes-safe); `GET /health/full` actively re-probes and adds
a public-safe `dependencies` state map (states only — reasons, hosts and
impact statements are admin-only via `/v1/admin/dependencies*`).

### M2 — Adaptive rate limiting
**Gap:** the `/v1` token bucket ran pre-auth, keyed by IP; the abuse blocker
did the same (second instance of the flaw caught by the harness when the fixed
check still returned 429).
**Design:** `AdaptiveRateLimiter.classify()` performs *soft identification*
(quota keying only, never authorization): valid Bearer → `user:<id>` (or
`admin:` with the platform_admin role), `X-Api-Key` → hashed `ak:` key, else
anonymous. Anonymous traffic **delegates to the existing `platform.rateLimiter`
read per-request** — anonymous semantics, and tests that swap that limiter,
are byte-identical. Identified classes get their own token buckets with
runtime-tunable quotas (`setQuota`), burst = bucket capacity, temporary bans
(`ban`/`unban`, auto-expiring), and an emergency multiplier (`setOverride`).
Metrics are class-level only (`motse_ratelimit_adaptive_total{class,result}`)
— per-identity Prometheus labels would be a cardinality hazard; hot consumers
are exposed via the admin `stats()` (top-N by denials). The abuse blocker now
keys by the same classified identity: an abusive account is banned by account,
an abusive IP no longer blankets the NAT.

### M3 — Enterprise event platform
**Gap:** `_drain()` full-scanned the outbox; published rows accumulated
unbounded (measured cost growth ~7.5×).
**Design:** an in-memory **pending index** — ids appended only *after* the
Unit of Work commits (rollback can never leave dangling entries), rebuilt by
one scan on the first drain of a fresh process (crash recovery — verified by
test). Additions, all default-off/neutral: `stage(type, data, { deliverAt,
priority, correlationId })` — scheduled events defer without burning retry
attempts; higher priority publishes first while equal priority keeps strict
staging order (default 0 ⇒ today's ordering guarantee unchanged);
`prune({ olderThanMs, keepLast })` archives published rows to `outbox_archive`
(opt-in automatic retention via the `retention` constructor option);
`replayWhere({ type, since, until, correlationId, limit })` republishes from
live+archive with the original stable `outbox_id`, so idempotent consumers
dedupe — at-least-once and replay safety preserved by construction.

## Alternatives considered

- **Background probe scheduler (M1):** rejected for now — probe-on-read
  (`/health/full`, admin) matches Kubernetes probe cadence without a timer
  lifecycle to manage; a scheduler is a clean extension point.
- **Full pre-auth JWT middleware (M2):** rejected — classification must never
  *grant* anything, so a soft, fail-to-anonymous check keeps the security
  model unchanged; real auth still happens at the route.
- **Per-status collections for the outbox (M3):** rejected — would change the
  storage layout every adapter must mirror; the index achieves the same read
  pattern with zero schema change and total rollback safety.
- **Fixing the findings silently inside the harness turn:** rejected then,
  honoured now — observation and implementation were kept in separate,
  individually reviewable deliveries.

## Trade-offs & risks

- The pending index is per-process; multiple relay instances would each
  rebuild from the shared store (correct, one redundant scan each). A
  DB-backed deployment gets the same effect from a status index — documented
  in the module.
- `classify()` runs signature verification twice per authenticated request
  (limiter + abuse key). In-memory cost is negligible; memoizing per-request
  is a documented optimization if evidence ever demands it.
- Probe-on-read means dependency state is as fresh as the last probe; a hung
  dependency is caught by the probe timeout (1.5s default).
- Risk: quota misconfiguration locking out a class → mitigated by the
  emergency `setOverride` multiplier and per-class (not global) blast radius.
- **Aliasing bug caught during testing:** the first quota-merge implementation
  shallow-copied `DEFAULT_QUOTAS`, so a runtime `setQuota` leaked into every
  other limiter instance. Fixed with per-class deep copies; regression test in
  place. Recorded here per the tamper-evident-engineering standard.

## Security impact

Classification is fail-closed to anonymous; a forged token yields the *lower*
anonymous quota. API keys are hashed before use as bucket keys (no raw keys in
memory maps). Public health payloads carry state strings only — degradation
reasons (which may name internal hosts) are admin-gated, verified by test.
Abuse blocking by account closes the rotate-IP evasion path. All admin control
routes sit behind the existing `platform_admin(platform)` L3 guard.

## Performance impact (measured)

| Measure | Before | After |
|---|---|---|
| Outbox op at ~5.5k published rows | ~866 µs | **~30–60 µs** (harness asserts <300) |
| Readiness probe cycle (8 deps, parallel) | n/a | ~1 ms typical (per-probe timeout 1.5 s) |
| Adaptive limiter per request | one bucket op | one classify (in-memory verify) + one bucket op |

Full harness re-run after the changes: **65/65 checks PASS**, including the
three new regression guards (M1 readiness-detects-outage, M2
authenticated-survives-throttle, M3 flat drain cost) — with sustained-load,
alert-quality and integrity checks unchanged and green.

## Operational impact & control plane additions

`/v1/admin/dependencies[/cached|/:name/check|/:name/maintenance]`,
`/v1/admin/ratelimit[|/bans|/unban|/quota|/override]`,
`/v1/admin/outbox/prune|replay|archive` — plus a new Grafana dashboard
(`ratelimit`: decisions/rejections/saturation by class) and the
`motse-slo`/foundation dashboards unchanged. Maintenance mode per dependency
means planned Redis failovers stop paging without silencing real alerts.

## CI/CD changes & rollback

New `motse:coverage:enterprise` gate (≥95/95/90 over the two new modules) wired
into `foundation.yml`; validation smoke, SLO/dashboard drift gates and secret
scan all still enforced. Rollback: every mission is independently revertible —
M1/M2 are new modules plus a handful of wiring lines; M3's extensions are
default-off (no retention configured ⇒ prior behaviour) and the index is an
internal optimization with the scan as its documented fallback.

## Test results

- motse suite: **602 green** (was 561; +41 `tests/enterprise.test.js`).
- Harness: **65/65 PASS** full + smoke; evidence regenerated and checked in.
- Gates: foundation 99.4/94.7 (outbox 100 % stmt), observability 99.6/95.9
  (dependency.health 100 % stmt), enterprise 98.8/91.1 — all ≥95/95/90.

## Future extension points

Scheduled probe loop + probe-latency histograms (M1); per-tenant quota classes
and distributed (Redis-backed) adaptive buckets (M2); partitioned parallel
consumers and cross-process index invalidation (M3) — each listed in module
docs. Remaining missions (4–13: control-plane UI, runtime intelligence,
distributed config, zero-trust, resilience patterns, capacity forecasting, DR
automation, business observability, governance, multi-region) follow the same
evidence-first cadence.

## Success criteria — met

✅ Readiness detects, diagnoses and reports dependency failure before users do
(asserted under chaos). ✅ Identity-aware quotas with runtime controls, no
anonymous behaviour change. ✅ Event platform with indexed relay, retention,
replay, scheduling and priorities — at-least-once, idempotency, ordering and
atomicity guarantees intact. ✅ All existing tests pass; coverage gates added,
none weakened; every claim above is backed by a checked-in measurement.
