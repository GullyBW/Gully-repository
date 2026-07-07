# Botswana National Transparency & Integrity Platform
## Enterprise Architecture & Governance Blueprint — Master Index

**Document status:** DRAFT — Batch 1 of the phased engagement (Foundations)
**Classification:** Internal / Restricted (contains threat model and adversary analysis)
**Primary currency:** Botswana Pula (BWP), USD secondary
**Owner:** (to be assigned — proposed Independent Oversight Trust, see Governance Framework §6)
**Last updated:** 2026-07-07

> **Working name.** This blueprint refers to the platform as **BNTIP** (Botswana National
> Transparency & Integrity Platform) for brevity. The name is a placeholder; a public-facing
> brand should be chosen with communications and legal advisors and is deliberately *not*
> fixed here (see Assumptions Register, A-ORG-04).

---

### 0.1 Purpose of this document

This is the top-level index and reading guide for the BNTIP Enterprise Architecture &
Governance Blueprint. The blueprint is an **implementation-ready** design for a
secure, privacy-preserving national platform that lets citizens confidentially report
suspected corruption, misconduct, abuse of office, maladministration, and related
integrity issues within Botswana's justice sector, with a designed path to expand into a
full National Transparency Platform covering all public institutions.

The blueprint is intended to serve, without rework, as the foundation for:
software architecture, security assessment, legal and privacy review, governance
planning, funding proposals, GitHub epics and milestones, and human-supervised
AI-assisted development.

### 0.2 How this document is produced (delivery contract)

This blueprint is deliberately produced in **batches**, not in a single pass. The design
mandate (Part C §3 of the engagement brief) requires that the **Threat Model be validated
by the client before any architecture, governance model, technology recommendation, or
roadmap is produced.** Accordingly:

| Batch | Sections | Status |
|-------|----------|--------|
| **1 — Foundations (this batch)** | Master Index · Assumptions Register · Threat Model (STRIDE + LINDDUN) · Threat Model Validation → **Confirmation Checkpoint** | **DELIVERED — awaiting your confirmation** |
| 2 — Governance & Trust | Executive Summary · Governance Framework · Trust Architecture | Blocked on Batch-1 confirmation |
| 3 — Security & System Architecture | Security Architecture · Cryptographic Design · Data Flow · System Architecture · Database Design · Evidence Management | Blocked |
| 4 — Product & Workflow | Problem Analysis · Stakeholder Analysis · Functional & Non-Functional Requirements · UX/UI Strategy · Verification Workflow · AI Integration | Blocked |
| 5 — Legal, Compliance & Risk | Legal & Ethical Framework · Compliance · Risk Register · Comparative Analysis · Botswana Adaptation | Blocked |
| 6 — Delivery & Sustainability | Technology Stack · Monitoring & Transparency · Sustainability & Funding · Implementation Roadmap · Future Roadmap · Final Recommendations | Blocked |

> **⛔ Confirmation Checkpoint.** The blueprint **stops** at the end of Batch 1. Every
> section from Batch 2 onward is contingent on your validation of the assumptions and
> threat model in this batch. See `03-threat-model-validation-checkpoint.md` for the
> specific decisions requested of you. Do not treat later batches as pending "somewhere in
> the background" — they are intentionally not written until you confirm, because they
> depend on choices only you can ratify.

### 0.3 Documents in this batch

| # | File | What it contains |
|---|------|------------------|
| 00 | `00-master-index.md` | This index; reading guide; delivery contract; coverage map |
| 01 | `01-assumptions-register.md` | Every explicit and implicit assumption (legal, technical, governance, operational, financial, organizational) that shapes the design, with confidence, impact-if-wrong, and validation owner |
| 02 | `02-threat-model-stride-linddun.md` | Assets, threat actors, trust assumptions, and the formal STRIDE (security) + LINDDUN (privacy/anonymity) threat catalogue with risk ratings, mitigations, residual risk, and architectural implications |
| 03 | `03-threat-model-validation-checkpoint.md` | Summary of highest-priority risks and highest-impact assumptions; the formal Confirmation Checkpoint and the explicit questions you must answer before Batch 2 |

### 0.4 Coverage map — 26-item catalogue → delivery batches

The engagement brief (Part F) requires 26 sections. This map shows where each is
delivered so nothing is silently dropped.

| Catalogue item | Delivered in |
|----------------|--------------|
| 1. Executive Summary | Batch 2 |
| 2. Problem Analysis | Batch 4 |
| 3. Stakeholder Analysis | Batch 4 |
| 4. Governance Framework | Batch 2 |
| 5. Functional Requirements | Batch 4 |
| 6. Non-Functional Requirements | Batch 4 |
| 7. UX/UI Strategy | Batch 4 |
| 8. Security Architecture | Batch 3 |
| 9. Cryptographic Design | Batch 3 |
| 10. Data Flow Architecture | Batch 3 |
| 11. System Architecture | Batch 3 |
| 12. Database Design | Batch 3 |
| 13. Evidence Management | Batch 3 |
| 14. Verification Workflow | Batch 4 |
| 15. AI Integration | Batch 4 |
| 16. Legal & Ethical Framework | Batch 5 |
| 17. Compliance | Batch 5 |
| 18. Risk Register | Batch 5 |
| 19. Comparative Analysis | Batch 5 |
| 20. Botswana Adaptation | Batch 5 |
| 21. Technology Stack | Batch 6 |
| 22. Monitoring & Transparency | Batch 6 |
| 23. Sustainability & Funding | Batch 6 |
| 24. Implementation Roadmap | Batch 6 |
| 25. Future Roadmap | Batch 6 |
| 26. Final Recommendations | Batch 6 |
| — Assumptions Register (Part C §1) | **Batch 1** |
| — Threat Model STRIDE+LINDDUN (Part C §2) | **Batch 1** |
| — Threat Model Validation (Part C §3) | **Batch 1** |
| — DDRs (Part C §4) | Embedded in Batches 2–6 at each decision point |

### 0.5 Cross-cutting conventions used throughout the blueprint

- **DDR (Design Decision Record).** Every major architectural, cryptographic, and
  governance decision is captured in a DDR using the Part C §4 template and is mapped to
  the specific STRIDE/LINDDUN threats it mitigates. DDRs begin in Batch 2.
- **Threat IDs.** Security threats are `S-*` (Spoofing), `T-*` (Tampering), `R-*`
  (Repudiation), `I-*` (Information disclosure), `D-*` (Denial of service), `E-*`
  (Elevation of privilege). Privacy threats are `L-*` (Linking), `ID-*` (Identifying),
  `NR-*` (Non-repudiation), `DT-*` (Detecting), `DD-*` (Data disclosure), `U-*`
  (Unawareness), `NC-*` (Non-compliance). These IDs are stable and are referenced by
  every downstream design decision.
- **Assumption IDs.** `A-LEG-*`, `A-TEC-*`, `A-GOV-*`, `A-OPS-*`, `A-FIN-*`, `A-ORG-*`.
- **Risk rating scale.** Likelihood × Impact on a 5-point scale each → severity band
  (Low / Medium / High / Critical). Defined in `02-threat-model-stride-linddun.md §2.4`.
- **Honesty markers.** Where anonymity and operational convenience conflict, the blueprint
  resolves for anonymity and **names the cost** inline with a `⚠️ COST:` marker.
  Subsystems that must not be autonomously built are marked
  `🔒 HUMAN-EXPERT-REVIEW-REQUIRED`.

### 0.6 Non-negotiable design constraints (carried into every section)

1. **Reporter safety is the highest priority**, above operational convenience, cost, and
   feature richness.
2. **The platform operator is inside the threat model.** No single organization,
   administrator, or operator may independently compromise reporter anonymity.
3. **Confidential reporting is separated from public disclosure.** The platform routes
   reports to authorized recipients; it does **not** publish individually identifying
   allegations. Public output is limited to verified, aggregated, anonymized,
   non-attributable statistics unless disclosure is lawfully authorized.
4. **Human verification over automated judgment.** AI assists; it never determines guilt,
   innocence, or the truth of an allegation. All substantive decisions require human
   review.
5. **Evidence integrity is preserved** from submission through case closure.
6. **Compliance by default**, **privacy by design**, **security by design**, **zero
   trust**, **least privilege**, **defense in depth**.

### 0.7 What this blueprint explicitly does not promise

Stated up front and expanded in the Security Limitations section (Batch 3):

- It **cannot** protect a reporter whose own device is compromised (malware, spyware,
  forensic seizure, shoulder-surfing).
- It **cannot** prevent a reporter from voluntarily self-identifying or being identified
  through the *content* of what they report (a report only three people could have made
  identifies its author regardless of cryptography).
- It **cannot** defeat physical coercion of a reporter, an operator, or a governance
  member.
- It **cannot** guarantee anonymity against a global passive network adversary who can
  observe all traffic into and out of the country simultaneously; it can only raise the
  cost and narrow the window.
- It **cannot** substitute for qualified Botswana legal counsel; every legal statement in
  this blueprint is flagged as requiring confirmation by an admitted Botswana attorney
  before deployment.

---

*Next: read `01-assumptions-register.md`, then `02-threat-model-stride-linddun.md`, then
`03-threat-model-validation-checkpoint.md` and respond at the Confirmation Checkpoint.*
