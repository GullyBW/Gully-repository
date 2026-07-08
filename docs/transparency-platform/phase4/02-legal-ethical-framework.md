# Phase 4 · 02 — Legal & Ethical Framework

**Traces:** Assumptions `../01` (A-LEG-*, A-JUS-*), Threat `../08` (NC-*), Trust `../09`,
Operational Governance `../phase2/03`. **Basis:** approved architecture; **no Botswana legal facts
are invented — all are `⟦validate⟧` pending qualified local counsel.** 🔒 This entire document
requires admitted Botswana legal + judicial + constitutional review before implementation.

---

## 1. Purpose & honest disclaimer

This framework identifies the **legal and ethical dimensions** the platform must satisfy and maps
each to an architectural or governance control. It is **not legal advice** and does **not** assert
Botswana law; every legal proposition is a hypothesis for counsel to confirm, amend, or reject.

## 2. Constitutional considerations `⟦validate⟧` 🔒

| Consideration | How the architecture engages it | Control | Review |
|---------------|-------------------------------|---------|--------|
| Separation of powers | Three non-collapsible data zones; no arm reads another's raw data | D-06, Constitutional Architecture | Constitutional advisor |
| Judicial independence | Judiciary owns adjudication data/keys/admin; executive cannot access | A-JUS-03, DDR-04, `../design/04` | Judicial + constitutional |
| Rights (privacy, fair trial, expression) | Data minimization; due-process workflows; reporter safety | D-02, `../phase2/03` | Legal + human-rights |
| Lawful governance | Independent operator within law; compelled-access posture | D-01/D-02, NC-2 | Legal |

## 3. Judicial independence & due process

- **Independence:** adjudication data and workflows are judiciary-controlled; the platform provides
  tooling, never influence; AI is barred from any decision (D-09).
- **Due process:** transparent case state machines, rights/next-step information, appeals workflow
  (`../phase2/03 §2`), equality-of-arms in disclosure (prosecutor ↔ defender), no allegation
  treated as fact. 🔒 judicial-procedure validation.

## 4. Privacy principles

Data minimization by design (collect no reporter identity, D-02); purpose limitation; per-field
legal basis + retention (`../design/02`); DSAR/erasure designed so they cannot be weaponized to
probe for a reporter (NC-2); Data Protection Commissioner engagement (`03`). 🔒 privacy regulation.

## 5. Procedural fairness & ethical governance

- Fairness: independent reviewers for appeals (SoD); explainable, contestable decisions; no
  automated judgment.
- Ethical governance: Ethics Committee sign-off on AI, vulnerable-person handling, and research
  use; trauma-informed design for victims/witnesses; honesty-first communication (no false
  confidence, RK-07).

## 6. Whistleblower / reporter protection `⟦validate⟧` 🔒

- **Technical:** operator-in-threat-model; technical inability to de-anonymize (D-01/D-02);
  metadata-resistant intake; deniability for reporters (NR-1).
- **Legal (to validate):** reach of the Whistleblowing Act to anonymous, NGO-channel disclosures
  (A-LEG-02) — **a load-bearing open question**; if protection does not reach the channel, the
  value proposition and routing must be revisited (RK-10). 🔒 legal.
- **Operational:** de-anonymization incident runbook; retaliation-signal escalation (`../phase2/03 §4`).

## 7. Evidence integrity & admissibility `⟦validate⟧` 🔒

Digital Chain of Custody (hash, trusted timestamp, append-only ledger, external anchoring;
`../phase2/08`) is designed to support admissibility — **but admissibility is a legal determination**
under Botswana evidence law (A-LEG-05) and must be confirmed by courts/counsel + forensics.

## 8. Key legal tensions (named, for counsel)

1. **Anonymity vs. lawful compliance (NC-2):** the design makes the operator *unable* to
   de-anonymize; counsel must assess contempt/obstruction exposure vs a lawful "cannot comply
   because we do not hold it" posture. 🔒
2. **Transparency vs. sub judice / open-justice exceptions (A-JUS-04, A-LEG-06):** publication is
   aggregate-only and exception-aware, but each release needs legal sign-off. 🔒
3. **Cross-border data/key custody (A-LEG-08):** hybrid hosting + threshold shares across
   jurisdictions require transfer/adequacy analysis. 🔒
4. **Customary vs. formal law (A-JUS-06):** accommodating dikgotla without imposing formal models.

## 9. Areas explicitly requiring qualified Botswana legal review (checklist) 🔒

Constitutional separation-of-powers design · judicial-independence data boundaries · whistleblower-
statute reach · compelled-access/"technical inability" posture · evidence admissibility · retention
schedules · cross-border transfer & key custody · defamation/sub judice for any publication ·
lawful basis under the Data Protection Act · open-justice exceptions · customary-law interface.

## 10. Quality gate

- **Traces to:** A-LEG-*, A-JUS-*, NC-1/2/3, D-01/02/06/09; `../phase2/03/08`.
- **Threats mitigated:** NC-1/2/3 (compliance/anonymity/open-justice), supports I-1 posture.
- **Residual risks:** statutory interpretation may differ (RK-10); admissibility uncertainty;
  compelled-access legal exposure — all pending counsel.
- **Trade-offs:** ⚠️ resolving for anonymity accepts legal-exposure questions — named, not hidden.
- **Acceptance criteria:** counsel opinion obtained on every §9 item before go-live (feeds
  readiness G2); no legal item RED at gate.
- **🔒 Required review:** admitted Botswana attorney(s), judicial officer/constitutional advisor,
  human-rights advisor, Data Protection Commissioner liaison.

*Next: `03-compliance-mapping.md`.*
