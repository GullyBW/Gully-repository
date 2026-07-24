# NJTIP v1.3 — Operational Enterprise System

v1.3 evolves the production-capable platform into an **operational enterprise system**: real
enterprise *semantics* on every adapter, expanded operational workflows, privacy-preserving
intelligence, enterprise security, resilience validation, external integrations, and an
assurance gate that now spans **architecture + application + infrastructure**. The frozen
architecture is unchanged; the Digital Engineering Twin remains the permanent gate.

> **What is real vs. drop-in.** The enterprise *semantics* below are real, tested code
> (transactions, optimistic locking, pooling, DLQ/retry, versioning/lifecycle, revocation,
> cert lifecycle, circuit breakers, SLO/error-budgets, drift, DR round-trip). The vendor
> *network clients* (PostgreSQL, Redis, Kafka, S3/Azure/GCS, Vault, an OIDC IdP,
> OpenSearch, SIEM) are **documented drop-ins** implementing the same ports — this
> environment is offline/zero-dependency, so requesting an unbundled driver **fails
> closed**. 🔒 Cryptography/KMS/HSM and key/cert custody stay **human-built**. **Evidence ≠
> authorization; go-live is a recorded human decision.**

## Enterprise adapters (behind stable ports)

| Concern | Real semantics added (tested) | Vendor drop-in | Selector |
|---|---|---|---|
| Persistence | transactions (rollback), optimistic locking (CAS), connection pool (backpressure) | PostgreSQL | `NJTIP_PERSISTENCE=sql` |
| Cache | TTL, namespacing, atomic incr, distributed session store | Redis | `NJTIP_CACHE` |
| Messaging | retry + exponential backoff + **dead-letter queue** + replay | Kafka/RabbitMQ/NATS | `NJTIP_BROKER` |
| Object storage | **versioning** + **lifecycle** (retention/transition/expiry) + legal hold | S3/Azure/MinIO/GCS | `NJTIP_OBJECT_STORE` |
| Identity | token **revocation**, JWKS **key rotation**, SAML assertions, `acr`/MFA | OIDC/OAuth2 IdP | `NJTIP_OIDC_*` |
| Secrets | leases (TTL) + versioned **rotation**; metadata-only status | Vault / cloud KMS / HSM | `NJTIP_SECRETS` |
| Certificates | issue → renew-due → expired/revoked, rotation-due, CRL | ACME / internal CA | — |
| Search | inverted index, field-scoped + free-text (non-identifying only) | OpenSearch/ES/PG-FTS | `NJTIP_SEARCH` |
| Integrations | **circuit breaker** isolation, PII-free outbound | gov-IdP/DMS/SIEM/notify | — |
| Feature flags | deterministic sticky rollout, cohorts, kill-switch (identity-free) | LaunchDarkly/Unleash | — |

## Operational workflows (Phase 2)

Prioritisation (P1–P4: severity + escalation + ageing) · assignment + workload balancing
(prefers the CoI-cleared recipient agency) · SLA targets (first-review + resolution due /
breach) · multi-stage review chain · appeals (never mutate closed history) · retention plans
(legal hold overrides). Endpoints under `/api/investigator/*` and `/api/reports/{code}/*`.

## Intelligence (Phase 3, privacy-preserving)

Full-text search over non-identifying metadata · KPIs, day-bucketed trends, per-case
timelines · **k-anonymity small-cell suppression** · identity-free JSON/CSV export.

## Operational excellence (Phases 5 & 7)

Distributed tracing (W3C traceparent, redacted spans) · SLO/SLI with **error budgets** and
multi-severity alerts + correlation (`/api/admin/slo`, `/api/admin/traces`) ·
`npm run perf` load + **soak** (integrity holds) + **chaos** (broker DLQ→replay recovery;
transaction rollback) · `npm run health` engineering-health score + transparent trend.

## The Twin now validates infrastructure too (Phase 8)

`npm run twin` runs **14 twin + 15 app + 7 infra = 36 invariants**. Infra fitness checks k8s
hardening, default-deny NetworkPolicy, fail-closed deploy gate, config validation,
HA/scalability, **DR backup/restore round-trip**, and **infrastructure drift** against a
human-reviewed baseline (`npm run infra-baseline`).

## Independent assurance & controlled pilot (Phases 9 & 10)

`npm run evidence` — deterministic, Ed25519-signed package organised by **independent-review
domain** (architecture, cybersecurity, privacy, governance, legal, risk, operational
readiness, engineering quality), each mapped to concrete controls. `npm run readiness` —
**human-gated**; never authorizes. Pilot artifacts in [`../deploy/pilot/`](../deploy/pilot/)
and [`../deploy/k8s/canary.yaml`](../deploy/k8s/canary.yaml) stage exposure via canary +
feature flags — **approval remains a recorded human governance decision**.

## Commands

```bash
npm test            # 74 tests
npm run twin        # combined gate: 36 invariants (twin + app + infra)
npm run perf        # load + soak + chaos (resilience)
npm run evidence    # signed, reproducible assurance package
npm run readiness   # human-gated readiness (never authorizes)
npm run health      # engineering-health score + trend
```
