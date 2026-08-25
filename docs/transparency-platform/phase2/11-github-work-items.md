# Phase 2 · 11 — GitHub Work Items (MVP)

**Implements:** the implementation-artifacts mandate · **Inputs:** RTM `04`, Roadmap `06`, Design.

> Implementation-ready backlog for the **MVP (Phase 0/1/2, D-05)**, structured as
> **Epics → Features → Stories → Tasks**. Every item carries the mandated metadata:
> `priority · dependencies · effort · owner · risk · architecture refs · DDR refs · threat refs ·
> success criteria`. Story IDs are the same referenced by the RTM (`04`), so the golden thread
> holds. Effort is **planning-grade** (S/M/L/XL ≈ 1/3/5/8+ dev-weeks) `⟦validate⟧`.
>
> **⚠️ Execution is gated:** these are planning artifacts. Building against **synthetic data** may
> start now; **production go-live is blocked by the Operational Readiness Gate (`05`).**
> 🔒 Stories on anonymity, crypto/threshold, chain-of-custody, metadata, and AI are marked
> `🔒 expert-review-before-merge` and cannot be autonomously built/auto-merged.

---

## EPIC EP0 — Governance & Readiness (Phase 0)
`Priority: P0 · Deps: funding (A-FIN-01), independent members (A-GOV-01) · Effort: XL · Owner: Programme Lead / Oversight Board`
`Risk: RK-03, RK-10, RK-15/17 · Arch: Phase2/01-03 · DDR: D-01,D-06 · Threats: E-1/E-3, RK-03`
**Success:** ORG (`05`) G1–G5, G9–G10 GREEN for MVP; RTM baselined.

| Feature | Stories (with owner/priority/effort) | DDR/Threat | Success criteria |
|---------|--------------------------------------|-----------|------------------|
| F0.1 Constitute governance bodies | S: charter + 8 bodies (Gov lead, P0, L); S: CoI registers (Gov, P0, M); S: threshold-custodian enrolment in HSM (Crypto 🔒, P0, M) | D-01 / E-1 | Bodies operational; M-of-N enrolled across ≥2 jurisdictions |
| F0.2 Legal & privacy readiness | S: legal opinions (Legal 🔒, P0, L); S: DPIA (Privacy 🔒, P0, L); S: Commissioner engagement (Privacy, P0, M) | NC-2/NC-1 | G2/G3 evidence produced |
| F0.3 Independent reviews | S: independent architecture review (ARB+ext 🔒, P0, M); S: pen-test + crypto review booked (ISRB 🔒, P0, M) | — | G4/G5 evidence produced |
| F0.4 Readiness Gate instrumentation | S: ORG checklist as policy-as-code (`02`) (DevSecOps, P0, M) | — | Pipeline blocks prod while any criterion ≠ GREEN |

## EPIC EP1 — Security Foundation (Phase 1)
`Priority: P0 · Deps: EP0 (custodians), HSM procurement 🔒 · Effort: XL · Owner: Security Architect`
`Risk: RK-06, RK-12, RK-18 · Arch: design/04, design/06, design/07 · DDR: DDR-04/09/10/13/15`
**Success:** SR-001..005, PR-001/002, NFR-001/002 acceptance tests pass; runs on synthetic data.

| Story | Detail | Prio/Effort/Owner | DDR | Threat | Risk | Success criteria |
|-------|--------|-------------------|-----|--------|------|------------------|
| **EP1-S1** IAM base | OIDC, sessions, service identity (mTLS) | P0/L/IAM eng | DDR-09 | S-3 | RK-06 | AuthN works; service mTLS enforced |
| **EP1-S2** Zone-isolation invariant CI | Test: 0 cross-zone DB connections; egress-gateway policy | P0/M/Platform 🔒 | DDR-01/04/07 | I-6, E-3 | RK-09 | CI fails on any cross-zone DB path |
| **EP1-S3** Phishing-resistant MFA | FIDO2/WebAuthn required for privileged scopes | P0/M/IAM | DDR-09 | S-3, S-5 | RK-06 | Non-FIDO2 rejected for privileged ops |
| **EP1-S4** Zero standing privilege | JIT grants, dual control, session recording | P0/L/IAM+SecOps | DDR-09 | E-1, E-3 | RK-06 | 0 standing sensitive grants in prod (audit) |
| **EP1-S5** KMS + envelope encryption | Per-zone HSM-backed KMS; envelope encrypt | P0/L/Crypto 🔒 | DDR-10 | I-1, I-4 | RK-01 | Data at rest enveloped; keys in HSM |
| **EP1-S6** Threshold (M-of-N) custody | De-anon-capable ops require M distinct custodians | P0/XL/Crypto 🔒 | DDR-10 | E-1, I-1 | RK-01/06 | Op impossible without M custodians (test) |
| **EP1-S7** Tamper-evident audit | Hash-chained append-only + external anchoring; SIEM | P0/L/Security | DDR-13 | T-2, R-2 | RK-06 | Chain verifies + anchors on schedule; SIEM alerts |
| **EP1-S8** Evidence + Chain of Custody | Hash, trusted timestamp, custody ledger (`08`) | P0/XL/Evidence+Forensics 🔒 | DDR-06 | T-1, T-2, T-5 | RK-08 | Custody reconstructable; tamper detectable |
| **EP1-S9** Responsiveness receipts | Signed delivery/receipt + non-attributable latency metric | P1/M/Backend | DDR-13/14 | R-1 | RK-04 | Receipt recorded; aggregate latency published |
| **EP1-S10** Availability + degrade | HA intake; degrade-to-minimal-intake | P0/L/SRE | DDR-02 | D-1, D-4 | RK-13 | Chaos test: intake survives downstream loss |
| **EP1-S11** DR foundation | Per-zone DR; ciphertext-only offshore; key≠ciphertext | P0/L/SRE 🔒 | DDR-02 | D-1 | RK-13 | DR drill meets RTO/RPO |
| **EP1-S12** Per-field data policy | field_policy for every column; retention + crypto-erase | P0/L/Data+Privacy 🔒 | DDR-05 | DD-1, ID-1 | RK-01/22 | Every column has policy (CI); erase verified |
| **EP1-S13** Secure supply chain | SLSA provenance, SBOM diff, reproducible build, signed release | P0/L/DevSecOps 🔒 | DDR-15 | T-3, S-1 | RK-12 | Independent rebuild matches fingerprint |

## EPIC EP2 — Confidential Reporting MVP (Phase 2)
`Priority: P0 · Deps: EP1, MVP recipient MoUs, safety-UX research · Effort: XL · Owner: Product + Reporting lead`
`Risk: RK-01/02/07/21 · Arch: design/01 §7, design/04, ../05 J1 · DDR: DDR-03/05/08/10/11`
**Success:** FR-001..009 pass; **ORG fully GREEN**; pilot launched.

| Story | Detail | Prio/Effort/Owner | DDR | Threat | Risk | Success criteria |
|-------|--------|-------------------|-----|--------|------|------------------|
| **EP2-S1** No-identity intake | Report model with **no C0 identity field**; capture-resistant | P0/M/Reporting 🔒 | DDR-05 | ID-1, I-1 | RK-01 | No identity field exists (schema+CI) |
| **EP2-S2** Metadata-resistant intake | Onion/enclave endpoint; no IP logs; padding; no 3P SDKs | P0/XL/Security 🔒 | DDR-11 | I-2, ID-2, DT-1 | RK-02 | Traffic inspection: 0 IP retention; onion reachable |
| **EP2-S3** Client-side E2E encryption | Encrypt content + strip EXIF on device before send | P0/L/Frontend+Crypto 🔒 | DDR-10 | T-1, I-4 | RK-01 | Server sees only ciphertext |
| **EP2-S4** Honest risk UX | Layered, Setswana/English, unskippable key points | P0/L/Safety-UX 🔒 | DDR-03 | U-1, U-2 | RK-07 | Comprehension test ≥ bar with target users |
| **EP2-S5** Offline drafting | Local encrypted draft; panic-wipe; low-bandwidth | P1/M/Frontend | DDR-03 | DT-1 | RK-21 | Works offline/2G; panic-wipe clears local |
| **EP2-S6** Case code + follow-up | High-entropy code; anonymous secure thread | P1/M/Reporting | DDR-09 | S-2 | RK-01 | Status by code, no identifier; capture-resistant |
| **EP2-S7** CoI-aware routing | Route to authorized recipient; block conflicted | P0/L/Governance+Backend | DDR-08 | T-4 | RK-06 | Conflicted recipient unassignable (test); routing signed |

## Cross-cutting labels & definition-of-ready/done

- **Labels:** `zone:independent|executive|judiciary`, `🔒critical`, `mvp`, `phase:0|1|2`,
  `risk:RK-##`, `ddr:DDR-##`, `threat:<id>`.
- **Definition of Ready:** has priority, owner, effort, deps, and **non-empty** DDR/threat/risk
  refs + acceptance criteria (RTM row exists, `04`).
- **Definition of Done:** acceptance tests pass; security/privacy checks green; 🔒 items have
  ISRB/expert sign-off; RTM metric instrumented; docs/runbook updated.

## Quality gate

- **Traces to:** RTM `04` (every story = an RTM row); D-05 scope.
- **Threats/risks:** each story maps to ≥1 threat + risk.
- **Residual risks:** effort estimates are planning-grade `⟦validate⟧`; MoU-dependent items (EP2-S7)
  carry RK-04.
- **Success criteria:** all MVP stories have complete metadata; 🔒 items flagged; execution
  gated by ORG (`05`).
- **🔒 Required review:** ISRB/expert sign-off on all 🔒 stories before merge; product/sponsor on
  scope; finance on effort/budget.

*Next: `12-implementation-artifacts.md`.*
