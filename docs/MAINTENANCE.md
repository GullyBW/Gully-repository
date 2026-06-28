# Maintenance procedures

## Routine

| Cadence | Task |
| --- | --- |
| Daily | Verify nightly backup ran; check 5xx rate + p95 latency dashboards. |
| Weekly | Review audit logs for anomalies (failed logins, suspensions, refunds). |
| Monthly | `npm audit` / Dependabot review; patch high/critical vulns; rotate logs. |
| Quarterly | Test a database restore; review indexes vs. slow queries; rotate secrets. |
| Per release | Run the release checklist (`docs/RELEASE_CHECKLIST.md`). |

## Dependency updates

- Backend & mobile use pinned ranges; bump with `npm update` + run the full test
  suite (`npm test`, `npm run test:e2e`, `npm run test:e2e:ui`) before merging.
- `optionalDependencies` (`firebase-admin`, `ioredis`, `sharp`) degrade
  gracefully if absent — safe to upgrade independently.

## Database maintenance

- Watch index usage (`db.collection.aggregate([{ $indexStats: {} }])`); drop
  unused indexes, add compound indexes for hot query paths.
- Archive old `auditLogs` / `notifications` if growth is high (TTL index option).

## Log & data retention

- Application logs: ship to your platform; retain per policy (e.g. 30–90 days).
- Audit logs: retain longer for compliance.
- Notifications: consider a TTL/archival job at scale.

## Scaling

- Stateless API → scale horizontally behind the proxy; enable **Redis** so cache
  + rate limiting are shared across instances.
- Socket.IO across instances needs a shared adapter (e.g. `@socket.io/redis-adapter`)
  — add when running more than one instance.
- MongoDB → replica set; add read replicas / sharding as volume grows.

## Feature flags / config

All integrations are env-driven (`.env.example`). Toggling Maps/FCM/Redis/storage
is a config change with safe fallbacks — no redeploy of code required.
