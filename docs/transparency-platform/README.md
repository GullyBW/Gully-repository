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

## What happens next

The Design & Delivery program (Governance & Trust → Zero-Trust Security & Data → System &
Domain design + 22 service specs → Product & Workflow → Legal/Compliance → Technology, GitHub
epics, roadmap) is **blocked pending your answers at the
[Confirmation Checkpoint](./11-discovery-confirmation-checkpoint.md#112-the-decisions-that-shape-everything-downstream).**

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
