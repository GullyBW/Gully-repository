# Foundation Layer — Transactions, Outbox, Distributed Runtime (F1–F3)

Production-hardening of the substrate beneath the domain platform. Every change
is **additive and default-preserving** — the in-memory single-process behaviour
is byte-identical, so all existing tests stay green, and production simply
points the same interfaces at Postgres/Redis. No breaking API changes; the
Ledger remains the sole financial source of truth.

- **F1 transactions** — `src/kernel/store.js`
- **F2 transactional outbox** — `src/persistence/outbox.js`
- **F3 distributed runtime** — `src/distributed/kv.js`, `src/distributed/services.js`
- Wiring — `src/container.js` (`platform.outbox`, `platform.kv`, `platform.distributed`)
- Admin — `/v1/admin/outbox*`, `/v1/admin/distributed`
- CI gate — `.github/workflows/foundation.yml`

## F1 — Repository transactional integrity (Unit of Work)

`Store.transaction(fn)` runs a callback as one Unit of Work. Mutations across any
number of collections commit together, or — if `fn` throws — roll back atomically
(the journal replays inverse operations newest-first) and the error re-throws.
Nested calls join the outer unit. **Outside a transaction there is no journaling**
(no closure allocation, identical behaviour), so every existing caller is
unaffected. This is the in-memory analogue of a Postgres transaction and the seam
a real `PgCollection`/`UnitOfWork` drops into unchanged.

```js
store.transaction(() => {
  ledger.providerDeposit({ ... });   // both commit,
  intents.update(id, { state });     // or both roll back
});
```

## F2 — Transactional Outbox

`OutboxService.run(work)` guarantees a domain state change and the events it emits
commit **atomically**, then delivers those events **at-least-once**:

1. `work({ stage })` performs the domain mutations and stages events; both the
   state rows and the outbox rows are written inside the **same Unit of Work** —
   if `work` throws, everything rolls back (no orphaned events, no lost events).
2. After commit, the relay (`drain`) publishes pending rows to the Event Bus in
   sequence order, marking each published. Transient failures are retried with
   bounded attempts (`maxAttempts`, default 5); exhausted rows move to a
   **dead-letter queue** for operator replay (`replayDead`). `drain` is idempotent
   (published rows are skipped), so a crashed relay recovers cleanly, and every
   delivered event carries a stable `outbox_id` for idempotent consumption.

Additive: existing `bus.publish` paths are unchanged; new/critical flows opt in.
Admin: `GET /v1/admin/outbox` (stats), `GET /v1/admin/outbox/dead-letters`,
`POST /v1/admin/outbox/drain`, `POST /v1/admin/outbox/dead-letters/:id/replay`.

## F3 — Redis-ready distributed runtime

A tiny Redis-shaped async KV interface (`get/set/setNx/incrBy/del/pttl`) with two
adapters selected by configuration:

- **`InMemoryKvAdapter`** (default) — preserves today's single-process behaviour.
- **`RedisKvAdapter`** — maps the same interface onto a real Redis client; used
  when `REDIS_URL` is set (or a client is injected).

On top of the KV, three cross-pod services enforce correctly across instances:

| Service | Guarantee |
| --- | --- |
| `DistributedIdempotency.runOnce(key, fn)` | exactly-once execution per key across pods (`SETNX`); releases on failure so retries proceed |
| `DistributedRateLimiter.take(id, cost)` | one **shared** fixed-window counter (atomic `INCR`) — N pods enforce a single global limit |
| `DistributedLock.withLock(name, fn)` | mutual exclusion with a fencing token + TTL; ownership-checked release (never steals a lock) |

Additive: the existing in-process `RateLimiter`/`IdempotencyRegistry` are untouched.
Multi-pod deployments opt in by setting `REDIS_URL`; the request path can then adopt
these without further change. `GET /v1/admin/distributed` reports the active adapter.

## Guarantees & validation

- **Stability:** all pre-existing tests remain green; 26 new Foundation tests added
  (`persistence` / `outbox` / `distributed`).
- **Coverage:** `npm run motse:coverage:foundation` — 98.6% statements / 93.8%
  branches / 99.5% lines on the new components.
- **Concurrency:** the distributed suite simulates concurrent callers — 25 racing
  `runOnce` on one key → exactly one execution; concurrent `take` → one global
  limit; lock contention → mutual exclusion.
- **CI:** `.github/workflows/foundation.yml` gates persistence, outbox, distributed
  and the coverage threshold on every push/PR.
- **Reversibility:** no existing interface changed signature; the transaction,
  outbox and distributed layers are opt-in and default to current behaviour.
