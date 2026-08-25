# Phase 8 · WS3 — Architecture-as-Code (Executable Fitness Functions)

**Traces:** DDRs `../design/00`, Governance Automation `../phase7/03`, Architecture Repository
`../phase6/01`. **Purpose:** translate approved architecture decisions into **automated, continuously-
evaluated fitness functions** so the twin (and CI) proves conformance on every change and **blocks
violations**. Architecture stops being a document you can drift from and becomes a test you must pass.

---

## 1. DDR → fitness function mapping (representative)

| DDR | Approved decision | Fitness function (automated) | Blocks |
|-----|-------------------|------------------------------|--------|
| DDR-01/04 | Three-zone, no shared DB | Assert 0 cross-zone DB connections; per-zone credentials | cross-zone DB path |
| DDR-05 | Data minimization; no reporter identity | Assert no C0 identity column; every column has field_policy | identity column / policyless field |
| DDR-06 | Chain of custody | Assert append-only ledger; hash-chain verifies; anchor present | mutable custody / broken chain |
| DDR-07 | PII-free events | Registry rejects cross-zone event with identity/PII | PII in cross-zone event |
| DDR-09 | Zero standing privilege; ABAC; FIDO2 | Assert 0 standing sensitive grants; non-FIDO2 privileged auth rejected | standing grant / weak auth |
| DDR-10 | Threshold custody | Assert de-anon-capable op blocked < M custodians | single-party de-anon path |
| DDR-11 | Metadata-resistant intake | Assert no IP retained on intake; minimal-signal telemetry | IP logging on intake |
| DDR-13 | Tamper-evident anchored audit | Assert audit chain verifies + anchors | mutable/un-anchored audit |
| DDR-15 | Reproducible/provenance builds | Assert rebuild matches fingerprint; SBOM diff | provenance mismatch |

## 2. Continuous verification of trust boundaries & policies

Beyond per-DDR checks, architecture-as-code continuously verifies:
- **Trust boundaries** (`../design/09`): every cross-zone interaction is an audited API/event (no
  back channels).
- **Zero-Trust policies** (`../design/04`): default-deny; fail-closed on policy-engine outage.
- **Governance constraints** (`../phase2/01-03`): threshold/CoI/gate rules enforced.
- **Privacy requirements** (`../design/02`, `../phase2/10`): minimization + disclosure control.

## 3. Prevent-not-just-detect

**[FACT]** Fitness functions run in local dev (`../phase7/01`), in CI (`../phase7/03`), and
continuously in the twin — so a violating change is caught at authoring, blocked at merge, and would
be caught again in the running twin. **There is no path to production for a change that fails an
architecture fitness function.**

## 4. Fitness function catalogue as living artifact

Each fitness function: ID · DDR/threat/risk ref · assertion · pass/fail evidence · owner. Stored in
the architecture repository (`../phase6/01`); changing/removing one requires ARB approval (and, for
invariants, OB super-majority — `../phase2/02 §5`). New DDRs add new fitness functions.

## 5. Quality gate

- **Traces to:** all DDRs; `../phase7/03`, `../phase6/01`; I-6, ID-1, DD-1, E-1, T-1/T-2.
- **Preserves:** approved architecture — as continuously-enforced code.
- **Threats mitigated:** architecture drift; I-6/E-3/ID-1 by construction.
- **Residual risks:** a decision not yet encoded as a fitness function (mitigated: DDR→function rule);
  fitness-function bugs (mitigated: they are themselves tested).
- **Trade-offs:** ⚠️ every DDR needing an automated check is upfront effort — bought for drift-proof
  architecture.
- **Acceptance criteria:** every enforceable DDR has a green fitness function; violations block at
  dev/CI/twin; catalogue versioned; no unencoded invariant.
- **🔒 Required review:** ARB (fitness functions), ISRB (security invariants).

*Next: `04-continuous-verification-framework.md`.*
