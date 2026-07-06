# Missions 8 + 5 — Advanced Resilience Patterns & Runtime Intelligence

Mission 8 (the prompt's *highest engineering priority*) delivered with Mission 5,
because the resilience patterns are only meaningful once validated, and the
existing chaos harness plus new runtime telemetry are how they're proven. Every
mechanism ships with measurable validation — 38 unit tests and **11 new
chaos-harness checks (W10/W11), all green (77/77 total)**. Additive and
reversible throughout: nothing is wrapped implicitly; call sites opt in.

- **Resilience** — `src/resilience/{circuit.breaker,bulkhead,retry,load.shed,self.healing,index}.js`
- **Runtime intelligence** — `src/observability/runtime.intelligence.js`
- **Wiring** — `container.js` (`platform.resilience`, `platform.runtime`), `app.js` (load-shed middleware), `server.js` (sampling + graceful shutdown), `health.service.js` (self-heal after probe)
- **Control plane** — `/v1/admin/{overview,runtime,resilience,...}`
- **Tests / gate** — `tests/resilience.test.js`, `motse:coverage:resilience` (≥95/95/90)
- **Validation** — harness `W10` (resilience under chaos) + `W11` (runtime detection)

---

## Executive summary

Six validated resilience patterns and a Node runtime-intelligence layer turn the
platform from *fault-tolerant* into *self-protecting and self-healing*.

- **Circuit breakers** fail fast on a sick dependency (rolling-window threshold →
  open → half-open probe → closed), with optional fallbacks for graceful
  degradation. Chaos-proven: under a KV outage the breaker trips and then
  **spares the dead dependency entirely** (0 further calls while open), and
  closes automatically once it recovers.
- **Bulkheads** cap per-compartment concurrency (redis/outbox/workers/external/
  database) with a bounded queue, so a slow dependency exhausts *its* compartment,
  never the process — chaos-proven to shed overflow while peak concurrency stays
  ≤ the cap.
- **Adaptive retry** — exponential backoff + full jitter, retry classification
  (MotseError `retryable` honoured; infra errors retry), and a shared **retry
  budget** that caps amplification during a storm. Plus **timeout budgets**
  (`withDeadline`) so nothing waits forever.
- **Load shedding** rejects normal traffic fast when overloaded (in-flight cap or
  event-loop stall) while **critical paths — health, metrics, admin, webhooks —
  always pass**.
- **Self-healing** watches dependency-state transitions and runs recovery actions
  (drain the outbox when the relay recovers, flush spans when the exporter
  recovers) — automation of the operator runbook, fired right after each probe.
- **Runtime intelligence** samples heap/GC/event-loop/RSS/handles and derives
  **predictive insights** (memory-leak trend with time-to-limit, event-loop
  stalls, saturation, handle leaks) — chaos-proven to flag a synthetic leak while
  *not* false-flagging the live process.

## Business justification

The validation harness had shown every distributed call surfacing the raw infra
error for the *entire* duration of a KV outage. Circuit breakers convert that
into instant typed rejections (or cached fallbacks), cutting user-visible error
duration and sparing a struggling dependency from a thundering herd. Bulkheads
and load shedding keep one failing subsystem from taking the whole node down —
essential at national scale where a single hot resource or a mobile-money
provider outage must not cascade. Runtime intelligence turns "the pod OOM-killed
overnight" into "a leak insight fired 60 minutes before the limit."

## Current state → gap → design

**Gap:** the Foundation was fault-*tolerant* (transactions roll back, the outbox
retries, idempotency holds) but had no *fault-isolation* or *fast-failure* layer,
and telemetry stopped at application metrics — nothing watched the runtime itself.

**Design (Mission 8):** small, single-purpose, individually testable primitives
behind a `Resilience` facade that owns named breakers/bulkheads/budgets and
exposes one `stats()` to the control plane. Each primitive is clock-injected
(deterministic tests) and metrics-instrumented (`motse_breaker_total`,
`motse_bulkhead_total`, `motse_retry_total`, `motse_loadshed_total`,
`motse_selfheal_total`). The load shedder is the one middleware wired into the
request path (ahead of the work, so shed requests are nearly free); everything
else is opt-in per call site. Rejections use the new `UNAVAILABLE` (503,
retryable) code.

**Design (Mission 5):** `RuntimeIntelligence` uses only Node core
(`perf_hooks.monitorEventLoopDelay`, `PerformanceObserver` for GC, `v8` heap
stats), samples on an unref'd interval (opt-in `start()`; the container never
starts a timer, so imports/tests are unaffected), and computes insights via a
least-squares slope over the sample window. It feeds two live systems: the
load-shedder's event-loop-lag signal and a new `event_loop` dependency probe.

## Alternatives considered

- **A library (opossum / cockatiel / p-retry):** rejected — adds dependencies for
  ~400 LOC of well-understood patterns; the in-house versions are clock-injected
  for deterministic chaos validation and share the platform's metrics/error model.
- **Implicit global wrapping of all Redis/outbox calls:** rejected — violates
  "additive, no redesign"; opt-in call sites keep blast radius controlled and
  every existing test unaffected.
- **A sampling agent / APM for runtime metrics:** rejected — Node core already
  exposes everything needed; no new egress or dependency, and the predictive
  layer is the differentiator, not raw collection.
- **Token-bucket load shedding:** rejected in favour of in-flight + event-loop
  signals — the adaptive rate limiter already owns quota; the shedder's job is
  overload protection, for which concurrency and loop lag are the true signals.

## Trade-offs & risks

- Breakers/bulkheads are per-process; a multi-pod deployment gets per-pod
  isolation (correct — each pod protects itself). Cross-pod coordination is a
  documented extension, not needed for isolation.
- Load-shed defaults are deliberately generous (500 in-flight, 500ms lag) — sized
  from validation (p95 ≈ 23ms at 1,400 rps), so they signal genuine distress, not
  load. Risk of shedding too early is mitigated by critical-path exemption and
  runtime-tunable thresholds.
- Runtime sampling adds one unref'd 5s interval; negligible, and fully released by
  `stop()` on shutdown.
- Self-healing acts only on *transitions* and is fail-safe (a throwing action is
  recorded, never propagated) — it cannot loop or cascade.

## Security & performance impact

No new inbound surface; all control routes reuse the `platform_admin(platform)`
L3 guard. Runtime insights carry sizes/latencies, no payloads. Performance:
breaker/bulkhead/shedder decisions are O(1) in-memory; the shedder sits ahead of
the work so shed requests cost almost nothing; runtime sampling is off the hot
path. Full suite + harness confirm **zero regression** and ledger integrity held
through every W10 fault-injection phase.

## Operational impact & control plane

- `GET /v1/admin/overview` — one call: system/version/uptime, dependency health +
  topology, event-platform stats, distributed + rate-limit state, **resilience
  stats, runtime snapshot** (Mission 4 unification).
- `GET /v1/admin/runtime[/insights]`, `POST /v1/admin/runtime/sample`.
- `GET /v1/admin/resilience`, `POST /v1/admin/resilience/breakers/:name/reset`.
- New Grafana dashboards: `resilience` (breaker outcomes, short-circuits saved,
  bulkhead rejections, retries, shed vs passed, self-heal) and `runtime` (heap,
  ELU, loop-delay p99, GC pause p95, handles).
- Graceful shutdown (SIGTERM/SIGINT): stop sampling, flush spans, close the
  listener.

## Testing strategy & validation results

- **Unit (`tests/resilience.test.js`, 38):** breaker state machine incl.
  rolling-window ageing, half-open success/failure and concurrency cap, fallback,
  reset, metrics; bulkhead concurrency cap/queue/overflow/failure; retry backoff
  math, jitter bounds, classification, budget amplification cap, deadlines; load
  shed by in-flight and by loop-lag, critical exemption, aborted-request release;
  self-heal transition firing, once-only, fail-safe; runtime sampling, leak/stall/
  saturation/handle-leak detection with severity bands, no-false-positive-at-boot.
- **Chaos (harness W10):** breaker trips + spares dependency + recovers over
  ChaosKv; bulkhead sheds overflow without cascade; retry recovers a blip;
  deadline abandons a hung call; shedder sheds normal / protects critical.
- **Runtime (harness W11):** live metrics reach the registry; synthetic leak
  window is flagged; the live process is **not** false-flagged.
- **Results:** motse suite **640 green** (was 602; +38), root 131 green, harness
  **77/77 PASS** full + smoke; gates foundation 99.4/94.7, observability
  98.6/91.6, enterprise 98.8/91.1, **resilience 97.7/91.5** — all ≥95/95/90.

## Rollback plan

Fully reversible. The load-shed middleware is the only request-path insertion —
removing that one `app.use` line restores prior behaviour; the shedder's generous
defaults mean it is inert under normal load regardless. All other primitives are
opt-in call-site helpers and admin routes; the runtime sampler is off unless
`server.js` starts it. Reverting the commit removes everything with no schema,
state, or API-contract change.

## Future extension points

Wrap ledger/payment/QR external calls with breakers+bulkheads (the facade is
ready); cross-pod breaker coordination via the distributed KV; thread-pool
(libuv) utilization once Node exposes it stably; request hedging on read paths;
self-heal actions for cache rebuild and worker restart; feed runtime insights
into the SLO burn-rate alerts and capacity forecasting (Mission 9).

## Production readiness assessment & success criteria — met

✅ Circuit breakers, bulkheads, adaptive retry, timeout budgets, load shedding,
graceful degradation and self-healing — **all implemented and proven under the
chaos harness** (no resilience feature shipped without measurable validation). ✅
Runtime behaviour is continuously observable with **predictive** insights, not
just raw gauges. ✅ Unified operations overview. ✅ All existing guarantees intact
(transactions, idempotency, observability, backward compatibility); coverage gate
added, none weakened; CI enforces it. The platform now detects, mitigates, and
recovers from dependency failure autonomously within a pod, and surfaces leaks and
stalls before they page.
