# Process Governance Mining (Stabilization Part 10)

Process mining now goes beyond operational efficiency into **governance**: deviation from the
mandated sequence, policy violations, separation-of-duties breaches, approval anomalies, fraud
indicators, unusual workflow patterns, bottlenecks and compliance failures — each correlated with the
architectural fitness function meant to prevent it (`src/orchestration/process-governance.js`).

Gated by `APP-FIT-PROCESS-GOVERNANCE`. Live: `GET /api/process/governance` (oversight board).

> Findings are **signals for human review, never verdicts**. They are advisory, explainable, and — by
> construction — cannot identify a person: the event log carries only activity types, role-coded
> principal ids and logical timestamps.

## Detections

| Detection | What it finds |
|---|---|
| **Governance deviation** | A case that skipped a mandated step, or performed mandated steps out of order |
| **Policy violation** | A data-defined rule broken: a forbidden transition, or an activity without its required predecessor |
| **Separation of duties** | The same actor performed both halves of a conflicting pair on one case (submit+review, review+decide, attach+admit evidence) |
| **Approval anomaly** | An approval faster than any plausible review (rubber-stamping); an approval that is the first activity on the case; an approval with no preceding review |
| **Unusual pattern** | Rare directly-follows edges — paths the process almost never takes |
| **Fraud indicator** | Composite: two or more governance signals coinciding on one case (SoD breach + rapid approval + repeated reversals) |
| **Compliance failure** | SLA breach; a case that never reached a terminal activity |
| **Bottleneck** | Retained from the existing miner: mean dwell time per transition |

Rules are **data** — `requiredSequence`, `rules`, `sodPairs`, `minDwellMs`, `slaMs`, `reversalTypes`
are all supplied by the caller, so tightening governance is a configuration change, not a redeploy.

## Correlation with the fitness gate

Each finding class maps to the control expected to prevent it:

| Finding | Control |
|---|---|
| governance-deviation | `APP-FIT-WORKFLOW-SIMULATION` |
| policy-violation | `APP-FIT-POLICY-AS-DATA` |
| sod-breach | `APP-FIT-AUTHZ-DEFAULT-DENY` |
| approval-anomaly | `FIT-GOVERNANCE` |
| fraud-indicator | `APP-FIT-WORKFLOW-INTEGRITY` |
| unusual-pattern | `APP-FIT-PROCESS-MINING` |
| compliance-failure | `APP-FIT-LIFECYCLE-DEFAULT-DENY` |

Three interpretations come out of that correlation, and the third is the one worth building for:

1. **Control failing** — the finding corroborates a control that is already red. Expected.
2. **No control** — no fitness function covers this finding class. A **control gap**.
3. **Control green, behaviour observed anyway** — the control holds, yet the process did the thing it
   is supposed to prevent. **The control's scope does not cover this path.** That is a discovery no
   amount of green CI would have surfaced, and it is why the correlation exists.

Correlation **explains** findings against controls; it never re-classifies a control as passing or
failing. The fitness gate remains the only authority on control state.

## Privacy

Actors are role-coded principal ids (`inv-1`, `gov-1`), never people. A fitness check asserts that no
identity marker appears anywhere in a governance report, and the analysis is fully deterministic — the
same log always yields the same findings, so a finding can be reproduced and argued with.
