# Phase 5 · WS6 — Readiness Evidence Catalogue

**Extends:** the Production Evidence Package `../phase4/13` into the **complete catalogue for
executive approval**, adding procurement/funding/judicial evidence and the **versioning/revalidation
schedule** for every item. This is the master index of proof the Oversight Board and independent
auditors inspect before any go-live.

---

## 1. Evidence catalogue (every item: owner · version · review status · revalidation · traceability)

| # | Evidence item | Owner | Review status | Revalidation | Traces to | 🔒 |
|---|---------------|-------|---------------|--------------|-----------|----|
| EV-01 | Governance approvals (charters, RACI, appointments, threshold enrolment) | OB | signed | on membership change | D-01; `../phase3/01` | 🔒 |
| EV-02 | **Legal validation** (whistleblower reach, compelled-access, DPA basis, cross-border) | Legal | opinion | on law change | A-LEG-*; `../phase4/02` | 🔒 |
| EV-03 | **Judicial review** (separation-of-powers, open-justice exceptions, procedure) | Judiciary advisor | opinion | annual | A-JUS-03/04; `../phase4/02` | 🔒 |
| EV-04 | Privacy review (DPIA, Commissioner engagement, no-identity verification) | PRB | approved | annual | D-02; `../phase4/03` | 🔒 |
| EV-05 | Security validation (pen test, red team, crypto review, vuln status) | ISRB | report | annual + pre-go-live | `../phase3/03` | 🔒 |
| EV-06 | Architecture review (invariants, DDR conformance) | ARB+external | report | on major change | DDR-01..15; `../phase4/12` | 🔒 |
| EV-07 | Testing evidence (all levels incl. privacy & governance; UAT) | QA | results | per release | `../phase3/04` | — |
| EV-08 | Compliance evidence (DPA/ISO/NIST/OWASP/SOC 2 controls) | Compliance | mapped | annual | `../phase4/03` | 🔒(DPA) |
| EV-09 | **Procurement approvals** (CoI-controlled, transparent) | OB | approved | per procurement | `../phase4/07` | 🔒 |
| EV-10 | **Funding approvals** (independence-preserving, Phases 0–2) | OB+Finance | committed | annual | A-FIN-01; `../phase4/07` | 🔒 |
| EV-11 | Operational readiness (runbooks, IR game-day, DR/BCP drills, ESM/SLOs) | OMT | tested | semi-annual | `../phase3/06/07` | — |
| EV-12 | Production readiness (OB go-live decision, rollback + hypercare plans) | OB | signed | per go-live | `../phase3/08` | 🔒 |

## 2. Evidence lifecycle rules

- **Versioned & immutable**, anchored to the tamper-evident audit (DDR-13); the go-live record cites
  the exact version of each item.
- **Revalidation schedule** (column above): an item past its revalidation window flips its readiness
  criterion to **AMBER/RED** automatically — **stale evidence does not count as GREEN.**
- **Independent validation** for Critical/🔒 items (no self-certification, `../phase3/07 §4`).
- **Traceable** to requirements/DDRs/risks (RTM `../phase2/04`); **no orphan evidence** and **no
  requirement without evidence** at go-live.

## 3. Executive approval pack (derived from the catalogue)

The OB go-live pack = the EV-01..12 checklist (all Critical/🔒 GREEN, none RED, no AMBER-waiver for
Critical) + the risk position (`../phase4/09`) + the honest residual-risk statement
(`../phase4/13 §4`). **[FACT]** Signing accepts named residuals; it does not certify their absence.

## 4. Quality gate

- **Traces to:** `../phase4/13`, `../phase3/07/08`, `../phase2/04`; all Critical/High risks.
- **Preserves:** gate discipline; adds procurement/funding/judicial evidence explicitly.
- **Residual risks:** evidence completeness depends on the human reviews landing (RK-10, funding,
  MoUs) — the catalogue makes gaps visible, it cannot fill them.
- **Trade-offs:** ⚠️ revalidation windows create ongoing effort — accepted; stale assurance is
  false assurance.
- **Acceptance criteria:** complete, versioned catalogue; every item owned + revalidation-scheduled;
  all Critical/🔒 GREEN before go-live.
- **🔒 Required review:** OB, legal, judicial, privacy, ISRB, procurement, finance.

*Next: `07-executive-decision-support.md`.*
