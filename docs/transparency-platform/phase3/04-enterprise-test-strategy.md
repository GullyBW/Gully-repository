# Phase 3 · WS4 — Enterprise Test Strategy

**Operationalizes:** Test plan `../phase2/12 §7`, RTM `../phase2/04`, DevSecOps `../design/07` ·
**Traces:** all MVP requirements (FR/NFR/SR/PR), acceptance tests, RK-07/08/09/13.

> Testing across ten levels with **entry/exit criteria** each, wired to the RTM so every
> requirement has an acceptance test and every test traces to a requirement. Two levels are
> unusual and first-class here: **privacy testing** (does the system leak/retain identity?) and
> **governance testing** (do the executable governance controls actually enforce?). All testing
> runs on **synthetic data** (never production sensitive data, `../design/07 §3`).

---

## 1. Test levels, entry & exit criteria

| Level | Purpose | Entry | Exit |
|-------|---------|-------|------|
| **Unit** | Component correctness | Code compiles; deps resolved | ≥ target coverage on critical paths; all pass |
| **Integration** | Service+event contracts | Units pass; schema registry green | Contract + event idempotency/ordering pass; no cross-zone raw path |
| **System (E2E)** | Whole-flow behavior | Integration passes; env seeded (synthetic) | Key journeys (`../05`) pass end-to-end |
| **Performance** | Latency/throughput/scale | System stable | Meets SLOs (intake availability, routing latency); degrades gracefully under load |
| **Accessibility** | WCAG, low-literacy, Setswana, offline | UI feature-complete | WCAG target met; comprehension test ≥ bar (RK-07); offline/2G works |
| **Security** | Controls hold | Build passes security CI | No High/Critical open (feeds `03`); ASVS/MASVS checks pass |
| **Privacy** | No identity leak/retention | System testable | **0 IP/identity retained** (T-FR003); no C0 field (T-FR001); disclosure control holds (no sub-k cell) |
| **Governance** | Executable controls enforce | Policy engine deployed | Threshold blocks < M (T-SR001); zone-isolation CI passes (T-SR005); unsigned policy cannot deploy; CoI recusal enforced |
| **Disaster recovery** | Restore + continuity | DR env ready | RTO/RPO met; key≠ciphertext verified; degrade-to-minimal-intake works |
| **User acceptance (UAT)** | Stakeholder fit | System + accessibility pass | Target-user + institutional sign-off; safety UX validated with real users (not staff) |

## 2. Traceability to requirements (sample — full set in RTM `../phase2/04`)

| Requirement | Level(s) | Acceptance test | Metric |
|-------------|----------|-----------------|--------|
| FR-001 no identity | Privacy, Governance | T-FR001 | identity cols = 0 |
| FR-003 metadata intake | Privacy, Security | T-FR003 | IP records = 0 |
| FR-004 honest risk UX | Accessibility, UAT | T-FR004 | comprehension ≥ bar |
| FR-008 chain of custody | Security, System | T-FR008 | tamper detected |
| SR-001 threshold | Governance, Security | T-SR001 | blocked < M |
| SR-005 zone isolation | Governance, Integration | T-SR005 | 0 cross-zone paths |
| NFR-001 availability | Performance, DR | chaos test | uptime SLO |

## 3. Test data & environments

- **Synthetic, shape-realistic data only** in dev/test/staging; **no production sensitive data
  in lower environments** (enforced, `../design/07 §3`).
- **Privacy/safety UX testing uses real target users** (with consent, ethically supervised — EC)
  because comprehension of risk (RK-07) cannot be validated on staff alone.
- Staging mirrors production topology incl. the three zones, for governance/DR/system tests.

## 4. Automation & gates

- Unit/integration/security/privacy/governance-invariant tests run in **CI** and **block merge**
  (`../design/07`); performance/DR/UAT run on schedule in staging.
- A failing **privacy or governance** test is treated as **release-blocking** (same weight as a
  security High) — these protect the crown-jewel guarantees.

## 5. Quality gate

- **Traces to:** RTM `../phase2/04` (every requirement ↔ test); D-02/D-06/D-09; RK-07/08/09/13.
- **Threats mitigated:** validates U-1/U-2 (UX), I-2/ID-1 (privacy), I-6/E-3 (governance/zone),
  T-1/T-2 (custody), D-1/D-4 (performance/DR).
- **Residual risks:** synthetic data may not reveal all real-world edge cases (mitigated: pilot +
  hypercare `08`); UAT coverage limits.
- **Dependencies:** synthetic data sets; DR env; EC-supervised user testing; policy engine live.
- **Trade-offs:** ⚠️ privacy/governance tests as release-blockers slow delivery — accepted.
- **Measurable outcomes:** every requirement has a passing acceptance test; privacy tests show 0
  identity retention; governance tests show controls enforce; DR meets RTO/RPO; UAT signed off.
- **🔒 Required review:** QA lead, privacy engineer (privacy tests), security (security tests), EC
  (user-testing ethics), accessibility expert.

*Next: `05-change-management.md`.*
