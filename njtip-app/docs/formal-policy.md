# Formal Policy Verification (Phase 10, Part 3 · Phase 12, Part 3)

Critical governance policies are stated as declarative **specifications** and checked by **bounded
exhaustive model checking** over a finite universe of subjects, actions, resources and contexts
(`src/iam/formal-policy.js`). Within the bound this is a proof, not a sample — and when a property
fails, the checker returns a **concrete, reproducible counterexample**.

Gated by `APP-FIT-FORMAL-POLICY`. Live: `GET /api/security/formal-policy`.

## Technology choice

| Concern | This implementation | Production drop-in |
|---|---|---|
| Specification language | Cedar-shaped declarative policy algebra (`{ attr, op, value }` conditions, permit/deny with deny-overrides) | **Cedar** or **OPA/Rego** — both consume the same policy structure |
| Proof engine | Alloy-shaped bounded model checking: exhaustive enumeration of a declared finite universe | **Alloy** (bounded, relational) or **TLA+** (unbounded, temporal) — both consume the same specifications |
| Runtime | Zero dependencies, runs in CI on every commit | External evaluator/checker in the pipeline |

The specifications are the artifact, and they are portable. Implementing the checker in-repo means
the proofs run on **every commit** rather than in a quarterly review, which is the property that
actually matters for continuous assurance.

## Specifications

| Specification | Kind | Property |
|---|---|---|
| `SPEC-AUTHZ-DEFAULT-DENY` | authorization | `permit(r) ⇒ rbac.can(role, action)` — no policy may widen the matrix |
| `SPEC-STEP-UP-MFA` | authorization | A sensitive action with `mfa ≠ fido2` is never permitted |
| `SPEC-ZONE-CONFINEMENT` | authorization | `principalZone ≠ resourceZone ⇒ ¬permit` |
| `SPEC-SUSPENDED-DENIED` | authorization | A suspended subject is denied every action |
| `SPEC-SEPARATION-OF-DUTIES` | separation-of-duties | `requester ≠ approver` for every accepted approval |
| `SPEC-APPROVAL-CHAIN` | approval-chain | An approval requires a review earlier in the chain |
| `SPEC-ESCALATION-MONOTONIC` | escalation | Escalation only ever moves upward |
| `SPEC-CUSTODY-UNBROKEN` | evidence-custody | `entry[i].previous = digest(entry[i-1])`, from a genesis entry |
| `SPEC-DATA-RESIDENCY` | data-residency | `restricted ∨ secret ⇒ region = bw-central` |
| `SPEC-LEGISLATIVE-COMPLIANCE` | legislative | Every mandated control is implemented **and** holding |

**Current result: 10 / 10 proven over ~11,900 states.**

## Counterexample generation

The universe is enumerated in a fixed order, so a counterexample is stable and can be pasted straight
into a bug report. Given a deliberately broken policy set (`permit-all`):

```json
{
  "specification": "SPEC-SUSPENDED-DENIED",
  "proven": false,
  "counterexample": {
    "state": { "role": "citizen", "action": "submit-report", "mfa": "none",
               "suspended": true, "principalZone": "independent", "resourceZone": "independent" },
    "reason": "suspended subject permitted 'submit-report'"
  }
}
```

The fitness function asserts this: it feeds the checker a policy set that *must* fail and requires
both a counterexample and that two runs produce **exactly** the same one. A verifier that cannot
demonstrate failure is not a verifier.

## Continuous policy validation

`continuousValidation()` produces the report a CI gate consumes, with `failClosed: true` — a failed
policy proof blocks the build. And, as everywhere else: `authorizes: false`. A passing proof does not
authorize a deployment; it only removes one reason not to.

---

# Formal Verification Catalogue (Phase 12, Part 3)

Gated by `APP-FIT-FORMAL-CATALOGUE`. Live: `GET /api/security/formal-policy/proof-report`.

A machine-readable row per property, regenerated on every build so it can never describe a proof
that no longer runs:

| Field | Why it is there |
|---|---|
| `id` · `description` · `statement` | What is claimed, formally |
| `kind` · `boundedContext` | Which context's invariant this is |
| `verificationMethod` | **"Proven" means different things by method** |
| `proofStatus` · `proofCoverage` · `exhaustive` | Whether it holds, and over how much of its domain |
| `counterexample` | The concrete failing state, when it does not |
| `owningAdr` | What recorded that this must hold |
| `responsibleOwner` · `governanceBoard` | Who answers for it — resolved from the ownership model, so the two cannot drift |

## Methods are named, not blurred

| Method | Properties | What it establishes |
|---|---|---|
| Bounded exhaustive model checking | 12 | Every state in the bounded domain enumerated — a proof within the bound, not a sample |
| Structural invariant over generated chains | 2 | Chains constructed and re-verified; a break is a counterexample |
| Reachability analysis | 1 | Every reachable state has a path to a terminal state |
| Traceability against the live fitness gate | 1 | Each mandate resolves to a control, and the control's current result is read |

Blurring these would overstate what has been established. A traceability check and an exhaustive
model check are both useful and are not the same claim.

## Coverage

**16 properties · 13 kinds · ~11,957 states · all proven**, spanning authorization correctness,
privilege isolation, separation of duties, evidence integrity, workflow consistency, event
ordering, legislative compliance, residency correctness and deadlock freedom.

`validateCatalogue()` fails the build when a specification has no owning context, no owning ADR, no
named owner or no stated method — **a proven property nobody owns is a proof nobody maintains.**
