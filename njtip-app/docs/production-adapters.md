# Production Adapters — Ports & Drop-in Drivers (v1.2)

This is the operator/engineer guide for taking NJTIP from a **production-shaped MVP** to an
**operational production platform** by swapping *reference* adapters for *production* drivers —
**without touching business logic**. Every adapter sits behind a stable **port**; the composition
root ([`src/app.js`](../src/app.js)) is the one place that selects a driver, chosen by
[`src/config.js`](../src/config.js) from the environment.

> **Honesty markers are load-bearing.** Reference drivers are **synthetic** and clearly labelled.
> The 🔒 cryptographic subsystem (KMS/HSM + threshold key custody) is **human-expert-built and
> ISRB-signed** — it is *never* autonomously generated, so the production KMS driver is intentionally
> **absent** from this repo. Requesting a non-bundled production driver **fails closed** (it raises),
> never silently falls back to the reference. **Evidence supports human decisions; it never
> replaces them.**

## The rule that makes this safe

A port is a *narrow interface*. The domain depends only on the interface, so a production driver is a
thin object implementing the same methods against a real backend. If a new driver keeps the contract
(and passes the port's tests + the Twin gate), business logic cannot tell the difference.

| Concern | Port (interface) | Reference driver (in-repo, synthetic) | Production driver (drop-in) | Selector (env) |
|---|---|---|---|---|
| Persistence | `get/put/values/keys/size/delete` | `MemoryStore`, `FileStore`, `SqlStore`+`MemorySqlDriver` | PostgreSQL driver (5-method SQL) | `NJTIP_PERSISTENCE=memory\|file\|sql` |
| Encryption at rest 🔒 | `encrypt/decrypt/isCiphertext/rewrap` | `SyntheticKeyManager` (Twin envelope crypto) | KMS/HSM + threshold custody (**human-built**) | `NJTIP_KMS=synthetic\|kms` |
| Evidence object storage | `put/get/has/delete/keys` (ciphertext-only) | `ObjectStore` (in-memory) | S3 / MinIO / GCS | `NJTIP_OBJECT_STORE=memory\|s3\|minio\|gcs` |
| Messaging | `publish/subscribe/drain` (PII-free outbox) | `MessageBroker` (in-memory outbox) | Kafka / RabbitMQ / NATS | `NJTIP_BROKER=memory\|kafka\|rabbitmq\|nats` |
| Sessions | `issue/verify/revoke` | `SessionManager` (HMAC) | same (secret from a secrets manager) | — |
| Federated auth | `verify(token) → {principal,role}` | `OidcVerifier` (HS256, offline) | OIDC/OAuth2 IdP (RS256/ES256 + JWKS + FIDO2/MFA) | `NJTIP_OIDC_*` |
| Staff notifications | `send({toPrincipal,role,reason,data})` | `CaptureProvider` (in-memory) | SES/SendGrid, Twilio/SNS, FCM/APNs | — |

## 1. PostgreSQL persistence (`NJTIP_PERSISTENCE=sql`)

`SqlStore` ([`src/adapters/sql-store.js`](../src/adapters/sql-store.js)) implements the same store
interface as `MemoryStore`/`FileStore`, bound to one table `` `${zone}__${collection}` ``. It speaks only
to a **driver port** with five methods:

```
migrate(ddlName)            -> record a migration (idempotent)
upsert(table, key, value)   -> insert or replace one row (value = JSON)
get(table, key)             -> value | null
all(table)                  -> value[]
keys(table)                 -> string[]
del(table, key)             -> boolean
```

The in-repo reference is `MemorySqlDriver`
([`src/adapters/drivers/sql-driver.js`](../src/adapters/drivers/sql-driver.js)). A **PostgreSQL driver**
implements the same five methods with real SQL against
[`db/migrations/001_init.sql`](../db/migrations/001_init.sql):

```js
// drivers/pg-driver.js (production; requires a Postgres client — added at deploy time)
class PgDriver {
  constructor(pool) { this._pool = pool; }              // one pooled connection
  async migrate(name) { /* run db/migrations/<name>.sql once; track in schema_migrations */ }
  async upsert(t, k, v) { /* INSERT ... ON CONFLICT (key) DO UPDATE SET value = $2 */ }
  async get(t, k)  { /* SELECT value FROM <t> WHERE key = $1 */ }
  async all(t)     { /* SELECT value FROM <t> */ }
  async keys(t)    { /* SELECT key FROM <t> */ }
  async del(t, k)  { /* DELETE FROM <t> WHERE key = $1 */ }
}
```

Zone isolation is **structural**: per-zone schemas + per-zone DB roles (no cross-zone grant). There is
**no identity column** — rows are opaque JSON blobs, and identity is rejected in the domain before it
can reach persistence. One driver instance is shared per app via a `WeakMap` keyed by `cfg` (see
`sqlDriver()` in [`src/adapters/store.js`](../src/adapters/store.js)) so it never leaks into config dumps.

> The reference driver is synchronous; a real `PgDriver` is async. Making the store methods `await` the
> driver is a mechanical change confined to `SqlStore` — the domain already treats persistence as an
> injected port, so no business logic changes.

## 2. Encryption at rest — KMS/HSM 🔒 (`NJTIP_KMS`)

`makeKeyManager` ([`src/adapters/kms.js`](../src/adapters/kms.js)) returns the `SyntheticKeyManager`
(delegating to the Twin's envelope crypto: per-zone data keys, keys never co-located with ciphertext).
The **production KMS/HSM driver is human-built and ISRB-signed** and is *intentionally not in this repo*;
`NJTIP_KMS=kms` **raises** so it can never be faked. The object store depends only on `isCiphertext()`,
so the real KMS drops in without any domain change.

## 3. Evidence object storage — ciphertext-only (`NJTIP_OBJECT_STORE`)

`ObjectStore` ([`src/adapters/object-store.js`](../src/adapters/object-store.js)) persists **only
ciphertext** — `put()` raises on any non-ciphertext blob, so plaintext cannot reach storage even by
mistake (fail-closed, independently checked by an app fitness function). Refs are content-addressed and
zone-scoped; a ref in one zone is invisible in another. S3/MinIO/GCS drivers implement the same
`put/get/has/delete/keys` against per-zone buckets with SSE-KMS; requesting one while unbundled fails closed.

## 4. Messaging — PII-free transactional outbox (`NJTIP_BROKER`)

`MessageBroker` ([`src/adapters/broker.js`](../src/adapters/broker.js)) stages events in an **outbox**
(written with the domain change, drained after commit) and delivers at-least-once. It **refuses** any
payload containing identity or case content (`assertPiiFree`) — the PII-free cross-zone contract cannot
be violated even by mistake. Kafka/RabbitMQ/NATS drivers keep `publish/subscribe/drain`; requesting one
while unbundled fails closed.

## 5. Federated auth — OIDC/OAuth2 (`NJTIP_OIDC_*`)

`OidcVerifier` ([`src/adapters/oidc.js`](../src/adapters/oidc.js)) exposes the same
`verify(token) → {principal, role} | null` contract as `SessionManager`, so the server's auth
middleware ([`src/server.js`](../src/server.js), via `app.auth`) accepts **either** a session token or a
verified OIDC token with no privilege change. The reference verifies a compact HS256 JWT offline against
the shared secret + issuer/audience trust anchors and maps a `njtip_role` claim (allow-listed — no
implicit privilege). The production verifier validates RS256/ES256 against the IdP's **JWKS** (rotating
keys), checks `iss/aud/exp/nbf`, and enforces FIDO2/MFA `acr`.

## 6. Staff notifications (email/SMS/push)

`makeNotificationProviders` ([`src/adapters/notify-providers.js`](../src/adapters/notify-providers.js))
delivers coarse, non-identifying reasons to **authenticated staff only**. The **anonymity boundary** is
enforced: anonymous reporters are never pushed to a device (their only channel is poll-by-case-code), and
case content is refused in the body. SES/SendGrid, Twilio/SNS, FCM/APNs drivers keep the same `send()`.

## v1.3 enterprise semantics (real, tested — on the same ports)

These behaviours are implemented and tested in-repo; only the vendor network client is a
drop-in. See [`enterprise-operations.md`](./enterprise-operations.md) for the full map.

- **Persistence**: transactions (`adapters/uow.js`, rollback on throw), optimistic locking
  (`SqlStore.putIfVersion` / driver `casUpsert`), connection pool with FIFO backpressure
  (`adapters/pool.js`), migration `002_versioning.sql`.
- **Cache** (`adapters/cache.js`): TTL, namespacing, atomic incr, distributed session store.
- **Messaging**: retry + exponential backoff + **dead-letter queue** + `replayDeadLetters()`.
- **Object storage**: `putVersion`/`versions`/`getVersion` + `applyLifecycle` (keepLatest /
  expireAfterMs / transitionAfterMs) + `setLegalHold`.
- **Identity**: `revoke(jti)`, `rotateKey()`/`jwks()`, `SamlVerifier`.
- **Secrets** (`adapters/secrets.js`): leases + versioned `rotate`; metadata-only status.
- **Certificates** (`adapters/certificates.js`): lifecycle states, rotation-due, CRL.
- **Search** (`adapters/search.js`): inverted index, non-identifying fields only (fail-closed).
- **Integrations** (`adapters/integrations.js`): circuit breaker + PII-free outbound.
- **Feature flags** (`adapters/flags.js`): deterministic sticky rollout, cohorts, kill-switch.

Each is guarded by an app or infra fitness function; the container refuses to start unless
the whole gate (twin + app + infra) passes.

## Checklist for adding a production driver

1. Implement the port's exact method signatures against the real backend.
2. Preserve the invariants the reference enforces (zone isolation; no identity column; ciphertext-only;
   PII-free events; anonymity boundary; no implicit privilege).
3. Select it in `config.js`/env and construct it in `src/app.js` (**only** there).
4. Add a port-contract test (mirror the reference tests) and keep the **Twin gate green**.
5. 🔒 If it is cryptographic or key-custody, it is **human-built and ISRB-signed** — not machine-generated.
