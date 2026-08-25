# Phase 6 · WS5 — Reference Implementation (Synthetic-Only)

**Traces:** all Design docs, Standards `04`, DevSecOps `09`. **Purpose:** a reference implementation
**to validate the architecture, not serve users** — synthetic data only. It demonstrates the
invariants (no-identity, zone isolation, chain of custody, fail-closed) end-to-end so the design is
provably buildable before any production commitment. **🔒 critical subsystems appear as
expert-built/reviewed modules, not autonomously generated code.**

---

## 1. Scope & non-goals

- **In scope:** local dev env, CI/CD, IaC for a synthetic multi-zone deployment, MVP contexts
  (Reporting, Evidence, IAM, Routing, Audit, Monitoring), synthetic datasets, demo workflows,
  invariant tests.
- **Non-goals:** production data, real integrations, real keys, real recipients, public exposure.
  **[FACT]** This is a validation harness, not a launch.

## 2. Local development environment

```
make dev         # spins up synthetic multi-zone stack (containers) with seeded synthetic data
make test        # unit + contract + privacy + governance/invariant tests
make demo        # runs demonstration workflows (below)
make verify      # V&V suite (06): requirement -> test mapping report
```
- Three isolated zone networks locally (Independent/Executive/Judiciary) to exercise no-cross-zone-DB
  (SR-005) even on a laptop.
- Synthetic KMS/HSM emulator with **synthetic keys**; threshold custody simulated with test
  custodians (real HSM + real M-of-N is 🔒 expert-provisioned, not in the dev harness).

## 3. CI/CD (reference)

Pipeline stages (from `../design/07`, `09`): lint → unit → SAST/secret-scan → SCA/SBOM/provenance →
policy-as-code → **invariant tests** (no cross-zone DB, no identity column, every column has
field_policy) → DAST → contract tests → **HUMAN gate for 🔒 paths** → deploy to synthetic staging.
Prod deploy stage is **disabled** in the reference implementation (no production target).

## 4. Infrastructure (IaC, synthetic)

- Per-zone modules (`../design/02`): isolated networks, separate stores, separate synthetic KMS.
- Event backbone + schema registry; observability stack; audit anchoring to a **synthetic** external
  log. All reproducible from IaC; immutable images.

## 5. Monitoring & security controls (demonstrated)

SLO metrics, SIEM rules, tamper-evident audit chain (synthetic anchor), privacy checks (no
PII/IP/identity in telemetry — asserted by tests). Demonstrates fail-closed on policy-engine outage.

## 6. Synthetic datasets

- **Generators** produce shape-realistic but wholly fictitious reports, cases, evidence, and users —
  **no real persons, no scraped data**. Reproducible seeds; clearly labelled synthetic.
- **[FACT]** No production or live justice-sector data touches any environment (SYNTHETIC DATA
  REQUIREMENT).

## 7. Demonstration workflows (validate the architecture)

| Demo | Validates |
|------|-----------|
| D1 Submit anonymous report → route (CoI) → recipient receipt | no-identity, DDR-11 intake, CoI routing, responsiveness (FR-001/003/007/009) |
| D2 Ingest evidence → tamper attempt → detected | chain of custody, integrity re-verify (FR-008, T-5) |
| D3 Cross-zone DB access attempt → blocked | Constitutional Architecture invariant (SR-005) |
| D4 Threshold op with < M custodians → blocked | operator-in-threat-model (SR-001) |
| D5 Policy-engine outage → requests fail-closed | fail-closed default |
| D6 Telemetry inspection → no PII/IP | privacy-by-design (T-FR003) |

## 8. What the reference implementation proves (and doesn't)

- **Proves:** the architecture is buildable and the invariants hold under test on synthetic data.
- **Does not prove:** real-world anonymity against a global adversary, admissibility, or that
  governance/legal/funding conditions are met — those need the human gates and independent review.
  ⚠️ HONESTY: a green demo is **not** a safe launch.

## 9. Quality gate

- **Traces to:** all Design docs; DDR-01/04/06/10/11; SR-001/005, FR-001/003/007/008/009.
- **Preserves:** invariants demonstrated, not just asserted; synthetic-only.
- **Residual risks:** reference ≠ production hardening; synthetic data misses real edge cases
  (mitigated: pilot + hypercare later).
- **Trade-offs:** ⚠️ building a validation harness is effort before "real" features — de-risks the
  architecture early.
- **Acceptance criteria:** demos D1–D6 pass in CI on synthetic data; invariant tests green; no PII
  anywhere; 🔒 modules present as reviewed stubs/specs, not autonomous code.
- **🔒 Required review:** ISRB (before any 🔒 module is really implemented), ARB (architecture
  conformance), SRE.

*Next: `06-verification-validation.md`.*
