# Phase 4 · 01 — Executive Summary

**Audience:** Cabinet, justice-sector leadership, oversight bodies, funding partners, technical
leadership. **Basis:** the approved NJTIP Discovery→Phase-3 blueprint. **One-page brief + detail.**

---

## The one-paragraph version

NJTIP is a modular national platform to strengthen **transparency, integrity, and due process**
across Botswana's justice sector. It lets citizens **confidentially and safely** report suspected
corruption and misconduct, gives justice institutions integrity-preserving tools, and publishes
**verified, aggregated, non-attributable** transparency data — while rigorously protecting
**judicial independence, separation of powers, privacy, and reporter safety**. It is architected so
that **no single operator — even the platform itself — can identify a reporter**, and so that no
arm of the state can silently read another's data. It is delivered **safety-first and MVP-first**,
behind formal readiness gates, with **independent governance** at its core.

## Vision & objectives

- **Vision:** a justice sector that is more accountable, accessible, and trusted, where integrity
  concerns can be raised safely and institutions can demonstrate — with evidence — that they act.
- **Objectives:** safe confidential reporting; provable evidence integrity; reduced fragmentation
  via standards-based integration; measurable transparency and responsiveness; expanded access to
  justice; all without compromising rights or constitutional principles.

## Strategic benefits (detailed in Benefits Realization `08`)

Reduced impunity through safe reporting · faster, more visible case handling · defensible evidence
· inter-agency efficiency without central surveillance · an evidence base for policy · measurably
higher public trust (the **Public Trust Index**).

## Architectural principles (approved)

Privacy & Security by Design · Zero Trust · Least Privilege · Defense in Depth · **Constitutional
Architecture** (three non-collapsible data zones) · **operator-in-threat-model** · **technical
inability to de-anonymize** · **AI never decides** · data minimization · auditability · integrate-
not-replace. *(Ratified decisions D-01…D-11.)*

## Governance model

An **independent Oversight Trust** with eight governing bodies (Oversight Board, Technical Steering,
Independent Security Review, Ethics, Privacy Review, Architecture Review, Incident Review,
Operational Management), **threshold (M-of-N) key custody** so no single party can de-anonymize, and
**governance-as-code** enforced at runtime. Independence is the platform's foundation, not an
add-on. 🔒 institutional-governance constitution required.

## Implementation roadmap (Phases 0–6)

Governance & Readiness → Security Foundation → **Confidential Reporting MVP** → Integration Platform
→ Justice Services Expansion → National Rollout → Continuous Improvement. Each production phase
passes an **Operational Readiness Gate** and **Production Go-Live Gate**; build proceeds on
synthetic data until gates are GREEN.

## Key risks & mitigations (full register `09`, `../10`)

| Top risk | Mitigation |
|----------|-----------|
| Reporter de-anonymization (compulsion/metadata/phishing) | Collect no identity; threshold key custody; metadata-resistant intake; verifiable clients |
| Governance capture | Independent, term-limited, multi-constituency bodies; threshold; external escalation |
| Institutional non-participation | MoU-based, phased onboarding; broad sponsorship; honest responsiveness metrics |
| Funding/sustainability | Diversified independent funding; low idle-cost, portable architecture |
| False confidence harming a reporter | Honesty-first UX and communications; residual risks stated plainly |

## Funding considerations (detail `07`)

Donor/development-partner funding assumed for build + early operation (independence precludes funding
by the institutions under scrutiny). Costs driven by HSM/infra, offshore DR, telecom/data, and
external specialists (FX-exposed). All figures are **planning-grade `⟦validate⟧`**, not commitments.

## Readiness status (honest)

The **blueprint is complete through Phase 3**; the programme is **not yet built and not yet
approved for production**. Go-live is **blocked** until: governance constituted, legal/privacy/
security/architecture reviews complete, incident & DR tested, and the readiness scorecard GREEN
with Oversight Board sign-off (`../phase3/07`, `../phase2/05`). Botswana-specific legal and
institutional assumptions **must be validated by qualified local experts before implementation.**

## The honest bottom line (for decision-makers)

NJTIP can materially improve justice-sector integrity **if** three non-technical conditions hold:
**genuine governance independence**, **institutional participation**, and **sustained independent
funding**. The technology is designed to protect people even from its own operators; it **cannot**
by itself supply political will, and it **cannot** protect a reporter whose own device is
compromised or who self-identifies through content. These limits are stated plainly throughout —
because over-promising safety would itself be a harm.

## Quality gate

- **Traces to:** entire approved blueprint (D-01…D-11; `../design`, `../phase2`, `../phase3`).
- **Assumptions:** funding, governance independence, participation, and all Botswana legal facts
  are `⟦validate⟧`.
- **Residual risks:** as above — non-technical conditions dominate.
- **Acceptance criteria:** approved as the executive basis for legal review, procurement, and
  funding decisions.
- **🔒 Required review:** executive sponsors, legal, funders, OB.

*Next: `02-legal-ethical-framework.md`.*
