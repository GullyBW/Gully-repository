# Phase 7 · WS6 — Quality Engineering Platform

**Traces:** Test Strategy `../phase3/04`, V&V `../phase6/06`, Golden Paths `02`. **Purpose:**
standardized, reusable testing capability so every team gets the full test spectrum — including the
NJTIP-specific **privacy and governance/invariant** tests — with minimal setup. Quality is a
platform, not each team's reinvention.

---

## 1. Reusable test frameworks (provided by the platform)

| Test type | Framework capability | NJTIP-specific assertions |
|-----------|----------------------|---------------------------|
| **Unit** | Standard harness + fixtures (synthetic) | fail-closed error paths |
| **Integration** | Service + event harness; ephemeral synthetic env | no cross-zone raw read |
| **Contract** | Consumer/provider contract tests (OpenAPI/AsyncAPI) | PII-free event schemas |
| **Performance** | Load/soak harness; SLO assertions | intake availability (Tier-1); degrade-to-minimal |
| **Security** | SAST/DAST/dep-scan integration; abuse tests | anonymity-preserving rate limit; authz fail-closed |
| **Accessibility** | WCAG automated + manual protocol; Setswana/low-literacy | comprehension test harness (RK-07) |
| **Resilience** | Fault injection | fail-closed on policy/KMS outage |
| **Chaos engineering** | Controlled failure experiments (synthetic) | intake survives downstream loss (D-1/D-4) |
| **Privacy (NJTIP)** | Telemetry/store scanners | **0 PII/IP/identity retained**; no C0 column |
| **Governance/invariant (NJTIP)** | Policy + invariant test runner | no cross-zone DB path; threshold blocks < M; field_policy present |

## 2. Quality gates & release-blockers

**[DECISION]** Privacy and governance/invariant tests are **release-blockers** with the same weight
as security Highs (`../phase3/04`). A green functional suite with a failing privacy test **does not
ship** — because the privacy test protects the core promise.

## 3. Quality metrics (platform-level)

| Metric | Purpose |
|--------|---------|
| Test coverage (critical paths) | Verification confidence |
| Contract-test pass rate | Interface stability |
| Privacy-test pass rate | Must be 100% (guardrail) |
| Invariant-test pass rate | Must be 100% (constitutional) |
| Escaped-defect rate | Quality trend |
| Flaky-test rate | Suite health |
| Mean test-suite time | DX + feedback speed |

## 4. Test data & environments

- **Synthetic only** (`../phase6/05`); reproducible generators; labelled; no production data ever.
- Ephemeral per-PR environments with zone isolation so integration/invariant tests are realistic.

## 5. Chaos & resilience discipline

Chaos experiments run in **synthetic** environments with hypotheses tied to NFRs (availability, DR,
degrade-to-minimal-intake); results feed SRE (`08`) and the reference-implementation demos
(`../phase6/05` D5). **[REC]** The first chaos hypothesis to validate: *the safety-critical intake
stays available when downstream fails.*

## 6. Quality gate

- **Traces to:** `../phase3/04`, `../phase6/06`; RK-07/08/09/13; privacy/invariant threats.
- **Preserves:** privacy & governance tests as blockers; synthetic-only.
- **Threats mitigated:** validates I-2/ID-1 (privacy tests), I-6/E-3 (invariant tests), D-1/D-4
  (resilience/chaos).
- **Residual risks:** synthetic data misses some real edge cases (mitigated: pilot + hypercare);
  flaky tests erode trust (mitigated: flaky-rate metric).
- **Trade-offs:** ⚠️ privacy/invariant blockers slow releases — accepted; they guard the core promise.
- **Acceptance criteria:** all test types available as reusable frameworks; privacy + invariant tests
  100% pass to release; chaos validates intake availability; no prod data used.
- **🔒 Required review:** QA lead, privacy (privacy tests), ISRB (security/invariant), accessibility.

*Next: `07-observability-platform.md`.*
