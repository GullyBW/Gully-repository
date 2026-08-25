# Stable Integration Contracts (Stabilization Part 3)

Every interaction between bounded contexts is a **versioned contract** declared in
`src/contracts/integration-contracts.js`: API operations, domain events and canonical data schemas,
each with its owner, consumers, field set, authentication, authorization, error model and stability.

> **The rule: interfaces stay stable while internals evolve.** A revision that would break a consumer
> is **refused** unless the caller explicitly takes a major version *and* records a sunset window.
> This is a fail-closed code path, not a review convention — `APP-FIT-INTEGRATION-CONTRACTS` enforces
> it, and the composition root refuses to start on an invalid contract set.

Generate the artifacts: `npm run contracts` (deterministic, signed, diffable) ·
`npm run contracts -- --openapi` for the OpenAPI fragment only. Live: `GET /api/contracts` ·
`GET /api/contracts/{id}` · `GET /api/contracts/openapi`.

## The canonical error model

A contract may only declare errors from this closed set, so one consumer error-handler works across
every context.

| Code | HTTP | Retryable | Meaning |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | no | The request violated the declared schema or field rules. |
| `IDENTITY_REFUSED` | 400 | no | An identity or content field was supplied where the contract forbids one. |
| `UNAUTHENTICATED` | 401 | no | No valid session or federated token was presented. |
| `POLICY_DENIED` | 403 | no | Default-deny authorization refused the action. |
| `NOT_FOUND` | 404 | no | The addressed resource does not exist (or is not visible to this principal). |
| `STATE_CONFLICT` | 409 | no | The requested transition is illegal for the current lifecycle state. |
| `HUMAN_APPROVAL_REQUIRED` | 409 | no | The action requires a recorded decision by a named human authority. |
| `RATE_LIMITED` | 429 | **yes** | The consumer exceeded its governed rate allocation. |
| `UPSTREAM_UNAVAILABLE` | 503 | **yes** | A downstream port failed closed; the platform did not degrade silently. |

`IDENTITY_REFUSED` and `HUMAN_APPROVAL_REQUIRED` exist because the platform's two hardest
guarantees — no identity, no automated authority — must be expressible in the wire protocol, not just
in prose.

## API contracts

| Contract | Operation | Owner | Authentication | Authorization |
|---|---|---|---|---|
| `api.reports.submit` | `POST /api/reports` | intake | **anonymous** | none — anonymous intake is a constitutional guarantee |
| `api.reports.status` | `GET /api/reports/{case_code}/status` | intake | case-code | possession of the case code only |
| `api.evidence.attach` | `POST /api/reports/{case_code}/evidence` | custody | case-code | possession of the case code only |
| `api.investigator.review` | `POST /api/investigator/{case_code}/review` | investigation | session | role=investigator, matter-scoped, JIT |
| `api.case.transition` | `POST /api/investigator/{case_code}/transition` | investigation | session | RBAC+ABAC permission=transition-case |
| `api.oversight.dashboard` | `GET /api/oversight/dashboard` | analytics | session | role=oversight-board |
| `api.governance.decision` | `POST /api/governance/decisions` | governance-oversight | session | role=oversight-board (**human-only**) |
| `api.assurance.evidence` | `GET /api/assurance/evidence-package` | assurance | session | role=admin |
| `api.data-exchange.request` | `POST /api/data-exchange/agreements` | data-exchange | federated-oidc | data steward approval; purpose must be permitted |

`anonymous` and `case-code` are **first-class authentication modes**, not gaps: the reporting path
must never require an identity, and status is retrievable by possession of the case code alone.

## Event contracts

All events are ordered on their topic and PII-free by construction; the envelope itself is a contract.

| Contract | Event | Producer | Consumers |
|---|---|---|---|
| `schema.EventEnvelope` | envelope | platform-events | every producer and consumer |
| `event.case.submitted` | `CaseSubmitted` | intake | investigation, analytics, orchestration |
| `event.case.reviewed` | `CaseReviewed` | investigation | analytics, orchestration |
| `event.case.transitioned` | `CaseTransitioned` | investigation | analytics, orchestration, observability |
| `event.evidence.attached` | `EvidenceAttached` | custody | investigation, analytics |
| `event.governance.decided` | `GovernanceDecided` | governance-oversight | assurance, knowledge, observability |

`GovernanceDecided` is emitted **only after** a named human recorded the decision — the event reports
a decision, it never constitutes one.

## Data schema contracts

`schema.Case`, `schema.EvidenceRef` and `schema.Agency` mirror the canonical model
(`CANONICAL_MODEL` in `fabric/registry.js`) and form the `canonical-model` shared kernel with
`data-exchange` and `api-governance`.

One deliberate divergence: the canonical `Agency.name` is published as **`agencyName`** so that a bare
`name` never appears on a wire contract. The identity denylist (`name`, `omang`, `email`, `phone`,
`address`, `dob`, `ip`, `content`, `reporter`) is absolute and has no exemptions — an organisation
field is renamed rather than the rule weakened.

## Versioning strategy

| Bump | When | Process |
|---|---|---|
| **major** | Field removed · required field added · type changed · error code removed · authentication or authorization changed | New major published side by side → consumers migrated → previous major deprecated with a **recorded sunset** → retired. Dual-run is mandatory. |
| **minor** | Optional field added · new error code | Publish; no consumer action required. |
| **patch** | Documentation, stability label or note | Publish. |

The HTTP surface is additionally versioned by path prefix (`/v1`). A contract may only be retired
from the `deprecated` state, and only after its sunset window is recorded. Any change to
authentication or authorization is flagged `securityReview` and goes to the ISRB regardless of size.

## What the fitness gate proves

`APP-FIT-INTEGRATION-CONTRACTS` verifies, on every build, that: every context crossing a boundary by
event or HTTP has a contract; every declared error is canonical; adding an optional field is `minor`
while removing any field is `major`; a breaking revision without a major version is refused; a major
version without a sunset is refused; an authentication change is breaking and security-relevant; a
contract carrying an identity field is refused; and the generated OpenAPI and event definitions are
deterministic and keep their ordering/PII-free guarantees.
