# API Contracts (Part 6)

Stable, versioned contracts that remain valid as implementations evolve. The machine-readable
**OpenAPI 3.1** spec is generated from code and served at `GET /openapi.json` (source: `src/openapi.js`).

## REST endpoints (v1)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/reports` | none (anonymous) | Submit report; **identity fields → 400** |
| GET | `/api/reports/{code}/status` | none | Status by case code only |
| POST | `/api/reports/{code}/evidence` | none | Attach evidence (custody) |
| POST | `/api/investigator/{code}/review` | Bearer (investigator) | JIT/FIDO2/matter-scoped review |
| GET | `/api/oversight/dashboard` | none | Non-attributable aggregates |
| POST | `/api/governance/decisions` | Bearer (oversight-board) | Record **human** decision (rationale required) |
| GET | `/api/evidence/bundle` | none | Deterministic signed evidence |
| GET | `/api/twin/validate` | none | Run the Twin fitness gate |

## Event contracts
Cross-context/zone communication uses **PII-free** CloudEvents-style events (schema registry enforces
no identity crosses a boundary). MVP-relevant events: `ReportSubmitted`, `ReportRouted`,
`EvidenceIngested`, `EvidenceAccessed`, `GovernanceDecisionRecorded`, `AuditRecordAppended`. Full
schemas: blueprint `docs/transparency-platform/phase6/03-executable-contracts.md`.

## Authentication & authorization
- **Anonymous** reporters: high-entropy case code, no identity, no credential to phish.
- **Privileged**: bearer token (v1.0 synthetic) → **OIDC + FIDO2** in v1.1 (transition matrix).
- **Authorization**: ABAC on `{principal, role, zone, matter, purpose}`; zero standing privilege; JIT
  grants; separation of duties. Governance actions require an accountable human + rationale.

## Validation & error handling
- Requests validated against the OpenAPI schemas (`additionalProperties:false` on inputs).
- Uniform errors `{ "error": "…" }`; `404` uniform (no enumeration oracle); `400` on identity fields;
  `401` on missing/insufficient auth; `403` on policy deny (fail-closed default).

## Versioning strategy
- SemVer; path-versioned under `/v1`. Additive changes = minor; breaking = new major (`/v2`), with
  dual-run + published sunset. Consumer-driven contract tests guard against accidental breakage.
- **Stability guarantee:** contracts stay stable while implementations (crypto, storage, IAM) are
  swapped per the transition matrix.
