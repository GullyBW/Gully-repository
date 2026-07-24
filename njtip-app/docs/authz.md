# Authorization & Domain Lifecycles (v1.2)

Two complementary layers decide **who may do what**, and one set of state machines decides **what may
happen next** — both default-deny, both pure and testable.

## Two authorization layers (defence in depth)

| Layer | Where | Granularity | Enforces |
|---|---|---|---|
| App RBAC + ABAC | [`src/authz.js`](../src/authz.js) | Route/action | Fast, declarative gate: may this *role* do this *action* given these *attributes*? |
| Twin IAM | `njtip-twin/src/model/iam.js` | Resource/matter | Zero-standing-privilege JIT grants, matter-scoped, MFA-gated, separation-of-duties |

The HTTP layer applies **RBAC+ABAC first** (cheap, deny early), and the domain still enforces the Twin's
fine-grained IAM at the point of evidence access. Neither layer can be skipped.

### RBAC matrix (the privilege ceiling)

`RBAC` maps each role to an explicit action list. Anything absent is **denied** — there is no implicit
privilege, and ABAC rules can only *add* denials, never grant.

| Role | Actions |
|---|---|
| `citizen` (anonymous) | submit-report, get-status, get-notifications, attach-evidence |
| `investigator` | list-reports, review-case, transition-case, read-evidence, seal-evidence, admit-evidence |
| `oversight-board` | view-dashboard, record-governance-decision |
| `admin` | admin-health, admin-metrics, admin-config |

### ABAC rules (attribute conditions, deny-only)

- **MFA step-up** — sensitive actions (review-case, read-evidence, admit-evidence,
  record-governance-decision) require `attributes.mfa === 'fido2'`.
- **Zone confinement** — a principal may act only within their own zone when both zones are known
  (`principalZone !== resourceZone` → deny).
- **Matter scoping** — case-scoped actions require the granted matter to match the case
  (`matter !== caseCode` → deny).
- **Accountability** — recording a governance decision requires a named `reviewer` **and** a `rationale`.

`authorize({ role, action, attributes })` returns `{ allow, reason }`. The server calls it via
`requirePermission(action, attributes)` after authenticating the bearer token (session **or** OIDC).

## Domain lifecycles (guarded state machines)

Both are pure, deterministic modules (no I/O, no clock). Illegal transitions are rejected by
construction; the workflow raises HTTP **409** on an illegal transition.

### Case lifecycle — [`src/domain/case-lifecycle.js`](../src/domain/case-lifecycle.js)

```
received ──review──▶ reviewed ──escalate──▶ escalated ──resolve──▶ resolved ──close──▶ closed
   │  └──escalate──▶ escalated        └──resolve──▶ resolved              (terminal)
   └──close──▶ closed
```

Events: `review · escalate · resolve · close`. `closed` is terminal. `investigatorReview` is guarded by
this machine (idempotent re-review is a no-op); `POST /api/investigator/{code}/transition` drives the
general capability.

### Evidence lifecycle — [`src/domain/evidence-lifecycle.js`](../src/domain/evidence-lifecycle.js)

```
ingested ──seal──▶ sealed ──open──▶ under-review ──admit──▶ admitted ──purge──▶ purged
                                        ├──exclude─▶ excluded ──purge──▶ purged
                                        └──seal────▶ sealed  (re-seal)
```

Events: `seal · open · admit · exclude · purge`. This governs *handling* status; the Twin's cryptographic
**chain of custody** remains the integrity proof (hashes prove the bytes were never altered).
Item state is stored durably on the case projection; `POST /api/investigator/{code}/evidence/{id}/transition`
drives it.

## Why this is safe to extend

Adding a role, action, or transition is a data change in one module, covered by unit tests
([`test/domain.test.js`](../test/domain.test.js)) and by endpoint tests
([`test/production.test.js`](../test/production.test.js)) — and every change still runs the **Twin gate**.
