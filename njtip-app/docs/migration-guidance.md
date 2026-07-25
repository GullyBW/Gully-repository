# Migration Guidance for Future Production Implementations

This is the engineer's guide for taking NJTIP's **synthetic, zero-dependency reference
implementation** into a real production deployment **without touching business logic**. The
architecture is frozen and everything sits behind stable ports, so migration is driver
substitution + human-built cryptography + operational provisioning — never a rewrite.

> **The rule:** a production driver implements the same port contract as its reference driver,
> keeps the port's invariants, passes the port's tests + the Twin gate, and is selected only at
> the composition root (`src/app.js`). If those hold, the domain cannot tell the difference.

## 1. Swap reference adapters for production drivers

Follow [`production-adapters.md`](./production-adapters.md). Each port lists its reference
driver and its documented production drop-in; the composition root selects by `config.js`/env.
A non-bundled production driver **fails closed** until implemented — it never silently degrades.

| Port | Production driver | Notes |
|---|---|---|
| Persistence | PostgreSQL (`db/migrations/*.sql`) | per-zone schemas/roles; async `PgDriver` awaits in `SqlStore` only |
| Cache / sessions | Redis | same `get/set/ttl/incr` contract |
| Messaging / event bus | Kafka · RabbitMQ · NATS | same `publish/subscribe/drain`; keep the PII-free rule |
| Object storage | S3 · Azure · MinIO · GCS | per-zone buckets; SSE-KMS; keep ciphertext-only |
| Identity | OIDC/OAuth2 IdP (JWKS, FIDO2) + SAML | same `verify(token)→{principal,role}` |
| Secrets | Vault · cloud KMS · HSM | same lease/rotate contract |
| Search | OpenSearch · ES · Postgres FTS | keep the identity-free index allow-list |

## 2. 🔒 Human-built cryptography (never machine-generated)

The KMS/HSM key manager, Ed25519/PQ signing identities, certificate/CA material, per-tenant
keys, and quantum-migration key material are **human-expert-built and ISRB-signed**. The
reference uses synthetic keys, clearly labelled; production wires real HSM/KMS behind the same
`encrypt/decrypt/isCiphertext` and signing ports. `NJTIP_KMS=kms` fails closed precisely so a
synthetic key is never mistaken for a real one.

## 3. Provision infrastructure + honor the gates

- Apply the reference manifests in [`../deploy/k8s/`](../deploy/k8s/) and the pilot artifacts in
  [`../deploy/pilot/`](../deploy/pilot/); review every placeholder value.
- Record the human-reviewed infra baseline (`npm run infra-baseline`) so `INFRA-FIT-DRIFT`
  guards it, and set the sovereign residency policy (Phase 52).
- The container refuses to start unless the whole gate passes (twin + app + infra), the default
  workflow is **formally proven**, and the access-control policy set is **validated** — keep
  these fail-closed startup gates.
- No deployment may bypass **supply-chain governance** (Phase 65): register real suppliers +
  trusted components; `validateForDeployment(sbom)` must pass.

## 4. What migration must NOT change

- Deterministic execution, fail-closed behavior, and complete auditability.
- Privacy boundaries: no reporter identity stored; PII-free events/traces/search/graph;
  small-cell suppression; identity refused across every new registry.
- Human accountability: governance/AI/recovery/crisis/marketplace/legislation decisions stay
  human-approved. **No pipeline, evidence package, readiness score, maturity grade, command
  center, or strategic projection authorizes deployment** — go-live is always a recorded human
  governance decision.

## 5. Verify after every substitution

Run `npm test`, `npm run twin`, `npm run evidence` (must verify), `npm run readiness` (must stay
human-gated), and `npm run devsecops` (must be clean). Add a port-contract test mirroring the
reference tests for each new driver, and keep the Twin green.
