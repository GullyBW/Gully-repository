# ADR-0006: Adaptive assurance, predictive operations and the extended ADR schema

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Architecture Review Board · Oversight Board · Information Security Review Board · Data Governance Board
- **Review required:** ARB (+ ISRB for the supply-chain and AI controls)

## Context

Phase 10 made the platform continuously *verified*. Sixteen assurance domains, 100 executable
invariants and a signed evidence package answered "is it correct right now?" on every commit.

What none of that answered is "is it getting worse?" A reliability report showed today's error
budget but not that it had been shrinking for four periods. A data-quality score existed but nothing
consumed it. A chaos experiment proved the platform survived a fault but not that anyone would have
noticed it. A supply-chain gate verified an attestation but had no way to say whether the artifact
was *trustworthy* overall.

Phase 11 addresses that gap without touching the frozen architecture: every capability extends an
existing module inside its existing bounded context.

## Decision

Adopt eight groups of changes across the existing contexts:

1. **Signed, revocable authorization decisions** replacing "nothing is cached"
   ([ADR-0005](./0005-authorization-decision-caching.md), recorded separately).
2. **Enterprise risk intelligence** — a full risk lifecycle with time-bound acceptances.
3. **Formal verification expansion** — sixteen properties across thirteen kinds, ~11,958 states.
4. **Predictive SRE** — multi-window burn-rate alerting, reliability and recovery forecasting,
   topology-derived dependency risk, append-only compliance history, scorecards.
5. **Business observability** — nine KPIs derived from the PII-free event log, correlated with
   technical reliability as a *hypothesis*, never a cause.
6. **A detect-and-recover contract for chaos** — every experiment must prove the fault became
   visible and that steady state returned. Seventeen scenarios in CI.
7. **Data-quality governance that feeds readiness**, supply-chain trust scoring that gates
   deployment, and AI monitoring that can require re-approval.
8. **Consistency governance per bounded context**, this **extended ADR schema**, and consumer
   impact analysis.

The extended schema applies from **ADR-0006 onward**, on the same principle as the 0004 expansion.

## Consequences

Assurance moves from a snapshot to a trajectory. Several controls now *bind*: poor data quality
fails the data-governance assurance domain, an untrusted artifact is not deployable, a drifted model
requires re-approval, and a chaos experiment that cannot show detection fails the build.

Three behaviours changed in ways callers must know about, all of them tightenings:

- `infer()` now requires a confidence score at or above the risk class's floor.
- `verifyRelease()` now requires a keyless signature, a reproducible build and lockfile integrity
  before it reports verified.
- Every chaos experiment must report `detected` and `recovered`.

None of these is a published API. Each was updated at its call sites rather than being made
optional, because a security control that callers can opt out of is a suggestion.

## Alternatives considered

**Leave assurance as a snapshot.** Cheapest, and defensible while the platform is small. Rejected
because the failure mode of a snapshot-only posture is discovering a six-month trend on the day it
becomes an incident.

**Add a separate "analytics" or "trends" bounded context.** Structurally cleaner in the abstract.
Rejected: it would have split reliability knowledge across two contexts and violated the v1.7
freeze for no measured need.

**Buy the observability and supply-chain layers.** Rejected on the zero-dependency and
sovereignty constraints — and because the point of this repository is a reference implementation
whose reasoning is inspectable.

## Rejected alternatives

- **Retrofit the extended schema onto ADRs 0001–0005.** Rejected on the same grounds as the 0004
  cutover: an ADR records what was known and required when it was written, and rewriting it to a
  later standard destroys precisely what the record exists to preserve. The cutover is data
  (`EXTENDED_SCHEMA_FROM = 6`) and the validator applies the right schema per ADR.
- **Make the artifact trust score advisory.** Rejected. A score nothing blocks on is a dashboard;
  the requirement was that deployment fails for an untrusted artifact.
- **Let a low-confidence AI output through with a caveat.** Rejected. A caveated suggestion still
  anchors the person reading it, and an anchor you did not intend to set is worse than silence.
- **Average hallucination rates across models.** Rejected: an aggregate rate tells you a problem
  exists but not which model to stop using.
- **Derive an overall "AI trustworthiness" score.** Rejected as false precision — the components
  are reported separately so a human reasons about them, rather than being averaged into a number
  that hides which one is failing.

## Architectural trade-offs

| We bought | We paid |
|---|---|
| Authorization at scale (signed decisions) | A cache is state, and state is a new class of bug. Bought back with an eight-condition re-check and a `allowCache: false` rollback path. |
| Trend and forecast signal | Forecasts invite treating a projection as a measurement. Mitigated by reporting `confidence` from r² and labelling every forecast as an early warning. |
| Business KPIs on the oversight surface | A metrics surface adjacent to case data is a surveillance risk. Mitigated structurally: identity-bearing events are *refused*, and only four fields cross the boundary. |
| A trust score that gates deployment | A composite score can be gamed by whoever sets the weights. Mitigated by deriving every component from a verification the platform already performs. |
| Consistency stated per context | Explicit strong consistency costs read availability below quorum. Accepted for constitutional contexts; the cost is the guarantee. |

## Long-term maintenance impact

Roughly 3,000 lines added across eleven existing modules, with no new bounded context and no new
runtime dependency, so the maintenance surface grows with the codebase rather than with the
integration count. The heaviest ongoing cost is the **consistency registry** and the
**RACI control-ownership map**: both are data that must be updated when a context or fitness
function is added, and both fail the build when they are not — which is the intended cost.

The forecasting and PSI code is arithmetic over injected inputs with no time dependence, so it
should not require maintenance beyond threshold recalibration.

## Implementation complexity

Moderate and deliberately bounded. Every addition is a pure function or a small class over injected
state; there is no new concurrency, no new persistence and no new protocol. The two genuinely
subtle pieces are the authorization decision cache (whose failure mode is privilege escalation —
see ADR-0005) and the Sigstore verification order (where the interesting checks are identity,
issuer and log inclusion rather than the signature itself). Both carry fitness functions that feed
them counterexamples.

## Operational cost

No new infrastructure. CI time grew by roughly 25% (435 tests, 115 invariants, 17 chaos
experiments), all within a single-process Node run. In production the additions imply: a
transparency log to operate, a decision cache to size, and per-model monitoring series to retain.
The dominant recurring cost is human — quality remediation, risk review cadence and AI
re-approval are all deliberately human-gated.

## Lifecycle implications

- ADR-0005's decision cache should be revisited once real authorization latency is measured; the
  `allowCache: false` path is the documented rollback.
- The SLSA claim stays at level 2 until build infrastructure supports 3; the gaps are recorded.
- The confidence floors, burn-rate multipliers, hallucination threshold and PSI bands are
  thresholds, not invariants — they should be recalibrated against production data, and each
  recalibration is a decision worth recording.
- This ADR is superseded when the platform adopts non-synthetic operation, which changes the
  premise of the AI and data-quality controls.

## Business justification

Botswana's justice-transparency commitment depends on the platform being *demonstrably* sound to an
oversight board, not merely sound. Phase 11 converts assurance claims into trajectories a
non-engineer can read, and turns four previously advisory signals into controls that block. The
alternative — discovering degradation from a citizen complaint — is the failure this platform
exists to prevent.

## Risk assessment

| Risk | Severity | Treatment |
|---|---|---|
| Decision cache permits privilege escalation | Critical | Eight-condition re-check; context digest in the key; caught in development by `APP-FIT-ZERO-TRUST-ARCHITECTURE` |
| A forecast is read as a measurement | Medium | `confidence` derived from r²; every forecast states it is an early warning |
| Business KPIs become a surveillance surface | High | Identity-bearing events refused, not stripped; four-field boundary; k-anonymity unchanged |
| Trust-score weights drift toward permissiveness | Medium | Weights are data, asserted by fitness; threshold 80 with a full-attestation case proving 100 is reachable |
| Tightened `infer()`/`verifyRelease()` break a caller | Low | No production caller; all call sites updated in the same commit |

## Performance impact

Positive on the authorization path (decision reuse replaces full evaluation for repeated identical
contexts) and negligible elsewhere: all analysis is O(n) over small in-memory collections and runs
in report generation, not on the request path. The chaos suite adds ~2s to CI.

## Security impact

Net strengthening. The decision cache is the one addition that could weaken security, which is why
it is recorded in its own ADR with its own failure story. Everything else adds controls: supply-chain
trust gating deployment, keyless signature verification bound to identity and issuer, AI confidence
floors, and consistency rules that refuse a stale read rather than serving one. Reviewed by the ISRB
as a security-critical change.

## Operational impact

Four new read-only endpoints (`/api/observability/dependency-risk`, `/api/observability/business`,
`/api/data/quality`, `/api/ai/monitoring`), all role-gated. Operators gain a per-context consistency
posture to reason about during a partition. Nothing changes about deployment, and the platform still
reports **NOT AUTHORIZED**.

## Compliance impact

No new legal mandate is claimed. The data-quality and lineage controls strengthen the evidence
behind existing purpose-limitation and retention mandates; the AI dataset-lineage requirement makes
the synthetic-only commitment structurally enforced rather than asserted.

## Rollback strategy

Every addition is additive and independently disableable:

- Authorization caching: `allowCache: false` restores Phase 10 behaviour exactly.
- Trust gating, quality readiness and chaos contract: each is a single fitness function; removing it
  returns the prior gate without touching the modules.
- The extended ADR schema: `EXTENDED_SCHEMA_FROM` is data; raising it past the highest ADR number
  disables it.

No data migration is involved, so rollback is a code revert.

## Migration strategy

Delivered in four green batches, each committed only after `node --test` and `node scripts/assure.js`
passed in full. Consumers of `infer()` and `verifyRelease()` were updated in the same commit as the
tightening. No stored data, contract version or event schema changed, so no consumer migration is
required.

## Estimated implementation cost

Approximately 3,000 lines of implementation, 1,400 lines of fitness assertions and 70 tests across
four batches. No procurement, no infrastructure and no third-party dependency.

## Success metrics

- 115 executable invariants hold on every commit (14 twin + 92 app + 9 infra).
- 435 deterministic tests pass.
- 17 chaos experiments prove both detection and recovery in CI.
- 16 formal properties proven over ~11,958 states.
- Zero runtime dependencies retained.

## Measurable success criteria

| Criterion | Target | Where it is checked |
|---|---|---|
| Executable invariants holding | 115 / 115 | `node scripts/assure.js` |
| Deterministic tests passing | 435 / 435 | `node --test` |
| Chaos scenarios proving detection **and** recovery | 17 / 17 | `APP-FIT-CHAOS-DETECT-RECOVER` |
| Artifact trust score for a fully attested release | ≥ 80 (100 achieved) | `APP-FIT-SUPPLY-CHAIN-TRUST` |
| Data-quality readiness with the estate measured | 1.0 | `APP-FIT-DATA-QUALITY` |
| Fitness controls with an accountable owner | 100% | `APP-FIT-RACI-GOVERNANCE` |
| Runtime third-party dependencies | 0 | `INFRA-FIT-DEVSECOPS` |

## Architectural debt assessment

Taken on knowingly, with the point at which it comes due:

1. **Threshold calibration.** Burn-rate multipliers, confidence floors, the 5% hallucination
   threshold, PSI bands and the trust threshold of 80 are informed defaults, not measured ones. Due
   at first production telemetry.
2. **Decision-cache state.** The first stateful element on the authorization path. Due for review
   once real latency data exists (ADR-0005).
3. **Synthetic signing identity.** The Sigstore *structure* is right; the signing primitive is the
   twin's. Due at the first real release pipeline. 🔒
4. **SLSA level 2.** Levels 3 and 4 need build-infrastructure commitments not yet made. Recorded as
   gaps rather than claimed.
5. **Business KPI objectives.** The nine objectives (throughput ≥ 20, latency ≤ 168h, and so on)
   are placeholders pending agreement with the Service Delivery Board. Due before the first
   published oversight report.
6. **Consistency registry covers 16 of 30 contexts.** The remaining fourteen hold no replicated
   state today; each becomes due the moment it does.

## Decision owner

**Architecture Review Board**, chaired by the Chief Architect, with the ISRB accountable for the
supply-chain and AI controls and the Data Governance Board accountable for the quality controls.

## Approval history

| Date | Body | Outcome | Basis |
|---|---|---|---|
| 2026-08-02 | Architecture Review Board | Accepted | No bounded-context change; every capability extends an existing module; v1.7 freeze intact |
| 2026-08-02 | Information Security Review Board | Accepted | Supply-chain trust gating and AI confidence floors strengthen the posture; the caching risk is recorded in ADR-0005 |
| 2026-08-02 | Data Governance Board | Accepted | Derived quality dimensions cannot be hand-entered; poor quality reduces readiness |
| 2026-08-02 | Oversight Board | Accepted | The platform continues to report NOT AUTHORIZED; no capability authorizes anything |
