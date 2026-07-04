# Four Governed DPI Planes (Phase 6)

Motse's cross-cutting authorization, AI access, and analytical exposure are now
**externalized into four hard-separated, event-sourced planes** with cryptographic
provenance, a cross-plane audit graph, cell-based sovereign isolation, and an
on-demand DPI certification mode. Additive and backward compatible — the Ledger
remains the sole financial source of truth and no existing API, SDK, plugin,
client or test changed.

- **Identity Plane** — `src/governance/identity.plane.js`
- **Policy Decision Kernel** — `src/governance/policy.kernel.js`
- **Governed AI Retrieval Gateway** — `src/governance/ai.gateway.js`
- **Data Product Plane** — `src/governance/data.product.plane.js`
- **Provenance** — `src/governance/provenance.js`
- **Audit Graph** — `src/governance/audit.graph.js`
- **Cell Registry** — `src/governance/cell.registry.js`
- **Certification** — `src/governance/certification.js`
- Wiring — `src/container.js`; HTTP — `/v1/identity/assertion`, `/v1/ai/retrieve`, `/v1/admin/{policy,audit,data-products,ai/corpus,cells,certification}`

## 1. Identity Plane (assertions only)

A hard boundary over the Identity Graph. It exposes **only identity assertions** —
`{ subject, authenticated, level, roles, tenant, suspended, ward_ref, morafe_refs }`
— and never lets another plane read `identity.users`/`identity.roles`. Every other
plane consumes assertions, never the raw identity stores.

## 2. Policy Decision Kernel (PDK)

The single, central, **stateless, deterministic** decision point.

```
decide({ assertion, tenant, resource, action, context, riskScore })
  → { decision: 'ALLOW' | 'DENY' | 'STEP_UP_AUTH', reason, obligations, policy_decision_id, evaluated, at }
```

- **Deny-by-default** (Zero Trust): no matching ALLOW ⇒ DENY.
- **Deny-overrides**: any DENY short-circuits and wins.
- **Deterministic**: same inputs → same decision (rules are pure); only the
  decision id and timestamp differ.
- **Fully auditable**: every decision is appended to the audit chain and published
  as a `policy.decided` event → Event Store → Audit Graph.

Default rule set (ordered): suspended-subject deny, tenant isolation, authenticated-
mutation, restricted-content fail-closed, explicit role/level/morafe requirements,
risk-based step-up for sensitive actions, then the public-read and authenticated
grants. Custom rules compose via `register(name, fn)`. The kernel holds no mutable
domain state, so it is trivially replicable per cell.

## 3. Governed AI Retrieval Gateway

**All** AI retrieval flows through here; the model never touches a raw domain store.
Each call: resolves an assertion → asks the PDK to authorize the retrieval → fetches
candidates from a **classified corpus/projection** (never `heritage.items` /
`identity.users` / the ledger) → filters **every** candidate through tenant isolation,
data classification and a **per-document PDK decision** → sanitizes and returns the
survivors inside a **signed provenance envelope**, emitting an audited
`ai.retrieval.performed` event.

Restricted heritage / PII can never leak into a prompt: an anonymous or under-verified
subject simply receives fewer documents. `POST /v1/ai/retrieve` (optional auth) and
`POST /v1/admin/ai/corpus` (classified ingestion).

## 4. Data Product Plane

Exposes **only projections / analytics / signed datasets** — never raw events or
database rows. Every read is PDK-authorized and returned in a signed provenance
envelope. Products are a catalog of named CQRS projections with a classification
(`public`/`internal`/`restricted`) and optional role/level requirement.
`GET /v1/admin/data-products[/:name]`.

## Cryptographic provenance

Every governed output is wrapped in a tamper-evident envelope binding it to the
events that produced it, the policy decision that authorized it, the tenant, and an
HMAC signature over a deterministic (sorted-key) serialization. `verify()` proves the
output is unmodified and platform-signed. Production swaps the HMAC for an asymmetric
key with no envelope change.

## Cross-plane audit graph

A pure read model over the Event Store. `trace(correlationId)` stitches identity,
policy, AI, data, cell and ledger events sharing a request's correlation id into a
causal graph (causation + sequence edges) for forensic tracing and replay;
`summary()` rolls up activity by plane and decision. `GET /v1/admin/audit/graph/:id`,
`GET /v1/admin/audit/planes`.

## Cell-based sovereign isolation

A cell is an isolated unit (own event-store partition, ledger shard, policy kernel,
AI gateway) serving a bounded set of tenants in a residency zone. The registry models
the contract the physical topology enforces: **no implicit cross-cell access**
(`assertSameCell` fails closed); every cross-cell interaction is **explicit,
policy-approved and logged** (`crossCell` requires a PDK ALLOW + emits
`cell.cross_access`); each cell declares a failure-containment contract (blast radius,
degraded mode, offline behaviour, recovery strategy) so failures don't cascade.
`GET /v1/admin/cells[/:id/contract]`.

## DPI Certification Mode

`certification.run()` (`POST /v1/admin/certification/run`) self-audits on demand:
replays the event log and checks sequence integrity, validates the Ledger trial
balance, verifies policy-decision coverage, confirms every AI retrieval carried a
policy decision, and rolls up cross-plane activity — returning a **single signed,
reproducible compliance report** (`passed` iff sequence intact ∧ ledger balanced ∧
AI retrievals governed).

## Event schemas (Phase 6)

| Event | Required fields | Plane |
| --- | --- | --- |
| `policy.decided` | `policy_decision_id`, `decision` | policy |
| `ai.retrieval.performed` | `request_id`, `decision` | ai |
| `data.product.read` | `product`, `decision` | data |
| `cell.cross_access` | `from_cell`, `to_cell`, `decision` | cell |

All carry `correlation_id`/`causation_id`/`plane`/`stream_id` so the Event Store,
CQRS projections and Audit Graph stitch them automatically.

## Acceptance criteria — status

- ✅ No cross-plane direct access — AI/Data planes never read raw stores; Identity Plane exposes only assertions.
- ✅ All decisions flow through the Policy Kernel (deny-by-default, deterministic, audited).
- ✅ All AI access is governed (per-document policy filter; no restricted/PII leak).
- ✅ Ledger remains immutable and authoritative (certification asserts a balanced trial balance).
- ✅ All actions are event-sourced (every plane emits to the Event Store).
- ✅ All outputs are auditable and reproducible (signed provenance + audit graph + certification).
- ✅ Multi-cell isolation enforced (fail-closed same-cell guard; policy-approved, logged cross-cell).
- ✅ All existing tests remain green (454 Motse + 131 Tirelo).

Coverage: `npm run motse:coverage:p6` — 99.1% statements / 93.4% branches / 100% lines.
