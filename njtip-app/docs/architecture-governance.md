# Architecture Governance Process (post-baseline)

**Goal:** keep architecture stable and implementation-driven. Architecture changes are the
**exception**, justified by measured need, recorded as ADRs, and validated by the Twin.

## When an ADR is required
Any change to a **frozen baseline component** (`ARCHITECTURE-BASELINE-v1.0.md`), a public API/event
contract, a security/privacy control, or a cross-zone boundary. Implementation details *inside* a
component, UI, and feature composition do **not** require an ADR.

## Flow
```
Measured need (from implementation) → ADR (adr/000-template.md) → Twin stays green
→ ARB review → [constitutional-invariant? → OB super-majority] → Accepted → merge
```

## Guardrails (enforced in CI)
- **Twin fitness gate** must pass (`npm run twin`) — architecture violations fail CI.
- **API contract** must remain valid & versioned (`/v1`); breaking changes need a new major version.
- **Backward compatibility** preserved, or a documented deprecation path (dual-run + sunset).
- **Drift detection** (Twin `src/drift`) flags any change to the architecture-of-record not reflected
  in an ADR + the approved manifest.

## Decision rights (from blueprint phase2/01)
- **ARB:** architecture changes, DDR/ADR conformance (veto on invariant breach).
- **ISRB:** 🔒 security-critical subsystem changes (sign-off gate).
- **OB super-majority:** constitutional-invariant changes (zones, key custody, no-identity).
- Human accountability: legal/constitutional/judicial/governance decisions never automated.

## Cadence
ADRs reviewed at the ARB cadence; the Twin runs on every commit; drift + threat-model refresh per the
assurance calendar (blueprint phase3/03).
