# Component Migration Roadmap (Stabilization Part 4)

Which subsystems are still **synthetic reference implementations**, what each must become in
production, and how it gets there — held as data in `src/migration/roadmap.js` so it can be verified
rather than left to drift. `APP-FIT-MIGRATION-ROADMAP` fails the build if an item lacks a rollback
strategy, names no risk, cites a fitness function that does not exist, or is marked `production`
ahead of something it depends on.

Live: `GET /api/migration/roadmap` (includes per-item readiness computed from the live fitness gate).

> Migration is **incremental**. Every step keeps deterministic testing and continuous assurance
> intact, and **readiness never authorizes a cutover** — that is a recorded decision by the approving
> authority named in the [ownership model](./governance-ownership.md).

## Waves

Sequenced so a dependency is never migrated after its dependent: **security spine → state and
transport → governance surfaces → insight and operations**.

| Wave | Theme | Items |
|---|---|---|
| 1 | Security spine | Identity · Cryptography 🔒 · Secrets · Certificates |
| 2 | State & transport | Storage · Evidence object storage · Messaging · Cache · Audit |
| 3 | Governance surfaces | Policy Engine · Governance Portal · Data Exchange |
| 4 | Insight & operations | Process Mining · Performance Observatory · Search · Notifications · Infrastructure |

Computed order: `identity → cryptography → secrets → certificates → storage → objectstore →
messaging → cache → audit → policyengine → governanceportal → dataexchange → processmining →
observatory → search → notifications → infrastructure`.

## Items

| Subsystem | Wave | Context | Current (synthetic) | Production target | Depends on |
|---|---|---|---|---|---|
| **Identity** | 1 | identity-access | HMAC sessions + offline HS256 verifier; role-coded principals, no reporter identity | Federated OIDC/OAuth2 with JWKS rotation, FIDO2 step-up, SAML for legacy agencies | — |
| **Cryptography** 🔒 | 1 | crypto-agility | Synthetic envelope encryption + Ed25519 with labelled synthetic keys | HSM/KMS envelope encryption, M-of-N custody, **human-built** signing identities | — |
| **Secrets management** | 1 | identity-access | Environment-sourced manager with redaction | Vault / cloud KMS-secrets with leasing, rotation, audit | cryptography |
| **Certificate lifecycle** | 1 | crypto-agility | Reference manager with rotation due-dates + health check | CA/ACME issuance, automated renewal, revocation checking | cryptography |
| **Storage** | 2 | persistence | Memory / File / SqlStore over MemorySqlDriver | PostgreSQL, per-zone schemas and roles, backups, PITR | cryptography |
| **Evidence object storage** | 2 | persistence | In-memory, ciphertext-only (plaintext refused) | S3 / MinIO / GCS, per-zone buckets, SSE-KMS, object lock | cryptography, storage |
| **Messaging / event bus** | 2 | platform-events | In-memory PII-free outbox with ordering, replay, DLQ | Kafka / RabbitMQ / NATS, durable partitions, consumer groups | storage |
| **Cache & sessions** | 2 | persistence | In-memory get/set/ttl/incr | Redis with TTL eviction and replication | storage |
| **Audit** | 2 | assurance | In-memory hash-chained log + synthetic anchor | Durable append-only store, digests anchored to an external transparency log | storage, cryptography |
| **Policy Engine** | 3 | policy-governance | In-process policy-as-data, default-deny, validated activation | Externalized policy (OPA/Rego) at gateway and runtime, policy-as-code pipeline | identity |
| **Governance Portal** | 3 | governance-oversight | Append-only ledger + API + prototype UI, human-only | Persistent ledger, reviewer workspace, threshold-signed decisions | storage, identity, cryptography |
| **Data Exchange** | 3 | data-exchange | In-memory registry, privacy validation, human approval | Persistent federated registry, purpose-limited access, retention enforcement | storage, identity |
| **Process Mining** | 4 | orchestration | Deterministic mining over the in-memory log | Incremental mining over the durable store at national volume | audit, messaging |
| **Performance Observatory** | 4 | observability | Deterministic KPIs, suppression, seeded forecasts | Real telemetry pipeline feeding audience dashboards | messaging |
| **Search** | 4 | analytics | In-memory index with identity-free allow-list | OpenSearch / ES / Postgres FTS, same allow-list at index time | storage |
| **Notifications** | 4 | intake | Capture providers, anonymity boundary enforced | SES / Twilio / FCM for **staff only**; reporter updates stay pull-only | identity |
| **Infrastructure** | 4 | infrastructure | Reference manifests, resource registry, reviewed baseline | Provisioned sovereign cloud managed as code, drift-checked | storage, messaging, certificates |

## Risks and rollback (the part that decides whether a migration is safe)

Every item names both. Three are worth calling out because their rollback is *not* free:

- **Cryptography 🔒** — key mismanagement makes historical evidence permanently unreadable. Rollback
  requires keeping the previous key generation decryptable for the whole re-wrap window; how long
  that window stays open is a **governance decision**, not a technical default. Key material is
  human-built under ISRB sign-off and never machine-generated.
- **Storage** — a shared schema silently collapses zone isolation, and a well-meaning DBA can
  introduce an identity column. Cut over **one zone at a time** so rollback is never platform-wide.
- **Policy Engine** — externalization's classic failure is an authoring error that *opens* access.
  Run shadow evaluation until external and in-process decisions agree across the full validation
  suite; unavailability of the external evaluator must **deny**. Rollback is a flag flip because the
  in-process engine stays loaded.

The rest roll back by configuration (`NJTIP_PERSISTENCE`, `NJTIP_BROKER`, `NJTIP_OBJECT_STORE`,
`NJTIP_KMS`, `NJTIP_CACHE`, `NJTIP_SECRETS`, `NJTIP_OIDC_*`) because business logic never names a
driver — that is what the port discipline buys.

## Required validations

Each item cites the **real fitness functions** that must hold before and after its cutover — for
example Identity cites `APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE`, `APP-FIT-AUTHZ-DEFAULT-DENY`,
`APP-FIT-CREDENTIAL-HYGIENE` and `FIT-ZERO-TRUST`. The fitness gate checks that every cited id
resolves to a function that actually exists, so a migration plan cannot cite a control that was never
implemented.

## Definition of done for a migration step

1. Production driver implements the port contract; the reference driver remains selectable.
2. A port-contract test mirrors the reference tests for the new driver.
3. `npm test`, `npm run twin`, `npm run evidence`, `npm run readiness`, `npm run devsecops` all pass.
4. Rollback **rehearsed**, not just documented.
5. The item's status is advanced in `src/migration/roadmap.js` in the same commit.
6. The approving authority records the cutover decision. *Readiness is advisory; the decision is not.*
