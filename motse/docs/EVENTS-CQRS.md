# Platform Event Store & CQRS (Phase 5, WS2/WS3)

Motse now records an immutable, platform-wide event log beyond the financial
Ledger, and serves dashboards from materialized projections rather than
transactional tables. This is the foundation the rest of Phase 5 (observability,
compliance, executive intelligence, disaster recovery) builds on.

- **Event Store** — `src/events/event.store.js`
- **CQRS projections** — `src/events/projections.js`
- **Bus hook** — `EventBus.tap()` in `src/kernel/eventBus.js` (backward compatible)
- **Wiring** — `src/container.js` (`platform.eventStore`, `platform.projections`)
- **Admin API** — `/v1/admin/events*`, `/v1/admin/projections*`

## Event Store (WS2)

The Event Store taps the event bus **before any domain service publishes**, so
every event — identity, heritage, payments, workflows, governance, trusts,
tourism, notifications, plugins, AI, search, sync, QR — is persisted with a
global sequence number and an aggregate stream id. The store never mutates or
deletes; corrections are new events.

```
bus.publish(type, data)
   → EventBus.tap → EventStore._record → append(seq, stream_id, tenant, type, version, data)
                                          → onAppend subscribers (projection workers)
```

**Stream derivation:** `data.stream_id` → `data.aggregate_id` → the type's domain
prefix (e.g. `payments.*` → stream `payments`). Every record carries a `tenant`
(WS1-ready) and a `source_id` linking back to the bus event.

Capabilities:

| Capability | Method |
| --- | --- |
| Read / filter | `read({ stream, type, tenant, fromSeq, toSeq, until })` |
| Replay | `replay(handler, filter)` |
| Fold (projection primitive) | `fold(reducer, initial, filter)` |
| Snapshots | `snapshot(stream, state)`, `loadSnapshot(stream)` |
| Rebuild (snapshot + tail) | `rebuild(stream, reducer, initial)` |
| Event versioning | every record carries `version` |
| Schema evolution | `registerUpcaster(type, fromVersion, fn)` — chained upcasters |
| Time-travel debugging | `timeTravel(atIso, filter)` |
| Introspection | `stats()` |

**Upcasters** transform old event versions to the current shape at read time, so
schemas evolve without rewriting history. An upcaster returns `{ data, version }`
or a bare next-`data` object (version defaults to +1); chains apply until no more
match.

Admin: `GET /v1/admin/events`, `GET /v1/admin/events/stats`,
`GET /v1/admin/events/timetravel?at=…`.

## CQRS projections (WS3)

Writes flow through the domain services into the Event Store (command side);
reads are served from materialized views maintained by the `ProjectionRegistry`
(query side). **Dashboards consume projections, never the transactional
collections.**

A projection is a named reducer map `{ eventType: (state, event) => state }`
folded into a single materialized document. Workers advance **live** as events
append, **backfill** on registration, and can be **rebuilt** from zero at any
time — so a new report is a new projection with no schema migration.

```js
projections.register({
  name: 'payments_summary',
  initial: { captured_minor: 0, refunded_minor: 0, chargebacks: 0, captures: 0 },
  on: {
    'card.captured': (s, e) => ({ ...s, captured_minor: s.captured_minor + e.data.amount_minor, captures: s.captures + 1 }),
    'card.refunded': (s, e) => ({ ...s, refunded_minor: s.refunded_minor + e.data.amount_minor }),
    'card.chargeback': (s) => ({ ...s, chargebacks: s.chargebacks + 1 }),
  },
});
```

Seed projections wired at boot: `platform_activity` (curated event counter),
`payments_summary`, `qr_activity`. Admin: `GET /v1/admin/projections`,
`GET /v1/admin/projections/:name` (state + worker position + lag),
`POST /v1/admin/projections/:name/rebuild`.

## Backward compatibility

`EventBus.tap()` is additive — existing publish/subscribe/replay semantics are
unchanged, and a tap that throws can never break domain publishing. No existing
service, route or test was modified. The Ledger remains the single source of
financial truth; the Event Store is an observability/read-model layer over the
events domains already emit.
