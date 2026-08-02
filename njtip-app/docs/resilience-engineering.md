# Performance & Resilience Engineering (Phase 10, Part 6 · Phase 11, Part 6)

Load, stress, spike, soak and recovery testing plus fault injection and chaos experiments — all
**deterministic and executable in CI**, so resilience is verified on every commit rather than at an
occasional game day (`src/twin2/chaos.js`).

Gated by `APP-FIT-CHAOS-RESILIENCE` and `APP-FIT-CHAOS-DETECT-RECOVER`. Live:
`GET /api/admin/resilience/suite`. Runs in CI via `npm run chaos`.

> Every assertion is a function of **injected state**, never of elapsed time. That is what lets a
> chaos suite live in CI without becoming flaky and getting disabled.

## Performance tests

| Test | Hypothesis |
|---|---|
| **load** | Under sustained volume every report is accepted exactly once and both chains stay intact |
| **stress** | Beyond nominal volume the platform either accepts or refuses — it never corrupts a chain |
| **spike** | A sudden burst after idle loses nothing and keeps the event log verifiable |
| **soak** | Over prolonged operation neither the audit chain nor the custody chain drifts |
| **recovery** | Read models are reconstructible from the event log with no loss — the log is the source of truth |

## The detect-and-recover contract (Phase 11)

An experiment that only proves the platform *survives* a fault proves half of what matters. Every
experiment must now report two booleans, and `runExperiment()` **refuses to pass one that does not**:

| Field | Question | Why it is not optional |
|---|---|---|
| `detected` | Did the fault become **visible** to the platform? | A fault the system absorbs silently is one you learn about from a citizen, not a dashboard |
| `recovered` | Did steady state **return** once the fault was withdrawn? | A system that survives but stays degraded has traded an outage for a permanent one |

The gate proves the contract bites: it substitutes a crafted experiment that returns
`{ pass: true }` and nothing else, and asserts the runner rejects it naming **both** missing halves.
A contract nothing can fail is decoration.

## Chaos experiments

Each states a steady-state hypothesis, injects a fault into the **real adapters**, and asserts the
hypothesis still holds — then that the fault was seen and steady state came back.

| Fault | Hypothesis | Detected by | Recovered by |
|---|---|---|---|
| Dependency fails repeatedly | The breaker opens and the platform fails **fast** | breaker `open` + fast-fail | probe after cooldown closes it |
| **Dependency latency** | A merely *slow* dependency is shed against its budget, not queued | p95 past budget, severity `critical` | budget clears, no operator action |
| Network partition | Events are **retained** and replay on recovery | outbox depth ≠ 0 during partition | 2 replayed, 0 lost, 0 dead-lettered |
| **DNS failure** | Last-known-good carries the outage, then stops lying | resolution failures + `stale-cache` | authoritative answer returns |
| **Certificate expiry** | Expiry is flagged *before* it happens; expired is refused | `renew-due` at day 70, refused at day 95 | rotation issues a valid successor |
| Database write failure | The write fails **closed** — no partial state | error surfaces, store size unchanged | driver heals, write succeeds |
| Storage failure | Plaintext is **never** written as a fallback | plaintext refused | ciphertext accepted |
| **Storage corruption** | Corruption is caught by digest, never served | digest mismatch + decrypt refused | verified replica restores it |
| Identity provider failure | Forged and tampered tokens grant nothing | both rejected | valid token still accepted |
| **Identity provider outage** | Auth fails **closed**; anonymous reporting is untouched | every verify throws | token verifies again, no re-issue |
| Key management failure | Evidence handling stops rather than proceeding unencrypted | garbage refused | round-trip works |
| Clock skew | Ordering comes from the hash chain, not timestamps | node offset past tolerance | node resyncs; chain never moved |
| **Message duplication** | Handlers are idempotent — a duplicate applies once | 2 duplicates seen by event id | new events still apply |
| **Message reordering** | A gap **buffers** rather than applying out of order | seq 3 buffered, gap at 2 | drains `[1,2,3]` when 2 arrives |
| **Partial regional outage** | Quorum survives; a lagging region is fenced | 2/3 healthy, replica lag detected | catch-up restores consistency |
| **Degraded service** | The platform degrades rather than failing | `degraded` non-empty, `impacted` not | nothing degraded once healed |
| **Cascading failure** | Blast radius is **bounded by zone** | contained to one zone; SPOF named | no residual impact |

Bold rows are the Phase 11 additions. All seventeen run in CI on every commit.

## Fault models

Four small deterministic models make the new scenarios honest rather than hand-waved:

- `StubResolver` — TTL cache plus a bounded **stale-serving window**. Serving stale beyond the
  window is worse than failing: it routes traffic to an address nobody can confirm is still ours.
- `OrderedConsumer` — buffers ahead-of-sequence events and drains only when the gap fills. The
  alternative is a projection that silently disagrees with the ledger.
- `detectClockSkew()` — offset against a reference beyond tolerance. "We ignore timestamps" is only
  safe if you also know *when they are wrong*.
- `latencyBudget()` — p95 against a budget with `ok | warning | critical`. A dependency that never
  errors but doubles its latency has still broken its contract.

## A note on the partition experiment

Modelling it correctly took two attempts, and the failed attempt is worth recording. Draining the
reference broker with **no subscriber attached** marks events delivered — so "publish during a
partition, then drain" silently consumed them and the experiment passed for the wrong reason.

The honest model is a subscriber whose handler **throws** (the link is down): delivery fails, the
events stay in the outbox with backoff, and when the link heals they replay. That exercises the
guarantee that actually matters — the transactional outbox retains — and it is why the experiment
now advances an injected clock past the backoff rather than assuming instant redelivery.

**Production implication:** an event published before any consumer subscribes is consumed with no
consumer in the reference driver. A durable broker (Kafka/RabbitMQ/NATS) retains by partition offset
instead, which is one of the reasons the messaging migration item exists in the
[migration roadmap](./component-migration-roadmap.md).
