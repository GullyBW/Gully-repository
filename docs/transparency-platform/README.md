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

## What happens next

After you approve the Design Phase (or flag DDR changes), the next batch is **Governance
Framework**, then **per-context implementation specs + OpenAPI/schemas**, then **GitHub Epics/
Stories for the MVP** — see the **Design Approval Gate** at the end of
[`design/07`](./design/07-devsecops-architecture.md#-design-approval-gate-ratified-d-11).

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
