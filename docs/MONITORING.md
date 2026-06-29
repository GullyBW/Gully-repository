# Monitoring & observability

## Health & readiness

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | basic liveness (service name) |
| `GET /health/live` | liveness probe (k8s `livenessProbe`) |
| `GET /health/ready` | readiness — checks DB connection (Postgres/Mongo) + cache backend; reports `driver`; 503 when not ready |
| `GET /metrics` | in-process counters (requests, status classes, errors, memory, uptime) |

## Structured logging

Each request logs one JSON line to stdout with `id` (request id), `method`,
`path`, `status`, `ms`. The request id is read from / echoed to the
`x-request-id` header for cross-service correlation. Ship stdout to your log
platform (CloudWatch, Loki, Datadog…).

## Metrics

`/metrics` returns request totals by status class and 5xx error count. For
multi-instance/production, plug a real collector into
`src/services/metrics.service.js#record` (Prometheus client / OpenTelemetry) and
scrape per instance.

## Crash reporting

`src/utils/crashReporter.js` installs `unhandledRejection` / `uncaughtException`
guards and integrates **Sentry** when `SENTRY_DSN` is set and `@sentry/node` is
installed (`npm i @sentry/node`). Swap the `report` body for another provider.

## What to watch

| Area | Signal |
| --- | --- |
| API | 5xx rate (`/metrics`), p95 latency (logs `ms`) |
| Auth | spikes in `login_failed` audit entries (`GET /api/admin/audit-logs?action=login_failed`) |
| Database | DB connection state (`/health/ready`), slow queries; `postgres-exporter` metrics |
| Notifications | push delivery failures (PushService logs / FCM dashboard) |
| Uploads | storage errors, disk/bucket usage |
| Payments | failed vs succeeded counts (`GET /api/admin/payments?status=failed`) |
| Audit | admin actions, refunds, suspensions (audit-log viewer) |

## Mobile crash reporting

Add Firebase Crashlytics in the native projects (Android/iOS) for client crash
visibility; the web/PWA can use Sentry's browser SDK.
