# NJTIP v1.0 — Product MVP (Vertical Slice)

The first **production-track implementation** of the National Justice Transparency & Integrity
Platform: a complete, runnable **anonymous-reporting → governance-decision vertical slice** that
exercises every major architectural subsystem, with the
[Digital Engineering Twin](../njtip-twin/README.md) as the permanent quality gate.

> **SYNTHETIC ONLY.** No production systems/data. **Zero runtime dependencies** (Node built-ins).
> Reuses the Twin's *validated* domain modules as the initial (reference) implementation; the
> [component transition matrix](./docs/component-transition-matrix.md) governs their replacement with
> production-grade implementations. **Evidence supports human decisions; it never replaces them.**

## Run it

```bash
cd njtip-app
npm test          # 10 end-to-end + API tests (node --test) — no install
npm start          # serve the MVP + UI at http://localhost:8087
npm run twin       # run the Digital Engineering Twin fitness gate (the quality gate)
```

## The vertical slice (Part 3)

```
Citizen → Anonymous Report → Policy Validation → Evidence Store → Audit Chain →
Investigator Review → Oversight Dashboard → Governance Decision → Evidence Generation → Twin Validation
```

| Step | Subsystem exercised | Endpoint |
|------|---------------------|----------|
| Anonymous report (no identity accepted) | Policy engine · Reporting store · CoI routing · Audit | `POST /api/reports` |
| Status by code only | Reporting projection | `GET /api/reports/{code}/status` |
| Secure evidence | Evidence store · Chain of custody · Audit | `POST /api/reports/{code}/evidence` |
| Investigator review | IAM (JIT + FIDO2 + matter-scoped) · Audit | `POST /api/investigator/{code}/review` |
| Oversight | Analytics (aggregate, non-attributable) | `GET /api/oversight/dashboard` |
| Governance decision (human-only) | Governance ledger (append-only, hash-chained) | `POST /api/governance/decisions` |
| Evidence generation | Deterministic digest + Ed25519 signature | `GET /api/evidence/bundle` |
| **Twin validation** | Architecture fitness gate | `GET /api/twin/validate` |

Contract: [`docs/api`](./docs/api/) · OpenAPI served at `GET /openapi.json`. UI prototype: `ui/index.html`.

## What's real vs synthetic

The workflow, policy default-deny, no-identity enforcement, conflict-of-interest routing, zero
standing privilege, chain of custody, append-only audit, and human-only governance recording are
**real, tested behaviour**. Cryptography/keys, auth tokens, storage, and identity are **synthetic
reference implementations** — see the [transition matrix](./docs/component-transition-matrix.md) for
how each becomes production-grade. The 🔒 anonymity/crypto/key-custody subsystems remain
human-expert-built and are never autonomously generated.

## Continuous assurance

Every change runs the app tests **and** the Twin fitness gate (`.github/workflows/njtip-app.yml`).
Architecture violations fail CI. See [`docs/`](./docs/) for the Architecture Baseline v1.0, ADRs,
engineering platform, deployment reference architectures, NFR validation, and review-readiness.
