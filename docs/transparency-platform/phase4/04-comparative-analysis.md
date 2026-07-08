# Phase 4 · 04 — Comparative Analysis

**Traces:** Threat `../08`, Design `../design/*`, Interoperability `../phase2/07`. **Basis:**
publicly documented systems [VERIFIED as public projects]. Focus is **transferable principles**,
not replication; NJTIP adaptations are noted.

---

## 1. Systems compared

| System | Category | Relevance |
|--------|----------|-----------|
| **SecureDrop** | Whistleblower submission (Tor-based) | Metadata-resistant anonymous intake |
| **GlobaLeaks** | Whistleblowing framework | Configurable intake + case workflow, multi-tenant |
| **Signal protocol** | E2E messaging | Deniability, forward secrecy for secure messaging |
| **Tor / onion services** | Anonymity network | Transport-layer metadata resistance |
| **Estonia X-Road** | Gov data-exchange bus | Standards-based interoperability without central pooling |
| **Certificate/Key Transparency** | Tamper-evident logs | External anchoring / verifiable append-only logs |
| **Aletheia/press SecureDrop deployments; ICIJ workflows** | Investigative collaboration | Handling sensitive material at scale |

## 2. Analysis

### SecureDrop
- **Strengths:** strong metadata resistance (Tor), minimal data retention, reproducible builds,
  hardened isolation, threat-model honesty.
- **Limitations:** operationally heavy (air-gaps, physical procedures); journalist-newsroom model,
  not a national multi-institution platform; usability friction.
- **Lessons:** metadata resistance + tiny TCB + reproducible builds + honesty are the core of
  reporter safety.
- **NJTIP adaptation:** adopt metadata-resistant intake (DDR-11), reproducible builds (DDR-15),
  tiny anonymity-critical TCB; but wrap in a broader, governed, multi-zone platform.

### GlobaLeaks
- **Strengths:** configurable intake + case management; multi-tenant; established in anti-corruption
  deployments; PGP/notifications.
- **Limitations:** central operator trust in default deployments; anonymity depends on config +
  Tor; not built around operator-in-threat-model threshold custody.
- **Lessons:** flexible intake/case workflow is valuable; **operator trust must be engineered down**,
  not assumed.
- **NJTIP adaptation:** take the intake/case-workflow ideas; **add threshold custody + three-zone
  isolation** so the operator cannot de-anonymize (D-01/D-02).

### Signal protocol
- **Strengths:** strong E2E, forward secrecy, deniability.
- **Limitations:** identity-based (phone numbers) in its consumer form — wrong for anonymous
  reporters.
- **Lessons:** deniability + forward secrecy for the secure-messaging component.
- **NJTIP adaptation:** apply the cryptographic *properties* to reporter follow-up threads **without**
  any identity anchor (NR-1).

### Tor / onion services
- **Strengths:** proven metadata resistance; pluggable transports for censorship resilience.
- **Limitations:** usability; blockable; not proof against a global passive adversary.
- **Lessons/adaptation:** onion/enclave intake (DDR-11) with **honest** user guidance about limits
  (U-1); pluggable transports for A-TEC-04.

### Estonia X-Road (DPI interoperability)
- **Strengths:** standards-based, decentralized data exchange; **each institution owns its data**;
  audited, no central pool — strikingly aligned with our Constitutional Architecture.
- **Limitations:** it is an exchange layer, not a safety/anonymity system; governance context
  differs.
- **Lessons:** **owner-controlled, audited, standards-based exchange without central pooling** is a
  proven national pattern.
- **NJTIP adaptation:** our Integration Architecture (`../design/03`) + Interoperability Framework
  (`../phase2/07`) follow this pattern within the three-zone model (D-06/D-07).

### Certificate/Key Transparency (tamper-evident logs)
- **Strengths:** publicly verifiable append-only logs; external anchoring.
- **Lessons/adaptation:** our anchored audit + custody ledger (DDR-13/DDR-06) apply the same
  verifiable-log principle to accountability and evidence.

### ICIJ-style investigative workflows
- **Strengths:** secure handling/collaboration on very sensitive material at scale.
- **Lessons/adaptation:** informs the investigator workspace + evidence handling, with least
  privilege + audit (Zone O).

## 3. Cross-cutting transferable principles

1. **Metadata is the real threat** — SecureDrop/Tor lesson → DDR-11.
2. **Engineer down operator trust** — GlobaLeaks gap → threshold custody + zones (D-01/D-06).
3. **Owner-controlled, audited exchange, no central pool** — X-Road → Integration (D-06/D-07).
4. **Verifiable append-only logs** — CT/KT → audit + custody (DDR-06/13).
5. **Honesty about limits** — every serious system states residual risk → U-1 as a safety control.

## 4. What NJTIP adds beyond these

A **unified national justice platform** combining: safety-first anonymous reporting **and**
constitutional multi-zone integration **and** governed transparency **and** executable governance —
none of the compared systems spans all four; NJTIP's contribution is the **synthesis under
separation of powers + operator-in-threat-model**.

## 5. Quality gate

- **Traces to:** DDR-06/11/13/15, D-01/06/07; `../design/03`, `../phase2/07`.
- **Residual risks:** comparisons are to public designs; local context differs; principles transfer,
  specifics need validation.
- **Trade-offs:** ⚠️ synthesizing patterns adds complexity vs adopting one tool — justified by the
  national, multi-mode scope no single tool covers.
- **Acceptance criteria:** each adopted principle traces to a DDR/architecture element already in the
  blueprint (it does).
- **🔒 Required review:** security architect, privacy engineer (anonymity claims), integration
  architect (X-Road pattern applicability).

*Next: `05-botswana-adaptation-strategy.md`.*
