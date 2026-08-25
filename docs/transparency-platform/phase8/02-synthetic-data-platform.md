# Phase 8 · WS2 — Synthetic Data Platform

**Traces:** Data Architecture `../design/02`, Reference Impl `../phase6/05`, Justice Analytics
`../phase2/10`. **Purpose:** generate realistic-but-wholly-artificial datasets to exercise the twin,
with a hard guarantee that **no datum can be linked to a real person or institution.** For a
reporter-safety platform, even the *test data* must be safe.

---

## 1. Synthetic datasets produced

| Dataset | Represents | Fidelity for testing |
|---------|-----------|----------------------|
| Citizens/users | Reporters + officials (roles) | shape-realistic profiles, fully fictitious |
| Reports | Confidential submissions | varied categories, languages (Setswana/English), lengths |
| Investigations | Zone-O cases | workflow states, handoffs |
| Court workflows | Adjudication events | hearings, orders, seal states |
| Evidence | Files + custody | assorted types/sizes; tamper scenarios |
| Governance events | Decisions, CoI, threshold ops | approval flows |
| Audit logs | Actions across zones | append-only, chained |
| Operational telemetry | Metrics/traces (no PII) | load/latency profiles |

## 2. Generation principles (safety of the test data itself)

- **[FACT] Fully generative, no real seed:** data is synthesized from models/rules, **not** derived
  from, sampled from, or anonymized out of any real dataset — so there is nothing real to re-identify.
- **No real identifiers:** no real names, national IDs, addresses, case numbers, or institution
  records; fictitious value spaces only.
- **Re-identification-safe:** synthetic "citizens" are not modeled on real individuals; generation
  avoids rare-attribute combinations that could coincidentally match a real person.
- **Labelled + reproducible:** every dataset tagged `SYNTHETIC` with a seed for reproducibility;
  cannot be mistaken for operational data.
- **Realistic distributions:** language mix, connectivity/device variety (A-TEC-01/02), evidence
  types, and abuse/flood patterns (S-4/D-3) so tests are meaningful.

## 3. Coverage for adversarial + edge testing

Generators deliberately include: content that *would* self-identify (to test I-3/U-2 warnings),
malformed/oversized evidence (D-2), flooding/Sybil patterns (S-4), cross-zone-access attempts (I-6),
and duress/CoI scenarios — so `05` can exercise real failure modes on safe data.

## 4. Governance of synthetic data

- **[REC]** The synthetic data platform is itself governed: generators reviewed (no accidental real
  data), datasets versioned, and **CI blocks any real-data ingestion** into any environment
  (`../design/07 §3`). Privacy Review Board confirms the generation approach cannot leak real data.

## 5. Quality gate

- **Traces to:** `../design/02`, `../phase6/05`; SYNTHETIC DATA REQUIREMENT; ID-1, DD-1.
- **Preserves:** synthetic-only; no linkage to real people/institutions.
- **Threats mitigated:** eliminates test-data leakage risk (a real risk in naive "anonymized prod
  data" testing); enables I-3/S-4/I-6 testing safely.
- **Residual risks:** synthetic data may miss real-world oddities (mitigated: broad generators +
  pilot/hypercare); generator bugs (mitigated: review + CI).
- **Trade-offs:** ⚠️ fully-generative data is more effort than "anonymize prod" — required (anonymized
  prod data is not safe for this platform).
- **Acceptance criteria:** datasets are fully artificial (no real seed), labelled, reproducible,
  re-identification-safe (PRB-confirmed); CI blocks real-data ingestion; coverage includes adversarial
  edge cases.
- **🔒 Required review:** privacy engineer (re-identification safety), PRB, data-governance.

*Next: `03-architecture-as-code.md`.*
