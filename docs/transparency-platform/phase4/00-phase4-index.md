# NJTIP — Phase 4: Strategic Assurance, National Readiness & Implementation Evidence (Index)

**Status:** DRAFT — Phase 4 (strategic + assurance layer). **Do not generate production code; do
not redesign approved architecture.**
**Authoritative inputs:** Discovery `../01`–`../12`, Design `../design/*`, Phase 2 `../phase2/*`,
Phase 3 `../phase3/*`. **Last updated:** 2026-07-07

> Phase 4 completes the **strategic, governance, assurance, and evidence** documentation needed
> *before* production implementation — for executive approval, legal review, procurement, funding,
> and long-term national operation. It **references and assembles**; it does not redesign. Every
> document distinguishes **verified facts from assumptions**, keeps 🔒 human-review topics flagged,
> and closes with acceptance criteria + residual risks.

## Documents (mapped to the brief's 13 sections)

| # | File | Brief section |
|---|------|---------------|
| 01 | [Executive Summary](./01-executive-summary.md) | 1 — Cabinet/leadership/funder briefing |
| 02 | [Legal & Ethical Framework](./02-legal-ethical-framework.md) | 2 — constitutional, judicial independence, due process, privacy, ethics |
| 03 | [Compliance Mapping](./03-compliance-mapping.md) | 3 — DPA/ISO/NIST/OWASP/SOC 2 controls, evidence, residual risk |
| 04 | [Comparative Analysis](./04-comparative-analysis.md) | 4 — SecureDrop, GlobaLeaks, X-Road, others; transferable principles |
| 05 | [Botswana Adaptation Strategy](./05-botswana-adaptation-strategy.md) | 5 — assumptions to validate + institutional engagement plan |
| 06 | [Technology Strategy](./06-technology-strategy.md) | 6 — selection principles, interoperability, scalability, lifecycle |
| 07 | [Sustainability & Funding Strategy](./07-sustainability-funding-strategy.md) | 7 — funding model, staffing, skills, vendor, procurement, sustainability |
| 08 | [Benefits Realization Framework](./08-benefits-realization-framework.md) | 8 — measurable benefits with baseline/target/owner/method |
| 09 | [Enterprise Risk Management](./09-enterprise-risk-management.md) | 9 — strategic/legal/operational/financial/procurement/reputational/org risks |
| 10 | [National DPI Alignment](./10-national-dpi-alignment.md) | 10 — open standards, interoperability, shared governance |
| 11 | [Business Continuity & Resilience](./11-business-continuity-resilience.md) | 11 — workforce, crisis comms, supplier, alternate ops, exercises |
| 12 | [Independent Assurance Framework](./12-independent-assurance-framework.md) | 12 — recurring independent reviews across domains |
| 13 | [Production Evidence Package](./13-production-evidence-package.md) | 13 — evidence structure, versioning, maintenance |

## Verified vs assumption convention

- **[VERIFIED]** — traceable to an approved NJTIP artifact or a widely-documented public fact.
- **`⟦validate⟧`** — Botswana-specific claim requiring local expert/stakeholder validation (never
  asserted as fact).
- **🔒** — mandatory human-review topic (constitutional, judicial, admissibility, cross-border,
  key-custody, privacy-regulation, institutional, procurement, funding).

## Traceability rule

Each recommendation maps to: stakeholder need (`../03`) · requirement (`../phase2/04`) · assumption
(`../01`) · threat (`../08`) · risk (`../10`/`09`) · DDR (`../design`) · architecture component ·
governance control (`../phase2/01-03`, `../phase3/01`) · operational process (`../phase3`). No
orphans.

## Where this leaves the programme

Phase 4 supplies the **evidence and strategy** that the Operational Readiness Gate (`../phase2/05`)
and Production Go-Live Gate (`../phase3/08`) consume. It does not itself authorize go-live — the
gates and Oversight Board sign-off do.

*Read `01`→`13`.*
