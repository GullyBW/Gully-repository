# Enterprise Observability (Phase 10, Part 5)

The Tracer already produces W3C-`traceparent` spans with identity redaction. This is the **analysis
layer** on top: OpenTelemetry-shaped resource and semantic attributes, business- and audit-event
tracing, the service map, dependency graph, runtime topology, failure-propagation analysis, alert
routing and a computed health score (`src/observability/telemetry.js`).

Gated by `APP-FIT-OBSERVABILITY-TELEMETRY`. Live: `GET /api/admin/telemetry` ·
`GET /api/admin/telemetry/failure/{service}`.

## Semantic conventions

Spans carry OpenTelemetry resource attributes (`service.name`, `service.namespace`,
`deployment.environment`) and only **allow-listed** semantic attributes per span kind. Anything else
is dropped at construction and reported in `dropped` — the Tracer's redaction is the second line of
defence, not the first.

Domain attributes are deliberately narrow and non-identifying: `event.domain`, `event.name`,
`event.outcome`, `njtip.case_code`, `njtip.zone`, `njtip.actor_role`, `njtip.decision`.

## Business and audit event tracing

`businessEvent()` and `auditEvent()` emit spans under the same trace id as the request that caused
them, so one correlation id joins **request → logs → business outcome → audit record**. That is what
makes "show me everything that happened when this decision was recorded" a query rather than an
investigation.

## Runtime topology — and why it is zone-shaped

Twenty services across the three constitutional zones. The load-bearing rule, enforced by the
validator: **no service depends directly on a service in another zone.** Zones integrate *only*
through declared PII-free event flows over their brokers. A cross-zone dependency in the topology
fails the build, because it would be a constitutional violation expressed as an architecture diagram.

```
independent            executive                     judiciary
  intake-api ─┐          case-service ─┐               governance-ledger ─┐
  policy-engine│         evidence-store │              persistence-jud    │
  event-store-ind        kms/object-store│             oversight-api
  persistence-ind        custody-ledger  │
  notification-service   identity        │
  broker-ind             event-store-exec│
        │                persistence-exec│
        │                analytics       │
        └──── case.events ───► broker-exec └──── governance.events ───► broker-jud
              (PII-free)                              (PII-free)
```

## Failure propagation — down vs degraded

The distinction that makes the analysis honest:

- **`dependsOn`** — the service cannot serve without it. Loss propagates.
- **`degradesOn`** — its loss reduces function; the service keeps serving. Loss does **not** propagate.

So losing `notification-service` degrades `intake-api` but does **not** break anonymous reporting,
while losing `persistence-ind` does. `singlePointsOfFailure()` returns exactly the services whose
loss breaks the constitutional path: `intake-api`, `policy-engine`, `event-store-ind`,
`persistence-ind`. Those four are known in advance rather than discovered during an incident.

## Alert routing

Every alert routes to an accountable team **and its governance board** (`security → SOC / ISRB`,
`reliability → SRE / ORB`, `privacy → Privacy Engineering / OB`, …). An unknown domain is reported as
`routed: false` with a fallback, because an unrouted alert is an unowned alert.

## Health score

A weighted composite over architecture (0.25), reliability (0.20), security (0.20), privacy (0.15),
infrastructure (0.10) and governance (0.10). Every input is a **measured** signal; each contribution
is shown. An unmeasured domain lowers **coverage** and contributes zero — it never silently inflates
the score, which is the failure mode of most executive health metrics.
