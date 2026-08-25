# Production Transition Status (Phase 1)

How each subsystem has progressed from **synthetic MVP** → **production-shaped** (real interface +
production-grade behaviour, still synthetic identities/data) → **production** (real external systems,
🔒 human-expert-built for crypto/anonymity). The **interface (port) is stable across all three**, so
business logic and the Twin invariants are untouched.

| Subsystem | v1.0 (synthetic) | v1.1 (production-shaped — this release) | Production target | Interface (port) |
|-----------|------------------|----------------------------------------|-------------------|------------------|
| **Persistence** | in-memory maps | **zone-isolated, durable file store (atomic writes, per-collection namespaces)** | PostgreSQL per zone | `adapters/store` (get/put/values/keys) |
| **Authentication / sessions** | static token map | **HMAC-signed, expiring, revocable session tokens + constant-time verify** (legacy tokens still accepted) | OIDC + FIDO2 at gateway | `adapters/session` (issue/verify/revoke) |
| **Config / secrets** | inline constants | **12-factor config with validation + secret redaction** | secrets manager (Vault/KMS) | `config` (load/redacted) |
| **Observability** | none | **structured PII-redacting JSON logs, metrics (Prom), health/readiness, trace IDs** | ship to SIEM/Prometheus/OTel | `adapters/observability` |
| **Error handling** | ad hoc | **centralized problem responses + traceId; fail-closed** | unchanged | server middleware |
| **Notifications** | none | **privacy-aware, poll-by-case-code, non-identifying** | durable transport | `adapters/notifications` |
| **Composition** | direct construction | **clean-architecture composition root selects adapters** | unchanged | `app.createApp` |
| **Cryptography / KMS** 🔒 | synthetic envelope | synthetic (unchanged — **not** auto-built) | HSM/KMS + M-of-N threshold | Twin `platform/crypto` |
| **Reporting store (no identity)** | in-memory | in-memory (Twin module) | persistent, zone-isolated | Twin `model/report-store` |
| **Event bus / audit / evidence** | in-memory (Twin) | in-memory (Twin) | durable broker + anchored log + TSA | Twin modules |

## What changed in v1.1 (this release)
Clean-architecture refactor (ports & adapters), zone-isolated durable persistence, secure session
management, config/secrets management, full structured observability, centralized error handling,
notifications, an administration portal, and search/reporting — **all behind stable interfaces, all
Twin-green, all tested (20 tests).**

## What deliberately did NOT change
The frozen architecture, every invariant the Twin verifies, and the 🔒 anonymity/crypto/key-custody
core (human-expert-built, never autonomously generated). Production identities, real databases, HSM,
and OIDC/FIDO2 are the next increments — each a drop-in behind the existing ports, sequenced in the
[component transition matrix](./component-transition-matrix.md).

## Verification
`cd njtip-app && npm test` (20 pass) · `npm run twin` (14/14 invariants) · `npm start` then
`GET /api/twin/validate` (invariants held from the running product). Evidence remains deterministic
and independently verifiable via the Twin.
