# Observability & Health — Distributed Tracing, Metrics, Readiness (Phase 2/3)

Production observability for the platform substrate. Every change is **additive,
reversible, backward-compatible and default-preserving**: the tracer and the
Foundation metrics are opt-in parameters that default to no-ops, so existing
constructions (`new Store()`, `new OutboxService({store,clock,bus})`) and the
existing `/health`, `/health/ready`, `/metrics` endpoints behave **byte-identically**.
Nothing here bypasses a transaction, weakens idempotency, or changes an API contract.

- **Tracing** — `src/observability/tracer.js`
- **Health & readiness** — `src/observability/health.service.js`
- **Foundation instrumentation** — `src/kernel/store.js`, `src/persistence/outbox.js`, `src/distributed/services.js`
- **Wiring** — `src/container.js` (`platform.tracer`, `platform.health`, one shared `platform.metrics`)
- **HTTP** — `src/app.js` (root span per request, W3C `traceparent`, `/health/live`, `/health/full`)
- **Admin** — `/v1/admin/observability/{traces,traces/:id,tracer,health}`
- **CI gate** — `npm run motse:coverage:observability` (≥95 % stmt/line, ≥90 % branch)

---

## Executive summary

Phase 2 (Operational Observability) and Phase 3 (Health & Readiness) give the
platform three things it lacked: **per-request distributed traces**, **first-class
Foundation metrics**, and **Kubernetes-grade liveness/readiness probes** that
understand the Foundation (ledger balance, event backbone, outbox backlog,
distributed adapter, payment rails).

The design reuses what already existed — the Prometheus `Metrics` registry, the
structured `Logger`, the `MonitoringService.readiness()` view, the request-metrics
middleware — and **extends** rather than duplicates it. The tracer is a
dependency-free, OpenTelemetry-shaped implementation built on Node's
`AsyncLocalStorage`; the Foundation was instrumented through optional parameters
so the hot path is unchanged when observability is absent. The result: 42 new
tests, 522 green in the motse suite (was 480), Foundation and observability
coverage gates both passing, zero breaking changes.

---

## Architectural rationale

Observability is a **cross-cutting concern**, and the platform already had a
metrics/logging seam (`src/monitoring/*`). The two gaps were (a) no causal link
between a request and the Foundation work it triggered, and (b) a readiness view
(`MonitoringService.readiness()`) that predated the Foundation (transactions,
outbox, distributed runtime) and therefore could not see it.

Rather than bolt on a heavyweight agent, we follow the same pattern the Foundation
itself uses for the KV layer: **a small in-process implementation behind a stable
surface that a real backend can replace later**. The tracer exposes
`startSpan`/`withSpan`/`runInContext` — the exact shape an OpenTelemetry SDK bridge
would adopt — so adopting OTel becomes a wiring change, not a rewrite. Context
propagation uses `AsyncLocalStorage`, which is correct across `await` boundaries
and needs no manual threading of a context object through every call.

Health is split the Kubernetes way: **liveness** (`/health/live`) is cheap and
dependency-free (a failed probe *restarts* the pod), while **readiness**
(`/health/full`) aggregates Foundation-aware checks (a failed probe *removes the
pod from rotation* without restarting it). This is the correct control-plane
contract for a national-scale deployment.

---

## Design decisions

1. **Optional instrumentation, no-op by default.** Each instrumented component
   accepts `metrics = null` (and the outbox also `tracer = null`), falling back to
   a local `NOOP_METRICS = { inc(){}, observe(){} }`. Existing call sites pass
   nothing and are unaffected — this is what keeps the change non-breaking.
2. **One shared `Metrics` registry.** The container constructs a single `Metrics`
   instance *first* and threads it into `Store`, `OutboxService`, and the three
   distributed services, so Foundation metrics land in the same registry that
   `/metrics` already renders. `platform.metrics` points at that instance.
3. **`AsyncLocalStorage` for context, not a passed argument.** Spans nest by
   reading the active context, so instrumentation is local and non-invasive.
4. **W3C Trace Context on the wire.** The HTTP layer honours an inbound
   `traceparent` (cross-service propagation) and always sets one on the response,
   falling back to a minted trace id when none is supplied.
5. **Bounded ring buffer, optional sink.** Completed spans are kept in a bounded
   buffer (`maxSpans`, default 2000) for introspection; an optional `sink`
   exporter can forward them, and an exporter failure is swallowed so it can never
   break a request.
6. **Degraded ≠ unready.** A dead-lettered outbox row marks readiness *degraded*
   (an operator signal) but still *ready* — a backlog beyond threshold, or any
   failed check, is what flips readiness to `false` (503). Checks **fail closed**:
   a throwing or empty check is treated as unhealthy.
7. **Existing endpoints frozen.** `/health`, `/health/ready`, `/metrics` are
   untouched; the new probes sit alongside them.

---

## Trade-offs

- **In-process spans vs. a real APM.** The ring buffer is memory-bounded and
  per-pod — it is for live introspection and export, not long-term storage. The
  `sink` seam and the OTel-shaped API are the deliberate path to a real backend;
  we accept a bounded local view now in exchange for zero new dependencies and no
  egress/PII surface.
- **Synchronous outbox drain span.** The outbox relay is synchronous in-process
  today, so `outbox.drain` is a child span of whatever triggered it. When the
  relay becomes a background worker, the span simply roots its own trace — the API
  does not change.
- **Fixed histogram buckets.** The metric latency buckets come from the existing
  `Metrics` class; they are adequate for the current SLOs and can be tuned without
  touching instrumentation call sites.
- **`enterWith` scope caveat.** `Tracer.enter` uses `AsyncLocalStorage.enterWith`,
  which mutates the current async scope; it is provided for middleware-style use
  and is intentionally the lower-level primitive next to `runInContext`.

---

## Files modified

| File | Change |
|------|--------|
| `src/kernel/store.js` | `constructor({ metrics })`; `transaction()` records `foundation_transaction_total{result}` + `foundation_transaction_ms{result}`. No-op default. |
| `src/persistence/outbox.js` | `constructor({ …, metrics, tracer })`; `drain()` wrapped in an `outbox.drain` span; `_drain()` records published/retried/dead counters, publish latency, and a backlog sample. |
| `src/distributed/services.js` | `DistributedIdempotency` / `DistributedRateLimiter` / `DistributedLock` each take `metrics` and record `foundation_idempotency_total`, `foundation_ratelimit_total`, `foundation_lock_total`. |
| `src/container.js` | Construct one shared `Metrics` + `Tracer` early; thread through Foundation; add `platform.tracer`, `platform.health`; `platform.metrics` now points at the shared registry. |
| `src/app.js` | Trace middleware honours inbound `traceparent`; a root HTTP span per request set into `AsyncLocalStorage`; `traceparent` response header; `GET /health/live`, `GET /health/full`. Existing endpoints unchanged. |
| `src/admin/admin.routes.js` | `GET /observability/{traces,traces/:traceId,tracer,health}` (admin-guarded). |
| `package.json` | New `motse:coverage:observability` gate. |

## New modules

| Module | Responsibility |
|--------|----------------|
| `src/observability/tracer.js` | OpenTelemetry-shaped, dependency-free tracer: `AsyncLocalStorage` context, W3C `traceparent`, bounded ring buffer, `trace()`/`recent()`/`stats()`, optional export sink. |
| `src/observability/health.service.js` | Kubernetes liveness (`live()`) + Foundation-aware readiness (`ready()`) with pluggable, fail-closed checks. |
| `tests/observability.test.js` | Tracer + Foundation-instrumentation suite. |
| `tests/health.test.js` | Health service, HTTP probes, admin routes, trace propagation. |

---

## Test results

```
npm run motse:test                    → 44 suites, 522 tests passing (was 480)
npm run motse:coverage:observability  → src/observability/** 100% stmt/line,
                                         98.3% branch, 100% func (gate ≥95/95/90)
npm run motse:coverage:foundation     → 98.74% stmt / 94.7% branch (unchanged pass)
npm run typecheck                     → module graph loads (container wiring valid)
```

New coverage of the observability modules: `health.service.js` 100 % across the
board; `tracer.js` 100 % stmt/line/func, 97.95 % branch. Foundation instrumentation
lines are exercised by both the new suite and the existing Foundation suites, so
the Foundation gate continues to pass.

---

## Metrics reference

| Metric | Type | Labels | Emitted by |
|--------|------|--------|-----------|
| `foundation_transaction_total` | counter | `result=commit\|rollback` | `Store.transaction` |
| `foundation_transaction_ms` | histogram | `result` | `Store.transaction` |
| `foundation_outbox_published_total` | counter | `type` | outbox relay |
| `foundation_outbox_retried_total` | counter | `type` | outbox relay |
| `foundation_outbox_dead_total` | counter | `type` | outbox relay |
| `foundation_outbox_publish_ms` | histogram | — | outbox relay |
| `foundation_outbox_backlog` | histogram sample | — | outbox relay |
| `foundation_idempotency_total` | counter | `result=first\|duplicate` | distributed idempotency |
| `foundation_ratelimit_total` | counter | `result=allowed\|limited` | distributed rate limiter |
| `foundation_lock_total` | counter | `result=acquired\|contended` | distributed lock |

All render through the existing `/metrics` endpoint (Prometheus text format).

## Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health/live` | none | Liveness — 200 while the process runs. |
| `GET /health/full` | none | Readiness — 200 ready / 503 not ready; Foundation-aware checks. |
| `GET /metrics` | none | Prometheus scrape (now including Foundation metrics). |
| `GET /v1/admin/observability/traces?limit=` | admin | Recent traces, newest first. |
| `GET /v1/admin/observability/traces/:traceId` | admin | All spans for one trace. |
| `GET /v1/admin/observability/tracer` | admin | Ring-buffer stats. |
| `GET /v1/admin/observability/health` | admin | Full readiness detail. |

Every response carries `X-Trace-Id` and a W3C `traceparent`; an inbound
`traceparent` is honoured end-to-end for cross-service correlation.

---

## Impact

- **Performance.** The hot path is unchanged when observability is absent (no-op
  sinks, no journaling outside a transaction). With it, each transaction/outbox
  publish/distributed call adds one counter increment and one histogram sample —
  O(1), in-memory. The tracer allocates one span object per instrumented scope and
  evicts from a bounded buffer, so memory is capped.
- **Security.** No new external egress and no PII: spans carry method/target/status
  and Foundation counters, not payloads. The admin observability routes reuse the
  existing `platform_admin(platform)` L3 guard; the health probes expose only
  boolean health and coarse detail strings. The exporter sink is fail-closed.
- **Operational.** Standard Kubernetes probes map directly:
  `livenessProbe → /health/live`, `readinessProbe → /health/full`. `/metrics`
  now surfaces Foundation health for alerting (outbox backlog, dead letters,
  rollback rate, lock contention). Traces are queryable live for incident triage.

---

## Future extension points

- **OpenTelemetry bridge.** Implement the tracer `sink` (or swap the tracer) to
  forward spans to an OTLP collector — the `startSpan`/`withSpan` surface already
  matches OTel semantics.
- **Instrument more call sites.** Ledger transfers, payment captures and QR verify
  can adopt `withSpan`/`metrics` with the same no-op-safe pattern.
- **Custom readiness checks.** `platform.health.register(name, fn)` lets any module
  contribute a check (e.g. a downstream provider heartbeat).
- **Exemplars & trace-metric correlation.** The shared trace id can be attached to
  metric exemplars once an OTel/Prometheus exemplar path exists.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Instrumentation changes Foundation behaviour | Optional params default to no-ops; Foundation coverage gate + full suite prove byte-identical behaviour. |
| Ring buffer grows unbounded | Hard cap at `maxSpans` (default 2000); oldest evicted. |
| Exporter failure breaks a request | Sink calls are wrapped in try/catch and swallowed. |
| Readiness probe flaps under transient load | Degraded signals (dead letters) do not flip readiness; only threshold breaches / failed checks do. |
| Trace headers leak internal detail | `traceparent` carries only opaque ids; span attributes are method/target/status, never payloads. |
