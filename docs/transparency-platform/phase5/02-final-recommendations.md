# Phase 5 · WS2 — Final Recommendations (Consolidated & Prioritized)

**Consolidates:** recommendations from every phase into one prioritized strategy. **Closes** Part-F
catalogue item 26. Priority reflects **reporter safety and programme viability first**. Each item:
rationale · dependencies · owner · effort · phase · risks · success criteria · approvals.
Effort S/M/L/XL `⟦validate⟧`.

---

## CRITICAL (do first; go-live impossible without them)

| ID | Recommendation | Rationale | Deps | Owner | Effort | Phase | Risk | Success criteria | Approval 🔒 |
|----|----------------|-----------|------|-------|--------|-------|------|------------------|------------|
| C1 | **Constitute independent governance + threshold custody** | D-01 is meaningless without it; RK-03 | Funding, members | OB | XL | P0 | RK-03 | 8 bodies live; M-of-N enrolled | OB, legal 🔒 |
| C2 | **Obtain Botswana legal validation** (whistleblower reach, compelled-access, admissibility, cross-border, separation of powers, DPA) | Entire legal basis is `⟦validate⟧` | Counsel | Legal 🔒 | L | P0 | RK-10 | Opinions on every `../phase4/02 §9` item | OB, counsel 🔒 |
| C3 | **Build the Security Foundation** (IAM/KMS-HSM/threshold/audit/monitoring/DevSecOps) | Everything depends on it (D-05) | C1, HSM procurement | Security Arch | XL | P1 | RK-06/12 | SR-001..005, PR-002 pass | ISRB 🔒 |
| C4 | **Independent security + crypto review of 🔒 subsystems** | Anonymity claim must be externally proven | C3, external firm | ISRB 🔒 | L | P1/P2 | RK-01/02 | Red team cannot de-anon; crypto clean | ISRB, OB 🔒 |
| C5 | **Ship reporter-safety controls** (no-identity, metadata-resistant intake, honest UX) | The core promise; RK-01/02/07 | C3 | Reporting+Privacy 🔒 | XL | P2 | RK-01/02/07 | FR-001..004 pass; 0 IP retained | ISRB, EC 🔒 |
| C6 | **Secure independent, no-strings funding for Phases 0–2** | Independence fails if funder = the scrutinized (RK-15) | Funders | OB+Finance 🔒 | M | P0 | RK-15/17 | Committed funding, independence-preserving | OB, funders 🔒 |

## HIGH PRIORITY

| ID | Recommendation | Rationale | Owner | Phase | Success criteria |
|----|----------------|-----------|-------|-------|------------------|
| H1 | **Digital Chain of Custody** operational (DDR-06) | Evidence defensibility (P3) | Forensics 🔒 | P1 | FR-008 pass; anchored |
| H2 | **CoI-aware secure routing + MVP recipient MoUs** | Avoid self-review; not a black hole | Governance | P2 | FR-007/009 pass; MoUs signed 🔒 |
| H3 | **DPIA + Data Protection Commissioner engagement** | Privacy compliance (NC-1) | PRB 🔒 | P0/P1 | DPIA approved |
| H4 | **DR/BCP tested (RTO/RPO)** | Availability of a safety service | SRE | P1 | Drill meets targets |
| H5 | **Operational Readiness scorecard to GREEN** | Gate prerequisite | Readiness Assessor | P2 | All Critical/🔒 GREEN |
| H6 | **Institutional engagement/validation plan executed** | Confirms `⟦validate⟧` assumptions | PMO+Change | P0–P3 | Assumptions confirmed/amended |
| H7 | **Pilot (Wave 0) with evaluation criteria** | De-risk before scale | PMO | P2 | Pilot metrics met; PIR done |

## MEDIUM PRIORITY

| ID | Recommendation | Phase | Success criteria |
|----|----------------|-------|------------------|
| M1 | Integration platform + Interoperability Standards + first ACL | P3 | Conformance green |
| M2 | Oversight Portal + responsiveness metrics + Public Trust Index v1 | P3 | Metrics published, non-attributable |
| M3 | Justice-services workspaces (per MoU) | P4 | Per-service ORG re-passed |
| M4 | AI assistance (bounded, self-hosted) | P4 | D-09 enforced; human-in-loop |
| M5 | Transparency dashboard (disclosure-controlled) | P4 | No sub-threshold cell |

## LOW PRIORITY

| ID | Recommendation | Phase |
|----|----------------|-------|
| L1 | Advanced analytics / policy insight | P4/P6 |
| L2 | Digital archive migration of legacy records | P4/P5 |
| L3 | Additional language packs beyond Setswana/English | P5 |

## QUICK WINS (high value, low dependency; mostly operator-controlled)

| ID | Quick win | Why now |
|----|-----------|---------|
| Q1 | Zone-isolation CI invariant tests (EP1-S2) | Cheap; enforces D-06 from day one |
| Q2 | Per-field `field_policy` + CI check (EP1-S12) | Cheap; enforces minimization |
| Q3 | Reproducible-build + SBOM pipeline (EP1-S13) | Establishes supply-chain trust early |
| Q4 | Honest risk-UX content draft + comprehension test (EP2-S4) | Safety-critical; no infra dependency |
| Q5 | Warrant-canary + transparency-report templates | Builds trust posture pre-launch |

## LONG-TERM STRATEGIC IMPROVEMENTS

| ID | Improvement | Horizon |
|----|-------------|---------|
| S1 | Post-quantum crypto migration (crypto-agility, DDR-10) | P6 |
| S2 | Customary-justice module (co-designed, D-08) | P4+ 🔒 |
| S3 | National DPI interoperability (guardrailed, `../phase4/10`) | P5+ 🔒 |
| S4 | Low-end channels: USSD/SMS/voice (D-04 re-eval) | P5 |
| S5 | Regional expansion / open APIs / additional transparency domains | P6+ |
| S6 | ISO 27001/27701 certification + SOC 2 attestation | P4–P6 |

## Prioritization logic (honest)

**[FACT]** The Critical set is dominated by **non-code** items — governance, legal validation,
funding, independent review — because the platform's hardest risks (RK-01/03/10/15) are not solved
by software. **[REC]** Sequence C1/C2/C6 (governance, legal, funding) **in parallel with** C3
(security foundation, buildable on synthetic data), so engineering progresses while the
gate-critical human decisions are secured. Nothing in HIGH+ starts touching real reporters before
C4/C5 and the readiness gates.

## Quality gate

- **Traces to:** all phases; D-01..11; RK-01..24 + ER-01..13; DDRs.
- **Preserves:** every recommendation aligns with approved architecture/governance; none weakens a
  control.
- **Residual risks:** effort/priority are planning-grade `⟦validate⟧`; non-technical Criticals may
  slip and stall the programme.
- **Acceptance criteria:** each recommendation has owner/phase/deps/success/approval; Critical items
  map to readiness-gate criteria.
- **🔒 Required review:** OB (prioritization), legal/finance/ISRB per item.

*Next: `03-implementation-master-plan.md`.*
