# Botswana National Justice Transparency & Integrity Platform (NJTIP) — Blueprint

An implementation-ready **Enterprise Architecture & Governance Blueprint** for a modular,
national justice-sector platform that improves transparency, accountability, integrity, due
process, evidence integrity, inter-agency collaboration, access to justice, and public trust —
while protecting the rights, safety, and dignity of everyone involved.

> **Program, not app.** Confidential whistleblowing is **one bounded context** within a larger
> ecosystem spanning reporting, investigation, prosecution, adjudication support, corrections,
> oversight, and public transparency. The blueprint keeps **four justice modes** (confidential
> reporting · investigation · adjudication · public transparency) and **three constitutional
> data zones** (executive · judiciary · independent) strictly separated.
>
> This blueprint is produced in **phases**. The design mandate requires the full **Discovery
> Phase** to be validated **before** any architecture, engineering spec, or roadmap is written.
> **Discovery is delivered below and the blueprint deliberately stops at a Confirmation
> Checkpoint.**

## Discovery Phase (delivered)

| # | Document | Contents |
|---|----------|----------|
| 00 | [Master Index](./00-master-index.md) | Four-modes rule, delivery contract, conventions, non-negotiable constraints |
| 01 | [Assumptions Register](./01-assumptions-register.md) | 41 assumptions (incl. justice-institutional & AI) with confidence, impact-if-wrong, validation owner |
| 02 | [Justice-System Problem Analysis](./02-justice-system-problem-analysis.md) | Root-cause trees for 10 systemic problems; 4 leverage points |
| 03 | [Stakeholder Analysis](./03-stakeholder-analysis.md) | 15 groups: needs, permissions, risks-to/from, design implications (no invented opinions) |
| 04 | [Functional Gap Analysis](./04-functional-gap-analysis.md) | current→desired gaps → owning components → proposed MVP cut line |
| 05 | [Service Blueprint](./05-service-blueprint.md) | 5 journeys across front/back-stage/support/evidence/fail-points |
| 06 | [Domain Model](./06-domain-model.md) | 16 DDD bounded contexts, context map, aggregates, event catalog, ubiquitous language |
| 07 | [Capability Map](./07-capability-map.md) | L0–L2 capabilities; coverage of all 22 services; sequencing |
| 08 | [Threat Model (STRIDE + LINDDUN)](./08-threat-model-stride-linddun.md) | Zone-R + Zone-O threats (~36) with ratings, mitigations, residual risk |
| 09 | [Trust Model](./09-trust-model.md) | Zero-trust zones, separation-of-powers data zones, roots of trust, bounded AI trust |
| 10 | [Risk Register](./10-risk-register.md) | 24 owner-assigned risks; 4 Critical, 13 High |
| 11 | [Discovery Validation → ⛔ Confirmation Checkpoint](./11-discovery-confirmation-checkpoint.md) | Summary + **11 questions to answer before the Design phase** |

## Checkpoint (ratified)

| # | Document | Contents |
|---|----------|----------|
| 12 | [Ratified Decisions](./12-ratified-decisions.md) | Checkpoint answers D-01…D-11 as authoritative decisions; five cross-cutting capabilities (D-10); assumption status updates |

## Design Phase (delivered — awaiting approval)

Produced in the ratified **D-11** order; pauses at a Design Approval Gate before Governance and
engineering work items. See [`design/`](./design/00-design-index.md).

| # | Document | Focus |
|---|----------|-------|
| 01 | [Enterprise Reference Architecture](./design/01-enterprise-reference-architecture.md) | Layered model · Constitutional Architecture (3 zones) · deployment-model comparison + hybrid justification · MVP slice |
| 02 | [Data Architecture](./design/02-data-architecture.md) | Zone-isolated stores · minimization · per-field policy · Digital Chain of Custody · Justice Analytics |
| 03 | [Integration Architecture](./design/03-integration-architecture.md) | Event backbone · standards-based external APIs · Interoperability Standards · ACLs |
| 04 | [Security Architecture](./design/04-security-architecture.md) | Zero Trust · IAM · threshold crypto/KMS/HSM · metadata-resistant intake · IR/DR/BCP |
| 05 | [AI Architecture](./design/05-ai-architecture.md) | Assistive-only · human-in-loop · out of decision path · self-hosted sensitive models |
| 06 | [Observability Architecture](./design/06-observability-architecture.md) | Metrics/logs/traces · SIEM/SecOps · tamper-evident audit · Public Trust Index |
| 07 | [DevSecOps Architecture](./design/07-devsecops-architecture.md) | Secure SDLC · SLSA/SBOM/reproducible builds · IaC · security-gated CI/CD · autonomy boundary |

## Phase 2 — Governance & Implementation (delivered — awaiting ORG sign-off)

Operationalizes the approved architecture into an executable governance subsystem, full
traceability, a phased programme, and MVP work items; pauses at the **Operational Readiness
Gate**. See [`phase2/`](./phase2/00-phase2-index.md).

| # | Document | Focus |
|---|----------|-------|
| 01 | [Governance System](./phase2/01-governance-system.md) | 8 bodies: authority, decision rights, quorum, voting, cadence, escalation; wired to technical controls |
| 02 | [Policy Engine](./phase2/02-policy-engine.md) | Policy-as-code lifecycle, versioning, enforcement, rollback, compliance monitoring |
| 03 | [Operational Governance](./phase2/03-operational-governance.md) | CoI, appeals, transparency reporting, whistleblower protection, audit, exceptions, emergency, disaster |
| 04 | [Requirements Traceability Matrix](./phase2/04-traceability-matrix.md) | Need→Req→Assumption→Threat→Risk→DDR→Component→Task→Test→Metric |
| 05 | [Operational Readiness Gate](./phase2/05-operational-readiness-gate.md) | 10 blocking criteria before any production go-live |
| 06 | [Implementation Roadmap](./phase2/06-implementation-roadmap.md) | Phases 0–6: objectives, scope, deps, risks, staffing, budget (BWP), exit criteria |
| 07 | [Interoperability Framework](./phase2/07-interoperability-framework.md) | API/event standards, federation, versioning, schema governance, onboarding |
| 08 | [Chain-of-Custody Procedures](./phase2/08-chain-of-custody-procedures.md) | Ingest→verify→hash→timestamp→retain→archive→delete→audit SOPs |
| 09 | [Public Trust Index](./phase2/09-public-trust-index.md) | 9 indicators, sources, calculation, publication, governance, privacy |
| 10 | [Justice Analytics](./phase2/10-justice-analytics.md) | Privacy-preserving analytics; disclosure control; purpose limitation |
| 11 | [GitHub Work Items (MVP)](./phase2/11-github-work-items.md) | Epics/Features/Stories/Tasks with full metadata |
| 12 | [Representative Artifacts](./phase2/12-implementation-artifacts.md) | Sample OpenAPI, event schema, DB migration, IaC, CI/CD gate, runbook, test plan |

## Phase 3 — Production Readiness (delivered — awaiting go-live sign-off)

Operationalizes the approved programme into a production-ready national delivery; pauses at the
**Production Go-Live Gate**. See [`phase3/`](./phase3/00-phase3-index.md).

| WS | Document | Focus |
|----|----------|-------|
| 1 | [Governance Maturation](./phase3/01-governance-maturation.md) | Charters, membership, appointment, terms, voting, escalation, cadence + full RACI |
| 2 | [Data Governance Framework](./phase3/02-data-governance-framework.md) | Ownership model, lifecycle per class, lineage, quality controls |
| 3 | [Security Validation Programme](./phase3/03-security-validation-programme.md) | Pen/red/blue/purple, vuln mgmt, supply-chain, threat-model & crypto reviews, DR testing |
| 4 | [Enterprise Test Strategy](./phase3/04-enterprise-test-strategy.md) | Unit→UAT incl. privacy & governance testing; entry/exit criteria |
| 5 | [Change Management](./phase3/05-change-management.md) | National adoption, engagement, training, resistance, rollout waves |
| 6 | [Enterprise Service Management](./phase3/06-enterprise-service-management.md) | Service catalogue, ITIL practices, SLOs, runbooks (zero standing privilege) |
| 7 | [Operational Readiness Scorecard](./phase3/07-operational-readiness.md) | 9 domains + GREEN/AMBER/RED thresholds (no-AMBER for Critical) |
| 8 | [Production Deployment Governance](./phase3/08-production-deployment-governance.md) | Go-live/rollback criteria, approvals, emergency, hypercare, PIR |

## Phase 4 — Strategic Assurance & Implementation Evidence (delivered)

Completes the strategic, legal, compliance, funding, assurance, and evidence documentation that the
readiness/go-live gates consume. See [`phase4/`](./phase4/00-phase4-index.md).

| # | Document | Focus |
|---|----------|-------|
| 01 | [Executive Summary](./phase4/01-executive-summary.md) | Cabinet/leadership/funder briefing |
| 02 | [Legal & Ethical Framework](./phase4/02-legal-ethical-framework.md) | Constitutional, judicial independence, due process, privacy, ethics (all `⟦validate⟧`) |
| 03 | [Compliance Mapping](./phase4/03-compliance-mapping.md) | DPA/ISO 27001/27701/OWASP/NIST/SOC 2 controls + evidence |
| 04 | [Comparative Analysis](./phase4/04-comparative-analysis.md) | SecureDrop, GlobaLeaks, X-Road, CT/KT — transferable principles |
| 05 | [Botswana Adaptation Strategy](./phase4/05-botswana-adaptation-strategy.md) | Assumptions-to-validate + institutional engagement plan |
| 06 | [Technology Strategy](./phase4/06-technology-strategy.md) | Selection principles, scalability, lifecycle, modernization |
| 07 | [Sustainability & Funding](./phase4/07-sustainability-funding-strategy.md) | Funding model, staffing, procurement, sustainability (BWP) |
| 08 | [Benefits Realization](./phase4/08-benefits-realization-framework.md) | Measurable benefits with baseline/target/owner/method |
| 09 | [Enterprise Risk Management](./phase4/09-enterprise-risk-management.md) | Strategic/legal/financial/procurement/reputational risks |
| 10 | [National DPI Alignment](./phase4/10-national-dpi-alignment.md) | Open standards, interoperability, guardrails |
| 11 | [Business Continuity & Resilience](./phase4/11-business-continuity-resilience.md) | Workforce, crisis comms, suppliers, exercises |
| 12 | [Independent Assurance Framework](./phase4/12-independent-assurance-framework.md) | Recurring independent reviews across domains |
| 13 | [Production Evidence Package](./phase4/13-production-evidence-package.md) | Versioned evidence structure for OB go-live sign-off |

## Phase 5 — Programme Execution & National Delivery (delivered)

The execution framework that drives the approved blueprint to disciplined delivery without
redesigning it or bypassing the gates. See [`phase5/`](./phase5/00-phase5-index.md).

| WS | Document | Focus |
|----|----------|-------|
| 1 | [PMO Operating Model](./phase5/01-pmo-operating-model.md) | Permanent programme office; control functions; no gate-waiver authority |
| 2 | [Final Recommendations](./phase5/02-final-recommendations.md) | All recommendations prioritized Critical→Strategic (catalogue item 26) |
| 3 | [Implementation Master Plan](./phase5/03-implementation-master-plan.md) | Per-phase reviews, gates, milestones, decision points |
| 4 | [Benefits Realization Programme](./phase5/04-benefits-realization-programme.md) | Operational benefits + corrective actions |
| 5 | [Enterprise Portfolio Management](./phase5/05-enterprise-portfolio-management.md) | Dashboards, dependency map, RAID log |
| 6 | [Readiness Evidence Catalogue](./phase5/06-readiness-evidence-catalogue.md) | Full evidence catalogue + revalidation schedule |
| 7 | [Executive Decision Support](./phase5/07-executive-decision-support.md) | Audience-specific briefing packs (shared facts) |
| 8 | [Implementation Assurance](./phase5/08-implementation-assurance.md) | Continual independent assurance during delivery |
| 9 | [National Rollout Strategy](./phase5/09-national-rollout-strategy.md) | Pilot → staged → national, gate-controlled |
| 10 | [Continuous Improvement](./phase5/10-continuous-improvement.md) | Annual reviews, refresh, feedback loops |
| 11 | [Enterprise Traceability](./phase5/11-enterprise-traceability.md) | Need→…→Executive Outcome; no orphans |

## Phase 6 — Engineering Execution & Reference Implementation (delivered)

Engineers the approved blueprint into implementation-ready specifications — synthetic-data-only, with
the 🔒 critical subsystems kept under human-expert control. See [`phase6/`](./phase6/00-phase6-index.md).

| WS | Document | Focus |
|----|----------|-------|
| 1 | [Architecture Repository](./phase6/01-architecture-repository.md) | Living, traceable, CI-enforced artifact graph + repo layout |
| 2 | [Per-Context Engineering Specs](./phase6/02-per-context-engineering-specs.md) | Spec template + worked MVP contexts (Reporting, Evidence, IAM) |
| 3 | [Executable Contracts](./phase6/03-executable-contracts.md) | OpenAPI, AsyncAPI, JSON Schema, event catalog, DB, IAM policy, errors, versioning |
| 4 | [Engineering Standards](./phase6/04-engineering-standards.md) | Coding, API, logging, observability, testing, infra, deps, secrets, crypto, release |
| 5 | [Reference Implementation](./phase6/05-reference-implementation.md) | Synthetic dev env, CI/CD, IaC, monitoring, demo workflows |
| 6 | [Verification & Validation](./phase6/06-verification-validation.md) | V&V framework (verification + validation per requirement) |
| 7 | [Engineering Work Packages](./phase6/07-engineering-work-packages.md) | Build-ready stories, test cases, DoD, sprint sequencing |
| 8 | [Systems Engineering Reviews](./phase6/08-systems-engineering-reviews.md) | SRR/PDR/CDR/TRR/ORR/PRR |
| 9 | [DevSecOps Engineering](./phase6/09-devsecops-engineering.md) | IaC, CI/CD, security testing, supply chain, SBOM, signing, rollback, DR |
| 10 | [Engineering Governance](./phase6/10-engineering-governance.md) | Governance alignment + AI autonomy boundary |

## Phase 7 — Engineering Factory, IDP & Autonomous Delivery (delivered)

The engineering ecosystem that lets teams build NJTIP repeatably and safely, with the approved
guarantees baked in as defaults. See [`phase7/`](./phase7/00-phase7-index.md).

| WS | Document | Focus |
|----|----------|-------|
| 1 | [Internal Developer Platform](./phase7/01-internal-developer-platform.md) | Self-service templates, scaffolding, provisioning — compliant by construction |
| 2 | [Golden Paths](./phase7/02-golden-paths.md) | Approved secure-by-default patterns (REST, events, authN/Z, persistence, files, infra…) |
| 3 | [Governance Automation](./phase7/03-governance-automation.md) | Governance-as-code; non-compliant deploys fail CI |
| 4 | [AI Engineering Guardrails](./phase7/04-ai-engineering-guardrails.md) | T1–T4 activity classification; 🔒 = spec-only; provenance + audit |
| 5 | [Developer Experience](./phase7/05-developer-experience.md) | Portal, API/event catalogs, synthetic data, mocks, playbooks |
| 6 | [Quality Engineering Platform](./phase7/06-quality-engineering-platform.md) | Reusable test frameworks; privacy/invariant tests as release-blockers |
| 7 | [Observability Platform](./phase7/07-observability-platform.md) | Logging/metrics/tracing/SLOs — privacy-budgeted; intake minimal-signal |
| 8 | [SRE Practices](./phase7/08-sre-practices.md) | Incident/on-call/DR under zero standing privilege |
| 9 | [Engineering Metrics](./phase7/09-engineering-metrics.md) | DORA + posture/conformance; guardrails; team-not-individual |
| 10 | [Knowledge Platform](./phase7/10-knowledge-platform.md) | Searchable, versioned, traceable knowledge graph; reusable factory |

## Phase 8 — Digital Engineering Twin & Continuous Verification (delivered)

An executable, synthetic, production-isolated validation environment that continuously proves the
architecture, security, privacy, governance, resilience, and readiness — generating machine-verifiable
evidence for human decision-makers. See [`phase8/`](./phase8/00-phase8-index.md).

| WS | Document | Focus |
|----|----------|-------|
| 1 | [Digital Engineering Twin](./phase8/01-digital-engineering-twin.md) | Synthetic executable model of the whole platform; fidelity levels; isolation |
| 2 | [Synthetic Data Platform](./phase8/02-synthetic-data-platform.md) | Fully-artificial datasets; no linkage to real people/institutions |
| 3 | [Architecture-as-Code](./phase8/03-architecture-as-code.md) | DDRs → executable fitness functions; violations blocked |
| 4 | [Continuous Verification](./phase8/04-continuous-verification-framework.md) | 8-dimension automated verification; signed evidence per change |
| 5 | [Adversarial Simulation](./phase8/05-adversarial-simulation.md) | SIM-1…10: insider/operator/DoS/phishing/metadata/tamper/DR/governance |
| 6 | [Compliance Evidence Automation](./phase8/06-compliance-evidence-automation.md) | Auto-generated, signed, anchored, packaged evidence |
| 7 | [Platform Certification](./phase8/07-platform-certification.md) | Human certification supported by automated evidence |
| 8 | [Engineering Analytics](./phase8/08-engineering-analytics.md) | Verification coverage/conformance/posture; guardrails; team-level |
| 9 | [Human Review Boundaries](./phase8/09-human-review-boundaries.md) | Twin generates evidence; humans decide (crypto/legal/constitutional/go-live) |
| 10 | [Continuous Learning](./phase8/10-continuous-learning.md) | Twin-driven improvement preserving architectural intent |

## What happens next

The blueprint is **complete end-to-end** (Discovery → Design → Phases 2–8). Engineering may proceed
**on synthetic data**: build the Phase-6 specs on the Phase-7 factory, continuously validated in the
Phase-8 twin, through the systems-engineering reviews and platform certification — security spine
first (D-05), 🔒 subsystems human-expert-built. **A green twin is evidence, not a launch decision.**
**Production go-live remains reserved for the Oversight Board**, contingent on the readiness gates
(`phase2/05`, `phase3/08`), the evidence package (`phase5/06`, `phase4/13`), and the 🔒 legal/judicial/
privacy/security/procurement/funding reviews. **No production data flows until the gates pass.**

## Design commitments carried through every section

- Safety, privacy, fairness, and due process never traded for convenience · Zero Trust · Least
  Privilege · Defense in Depth · Privacy/Security by Design.
- **Four justice modes and three data zones stay separated**; no allegation is assumed true.
- **The operator is inside the threat model** for confidential reporting — no single party can
  de-anonymize a reporter.
- **Separation of powers is reflected in data ownership** — no arm silently reads another's data.
- **Human decision-makers are never replaced by AI** — AI assists, never decides guilt or truth.
- **Data minimization by default**; every stored field carries purpose, legal basis, retention,
  encryption, access, and deletion policy.
- **Honesty over false confidence** — residual risks stated plainly; anonymity-, cryptography-,
  evidence-, metadata-, and AI-decision-support subsystems flagged `🔒 HUMAN-EXPERT-REVIEW-
  REQUIRED` before implementation.

_All financials will be presented in Botswana Pula (BWP) primary, USD secondary. Every legal,
judicial, and policy statement requires confirmation by qualified Botswana experts before
deployment._
