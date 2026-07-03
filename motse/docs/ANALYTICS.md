# Analytics Guide (Phase 2, WS5)

`GET /v1/admin/analytics/dashboard` (portal → Analytics) returns every WS5
aggregate in one call:

| Metric | Source |
| --- | --- |
| DAU / MAU (30-day) | truncated SHA-256 of pseudonymous user ids per request-day |
| Feature usage | first path segment of successful `/v1` requests |
| Verification conversion (L0→L1→L2) | live identity-graph aggregate |
| Payment conversion + per-provider success | payment intents + completion events |
| Escrow completion | campaign state distribution |
| Tourism bookings | booking state distribution |
| Heritage usage | publication/validation events + totals |
| Offline usage | sync batches, USSD/SMS letsema joins, outbox mutations |
| Search queries + top terms | counted with **no user linkage** |
| Notification delivery | dispatch events + per-channel delivery stats |

## The PII rule (enforced, not aspirational)

- Active-user sets store `sha256(user_id)[0:16]` — nothing reversible.
- Search terms are counted globally, never per user.
- Funnels and distributions are aggregates of the live stores, computed at
  read time — analytics keeps no per-person rows at all.
- `analytics.test.js` asserts that **no user id in the system appears anywhere
  in the serialized dashboard**, and pilot usage reports count residents
  without naming them. New metrics must keep that test passing; anything
  requiring identifiable analysis needs DPO approval per doc §6.1 first.

## Extending

Subscribe in `analytics.service.js` (`sub('domain.event', …)`) for event-driven
counters, or compute aggregates from stores at read time in `dashboard()`.
Never store a raw user reference.
