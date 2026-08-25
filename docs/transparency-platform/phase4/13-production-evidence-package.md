# Phase 4 · 13 — Production Evidence Package (PEP)

**Consumes:** Readiness Gate `../phase2/05`, Readiness Scorecard `../phase3/07`, Go-Live Gate
`../phase3/08`, all reviews (`12`). **Purpose:** the single, versioned, auditable **evidence
structure** that the Oversight Board signs before production go-live, and that independent auditors
and funders can inspect. This is the artifact that turns "we designed it safely" into "here is the
proof."

---

## 1. Evidence structure (folders → artifacts)

| # | Evidence domain | Artifacts | Owner | Gate link |
|---|-----------------|-----------|-------|-----------|
| E1 | **Governance approvals** | Signed charters, RACI, appointment records, threshold-custodian enrolment, OB decisions | OB | ORG G1 |
| E2 | **Readiness assessments** | Operational Readiness Scorecard (all domains GREEN), independent-assessor validation | Readiness Assessor | ORG G6/G9, `../phase3/07` |
| E3 | **Legal reviews** 🔒 | Counsel opinions (whistleblower reach, compelled-access, cross-border, admissibility, separation of powers), DPA lawful-basis | Legal | ORG G2, `02` |
| E4 | **Privacy reviews** 🔒 | Approved DPIA, Commissioner engagement record, disclosure-control parameters, no-identity verification | PRB | ORG G3, `03` |
| E5 | **Security validation** 🔒 | Pen-test, red-team, crypto-review reports (no open Critical/High), vuln-mgmt status | ISRB | ORG G4, `../phase3/03` |
| E6 | **Testing evidence** | Test results across all levels incl. privacy & governance tests, UAT sign-off | QA | `../phase3/04` |
| E7 | **Compliance evidence** | Control-to-standard mapping + evidence artifacts (ISO/NIST/OWASP/DPA) | Compliance | `03` |
| E8 | **Operational readiness** | Runbooks, ESM/SLO instrumentation, IR game-day report, DR drill report, BCP exercises | OMT | ORG G6/G7/G8, `../phase3/06`, `11` |
| E9 | **Independent architecture review** 🔒 | External review confirming invariants/DDR conformance | ARB + external | ORG G5, `12` |
| E10 | **Institutional responsibilities** 🔒 | Signed MoUs, data-sharing agreements, RACI, funding confirmation | OB | ORG G10, `07` |
| E11 | **Production approval** | OB signed go-live decision (scope-limited), rollback plan, hypercare plan | OB | `../phase3/08` |

## 2. Evidence lifecycle: versioning, review, maintenance

- **Versioned & immutable:** each artifact is versioned; the PEP records the **exact version** of
  every artifact that supported a go-live decision (so an auditor can reconstruct what was true at
  sign-off). Anchored to the tamper-evident audit (DDR-13).
- **Reviewed:** each artifact has a named owner and an independent validator (no self-certification
  for Critical/🔒 domains, `../phase3/07 §4`).
- **Maintained:** the PEP is **living** — re-validated at each phase/wave go-live and after major
  change; stale evidence (past its currency window) flips its readiness criterion to AMBER/RED.
- **Traceable:** every PEP artifact links back to the requirement/threat/risk/DDR it evidences
  (RTM `../phase2/04`) — no orphan evidence.

## 3. Go-live evidence checklist (the OB sign-off pack)

```
[ ] E1 Governance approvals ....... GREEN, signed
[ ] E2 Readiness scorecard ......... GREEN (all Critical/🔒 domains), independently validated
[ ] E3 Legal reviews 🔒 ............ complete, no open item
[ ] E4 Privacy reviews 🔒 .......... DPIA approved, no-identity verified
[ ] E5 Security validation 🔒 ...... no open Critical/High; red team could not de-anon
[ ] E6 Testing evidence ............ all levels pass incl. privacy & governance
[ ] E7 Compliance evidence ......... controls evidenced
[ ] E8 Operational readiness ....... runbooks, IR + DR tested
[ ] E9 Independent arch review 🔒 .. invariants confirmed
[ ] E10 Institutional + funding 🔒 . MoUs + funding confirmed
[ ] E11 Production approval ........ OB signed, rollback + hypercare ready
=> GO-LIVE only if ALL GREEN and no Critical/🔒 item RED (no AMBER waiver for Critical)
```

## 4. Honesty statement embedded in the PEP

The PEP certifies **the platform's own controls**, not the elimination of all risk. It explicitly
records the **standing residual risks** (device compromise, content self-ID, coercion, global
passive adversary, successful-compulsion-if-mis-implemented, governance capture) so that decision-
makers approve with eyes open. Signing the PEP is **accepting named residuals**, not pretending
they are gone.

## 5. Quality gate

- **Traces to:** `../phase2/04/05`, `../phase3/07/08`, `02`–`12` of this phase; all Critical/High
  risks.
- **Threats mitigated:** premature/unaccountable go-live (governance backstop for RK-01/02/05/07).
- **Residual risks:** evidence can be assembled yet a residual still materialize post-launch —
  mitigated by hypercare + rollback + PIR (`../phase3/08`), not eliminated.
- **Trade-offs:** ⚠️ a rigorous evidence bar delays launch — accepted; it is the auditable proof that
  makes go-live defensible.
- **Acceptance criteria:** complete, versioned PEP with all Critical/🔒 domains GREEN and OB signed
  decision, before any production data flows.
- **🔒 Required review:** OB (sign-off), Legal/Privacy/ISRB/ARB (their domains), independent
  readiness assessor, funders (E10).

---

## Phase 4 complete — closing note

Phase 4 delivers the **strategic, legal, compliance, funding, benefits, enterprise-risk, DPI,
resilience, assurance, and evidence** documentation that the readiness and go-live gates consume.
Combined with Discovery, Design, Phase 2, and Phase 3, the NJTIP blueprint is now complete as an
**implementation-ready programme** — pending the human decisions it has always been explicit about:
qualified Botswana legal/judicial validation, genuine governance constitution, institutional MoUs,
independent funding, and the independent reviews whose GREEN results the Production Evidence Package
records. **No production code has been generated; approved architecture has not been redesigned.**

*The programme is prepared for engineering to proceed safely once the readiness gates are satisfied.*
