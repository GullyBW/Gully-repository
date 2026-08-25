# Phase 8 · WS8 — Engineering Analytics (Verification-Centric)

**Traces:** Engineering Metrics `../phase7/09`, Continuous Verification `04`, Architecture-as-Code
`03`. **Purpose:** measure the **verification system** and engineering health to improve quality —
extending `../phase7/09` with twin/verification-specific analytics. **[DECISION]** Analytics improve
the system and platform; they are **never** used to evaluate individuals.

---

## 1. Analytics (twin/verification-centric)

| Metric | Meaning | Guardrail? |
|--------|---------|-----------|
| **Verification coverage** | % of requirements/DDRs with automated verification | trend ↑ (target near-100% for enforceable) |
| **Architecture conformance** | Fitness-function pass rate (`03`) | **100%** (guardrail) |
| **Security posture** | Open Critical/High; sim (`05`) results; patch SLA | Critical/High = 0 to certify |
| **Privacy compliance** | PII/IP-leakage findings; disclosure-control adherence | **0 leakage** (guardrail) |
| **Governance compliance** | Threshold/CoI/gate enforcement pass; exception age | **100%** enforcement |
| **Resilience** | DR/chaos pass; SLO adherence; error-budget burn | RTO/RPO met |
| **Operational maturity** | Runbook coverage; drill pass; MTTR | trend ↑ |
| **Technical debt** | Debt register size/age; conformance exceptions | trend ↓ |

## 2. Guardrail vs trend (crucial distinction)

**[FACT]** Conformance (100%), privacy leakage (0), and governance enforcement (100%) are
**guardrails** — hard limits that gate certification (`07`); the rest are **trends** used for
improvement. A "productivity" gain that lowers a guardrail is a regression.

## 3. Using analytics ethically

- **[DECISION]** Platform/team level only; **no individual-performance use** — consistent with a
  culture where engineers must feel safe to raise reporter-safety concerns (`../phase7/09`).
- Feedback loop: analytics → continuous-learning backlog (`10`) → standards/tooling/test improvements
  → re-measure. Governed like any change (`../phase7/03`).

## 4. Reporting

To TSC (delivery) and OB (aggregate); conformance/security/privacy metrics feed the Public Trust
Index (`../phase2/09`). No reporter/case/individual-engineer data in any analytic.

## 5. Quality gate

- **Traces to:** `../phase7/09`, `04`, `03`; RK-06/12; guardrail threats.
- **Preserves:** guardrails as hard limits; team-not-individual use; privacy of analytics.
- **Threats mitigated:** metric-gaming that erodes safety (guardrails); conformance drift.
- **Residual risks:** metric myopia (mitigated: balanced set); coverage gaps (mitigated: coverage
  metric itself).
- **Trade-offs:** ⚠️ guardrails cap velocity theater — accepted.
- **Acceptance criteria:** verification/conformance/posture analytics collected; guardrails enforced
  (100%/0) as certification gates; used for system improvement only; no individual eval.
- **🔒 Required review:** TSC, ISRB (posture), OB (guardrail policy).

*Next: `09-human-review-boundaries.md`.*
