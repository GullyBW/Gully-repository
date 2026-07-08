# Phase 4 · 08 — Benefits Realization Framework

**Traces:** Public Trust Index `../phase2/09`, Justice Analytics `../phase2/10`, Problem `../02`,
Monitoring `../design/06`. **Rule:** every benefit is **measurable, privacy-preserving, and
non-attributable**; benefits are never demonstrated by exposing individuals.

---

## 1. Benefit definition schema

Each benefit: *baseline · target · owner · measurement method · reporting frequency · success
threshold · review process.* Measurement uses the privacy-preserving analytics pipeline
(`../phase2/10`) with disclosure control — no individual/case data.

## 2. Benefits register

| Benefit | Baseline | Target `⟦validate⟧` | Owner | Method | Freq | Success threshold | Review |
|---------|----------|---------------------|-------|--------|------|-------------------|--------|
| **Transparency** | No published justice-sector aggregates | Regular Trust Index + transparency reports | OB | Report cadence met; methodology public | Quarterly | 100% cadence adherence | OB review |
| **Accessibility** | Baseline reach (pilot) | Rising multi-channel/language/offline reach | Change lead | Aggregate reach metrics, WCAG conformance | Quarterly | Reach + WCAG targets met | PRB (privacy) |
| **Responsiveness** | Baseline intake→action latency | Reduced latency; no "black holes" | Oversight | Non-attributable latency (`../phase2/09`) | Monthly | ≤ target latency; 0 unactioned > SLA | IRB/OB |
| **Public trust** | Baseline confidence (opt-in signal) | Rising Public Trust Index | OB | PTI composite (`../phase2/09`) | Quarterly | PTI trend positive | OB + public |
| **Operational efficiency** | Baseline throughput/backlog | Reduced bottlenecks | TSC | Aggregate throughput/backlog trends | Quarterly | Trend improving | TSC |
| **Governance effectiveness** | — | Full audit/CoI/exception discipline | OB | Audit completion, CoI recusal rate, exception age | Quarterly | Targets met | ISRB/OB |
| **Service quality** | Baseline SLOs | Meet Tier-1 SLOs | OMT | SLO adherence, MTTR | Monthly | SLOs met | ESM/OB |
| **Evidence integrity** | — | Provable integrity | ISRB | Integrity-check pass rate | Continuous | 100% pass | ISRB |
| **Reporter safety (guardrail)** | 0 incidents | 0 de-anonymization incidents | ISRB/OB | Incident metrics | Continuous | **0** (any >0 = critical review) | IRB/OB |

> **Reporter safety is a guardrail benefit, not a growth metric:** the target is **zero**
> de-anonymization incidents; it can never be traded for adoption or efficiency gains.

## 3. Measurement integrity & honesty

- All benefit metrics pass **disclosure control** (k-anonymity/suppression/DP) — a benefit is never
  shown by exposing a person or case (I-8/L-1).
- **No vanity metrics:** adoption is reported honestly alongside limits; a rising report count is
  not "success" if responsiveness lags (that would be a black hole, R-1).
- **Baselines** are established during the pilot (Wave 0) before targets are set; targets are
  `⟦validate⟧` until baselined.

## 4. Benefits governance

- Benefits reviewed by the **Oversight Board** on cadence; underperformance triggers corrective
  action (IRB/TSC) and, where relevant, re-planning (`../phase2/06`).
- Benefits feed the **Public Trust Index** and public transparency reports — accountability runs
  both ways (the platform is measured, publicly).

## 5. Quality gate

- **Traces to:** P1/P2/P6/P10; `../phase2/09/10`, `../design/06`.
- **Threats mitigated:** I-8/L-1 (disclosure control on all metrics), R-1 (responsiveness measured).
- **Residual risks:** targets are `⟦validate⟧` pre-baseline; composite indices can mislead
  (mitigated: publish components + methodology); attribution of outcomes to the platform is
  imperfect.
- **Trade-offs:** ⚠️ honest metrics may show slower/less flattering progress than vanity metrics —
  accepted (trust > optics).
- **Acceptance criteria:** every benefit has baseline/target/owner/method/threshold/review; safety
  guardrail = 0 incidents; all metrics privacy-preserving.
- **🔒 Required review:** OB, PRB (privacy of metrics), oversight bodies (targets), statistics.

*Next: `09-enterprise-risk-management.md`.*
