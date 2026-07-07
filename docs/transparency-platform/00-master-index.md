# Botswana National Justice Transparency & Integrity Platform (NJTIP)
## Enterprise Architecture & Governance Blueprint — Master Index

**Document status:** DRAFT — Discovery Phase (produced; stops at a Confirmation Checkpoint)
**Classification:** Internal / Restricted (contains threat model and adversary analysis)
**Primary currency:** Botswana Pula (BWP), USD secondary
**Owner:** (to be assigned — proposed Independent Oversight Trust; see Trust Model §09 and Governance batch)
**Last updated:** 2026-07-07

> **Scope note — program, not app.** This blueprint designs an **entire National Justice
> Transparency & Integrity Platform (NJTIP)** for Botswana: a modular ecosystem spanning
> confidential reporting, investigation, prosecution, adjudication support, corrections,
> oversight, and public transparency. **Confidential whistleblowing is one bounded context
> within it, not the whole platform.** Working name **NJTIP** is a placeholder (A-ORG-04).
>
> This supersedes and *expands* the earlier confidential-reporting-only framing. The
> Assumptions Register and Threat Model from that earlier pass have been broadened to the
> full justice ecosystem; nothing is discarded.

---

### 0.1 Purpose

An **implementation-ready** Enterprise Architecture & Governance Blueprint for a national
justice-sector digital public infrastructure that improves transparency, accountability,
integrity, accessibility, fairness, due process, case visibility, citizen trust, evidence
integrity, and inter-agency collaboration — while protecting the rights, safety, and dignity
of everyone involved and upholding constitutional principles, human rights, and procedural
fairness.

Intended to serve, without rework, as the foundation for: software architecture, security
assessment, legal/privacy review, governance planning, funding proposals, **GitHub epics/
features/stories/tasks**, OpenAPI/DB migrations/IaC, milestones, and human-supervised
AI-assisted implementation.

### 0.2 The four justice modes — kept strictly separate (a first-class design rule)

The platform draws a hard line between four modes with different actors, trust models, and
legal postures. Conflating them is the classic failure mode of "justice tech." They map to
different bounded contexts, trust zones, and permission regimes throughout the blueprint:

| Mode | Who acts | Trust posture | Public visibility |
|------|----------|---------------|-------------------|
| **1. Confidential reporting** | Anonymous citizen | Maximum anonymity; **operator in threat model** | None (aggregate stats only) |
| **2. Investigation** | Identified, authorized investigators | Least privilege, dual control, full audit | None |
| **3. Adjudication** | Courts, prosecutors, defenders, judicial officers | Due process, separation of powers, defensibility | Per court rules (open-justice) |
| **4. Public transparency** | Everyone | Read-only, verified, aggregated, non-attributable | Full, by design |

> **Rule:** no allegation is assumed true; unverified reports never surface as fact; and
> confidential-reporting data never crosses into public transparency except as verified,
> aggregated, anonymized statistics or through a lawful, governed disclosure process.

### 0.3 Delivery contract — phased, with checkpoints

Per the engagement briefs, Discovery was completed and **validated at the Confirmation
Checkpoint** (answers recorded in `12-ratified-decisions.md`). The Design Phase was then produced
in the **ratified D-11 order** and now **pauses at the Design Approval Gate** before Governance
and engineering work items.

| Phase | Deliverables | Status |
|-------|--------------|--------|
| **DISCOVERY** | 01 Assumptions · 02 Problem Analysis · 03 Stakeholders · 04 Gap Analysis · 05 Service Blueprint · 06 Domain Model · 07 Capability Map · 08 Threat Model · 09 Trust Model · 10 Risk Register · 11 Checkpoint | **✅ DELIVERED & CONFIRMED** |
| **CHECKPOINT** | 12 Ratified Decisions (D-01…D-11) | **✅ RATIFIED** |
| **DESIGN** (`design/`, D-11 order) | 01 Enterprise Reference Arch · 02 Data Arch · 03 Integration Arch · 04 Security Arch · 05 AI Arch · 06 Observability Arch · 07 DevSecOps Arch · 15 DDRs → **Design Approval Gate** | **✅ DELIVERED — awaiting approval** |
| GOVERNANCE & SPECS | Governance Framework (operational subsystem) · per-context implementation specs (APIs/OpenAPI/schemas/events/failure modes/monitoring) · sequence diagrams · state machines · permission matrices | Blocked on Design approval |
| ENGINEERING | **GitHub Epics/Features/Stories/Tasks** · acceptance criteria · test plans · IaC modules · CI/CD definitions · runbooks — **MVP slice first** | Blocked |
| REMAINING CATALOGUE | Executive Summary · Legal & Ethical · Compliance · Comparative Analysis · Botswana Adaptation · Technology Stack · Sustainability & Funding · Implementation & Future Roadmap · Final Recommendations | Blocked |

> **⛔ Approval gates.** The blueprint pauses at defined gates (Discovery Checkpoint ✅, Design
> Approval Gate ⟵ current) rather than emitting everything at once. This is intentional: each
> phase depends on decisions only the client can ratify. The Discovery-stop text below reflects
> the earlier state and is retained for provenance.

> **⛔ Confirmation Checkpoint.** The blueprint **stops** at the end of Discovery
> (`11-discovery-confirmation-checkpoint.md`). Everything downstream is contingent on your
> validation of the assumptions, problem framing, scope, and threat model. Later phases are
> intentionally *not* written until you confirm — because they depend on scope and
> separation-of-powers decisions only you can ratify.

### 0.4 Documents in the Discovery Phase

| # | File | What it contains |
|---|------|------------------|
| 00 | `00-master-index.md` | This index; four-modes rule; delivery contract; conventions |
| 01 | `01-assumptions-register.md` | All assumptions (legal, technical, governance, operational, financial, organizational, **justice-institutional**) with confidence, impact-if-wrong, validation owner |
| 02 | `02-justice-system-problem-analysis.md` | Root-cause problem trees for systemic justice-sector challenges; Botswana-specific claims flagged for validation |
| 03 | `03-stakeholder-analysis.md` | Every stakeholder: role, needs, interactions, permissions posture, risks-to/risks-from, incentives, design implications (no invented opinions) |
| 04 | `04-functional-gap-analysis.md` | Current (assumed) vs desired capabilities → gaps → owning component |
| 05 | `05-service-blueprint.md` | Layered service blueprints for key journeys (front-stage/back-stage/support/evidence/fail points) |
| 06 | `06-domain-model.md` | DDD bounded contexts, context map, aggregates, ubiquitous language, event-catalog seed |
| 07 | `07-capability-map.md` | Business capability map (L1/L2) across the justice value chain, mapped to services |
| 08 | `08-threat-model-stride-linddun.md` | Assets, actors, trust assumptions; 30+ STRIDE + LINDDUN threats spanning all four modes |
| 09 | `09-trust-model.md` | Trust zones/boundaries, separation-of-powers data ownership, roots of trust, split-trust, AI trust bounds |
| 10 | `10-risk-register.md` | Consolidated program + security + privacy + delivery risk register |
| 11 | `11-discovery-confirmation-checkpoint.md` | Discovery summary, top risks, high-impact assumptions, decisions requested → **STOP** |

### 0.5 Cross-cutting conventions

- **DDR (Design Decision Record).** Every major decision (from the Design phases on) uses:
  `DDR ID · Context · Problem · Decision · Alternatives Considered · Threats Mitigated
  (STRIDE/LINDDUN IDs) · Privacy Implications · Legal Implications · Trade-offs · Future
  Review Trigger`.
- **Threat IDs.** STRIDE: `S/T/R/I/D/E-*`. LINDDUN: `L/ID/NR/DT/DD/U/NC-*`. Stable, referenced downstream.
- **Assumption IDs.** `A-LEG-*`, `A-TEC-*`, `A-GOV-*`, `A-OPS-*`, `A-FIN-*`, `A-ORG-*`, `A-JUS-*` (justice-institutional).
- **Risk rating.** L×I (1–5 each) → Low 1–5 / Medium 6–11 / High 12–19 / Critical 20–25. Impact scored **safety- and rights-first**.
- **Honesty markers.** `⚠️ COST:` names a cost we accept for safety/rights; `🔒 HUMAN-EXPERT-REVIEW-REQUIRED` marks anonymity-, cryptography-, evidence-integrity-, metadata-, and AI-decision-support subsystems that must never be autonomously built.
- **Quality gate (per section):** maps decisions to STRIDE + LINDDUN; states residual risks; documents assumptions; identifies legal/privacy/security review needs; includes measurable success criteria.

### 0.6 Non-negotiable constraints (carried into every section)

1. **Safety, privacy, fairness, and due process are never traded for convenience.**
2. **The four justice modes stay separated** (§0.2). No allegation is assumed true.
3. **The platform operator is inside the threat model** for confidential reporting — no
   single party can de-anonymize a reporter.
4. **Separation of powers is reflected in data ownership** — the judiciary owns adjudication
   data; the executive owns investigation data; oversight bodies own their own records; no
   arm silently reads another's (Trust Model §09).
5. **Human decision-makers are never replaced by AI.** AI assists (translation, categorization,
   duplicate detection, PII redaction, summarization, prioritization); it never determines
   guilt, innocence, or any legal outcome.
6. **Data minimization by default** — every stored field carries purpose, legal basis,
   retention, encryption level, access policy, deletion policy (enforced from the Data batch).
7. **Compliance by default · privacy/security by design · zero trust · least privilege ·
   defense in depth · legal defensibility · auditability.**

### 0.7 What this blueprint explicitly does not promise (honesty)

- It cannot protect a reporter whose own device is compromised, nor prevent content-based
  self-identification, nor defeat physical coercion, nor beat a global passive network
  adversary (see `08-* §2.8`).
- It cannot substitute for qualified Botswana legal, judicial, or policy review — every such
  statement is flagged for expert validation.
- It cannot, by itself, fix institutional or political dysfunction; it is an enabler of
  transparency and due process, not a guarantor of them.
- It does not assume any allegation is true and does not publish individually identifying
  allegations.

---

*Read `01` → `10` in order, then respond at the Confirmation Checkpoint in `11`.*
