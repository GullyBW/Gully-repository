# 11 — Discovery Phase Validation → ⛔ Confirmation Checkpoint

> **Per both engagement briefs, the blueprint stops here.** The entire Design and Delivery
> program — Governance, Trust Architecture, Zero-Trust Security, System/Domain design, the 22
> service specs, API/OpenAPI/schemas, GitHub epics, and the roadmap — is **contingent** on
> validating this Discovery Phase. This document (a) summarizes what Discovery established,
> (b) names the decisions only you can make, and (c) asks the specific questions we need
> answered before the Design phase begins.

---

## 11.1 What Discovery established

| Artifact | Output |
|----------|--------|
| `01` Assumptions Register | 41 assumptions (legal, technical, governance, operational, financial, organizational, **justice-institutional**, **AI**); ⚑ high-impact ones flagged |
| `02` Problem Analysis | 10 systemic problems (P1–P10) with root-cause trees; clustered into 4 leverage points; Botswana-specific claims tagged `⟦validate⟧` |
| `03` Stakeholder Analysis | 15 stakeholder groups with needs, permissions posture, risks-to/from, and design implications; no invented opinions |
| `04` Functional Gap Analysis | current→desired gaps across all domains; owning components; a **proposed MVP cut line** |
| `05` Service Blueprint | 5 key journeys blueprinted across 5 layers with fail points mapped to threats |
| `06` Domain Model | 16 bounded contexts, context map, aggregates, event-catalog seed, ubiquitous language (Report ≠ Case) |
| `07` Capability Map | L0–L2 capabilities across the justice value chain; bidirectional coverage of all 22 services; sequencing |
| `08` Threat Model | Zone-R (reporting) + Zone-O (official) STRIDE + LINDDUN, ~36 threats, ratings, mitigations, residual risk |
| `09` Trust Model | Zero-trust zones, separation-of-powers data zones, roots of trust, bounded AI trust |
| `10` Risk Register | 24 risks, owner-assigned; 4 Critical, 13 High |

**The through-line:** four systemic leverage points (safe/accountable channels; a shared,
permissioned source of truth without collapsing separation of powers; provable integrity;
inclusion) addressed by a modular ecosystem that keeps **four justice modes** and **three
constitutional data zones** strictly separated, with the **operator inside the threat model**
for confidential reporting.

## 11.2 The decisions that shape everything downstream

The Critical/High risks (`10`) and ⚑ assumptions (`01`) reduce to a handful of choices only
you (and your legal/governance advisors) can ratify. **Getting these wrong later means
reworking the Design phase.**

### Carried forward from the confidential-reporting checkpoint

**Q1 — Operator & oversight model (A-ORG-01 / A-GOV-01 / RK-03).**
Confirm the platform is built around an **independent operator + genuinely independent,
multi-stakeholder oversight body**, with the operator inside the threat model? Or is a
government-hosted / single-institution model a hard constraint (which materially weakens
achievable anonymity)?

**Q2 — Anonymity vs. lawful compliance (I-1 / NC-2 / RK-01 / RK-10).**
Confirm we resolve in favor of anonymity — architect so the operator is *technically unable*
to de-anonymize even under lawful order, accepting the legal exposure and the need for
Botswana legal review? Or must a lawful-disclosure capability be retained (fundamentally
different trust model)?

**Q3 — Hosting-jurisdiction leaning (A-TEC-03 / A-LEG-04 / A-LEG-08 / A-JUS-03).**
For the deployment-model analysis in the Design phase, do you lean **(a) in-country**,
**(b) offshore**, **(c) hybrid/distributed** (e.g., judiciary data in-country, resilient
governance offshore), or **(d) no lean — present the full comparison and recommend?**
*(Note: separation of powers (A-JUS-03) may itself force some data to specific jurisdictions/
custody.)*

**Q4 — MVP intake channels (A-TEC-01/02 / DT-1 / RK-21).**
Must release 1 support low-end reach (**USSD/SMS/voice/feature-phone + offline**) as mandatory
(max reach, worse metadata safety), or is a **smartphone/PWA-first** MVP acceptable with
low-end channels as a fast follow?

### New — ecosystem-scope decisions

**Q5 — Program scope & MVP cut line (A-ORG-02 / A-JUS-05 / RK-04 / `04 §4.6`).**
We propose an MVP of **confidential reporting + the security spine (IAM/KMS/HSM/Audit/
Monitoring/DR) + CoI routing + responsiveness metrics**, deferring full court/prosecution/
defence/oversight/transparency to Phase 2+ (gated on institutional MoUs). **Confirm this cut
line, or tell us to (a) narrow to reporting-only, or (b) widen to include specific Zone-O
components in release 1** (name which, given they depend on that institution adopting).

**Q6 — Separation-of-powers data ownership (A-JUS-01/03 / I-6 / RK-09).**
Confirm the **three non-collapsible data zones** (Executive / Judiciary / Independent) with
**no shared database** and only event-driven, audited, scoped cross-zone access — as the
architectural expression of judicial independence? Or is there an existing legal/institutional
data-sharing arrangement we must design to instead?

**Q7 — Integrate vs. replace (A-JUS-02 / RK-20).**
Confirm NJTIP is an **integration/transparency/integrity layer that interoperates with existing
institutional systems** (behind anti-corruption layers), **not** a rip-and-replace of court/
police IT? If any institution actually expects replacement, name it (materially changes scope,
cost, and risk).

**Q8 — Customary justice in scope? (A-JUS-06 / RK-23).**
Should customary justice (dikgotla / Kgosis) be **designed for from the start** (co-designed as
a first-class domain) or explicitly **deferred**? This affects the domain model, language, and
accessibility work.

**Q9 — AI boundary (A-AI-01 / T-7 / RK-14).**
Confirm AI is **assistive-only, human-in-the-loop, explainable, and never in the decision path**
(translation, categorization, dedup, PII redaction, summarization, prioritization)? This is a
hard constraint we will not relax without your explicit instruction.

**Q10 — Threat/stakeholder completeness (RK-17 and general).**
Anything we've **under- or over-weighted** for the Botswana context — specific institutions,
known incidents, particular political/funding risks, or stakeholder groups — that we should
fold in before the Design phase?

### Delivery preference

**Q11 — How to deliver the Design phase after confirmation.**
Options: **(a)** Governance Framework + Trust Architecture + Executive Summary first
(recommended — they interlock and set up everything), then Security & System design; **(b)**
Security & System Architecture first (if you want to see the technical spine sooner); **(c)**
straight to **GitHub epics/stories for the MVP** so engineering can start on the security-spine
slice while design continues in parallel; or **(d)** another order you specify.

---

## 11.3 The tensions we will adjudicate downstream (named, not hidden)

Unchanged and still true — carried into the Design phase for explicit resolution:
1. Anonymity vs. lawful compliance (Q2). 2. Data residency vs. operational maturity (Q3).
3. Availability CDNs vs. metadata exposure. 4. Anti-abuse vs. anonymity. 5. Evidence retention
vs. minimization. 6. Reach vs. detection resistance (Q4). **Plus new:** 7. Integration vs.
separation of powers (Q6/Q7). 8. Transparency vs. confidentiality/open-justice exceptions.
9. Institutional participation vs. operator-controlled MVP (Q5).

## 11.4 How to respond

A terse answer is enough to proceed, e.g.:
> *"Q1 independent · Q2 anonymity · Q3 hybrid · Q4 PWA-first · Q5 confirm cut line · Q6 confirm
> 3 zones · Q7 integrate · Q8 design-for-it · Q9 confirm · Q10 none · Q11 a"*

Any **"correct/adjust"** on an assumption is written back into `01-assumptions-register.md`
before the Design phase, so the record stays truthful. Corrections to the threat model or scope
are folded into `08`/`04` respectively.

**Until you respond, no Design-phase content is generated — by design, not oversight.** The
anonymity, cryptography, evidence-integrity, metadata, and AI-decision-support subsystems remain
flagged 🔒 HUMAN-EXPERT-REVIEW-REQUIRED and will not be autonomously built.

## 11.5 Definition-of-Done for Discovery

- [x] All 10 Discovery artifacts produced (Assumptions → Risk Register).
- [x] Discovery summarized; top risks and highest-impact assumptions surfaced.
- [x] Decision-shaping questions posed (Q1–Q11), covering scope, separation of powers,
  integration, customary justice, AI bounds, and delivery order.
- [x] Downstream tensions named; specialist-review needs recorded per artifact.
- [x] Explicit stop; all Design/Delivery work declared contingent on confirmation.
