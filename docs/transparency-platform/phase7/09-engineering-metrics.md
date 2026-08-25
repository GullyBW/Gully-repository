# Phase 7 · WS9 — Engineering Metrics & Continuous Improvement

**Traces:** Observability `07`, Quality `06`, Governance automation `03`, Continuous Improvement
`../phase5/10`. **Purpose:** measure the **engineering system** to improve it — DORA plus NJTIP-
specific posture/conformance metrics. **[DECISION]** Metrics guide **team/platform improvement, never
individual performance evaluation.**

---

## 1. Metric set

| Category | Metric | Purpose |
|----------|--------|---------|
| **DORA** | Deployment frequency | Delivery throughput (synthetic staging) |
| | Lead time for changes | Flow efficiency |
| | Change failure rate | Stability |
| | MTTR | Recovery capability |
| **Security posture** | Open Critical/High findings; patch-SLA adherence; pen/red-team results | Safety (`../phase3/03`) |
| **Technical debt** | Debt register size/age; refactor throughput | Maintainability |
| **Architecture conformance** | Invariant-test pass rate; golden-path adoption; exception count/age | Constitutional integrity (must trend to 100%/low) |
| **Documentation completeness** | Specs/DDRs/runbooks coverage | Traceability/DX |
| **Developer experience** | Onboarding time; build/test time; self-service success; satisfaction | Platform quality (`05`) |
| **Quality** | Coverage; privacy/invariant pass (100% guardrail); flaky rate; escaped defects | `06` |
| **Reliability** | SLO adherence; error-budget burn | `08` |

## 2. Guardrail metrics (non-negotiable)

**[FACT]** Some metrics are **guardrails, not trends**: privacy-test pass = **100%**, invariant-test
pass = **100%**, de-anonymization incidents = **0**. These can never be traded for velocity — a rise
in deployment frequency that lowers a guardrail is a regression, not progress.

## 3. Using metrics well (and the ethics)

- **[DECISION]** Metrics improve the **system**, not rank people — DORA/DX are notoriously
  weaponizable; NJTIP uses them at team/platform level only, consistent with a culture that must be
  psychologically safe enough for engineers to raise safety concerns.
- **Feedback loop:** metrics → continuous-improvement backlog (`../phase5/10`) → golden-path/IDP/
  platform changes → re-measure. Gated like any change (`03`).

## 4. Reporting

Engineering metrics reported to TSC (delivery) and, in aggregate, to OB; security/conformance metrics
feed the Public Trust Index (`../phase2/09`). No individual-identifying engineering metrics are
published.

## 5. Quality gate

- **Traces to:** `07`, `06`, `03`, `../phase5/10`; RK-06/12.
- **Preserves:** guardrail metrics as hard limits; team-not-individual use.
- **Threats mitigated:** metric-gaming that erodes safety (guardrails prevent); technical-debt drift.
- **Residual risks:** metric myopia (mitigated: balanced set + guardrails); misuse for individual eval
  (mitigated: explicit policy).
- **Trade-offs:** ⚠️ guardrails cap "velocity theater" — accepted; velocity that lowers safety is not
  velocity.
- **Acceptance criteria:** DORA + posture/conformance/DX metrics collected; guardrails enforced (100%/
  0); metrics used for system improvement only; no individual-eval use.
- **🔒 Required review:** TSC, ISRB (posture metrics), OB (guardrail policy).

*Next: `10-knowledge-platform.md`.*
