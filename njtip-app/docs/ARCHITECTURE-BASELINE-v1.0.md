# Architecture Baseline v1.0 (FROZEN)

**Status:** BASELINED · **Date:** 2026-07-07 · **Change control:** ADR-only (see
`architecture-governance.md`). After this baseline, major components are **not** redesigned; changes
require a measured, implementation-driven need recorded as an ADR, with backward compatibility
preserved where practical, and must keep the Digital Engineering Twin green.

## Frozen components (the architecture-of-record)

The baseline is the approved blueprint (`docs/transparency-platform/`) as **realized** in the Twin's
`src/` domain modules and this MVP. Frozen elements:

| Component | Baseline decision | Invariant enforced by Twin |
|-----------|-------------------|----------------------------|
| Constitutional Architecture | 3 non-collapsible data zones (independent/executive/judiciary); no shared DB | `FIT-ZONE-ISOLATION`, `FIT-SECURE-DATA-FLOWS` |
| Identity minimization | No reporter identity collected/stored (rejected at write) | `FIT-IDENTITY-MINIMIZATION` |
| Operator-in-threat-model | M-of-N threshold custody; no single-party de-anon | `FIT-GOVERNANCE` |
| Zero Trust / least privilege | Default-deny, zero standing privilege, JIT + FIDO2, SoD | `FIT-ZERO-TRUST`, `FIT-LEAST-PRIVILEGE`, `FIT-POLICY-ENFORCEMENT` |
| Evidence integrity | Envelope encryption; hash-chained chain of custody | `FIT-ENCRYPTION`, `FIT-CHAIN-OF-CUSTODY` |
| Auditability | Append-only, hash-chained, anchored audit | `FIT-AUDITABILITY` |
| Event-driven, PII-free flows | Cross-zone only via audited, PII-free events | `FIT-SECURE-DATA-FLOWS` |
| Emergency / backup / time | Dual-control break-glass; ciphertext-only backups; trusted time | `FIT-EMERGENCY`, `FIT-BACKUP`, `FIT-TIME-INTEGRITY` |
| Governance-by-design | Human decisions recorded (append-only ledger); never automated | Governance portal + maturity cap L6 |
| API-first | Stable, versioned REST + event contracts (`/v1`) | OpenAPI in `docs/api` |

## Baseline principles (unchanged from blueprint)

Privacy & security by design · Zero Trust · least privilege · defense in depth · data minimization ·
separation of powers · human accountability for authoritative decisions · deterministic,
reproducible evidence · synthetic-data-only until readiness gates pass.

## What is NOT frozen

Implementation details **inside** a component (algorithms, storage engines, adapters), UI, new
features that compose existing subsystems, and the roadmap. These evolve freely provided the Twin
invariants hold and API contracts remain stable.

## Change-control summary

1. Propose change → ADR (template in `adr/000-template.md`). 2. Twin must stay green. 3. Backward
compatibility preserved or a deprecation path documented. 4. Architecture Review Board approves;
constitutional-invariant changes require Oversight Board super-majority (per blueprint `phase2/02`).
