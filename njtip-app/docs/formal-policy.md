# Formal Policy Verification (Phase 10, Part 3)

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
