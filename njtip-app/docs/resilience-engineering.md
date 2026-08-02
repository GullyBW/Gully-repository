# Performance & Resilience Engineering (Phase 10, Part 6)

Load, stress, spike, soak and recovery testing plus fault injection and chaos experiments — all
**deterministic and executable in CI**, so resilience is verified on every commit rather than at an
occasional game day (`src/twin2/chaos.js`).

Gated by `APP-FIT-CHAOS-RESILIENCE`. Live: `GET /api/admin/resilience/suite`. Runs in CI via
`npm run chaos`.

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

## Chaos experiments

Each states a steady-state hypothesis, injects a fault into the **real adapters**, and asserts the
hypothesis still holds.

| Fault | Hypothesis | Observed |
|---|---|---|
| Dependency fails repeatedly | The breaker opens and the platform fails **fast**, then probes again after cooldown | opens ✓ · fast-fail ✓ · probes again ✓ |
| Network partition | Events are **retained** and replay on recovery; nothing is lost | 2 retained, 2 replayed, 0 lost, 0 dead-lettered |
| Database write failure | The write fails **closed** — no partial state, error surfaces | error surfaced ✓ · store size unchanged ✓ |
| Storage failure | Plaintext is **never** written as a fallback | plaintext refused ✓ · ciphertext accepted ✓ |
| Identity provider failure | Authentication fails **closed** — forged and tampered tokens grant nothing | valid ✓ · forged rejected ✓ · tampered rejected ✓ |
| Key management failure | Evidence handling stops rather than proceeding unencrypted | round-trip ✓ · garbage refused ✓ |
| Clock skew | Ordering comes from the hash chain and sequence numbers, not timestamps | chain intact ✓ · sequenced ✓ |

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
