# Phase 6 · WS7 — Engineering Work Packages

**Extends:** `../phase2/11` (MVP epics/stories) into build-ready work packages with **test cases,
Definition of Done, and sprint sequencing**. Metadata per item: priority · deps · effort · owner ·
risk · architecture/DDR/threat refs · acceptance criteria · test cases · DoD. Synthetic data only.

---

## 1. Epic → sprint sequencing (MVP, indicative `⟦validate⟧`)

| Sprint | Focus | Key stories |
|--------|-------|-------------|
| S1 | Repo, CI/CD, IaC skeleton, invariant tests | EP1-S2, EP1-S13, dev harness (`05`) |
| S2 | IAM base + FIDO2 + ABAC + zero standing privilege | EP1-S1/S3/S4 |
| S3 | KMS/envelope + threshold custody 🔒 | EP1-S5/S6 |
| S4 | Audit (anchored) + monitoring/SIEM | EP1-S7 |
| S5 | Evidence + chain of custody 🔒 | EP1-S8 |
| S6 | Availability/DR foundation + field policy | EP1-S10/S11/S12 |
| S7 | No-identity intake + client E2E 🔒 | EP2-S1/S3 |
| S8 | Metadata-resistant intake 🔒 | EP2-S2 |
| S9 | Honest risk UX + offline draft | EP2-S4/S5 |
| S10 | Case code/follow-up + CoI routing + responsiveness | EP2-S6/S7, EP1-S9 |
| S11 | Hardening, V&V, demos D1–D6, readiness evidence | `05`,`06`,`../phase5/06` |

**[REC]** Security-foundation sprints (S1–S6) precede reporting sprints (S7–S10) — the spine before
the surface (D-05). 🔒 stories (S3,S5,S7,S8) require ISRB sign-off before merge.

## 2. Work-package template (example — EP2-S2 metadata-resistant intake 🔒)

```
Story EP2-S2 — Metadata-resistant intake endpoint
Priority: P0 | Effort: XL | Owner: Security eng + crypto 🔒 | Phase: P2
Deps: EP1-S5 (KMS), intake enclave infra
Arch/DDR: DDR-11 | Threats: I-2, ID-2, DT-1 | Risk: RK-02
Acceptance criteria:
  - Intake served via onion/enclave path; no IP logged anywhere (verified)
  - Client metadata (EXIF) stripped before transport
  - No third-party SDK on the intake path
  - Timing/size padding applied where feasible
Test cases:
  - T-FR003: inspect server+network logs → 0 IP records
  - Onion reachability test from a clean client
  - Static check: dependency allowlist for intake path (minimal TCB)
Definition of Done:
  - Acceptance + tests green on synthetic data
  - ISRB + cryptographer sign-off (CI HUMAN gate)
  - RTM row complete; runbook updated; no PII in telemetry
```

## 3. Definition of Done (global)

A story is Done when: acceptance criteria met; unit+contract+privacy+governance tests green; SAST/
secret-scan/SBOM clean; RTM links complete (`01`); docs/runbook updated; **🔒 stories carry ISRB
sign-off**; no production data used.

## 4. Test cases (sampled, mapped to V&V `06`)

| Test | Story | Type | Pass |
|------|-------|------|------|
| T-FR001 | EP2-S1 | privacy/CI | no identity column |
| T-FR003 | EP2-S2 | privacy/security | 0 IP retained |
| T-SR001 | EP1-S6 | governance/security | blocked < M custodians |
| T-SR005 | EP1-S2 | invariant/CI | 0 cross-zone DB paths |
| T-FR008 | EP1-S8 | forensic | tamper detected |
| T-FR004 | EP2-S4 | UAT/A11y | comprehension ≥ bar |

## 5. Quality gate

- **Traces to:** `../phase2/11`, RTM `../phase2/04`, `06`; D-05; RK-01/02/06/08.
- **Preserves:** MVP-first sequencing; 🔒 gate before merge.
- **Residual risks:** effort/sequence `⟦validate⟧`; 🔒 stories bottleneck on expert review (accepted).
- **Trade-offs:** ⚠️ spine-before-surface delays visible reporting features — de-risks safety.
- **Acceptance criteria:** every story has full metadata + test cases + DoD; sprint plan sequences
  security spine first; 🔒 stories flagged.
- **🔒 Required review:** ISRB (🔒 stories), TSC (sequencing), QA (test cases).

*Next: `08-systems-engineering-reviews.md`.*
