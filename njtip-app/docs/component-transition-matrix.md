# Component Transition Matrix (Part 4)

Which subsystems are **synthetic reference** vs must become **production-ready**, and how. Migration is
incremental; each step must keep the Twin green and preserve API contracts. 🔒 = human-expert-built,
never autonomously generated.

| Subsystem | Current (v1.0 synthetic) | Target (production) | Migration strategy | Risks | Dependencies | Validation |
|-----------|--------------------------|---------------------|--------------------|-------|--------------|------------|
| **Identity** | In-memory principals; no reporter identity | Federated, zone-scoped; still **no reporter identity** | Add IdP adapter behind IAM interface; anonymous path unchanged | Identity leak if adapter misused | IdP (per zone) | `FIT-IDENTITY-MINIMIZATION`, privacy tests |
| **Authentication** | Synthetic bearer tokens | OIDC + **FIDO2/WebAuthn** for privileged; anonymous case-code for reporters | Swap token check for OIDC/WebAuthn verify at the gateway | Phishing if MFA weakened | IdP, WebAuthn | `FIT-ZERO-TRUST`, SIM-06/24 |
| **Cryptography** 🔒 | Synthetic envelope (AES-GCM, synthetic keys) | **HSM/KMS** envelope + **M-of-N threshold** custody | Replace crypto module behind the same interface; keys never leave HSM | Key mismanagement | HSM, governance custodians | `FIT-ENCRYPTION`, `FIT-GOVERNANCE`, crypto review |
| **Policy Engine** | In-process rules (default-deny, deny-precedence) | OPA/Rego at gateway + runtime; policy-as-code lifecycle | Externalize rules; keep fail-closed semantics | Policy authoring errors | Policy registry | `FIT-POLICY-ENFORCEMENT`, FORMAL-POLICY-LOGIC |
| **Event Bus** | In-memory PII-free bus + schema registry | Durable broker (log-based) + outbox + registry | Introduce broker behind publish/subscribe interface | Delivery/dup issues | Broker | `FIT-SECURE-DATA-FLOWS`, contract tests |
| **Storage** | In-memory maps | Zone-isolated databases + object store; per-field policy | Repository adapters per store; no shared DB | Data at rest exposure | DBs per zone | `FIT-ZONE-ISOLATION`, `FIT-ENCRYPTION` |
| **Audit Log** | In-memory hash-chained + synthetic anchor | Append-only store + **external transparency-log anchoring** | Persist chain; anchor digests externally | Tampering if not anchored | Transparency log | `FIT-AUDITABILITY`, SIM-15/25 |
| **Evidence Store** 🔒 | In-memory + custody chain | Content-addressed store + trusted timestamp + legal-hold | Persist ciphertext + custody; add TSA | Admissibility | TSA, forensics/legal | `FIT-CHAIN-OF-CUSTODY`, SIM-16 |
| **Notification Services** | (not in MVP) | Privacy-aware notifications; minimal payloads | New service behind events | Metadata leak | Broker | privacy tests |
| **Reporting** | In-memory store (no identity) | Persistent, zone-isolated; offline-draft client | Repository adapter; PWA client | — | Storage, client | `FIT-IDENTITY-MINIMIZATION` |
| **Governance Portal** | File-backed append-only ledger + CLI | Persistent ledger + reviewer UI + threshold-signed decisions | Persist; add auth + signatures; **stays human-only** | Automation creep (forbidden) | IdP, HSM | governance tests, maturity cap L6 |

## Sequencing (implementation-driven)
Security spine first: **Authentication → Cryptography → Storage → Audit/Evidence persistence**, then
Policy externalization, Event bus durability, Notifications, then Governance UI. Each behind a stable
interface so the vertical slice keeps running and the Twin keeps validating throughout.

## v1.2 — Adapter status (production transition in progress)

Every production concern now sits behind a **stable port**, selected only at the composition root
(`src/app.js`). In-repo **reference drivers** are synthetic and labelled; **production drivers** are
documented drop-ins that implement the same port. Requesting an unbundled production driver **fails
closed** (never silently degrades). Full guide: [`production-adapters.md`](./production-adapters.md).

| Port | Reference driver (in-repo, tested) | Production driver (drop-in) | Selector | App fitness check |
|---|---|---|---|---|
| Persistence | `MemoryStore` · `FileStore` · `SqlStore`+`MemorySqlDriver` | PostgreSQL (5-method driver) | `NJTIP_PERSISTENCE` | `APP-FIT-NO-IDENTITY-COLUMN` |
| Encryption at rest 🔒 | `SyntheticKeyManager` (Twin envelope) | KMS/HSM + threshold custody (**human-built**) | `NJTIP_KMS` | `APP-FIT-CIPHERTEXT-ONLY` |
| Evidence object storage | `ObjectStore` (memory, ciphertext-only) | S3 · MinIO · GCS | `NJTIP_OBJECT_STORE` | `APP-FIT-CIPHERTEXT-ONLY` |
| Messaging | `MessageBroker` (memory outbox, PII-free) | Kafka · RabbitMQ · NATS | `NJTIP_BROKER` | `APP-FIT-PII-FREE-EVENTS` |
| Federated auth | `OidcVerifier` (HS256, offline) | OIDC/OAuth2 IdP (JWKS, FIDO2/MFA) | `NJTIP_OIDC_*` | `APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE` |
| Sessions | `SessionManager` (HMAC, expiring, revocable) | same (secret from a secrets manager) | — | `APP-FIT-SECRETS-REDACTED` |
| Staff notifications | `CaptureProvider` (email/sms/push) | SES · Twilio · FCM | — | `APP-FIT-ANONYMITY-BOUNDARY` |

New v1.2 business capabilities: **RBAC+ABAC authorization** (`authz.js`, `APP-FIT-AUTHZ-DEFAULT-DENY`),
**case + evidence lifecycles** (`domain/`, `APP-FIT-LIFECYCLE-DEFAULT-DENY`), a signed **assurance
evidence package** (Phase 9), a **human-gated readiness assessment** (Phase 10, never auto-authorizes),
and **Kubernetes reference manifests** (`deploy/k8s/`: HA, autoscaling, zone-isolation NetworkPolicy).
