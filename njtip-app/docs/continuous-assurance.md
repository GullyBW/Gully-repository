# Executive Dashboard & Continuous Assurance (Phase 10, Parts 14 & 15)

Sixteen assurance domains evaluated on **every build** from live evidence, producing an assurance
dashboard, readiness score, risk register, evidence register, compliance register, deployment
authorization package and production readiness package (`src/assurance/continuous.js`) — plus
twelve executive metrics, each traceable to the evidence that produced it
(`src/observability/executive.js`).

Gated by `APP-FIT-CONTINUOUS-ASSURANCE` and `APP-FIT-EXECUTIVE-DASHBOARD`. Run:
`npm run assurance` · `npm run production-readiness`. Live: `GET /api/assurance/continuous` ·
`GET /api/assurance/authorization-package` · `GET /api/assurance/production-readiness` ·
`GET /api/executive/dashboard` · `GET /api/executive/evidence-trace`.

> **FAIL-CLOSED.** Any failed assurance gate blocks production authorization until a named human
> authority explicitly accepts the risk. And a fully green, signed package **authorizes nothing** —
> it is *prepared for* a human decision, never a substitute for one.

## The sixteen domains

| Domain | Verified by | Passes when |
|---|---|---|
| Architecture | `APP-FIT-CONTEXT-MAP`, `APP-FIT-MIGRATION-ROADMAP` | The architecture-of-record is valid and every invariant holds |
| Security | `APP-FIT-ZERO-TRUST-ARCHITECTURE`, `APP-FIT-THREAT-MODEL`, `INFRA-FIT-DEVSECOPS` | Policy certified, zero credential findings, algorithm independence holds |
| Privacy | `FIT-IDENTITY-MINIMIZATION`, `APP-FIT-ANONYMITY-BOUNDARY`, `APP-FIT-CORRELATION-GOVERNANCE` | Identity minimization and correlation default-deny both hold |
| Compliance | `APP-FIT-LEGISLATIVE-IMPACT` | Control coverage ≥ 90% |
| Performance | `APP-FIT-SRE-RELIABILITY` | Latency within objective |
| Reliability | `APP-FIT-SRE-RELIABILITY`, `APP-FIT-CHAOS-RESILIENCE` | Every SLO met |
| Governance | `APP-FIT-GOVERNANCE-OWNERSHIP`, `APP-FIT-RACI-GOVERNANCE`, `FIT-GOVERNANCE` | Ownership complete, no self-approval |
| Recovery | `APP-FIT-RECOVERY-STRATEGIES`, `APP-FIT-MULTI-REGION`, `INFRA-FIT-DR-BACKUP-RESTORE` | Failover scenarios match; backups restore-verified |
| Supply chain | `APP-FIT-SUPPLY-CHAIN-GOVERNANCE`, `APP-FIT-SUPPLY-CHAIN-ATTESTATION` | Zero third-party dependencies; attestations verify |
| Infrastructure | `APP-FIT-INFRA-ASSURANCE`, `INFRA-FIT-DRIFT`, `INFRA-FIT-PLATFORM-LIFECYCLE` | Healthy and drift-free |
| Legislation | `APP-FIT-LEGISLATIVE-IMPACT`, `APP-FIT-FORMAL-POLICY` | No unimplemented mandate |
| Identity | `APP-FIT-ZERO-TRUST-ARCHITECTURE`, `APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE` | Trust anchor present; credentials short-lived |
| Policies | `APP-FIT-POLICY-AS-DATA`, `APP-FIT-FORMAL-POLICY` | Certified and every specification proven |
| Observability | `APP-FIT-OBSERVABILITY-TELEMETRY`, `APP-FIT-TRACE-PRIVACY` | Topology valid; telemetry identity-free |
| Data governance | `APP-FIT-DATA-GOVERNANCE`, `APP-FIT-DATA-EXCHANGE-PURPOSE` | 100% of records fully traced |
| AI governance | `APP-FIT-AI-LIFECYCLE`, `APP-FIT-AI-ADVISORY-ONLY` | Every artifact approved; no autonomous action surface |

**A domain with no evidence FAILS.** Assurance is never granted blind — `reason` says exactly which
source was missing.

## The deployment authorization package

```
gateOutcome:           ALL ASSURANCE GATES PASS
readiness:             1.0 (fully assured)  ·  16/16 domains
digest + signature:    reproducible over the domain results
authorized:            false
authorizationDecision: NOT AUTHORIZED — production go-live requires a recorded decision by the
                       approving authority for this deployment.
```

The last two fields are the point of the whole framework. A complete, green, signed package is
**evidence that the platform is ready to be considered**. It is not permission, and nothing in it
becomes permission by being green. The fitness function asserts this explicitly: a fully green
package that reported `authorized: true` would fail the build.

When a gate fails, the package names the blockers, raises them in the risk register (privacy,
security, governance and legislation failures as **critical**), and stays blocked until a named human
authority records an acceptance **with a rationale** — which is recorded, and still is not
authorization.

## Production readiness — six things a build cannot do

| Item | Why a human |
|---|---|
| 🔒 Production cryptography | HSM/KMS keys generated and custodied by humans under ISRB sign-off. Never machine-generated. |
| Production adapters | Synthetic drivers replaced per the migration roadmap, each with a **rehearsed** rollback |
| Infrastructure provisioning | Sovereign-cloud estate provisioned, reviewed, baselined; residency confirmed by the data steward |
| Legal and constitutional validation | Attorney General Chambers and the Oversight Board confirm the deployed platform satisfies enacted instruments |
| User validation with real participants | The usability round re-run with recruited participants; blockers resolved |
| Recorded governance decision | The approving authority records go-live in the governance ledger |

`productionReady: false`, always, from the build's point of view. **Automated assurance is necessary
and not sufficient.**

## The executive dashboard — no manually entered metrics

Twelve metrics: architecture health, security posture, compliance posture, reliability, performance,
operational readiness, technical debt, deployment readiness, risk exposure, legislative readiness,
data governance and recovery readiness.

Each declares **where its value comes from** (an evidence path) and **what verifies it** (a fitness
function id). `GET /api/executive/evidence-trace` answers "where did this number come from?" for
every metric on the page.

A metric whose evidence is missing renders as `unavailable`, **naming what was missing** — never
filled in by hand, never defaulted to zero, never quietly dropped. The fitness function proves this
by rendering the dashboard with an empty evidence bundle and requiring that no metric reports a
value. An executive dashboard that can be typed into is a reporting system, not a measurement system.
