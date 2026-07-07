# Production Validation — Observability Truth, Reliability, Evidence-Based SLOs

Phases 1–3 of the production-validation mission: prove the telemetry tells the
truth under production-shaped conditions, demonstrate Foundation recovery under
injected faults, and derive SLOs from measured behaviour rather than intuition.
Everything here is **additive and reversible**; no Foundation or Observability
component was redesigned, and one small gauge (`motse_otel_dropped_spans`) plus
one query helper (`Metrics.counterTotal`) were the only production-code additions.

- **Harness** — `motse/scripts/production-validation.js` (`npm run motse:validate[:smoke]`)
- **Fault injection** — `motse/src/distributed/chaos.kv.js` (+ `tests/chaos.test.js`)
- **Evidence** — `motse/docs/evidence/production-validation.json` (checked in, full run)
- **SLOs** — `deploy/motse/observability/slo.yaml` → generated `dashboards/slo.json` + `prometheus-slo-alerts.yaml` (`npm run motse:slo`)
- **CI** — validation smoke, SLO-asset drift gate, secret scan (`.github/workflows/foundation.yml`)

---

## Executive summary

The platform's telemetry was validated **empirically, not assumed**: a harness
drives the real container and Express app through sustained load, duplicate
storms, rollback storms, outbox backlog/dead-letter cycles, lock/rate-limit
contention, and Redis outage/blip/restart chaos — then cross-checks every
emitted signal against ground truth. **All 60 expected-vs-observed checks pass**:
metrics are exact (not approximate), traces stay complete and propagate across
HTTP boundaries, 100 % of request logs correlate, and across 36 alert-phase
evaluations every alert fired in its intended fault window and stayed silent
otherwise — **zero false positives, zero false negatives**.

Reliability was demonstrated, not asserted: recovery from a 1,100-event outbox
backlog took **14.8 ms**; DLQ replay of 50 dead letters took **26.3 ms**; the
distributed layer **fails closed** during a KV outage and recovers on the first
call (**0.08 ms**) after restoration. Eight SLOs were then derived from these
measurements — each with its evidence cited in the config — and rendered into a
Grafana compliance dashboard and Prometheus burn-rate alerts, all drift-gated
in CI. The harness also surfaced **three genuine findings** (below) — exactly
the operational insight this mission demanded.

## Objectives

1. Validate traces, logs, metrics, dashboards and alerts under realistic
   workloads (Phase 1). 2. Demonstrate recovery behaviour under fault injection
   (Phase 2). 3. Define measured, evidence-based SLOs and export them to
   dashboards/alerts/documentation (Phase 3). 4. Enforce all of it in CI.

## Architecture review (of the validation approach)

The harness runs **in-process against the production wiring** — the same
`createPlatform()` container and `createApp()` Express app — over a real HTTP
socket, so every middleware (helmet, tracing, RED metrics, idempotency, rate
limiting) is on the measured path. Fault injection reuses the Foundation's own
seams: `ChaosKv` wraps any KV adapter behind the identical interface (outage,
transient blips, latency, restart-with-data-loss), the OTLP exporter accepts an
in-memory transport, and the logger accepts a capturing sink. No service under
test was modified to be testable.

Alert validation is a **semantic evaluation**: the harness computes the same
ratios/thresholds the PromQL rules encode, over the same counters, per phase
window. It does not run a Prometheus engine — that trade-off is documented and
the `slo.test.js` contract test separately guarantees the PromQL references
only emitted metrics.

## Engineering decisions

1. **Exactness, not tolerance, for counters.** HTTP request, commit, rollback,
   published, retried and dead counters are asserted **equal** to ground truth.
   Telemetry you can't trust exactly is telemetry you can't page on.
2. **Fault errors are plain `Error`s.** ChaosKv throws what ioredis would —
   not `MotseError`s — so error-propagation paths are validated faithfully.
3. **Absolute-floor + percentage hybrid for overhead budgets.** Percentages
   mislead on ~1 µs micro-ops; absolute budgets destabilise when the bare op
   itself varies with heap pressure. Budget = max(floor, 25 % of bare).
4. **Findings are recorded, not silently fixed.** The mission separates
   observation from implementation; gaps go into `recommendations` in the
   evidence file and this document.
5. **SLOs as declarative config.** `slo.yaml` is the single source; dashboard
   and alert rules are generated and drift-gated, so objectives, panels and
   alerts cannot diverge.

## Alternatives considered

- **k6/Artillery external load rig** — rejected for now: adds toolchain and a
  network hop without changing what is validated; the in-process rig measures
  the same code path deterministically in CI. External rigs belong in the
  staging environment (extension point).
- **Running a real Prometheus for alert evaluation** — rejected: heavyweight in
  CI; the semantic evaluation plus the metric-contract tests cover the
  meaningful failure modes (wrong threshold logic, missing metrics).
- **Testcontainers Redis for chaos** — deferred: `ChaosKv` exercises the same
  service-level behaviour deterministically; the CI Redis service container is
  already provisioned for future `REDIS_URL` runs.
- **Fixing the three findings inline** — rejected: the mission mandates
  operating before expanding; each fix is scoped as follow-up with evidence.

## Trade-offs

- In-process load excludes real network jitter and container CPU limits —
  latency numbers are a lower bound, which is why SLO targets carry 10–30×
  headroom over measured values.
- The alert evaluation validates threshold semantics, not PromQL syntax
  execution; syntax is covered by config-integrity tests, not a query engine.
- The checked-in evidence file is a snapshot; CI re-validates behaviour each
  run (smoke mode) but the committed numbers refresh only when
  `npm run motse:validate` is rerun deliberately.

## Implementation summary

**New:** `scripts/production-validation.js` (harness, 9 workloads, 60 checks),
`src/distributed/chaos.kv.js` (fault-injection wrapper), `tests/chaos.test.js`
(10 tests), `tests/slo.test.js` (10 tests), `deploy/motse/observability/slo.yaml`,
`generate-slo-assets.js`, generated `dashboards/slo.json` +
`prometheus-slo-alerts.yaml`, `docs/evidence/production-validation.json`.

**Modified:** `monitoring/metrics.js` (`counterTotal` helper),
`monitoring/monitoring.service.js` (`motse_otel_dropped_spans` gauge),
`package.json` (`motse:validate`, `motse:validate:smoke`, `motse:slo`),
`.github/workflows/foundation.yml` (validation smoke, SLO drift gate, secret scan).

## Validation strategy & test results

- Harness: **60/60 checks PASS** in both full and smoke modes (checks are
  identical; only scale differs). Evidence checked in from the full run.
- Unit/integration: **motse suite 561 green** (was 541; +10 chaos, +10 SLO).
- Coverage: Foundation gate 98.9 % stmt / 95.1 % branch (chaos.kv.js at 100 %
  across the board); observability gate unchanged.
- CI: smoke validation, SLO/dashboard drift gates, secret scan, dependency
  audit (high/critical) all enforced.

## Load testing results (full run, Node v22, in-process)

| Measure | Value |
|---|---|
| Sustained throughput | **1,426 rps** (8,558 requests, 6 s × 24 workers) |
| Latency | p50 **15.3 ms** · p95 **23.0 ms** · p99 **27.2 ms** |
| 5xx under load | **0** |
| Rate limiting engaged | 3,938 × 429 (anonymous IP bucket, by design) |
| Transaction throughput | **179k txn/s** (5.6 µs/txn, 20,000 txns) |
| OTLP export | **~76k spans/s**, 20,000/20,000 shipped, 0 dropped |

## Reliability metrics (fault injection)

| Scenario | Expected | Observed |
|---|---|---|
| KV outage (10 ops) | fail closed, no silent success | 10/10 failed closed |
| Recovery after outage | first op succeeds | **0.08 ms** |
| Transient blip | retryable, no duplicate execution | confirmed |
| Restart with data loss | degrade to at-least-once (documented boundary) | confirmed |
| Outbox backlog 1,100 | drains after consumer recovery | **14.8 ms** to zero |
| DLQ 50 dead letters | operator replay to zero | **26.3 ms** |
| Lock hotspot (200 concurrent) | exactly one winner | 1 acquired / 199 contended |
| 50 concurrent duplicates | exactly-once | 1 executed |
| Ledger through all faults | balanced | balanced |
| Alert matrix (6 alerts × 6 phases) | fire only in fault windows | **36/36 correct** |

## Security findings (early review, Phase 5 slice)

- Secret scan: clean (now enforced in the Foundation pipeline as well).
- Dependency audit: 0 high/critical (8 moderate, tracked; gate already in CI).
- Replay/idempotency abuse: duplicate HTTP requests replay cached responses
  (verified); distributed duplicates execute exactly once (verified);
  reservation release on failure verified (no poisoned keys).
- **Finding (authz-adjacent):** the `/v1` token bucket keys by client IP
  *before* authentication — see finding 2 below.
- Deeper review (Redis AUTH/TLS, OWASP pass) remains scheduled for the
  dedicated security phase.

## Performance measurements (profiling baseline, Phase 7 seed)

| Measure | Bare | Instrumented | Added |
|---|---|---|---|
| Store transaction | 1.38 µs | 2.20 µs | **+0.82 µs/txn** |
| Outbox op (at ~5.5k rows) | 865.7 µs | 914.8 µs | **+49.1 µs/op (5.7 %)** |

Heap growth across the entire harness: +81.7 MB (includes event store, log
capture and report buffers; tracer ring buffer verified bounded at 2,000 spans).
A dead OTLP collector dropped 500 spans in 5.9 ms without affecting request
handling. **Conclusion: instrumentation overhead is negligible against any real
I/O; no optimization is warranted by evidence at this time** — except finding 3.

## SLOs established (Phase 3 — every threshold cites its evidence)

| Objective | Target | Measured basis |
|---|---|---|
| Availability | ≥ 99.9 % / 30d | 0 × 5xx in 8,558 req incl. fault phases |
| API latency p95 | < 300 ms | 23.0 ms measured (≈13× headroom for real I/O) |
| API latency p99 | < 800 ms | 27.2 ms measured |
| Transaction success | ≥ 99.99 % | healthy-phase rollback ratio 0 %; counters exact |
| Outbox backlog | < 1,000 | 1,100 drained in 14.8 ms (>50,000×/s capacity) |
| Dead letters | 0 sustained | replay-to-zero verified in 26.3 ms |
| Lock failure rate | < 20 % | healthy 0 %; deliberate hotspot 99.5 % detected |
| Telemetry delivery | 0 dropped spans | 20,000/20,000 shipped; drops now a metric |

Exported to: `dashboards/slo.json` (stat + trend panel per objective, evidence
in panel descriptions), `prometheus-slo-alerts.yaml` (availability fast/slow
burn-rate, p99, dropped-spans), and this document. All generated, all drift-gated.

## Operational impact

Operators gain: a one-command production-validation run (`motse:validate`), an
SLO compliance dashboard, burn-rate paging aligned to error budgets, and CI
that fails if telemetry contracts drift (metrics disappear, dashboards/alerts
reference missing series, SLO assets diverge from `slo.yaml`, coverage drops,
secrets appear).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| CI smoke flakes on slow runners | fixed-iteration warmed benchmarks; hybrid overhead budgets; ordering-sensitive checks run before bucket exhaustion |
| Evidence goes stale as code evolves | CI re-runs the checks each build (smoke); `slo.test.js` fails if evidence is missing or non-PASS |
| Semantic alert evaluation diverges from PromQL | contract tests pin alert names/expressions to emitted metrics; thresholds encoded once in YAML |
| Harness mutates shared state (maxAttempts, kv) | all mutations restored in-scenario; final integrity checks (ledger balanced, ready=true) gate the verdict |

## Rollback strategy

Everything is additive: removing the harness, chaos wrapper, SLO configs and CI
steps restores the prior state exactly. The two production-code additions (a
gauge and a read-only counter helper) have no behavioural coupling; reverting
them breaks nothing but the new tests.

## Future extension points

- Run the same harness against a staging deployment over a real network
  (`k6`/external rig) and against `REDIS_URL` with the CI Redis service.
- Feed `ChaosKv` latency mode into a scheduled chaos pipeline.
- Wire evidence snapshots into release notes (per-release SLO conformance).
- Add GC/heap profiling via `--expose-gc` + `perf_hooks` GC observer for the
  dedicated performance phase.

## Actionable recommendations (evidence-based findings)

1. **Readiness is blind to a KV outage.** The `distributed` health check
   verifies the adapter exists, not that it responds — during a simulated
   Redis outage readiness stayed green. *Recommend:* an active KV ping
   (`setNx`/`del` round-trip with timeout) as a readiness check. (Health/
   operational-intelligence phase.)
2. **Rate limiting keys by IP before auth.** Authenticated users behind a
   shared egress IP (NAT/proxy) inherit the anonymous bucket once exhausted —
   observed directly when the admin request drew 429 after the load phase.
   *Recommend:* post-auth actor-keyed bucket or authenticated exemption from
   the IP bucket. (Architecture-validation phase.)
3. **Outbox drain full-scans the collection and published rows accumulate
   unbounded.** Bare op cost measured growing from ~115 µs cold to ~866 µs at
   5.5k rows under heap pressure. *Recommend:* status-indexed pending lookup
   and/or pruning/archiving published rows before high-volume production.
   (Performance phase — this is the one measured bottleneck.)

## Definition of success & final production readiness assessment

Against the mission's success criteria: observability is **validated as
truthful** (exact counters, complete traces, correlated logs) and **actively
operational** (SLO dashboard, burn-rate alerts, drift-gated config);
reliability is **demonstrated** through controlled failure testing with
measured recovery; SLOs are **evidence-based and continuously monitored**;
CI **enforces telemetry, quality and security standards automatically**;
security validation has **started early** (scans enforced; findings logged);
performance work is **gated on measurement** (one real bottleneck identified,
scoped, not speculatively fixed).

**Assessment: the platform's Foundation and observability are production-ready
within the validated envelope** (in-process, in-memory adapters). The three
recorded findings are the prioritized, evidence-backed backlog for the next
phases — health-check depth, rate-limiter keying, and outbox scan cost — and
none of them blocks continued pilot-scale operation. Expansion phases (durable
read models, CQRS, workflow orchestration) should proceed only after those
findings are addressed and a staging-network validation run repeats these
measurements over real infrastructure.
