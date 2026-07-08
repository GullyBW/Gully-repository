# Phase 6 · WS6 — Verification & Validation (V&V) Framework

**Traces:** RTM `../phase2/04`, Test Strategy `../phase3/04`, Traceability `../phase5/11`.
**Distinction:** *Verification* = "built right" (meets spec/architecture); *Validation* = "right
thing" (meets the need safely). Every requirement maps to decision → task → **automated test** →
**manual review** → acceptance → operational evidence.

---

## 1. V&V mapping (every requirement, both -fications)

| Requirement | Verification (built right) | Validation (right thing) |
|-------------|----------------------------|--------------------------|
| FR-001 no identity | CI: no C0 column; schema test | Privacy review confirms no identity path; red team can't recover identity |
| FR-003 metadata intake | Traffic test: 0 IP retained | Red team + privacy review; onion reachable |
| FR-008 chain of custody | Integrity/tamper tests | Forensic review of admissibility posture |
| SR-001 threshold | Unit/integration: blocked < M | Crypto review of threshold correctness |
| SR-005 zone isolation | CI invariant: 0 cross-zone paths | Architecture review confirms constitutional intent |
| FR-004 honest UX | Content lint; A11y tests | **UAT with real target users**; EC review (comprehension) |
| NFR-001/002 avail/DR | Perf + chaos + DR drill | ORR confirms operational fitness |

## 2. V&V methods

| Method | Used for |
|--------|----------|
| Automated tests (unit/contract/integration/system/privacy/governance) | Verification, continuous |
| Performance/chaos/DR drills | NFR verification |
| Manual expert reviews (ISRB, ARB, PRB, forensics 🔒) | Validation of 🔒 subsystems |
| UAT with real users (ethically, EC-supervised) | Validation of safety UX / accessibility |
| Independent red team / pen test / crypto review | Validation of anonymity guarantees |
| Operational evidence (metrics, audit) | In-life validation |

## 3. V&V gates aligned to systems-engineering reviews (`08`)

- **Verification evidence** accumulates from unit → system tests (feeds TRR/PRR).
- **Validation evidence** requires the human reviews + UAT + independent assurance (feeds ORR/PRR
  and the Production Evidence Package `../phase5/06`).
- **[REC]** A requirement is "V&V-complete" only when **both** columns (§1) are satisfied and
  recorded in the architecture repository (`01`).

## 4. Handling the un-verifiable-by-test guarantees (honesty)

Some guarantees (real-world anonymity vs a global adversary, coercion resistance, admissibility)
**cannot be fully verified by automated test**. For these, V&V relies on **independent expert
validation + honest residual-risk statements** (`../08 §2.8`) — the framework records them as
**validated-with-residual**, never as "passed." ⚠️

## 5. Quality gate

- **Traces to:** `../phase2/04`, `../phase3/04`, `../phase5/11`; all Critical requirements.
- **Preserves:** both verification and validation; nothing "passes" on tests alone where human
  judgment is required.
- **Residual risks:** un-testable guarantees rely on expert validation (mitigated: independent
  reviewers, honest labelling).
- **Trade-offs:** ⚠️ dual V&V + human validation is slower than tests-only — required for safety.
- **Acceptance criteria:** every requirement has verification + validation entries; 🔒 requirements
  have expert validation; safety guarantees carry explicit residual labels.
- **🔒 Required review:** ISRB/ARB/PRB/forensics per domain; EC (UAT ethics); independent assurance.

*Next: `07-engineering-work-packages.md`.*
