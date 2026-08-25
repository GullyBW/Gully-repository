# ADR-0001: Freeze Architecture Baseline v1.0, select the MVP, reuse Twin components

- **Status:** Accepted · **Date:** 2026-07-07 · **Deciders:** Principal Architect, Product Lead, ARB

## Context
Architecture reached diminishing returns (blueprint Discovery→Phase 8; assurance platform v0.2). The
project must transition to product-centric engineering: build, validate continuously with the Twin,
and let implementation drive future refinement.

## Decision
1. **Freeze Architecture Baseline v1.0** (`ARCHITECTURE-BASELINE-v1.0.md`); post-baseline changes are
   ADR-only and must keep the Twin green.
2. **MVP = the anonymous-reporting → governance-decision vertical slice** — selected because it gives
   the **greatest architectural coverage at the lowest complexity** (see `MVP.md` §selection): it
   exercises policy, reporting, CoI routing, evidence + chain of custody, audit, IAM (JIT/FIDO2/SoD),
   analytics, and the governance ledger — every major subsystem — in one thin end-to-end path.
3. **Reuse the Twin's validated domain modules** as the MVP's initial (reference) implementation;
   replace with production-grade implementations incrementally per `component-transition-matrix.md`.
4. **Zero runtime dependencies** (Node built-ins) for determinism, offline operation, and a minimal
   trusted-computing base on the anonymity-critical path.

## Consequences
- **Backward compatibility:** APIs versioned under `/v1`; contracts stable as implementations evolve.
- **Twin impact:** none negative — the MVP composes existing verified components; `GET /api/twin/validate`
  runs the fitness gate from the running product; CI blocks on any violation.
- **Threats/risks:** preserves mitigations for ID-1, I-6, E-1/E-3, T-1/T-2 (all Twin-verified).
- **Trade-offs:** reusing synthetic components delays production hardening — accepted; it is
  incremental and transition-governed. ⚠️ Cost named: MVP is not production-ready until the transition
  matrix items are complete and the readiness gates pass.

## Alternatives considered
- MVP = evidence submission only (rejected: narrower coverage). MVP = case-lifecycle across courts
  (rejected: high inter-institution dependency; needs MoUs). MVP = oversight dashboard only (rejected:
  no intake path). Greenfield production components now (rejected: speculative; contradicts
  implementation-driven refinement).

## Human review
Production go-live, legal/constitutional/judicial validation, procurement, and funding remain human
decisions. The MVP records governance decisions; it never automates them.
