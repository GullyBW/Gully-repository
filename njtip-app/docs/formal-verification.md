# Formal Verification — Property Catalogue (Phase 11, Part 3)

The verification engine now proves **16 properties across 13 guarantee kinds**, exhaustively over
~11,960 states, on every build (`src/iam/formal-policy.js`). Gated by `APP-FIT-FORMAL-POLICY`.

## Property catalogue

| Property | Kind | Guarantee |
|---|---|---|
| `SPEC-AUTHZ-DEFAULT-DENY` | authorization | Nothing is permitted that the RBAC matrix does not allow |
| `SPEC-STEP-UP-MFA` | authorization | A sensitive action with weak MFA is never permitted |
| `SPEC-ZONE-CONFINEMENT` | authorization | A principal never acts across a zone boundary |
| `SPEC-SUSPENDED-DENIED` | authorization | A suspended subject is denied every action |
| `SPEC-SEPARATION-OF-DUTIES` | separation-of-duties | No principal both requests and approves the same act |
| `SPEC-APPROVAL-CHAIN` | approval-chain | An approval always follows the review that justifies it |
| `SPEC-ESCALATION-MONOTONIC` | escalation | Escalation only ever moves upward |
| `SPEC-CUSTODY-UNBROKEN` | evidence-custody | The custody chain is unbroken from genesis |
| **`SPEC-EVIDENCE-INTEGRITY`** | evidence-integrity | Every evidence entry is chained **and signed** |
| `SPEC-DATA-RESIDENCY` | data-residency | Restricted and secret data never leave the sovereign region |
| `SPEC-LEGISLATIVE-COMPLIANCE` | legislative | Every mandated control is implemented and holding |
| **`SPEC-NON-INTERFERENCE`** | non-interference | No identity-carrying information crosses a zone boundary |
| **`SPEC-NO-PRIVILEGE-ESCALATION`** | privilege-escalation | Effective privilege never rises without a recorded grant |
| **`SPEC-WORKFLOW-CONSISTENCY`** | workflow-consistency | A run never skips a mandated step or repeats a state |
| **`SPEC-EVENT-ORDERING`** | event-ordering | Event sequences are contiguous and strictly increasing per stream |
| **`SPEC-DEADLOCK-FREEDOM`** | deadlock-freedom | Every reachable state can still reach a terminal state |

**Bold** = added in Phase 11.

## Reports the engine produces

| Report | What it answers |
|---|---|
| `catalogue()` | Which properties are published, and what guarantee each gives |
| `verifyAll()` | Are they all proven right now? |
| `stateCoverage()` | How much of each bounded domain did the proof explore? (`fullyExhaustive: true`) |
| `proofSummary()` | An audit-ready summary: properties, guarantees, method, counterexamples |
| `continuousValidation()` | The CI verdict — **fail-closed**, a failed proof blocks the build |

## Falsifiability

Every property must be able to **detect its own violation**, and the fitness function proves it by
feeding each one a crafted counterexample: identity crossing a zone boundary, an ungranted privilege
rise, a broken evidence link, an unsigned entry, a run starting mid-workflow, a repeated state, a
sequence gap, and a two-state cycle with no terminal. A property that cannot fail is not a property.

## Method and portability

Bounded exhaustive model checking over a declared finite universe; Cedar-shaped specifications,
Alloy-shaped checker. **Alloy or TLA+ are drop-in unbounded checkers for the same artifacts** — the
specifications are the portable part, and running them in-repo is what makes them run on *every
commit* rather than quarterly.

`proofSummary().authorizes` is `false`. Proven properties are evidence for a human reviewer; they do
not authorize a deployment.
