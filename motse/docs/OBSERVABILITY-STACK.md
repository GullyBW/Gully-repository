# Phase A — Operationalize Observability

Turning the emitted telemetry (Phase 2/3 traces, metrics, health) into an
operational stack: OTLP trace export to standard backends, trace-correlated
structured logs, and checked-in Grafana dashboards + Prometheus alert rules for
the Foundation. Every change is **additive, reversible, backward compatible,
independently testable, and OFF by default** — with no configuration the
platform behaves exactly as before.

## Executive summary

The platform already *emitted* traces, metrics and health. Phase A makes those
signals *usable in operations*:

- **OTLP export bridge** (`src/observability/otel.exporter.js`) ships finished
  spans to any OpenTelemetry backend (Jaeger, Grafana Tempo, an OTel Collector)
  in OTLP/JSON, wired to the tracer's existing `sink`. Disabled unless
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **Trace-correlated logs** — the structured `Logger` now attaches the active
  `trace_id`/`span_id` and a bound `service` to every line, so logs join traces
  in Loki/Elasticsearch/OpenSearch with no call-site changes.
- **Dashboards & alerts** — the Grafana dashboard generator and the Prometheus
  alert rules gain Foundation coverage (transactions, outbox, distributed
  runtime) driven by real emitted series, plus three new live gauges for clean
  absolute-value alerting.

19 new tests; full motse suite **541 green** (was 522); observability coverage
gate **99.4 % stmt / 98.0 % branch**; Foundation gate unchanged; zero breaking
changes.

## Problem statement

Signals without operational scaffolding are inert. Three gaps blocked
day-to-day use: (1) in-process spans could be inspected via admin routes but not
shipped to a tracing backend for cross-service correlation and retention;
(2) structured logs required manual `trace_id` threading to correlate with
traces; (3) the checked-in dashboards/alerts predated the Foundation and
Phase-2 instrumentation, so transactions, the outbox and the distributed runtime
had no panels or alert rules.

## Architectural rationale

Reuse the seams already built rather than add a heavyweight agent. The tracer
was designed with an optional `sink(span)` export hook; the OTLP exporter simply
implements that hook and formats to the OpenTelemetry wire shape, so adopting a
real backend is configuration, not a rewrite. The logger already supported bound
fields and an injectable sink; a small `context` provider evaluated at log time
pulls the active trace context from `AsyncLocalStorage` — the same mechanism the
tracer uses — so correlation is automatic and local. Dashboards/alerts extend
the existing generator and rules file, keeping one source of truth.

## Design decisions

1. **OTLP/JSON over OTLP/HTTP, dependency-free.** No new runtime dependency; the
   exporter serialises spans to `resourceSpans` JSON and POSTs to
   `${endpoint}/v1/traces`. Jaeger and Tempo both accept OTLP natively.
2. **Off by default; injectable transport.** `enabled` is true only when an
   endpoint (or a test transport) is present. The wire transport is injectable,
   so the exporter is fully testable without a network; the real HTTP transport
   is `istanbul ignore`d and fire-and-forget.
3. **Export never affects the request path.** Spans are buffered and flushed in
   batches; a transport throw is caught and counted as `dropped`, never raised.
4. **Log context is a provider, not a parameter.** `context: () => fields` is
   evaluated per line and merged at the lowest precedence (explicit call fields
   and bound fields win), so it can never clobber an intentional field, and a
   throwing provider is swallowed.
5. **Live gauges for absolute-value alerts.** `motse_outbox_pending`,
   `motse_outbox_dead`, `motse_distributed_redis_backed` are `gaugeFn`s
   evaluated on scrape — cleaner to alert on than histogram samples.
6. **Config is tested against emitted reality.** A test asserts every metric the
   Foundation dashboards/alerts reference is actually rendered by the platform,
   preventing dashboard/alert drift.

## Alternatives considered

- **Full OpenTelemetry SDK + auto-instrumentation.** Rejected for now: heavy
  dependency, larger attack surface, and our tracer already produces the needed
  spans. The `sink` seam leaves this as a drop-in future option.
- **A logging framework (pino/winston).** Rejected: the existing JSON-lines
  logger already satisfies the structured-logging contract; swapping it would be
  a breaking change for no gain.
- **Push metrics (StatsD/OTLP metrics).** Rejected: Prometheus scrape of
  `/metrics` is already in place and is the platform's established model.
- **Histogram-sample backlog panel.** Replaced with a live gauge — simpler and
  correct for absolute thresholds.

## Trade-offs

- In-process buffering means spans dropped on a hard crash before flush are
  lost; acceptable for telemetry, and a Collector sidecar removes even that.
- The synchronous fire-and-forget HTTP transport does not retry; a Collector is
  the recommended durable hop for production. The exporter counts `dropped` for
  visibility.
- Auto-enriching every log with context adds a tiny per-line function call;
  negligible and skipped entirely when no provider is set.

## Implementation plan / files affected

**New**
- `src/observability/otel.exporter.js` — OTLP span exporter.
- `tests/observability-stack.test.js` — 19 tests (exporter, log enrichment, config integrity, wiring).

**Modified**
- `src/monitoring/logger.js` — optional `context` provider, propagated through `with()`, fail-safe.
- `src/container.js` — construct the exporter, feed it via `tracer.sink`; enrich `platform.logger` with trace context + `service`; expose `platform.otel`.
- `src/monitoring/monitoring.service.js` — `motse_outbox_pending`, `motse_outbox_dead`, `motse_distributed_redis_backed` gauges.
- `src/admin/admin.routes.js` — `GET /observability/otel`, `POST /observability/otel/flush`.
- `deploy/motse/observability/generate-dashboards.js` — `foundation`, `outbox`, `distributed` dashboards (regenerated JSON checked in).
- `deploy/motse/observability/prometheus-alerts.yaml` — `motse-foundation` alert group.
- `.github/workflows/foundation.yml` — run the stack suite + assert dashboards regenerate without drift.

## Configuration changes

| Variable | Default | Effect |
|----------|---------|--------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | When set (e.g. `http://tempo:4318`), spans are exported. |
| `OTEL_SERVICE_NAME` | `motse-core` | `service.name` resource attribute + bound log `service`. |

No config → export disabled, logs carry only `service`, behaviour identical.

## Infrastructure requirements

Optional and only when enabling export: an OTLP/HTTP endpoint (Grafana Tempo,
Jaeger ≥1.35 with OTLP, or an OpenTelemetry Collector), plus a Prometheus
scraping `/metrics` and a Grafana importing `deploy/motse/observability/dashboards/*`.
Alert rules load from `prometheus-alerts.yaml`. None are required to run the
platform.

## Testing strategy & results

- **Exporter:** off-by-default no-op; OTLP shape (ids, parent linkage, status
  codes, int/double/bool/string attribute encoding, events, unix-nano);
  batch auto-flush; transport failure counted not thrown; minimal-span and
  bad-timestamp tolerance; default-transport selection.
- **Log enrichment:** dynamic context attach; precedence explicit > bound >
  context; `with()` propagation; throwing provider swallowed; no-provider
  backward compatibility.
- **Config integrity:** platform renders every metric the Foundation
  dashboards/alerts reference; dashboards parse and reference only emitted
  metrics; alert YAML parses with valid severities/summaries.
- **Wiring:** `platform.otel` disabled by default; request logs auto-correlate
  to the request trace id; admin OTLP status/flush routes.

```
npm run motse:test                    → 45 suites, 541 tests passing (was 522)
npm run motse:coverage:observability  → 99.37% stmt, 98.03% branch (gate ≥95/95/90)
npm run motse:coverage:foundation     → 98.74% stmt / 94.7% branch (unchanged pass)
node generate-dashboards.js           → 13 dashboards, no diff (CI drift gate)
```

## Performance impact

Negligible. Export is a buffer push (O(1)); flush serialises a batch off the
hot path. When disabled, `accept()` returns immediately. Log enrichment is one
function call + object spread per line, skipped when unset. The three new gauges
are evaluated only on Prometheus scrape.

## Security impact

No new inbound surface. Outbound export is opt-in to an operator-configured
endpoint only. Spans carry method/target/status and Foundation counters — no
payloads or PII. Admin OTLP routes reuse the `platform_admin(platform)` L3
guard. The exporter is fail-closed (drops on error). Logs gain `trace_id`/`span_id`
(opaque) and `service`, no new sensitive fields.

## Operational impact

Standard wiring: point `OTEL_EXPORTER_OTLP_ENDPOINT` at Tempo/Jaeger to get
distributed traces; import the dashboards; load the alerts. New alerts:
`TransactionFailureSpike`, `OutboxBacklogGrowing`, `OutboxDeadLetterAccumulation`,
`LockContentionHigh`, `RateLimitSaturation` — thresholds chosen to be actionable,
not noisy. Admin `GET /v1/admin/observability/otel` shows export health;
`POST …/otel/flush` forces a flush (e.g. before shutdown).

## Rollback strategy

Fully reversible. Unset `OTEL_EXPORTER_OTLP_ENDPOINT` to disable export at
runtime with no redeploy. The code is additive: reverting the commit removes the
exporter, the log `context` provider, the extra gauges and the dashboards/alerts
without touching Foundation or Phase-2/3 behaviour. No migrations, no state.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Export backpressure/slowness affects requests | Buffered + off-hot-path flush; failures dropped, never thrown; Collector sidecar recommended. |
| Dashboards drift from emitted metrics | CI regenerates dashboards (diff gate) and a test asserts referenced metrics are rendered. |
| Log context leaks sensitive data | Provider yields only opaque trace/span ids + service; lowest precedence, cannot override intentional fields. |
| Noisy alerts | Ratio/threshold rules with `for:` windows tuned to sustained conditions. |
| Enabling export opens egress | Opt-in, single operator-set endpoint; disabled by default. |

## Future extension points

- Bridge the exporter to a full OpenTelemetry SDK / Collector for retries, tail
  sampling and metric export.
- Flush on graceful shutdown (ties into Phase K lifecycle work).
- Exemplars linking Prometheus samples to trace ids.
- Log shipping config samples for Loki/OpenSearch (Promtail/Fluent Bit).
- Extend `withSpan`/metrics instrumentation to ledger/payments/QR call sites.

## Success criteria (met)

- ✅ Traces exportable to OTLP backends (Jaeger/Tempo/Collector), off by default.
- ✅ Logs carry `trace_id`/`span_id`/`service` automatically and join traces.
- ✅ Dashboards + alerts cover transactions, outbox and the distributed runtime,
  validated against emitted metrics.
- ✅ All existing tests pass; new code ≥95/95/90; Foundation guarantees intact.
- ✅ Additive, reversible, production-deployable, incrementally rolloutable.

## Constraints honoured

No Foundation redesign; no weakened transactional/idempotency guarantees; no
removed abstractions; no breaking API changes; coverage maintained/improved; CI
gates extended, never bypassed.
