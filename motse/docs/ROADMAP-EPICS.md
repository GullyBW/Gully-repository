# Motse DPI — Production-Hardening Epic & Ticket Breakdown

Dependency-ordered epics and task-level tickets that take Motse from a
feature-complete, governed application (Phases 1–6) to a globally deployable
Digital Public Infrastructure operating system. Grounded in the two architecture
reviews and the now-**implemented** four governed planes; every ticket extends an
existing interface — no breaking changes, ledger stays the sole financial truth.

**Legend** — Size: `S` ≤2d · `M` ≤1w · `L` ≤3w · `XL` >3w. Labels: `foundation`,
`security`, `data`, `identity`, `ai`, `payments`, `platform`, `sre`, `a11y`,
`compliance`, `sustainability`. Dependencies reference epic/ticket IDs.

**Already shipped (do not re-scope):** event store + CQRS, QR platform, the four
governed planes (Identity/Policy/AI/Data), provenance, cross-plane audit graph,
cell registry (logical), DPI certification, cards/multi-currency, capability
providers, offline outbox, USSD/SMS.

---

## STAGE 1 — FOUNDATION (unblocks everything)

### EPIC F1 — Durable persistence & repository realization `foundation`
**Goal:** back the in-memory `Collection` seam with real stores (Postgres for
money/identity), ledger-first, with ACID transactions. **Why:** no durability or
horizontal scale today — the single hard blocker to production. **Deps:** none.
**Acceptance:** kill a pod mid-transaction → trial balance stays balanced, no
committed data lost; two pods serve consistent reads; serializable ledger
concurrency test passes; p99 write < 50 ms.

- **F1-1** `PgCollection` implementing `insert/get/update/find/count` behind the existing interface · `L`
- **F1-2** `UnitOfWork` transaction wrapper; `LedgerService.post` runs in one tx with `SELECT … FOR UPDATE` on accounts · `L` · deps F1-1
- **F1-3** Migrate the Ledger + Identity collections first; optimistic `version` column · `M` · deps F1-2
- **F1-4** Connection pooling (PgBouncer), least-privilege DB roles, TLS · `S` · deps F1-1
- **F1-5** Index audit of hot `.find()` scans → add indexes/projections · `M` · deps F1-3
- **F1-6** Load-test parity via `scripts/load-test.js` at 10× volume · `S` · deps F1-3

### EPIC F2 — Transactional outbox + durable event log + broker `foundation`
**Goal:** atomic state+event commit; durable, partitioned event log; inter-service
delivery via a broker. **Why:** `EventBus.tap` is in-process/synchronous — a crash
diverges state from events. **Deps:** F1. **Acceptance:** chaos test → every
committed change has exactly one durably-delivered event; projections rebuild
bit-identically; consumer lag exported.

- **F2-1** `outbox` table written inside the F1 transaction · `M` · deps F1-2
- **F2-2** Relay process → broker (Pub/Sub/Kafka); mark-published + DLQ · `L` · deps F2-1
- **F2-3** `EventStore.append` idempotent on `source_id`; durable partitioned log · `M` · deps F2-2
- **F2-4** Projection workers consume broker offsets with checkpointing (reuse `position`/`lag`) · `M` · deps F2-3
- **F2-5** `traceparent`/correlation carried in the event envelope · `S` · deps F2-2

### EPIC F3 — Distributed platform services (Redis) `foundation`
**Goal:** move `RateLimiter`, `IdempotencyRegistry`, `ReplayGuard` nonces and a hot-
read cache to Redis behind existing interfaces. **Why:** per-pod in-memory = limits
×N, no idempotency dedupe across pods (double-charge risk). **Deps:** none.
**Acceptance:** same idempotency key on two pods → one execution; global limit holds
at any pod count; replayed webhook rejected cluster-wide.

- **F3-1** Redis token-bucket `RateLimiter` (Lua atomic) · `M`
- **F3-2** Redis idempotency cache (`SETNX`+TTL 48h) · `S`
- **F3-3** Redis nonce set for `ReplayGuard` (TTL = replay window) · `S`
- **F3-4** Cache-aside for identity claims/projections; event-driven invalidation · `M` · deps F2-4

### EPIC F4 — Tenant isolation enforcement `foundation` `security`
**Goal:** first-class `TenantContext` propagated + enforced at repo (RLS), policy
and event layers. **Why:** Phase-5/6 added tenant *fields*; isolation is not yet
*enforced*. **Deps:** F1. **Acceptance:** tenant A cannot read/write/scan-QR tenant
B via any API; RLS denies even a forged query; per-tenant config isolates.

- **F4-1** `AsyncLocalStorage` tenant context from edge (JWT/subdomain) · `M`
- **F4-2** `Collection` auto-applies tenant predicate; Postgres RLS backstop · `L` · deps F1-1, F4-1
- **F4-3** Scope PDK `tenant_isolation` rule + roles to `tenant:` (extends the shipped kernel) · `M` · deps F4-1
- **F4-4** Per-tenant `SecretManager` namespaces + signing keys · `M` · deps F5-1

### EPIC F5 — KMS envelope encryption + crypto-shredding `foundation` `security`
**Goal:** KMS-backed secrets, envelope-encrypted PII, crypto-shredding for erasure.
**Why:** in-memory secrets, cleartext PII, immutable-log vs right-to-erasure tension.
**Deps:** F1. **Acceptance:** all PII ciphertext at rest; erase a subject → all reads
undecryptable; ledger/audit intact; KMS-audited keys; zero-downtime rotation.

- **F5-1** `SecretManager` backed by cloud KMS/HSM (same interface) · `M`
- **F5-2** `EncryptedField` + DEK cache; per-tenant/per-subject key hierarchy · `L` · deps F5-1
- **F5-3** Crypto-shred erasure = DEK destruction + tombstone event; projections reference not copy PII · `L` · deps F5-2, F2-1
- **F5-4** Asymmetric option for provenance signing (see E4) · `S` · deps F5-1

### EPIC F6 — Event contract governance (AsyncAPI + schema registry) `foundation` `platform`
**Goal:** machine-readable event contracts + compatibility gates, leveraging the
shipped upcasters. **Why:** schemas are imperative (`bus.register`); the event log is
now the integration backbone. **Deps:** none. **Acceptance:** 100% events have a
registered schema; CI rejects a breaking change lacking an upcaster.

- **F6-1** `scripts/generate-asyncapi.js` from `bus.schemas` · `S`
- **F6-2** Schema registry + CI backward-compat check · `M` · deps F6-1
- **F6-3** Require an `EventStore` upcaster on every version bump; contract tests · `M` · deps F6-2

---

## STAGE 2 — PLATFORM MATURITY

### EPIC P1 — Externalize the Policy Kernel: policy-as-code + ReBAC `security` `platform`
**Goal:** evolve the shipped in-code `PolicyKernel` into policy-as-code (OPA/Cedar) +
a relationship graph (Zanzibar-style) as a projection. **Why:** express relationship
scopes ("custodian *of this ward*") and govern policy as versioned artifacts. **Deps:**
F2, F4. **Acceptance:** shadow-mode divergence = 0 before enforce; a relationship-
scoped policy is expressible + tested; every decision still audited.

- **P1-1** ReBAC relationship projection from `role.granted`/`custodian.assigned`/`consent.given` · `M` · deps F2-4
- **P1-2** Policy engine PDP; `PolicyKernel.decide` delegates (interface unchanged) · `L` · deps P1-1
- **P1-3** Shadow-mode diff harness vs current rules; reconcile · `M` · deps P1-2
- **P1-4** Continuous authorization: re-evaluate on risk change mid-session · `M` · deps P1-2

### EPIC P2 — OpenTelemetry distributed tracing `sre`
**Goal:** end-to-end spans across the event-driven flows (correlation ids already
threaded). **Deps:** F2. **Acceptance:** one trace spans QR→pay→gateway→ledger→
projection; no PII/secret in spans; per-service latency SLOs.

- **P2-1** OTel SDK at the edge + auto-instrumentation · `M`
- **P2-2** Context propagation on events/broker (extends F2-5) · `S` · deps F2-5
- **P2-3** Redaction processor (strip tokens/PII from attributes) · `S`
- **P2-4** Trace-derived SLO dashboards + alerts · `M` · deps P2-1

### EPIC P3 — Durable read-model store for CQRS `data`
**Goal:** persist projections to indexed/durable stores with checkpointed offsets.
**Deps:** F1, F2. **Acceptance:** projections survive restart with no replay; rebuild
from snapshot is incremental; dashboard p99 < 50 ms at 10⁷ events.

- **P3-1** Persisted projection tables + offsets · `M` · deps F2-4
- **P3-2** Snapshot offsets for incremental rebuild · `M` · deps P3-1
- **P3-3** Re-back Data Product Plane reads on the durable store · `S` · deps P3-1

### EPIC P4 — SRE program: SLOs/error budgets + chaos `sre`
**Deps:** P2. **Acceptance:** SLOs defined for pay/verify/scan/sync; error-budget
policy gates releases; automated fault injection in staging; measured RPO/RTO.

- **P4-1** SLI/SLO definitions per critical journey · `S` · deps P2-4
- **P4-2** Error-budget policy in CD · `S` · deps P4-1
- **P4-3** Automated chaos (extend `scripts/resilience-test.js`) + game days · `M`
- **P4-4** Automated RPO/RTO measurement (Phase-5 WS19) · `M` · deps F2-3

### EPIC P5 — Internal Developer Platform + golden paths `platform`
**Deps:** F6. **Acceptance:** new module/provider/plugin/projection scaffolds with
governance baked in (events, AsyncAPI, tests, policy stubs, SBOM) in hours; service
catalog complete.

- **P5-1** Backstage (or equivalent) service catalog · `M`
- **P5-2** Golden-path scaffolds (module / provider / plugin / projection) · `L` · deps F6-1
- **P5-3** Self-service ephemeral environments · `M`

### EPIC P6 — Confidential computing for keys & PII `security`
**Deps:** F5. **Acceptance:** crown-jewel ops (key unwrap, PII match, national-ID
verify) run in attested enclaves; operator-plaintext surface → 0.

- **P6-1** Confidential VM / enclave runtime for key + PII operations · `L` · deps F5-1
- **P6-2** Attestation before secret release · `M` · deps P6-1

---

## STAGE 3 — ECOSYSTEM EXPANSION

### EPIC E1 — Verifiable Credentials + DIDs `identity` (**Strategic Leap**)
**Goal:** issue W3C VCs bound to tenant DIDs, held in the wallet, presented via QR,
verified offline. **Deps:** F5, N1, Phase-5 wallet + QR (shipped). **Acceptance:** a
custodian proves status offline via QR disclosing no PII; a revoked credential fails
without a network call; conforms to W3C VC 2.0.

- **E1-1** `CredentialService.issue/verify/revoke` (SD-JWT-VC / JSON-LD) · `L` · deps F5-1
- **E1-2** DID method + resolver in `IntegrationRegistry` · `M` · deps E1-1
- **E1-3** Selective disclosure (BBS+/SD-JWT) · `M` · deps E1-1
- **E1-4** Privacy-preserving status list projection (revocation) · `M` · deps F2-4
- **E1-5** QR `kind:'identity'` carries a VC presentation; wallet offline store · `M` · deps E1-3

### EPIC E2 — Governed RAG + vector projections + MLOps `ai` (**Strategic Leap**)
**Goal:** extend the shipped AI Gateway with a vector-search projection, model/prompt
registry, evaluation gates and human-approval agents. **Deps:** P1, P3. **Acceptance:**
red-team prompt cannot surface restricted heritage/other-tenant/consent-denied PII;
answers cite authorized sources; agents mutate only via approved workflows.

- **E2-1** Vector-embedding projection over corpus/content events · `L` · deps P3-1
- **E2-2** Retrieval filter reuses the PDK per candidate (extends AI Gateway) · `M` · deps P1-2
- **E2-3** Model + prompt registry (extends `AiRegistry`/`AiEvaluator`) · `M`
- **E2-4** Eval/guardrail gates in CD; drift detection projection · `M` · deps E2-3
- **E2-5** Agentic actions routed to the Workflow Engine (human approval) · `M`

### EPIC E3 — Plugin isolation + marketplace + supply-chain `security` `platform`
**Deps:** F4. **Acceptance:** deploy rejects unsigned/unprovenanced artifacts; a
malicious plugin cannot exceed its manifest/tenant/PII scope; SBOM per release.

- **E3-1** SBOM (CycloneDX) + SLSA provenance + cosign signing in CI · `M`
- **E3-2** WASM/subprocess plugin sandbox + capability manifest · `XL`
- **E3-3** Marketplace certification pipeline (WS20) · `M` · deps E3-2

### EPIC E4 — Asymmetric provenance + offline verifier `security`
**Deps:** F5. **Acceptance:** third parties verify signed outputs without holding
signing material; envelope shape unchanged.

- **E4-1** Swap provenance HMAC for asymmetric signing (keys in KMS) · `M` · deps F5-1
- **E4-2** Public verifier SDK method + published JWKS · `S` · deps E4-1

### EPIC E5 — CRDT offline for concurrent edits `platform`
**Deps:** F2. **Acceptance:** concurrent offline edits to shared civic data converge
deterministically on reconnect (never the ledger); conflict-loss = 0.

- **E5-1** CRDT state for collaborative non-financial domains · `L`
- **E5-2** Reconnect convergence audited as events · `M` · deps E5-1

---

## STAGE 4 — NATIONAL READINESS

### EPIC N1 — OIDC/OAuth 2.1 provider + FIDO2 passkeys + federation `identity`
**Deps:** F3, F5. **Acceptance:** passes OIDC conformance; sample third-party
auth-code+PKCE works; passkey login cross-device; national-ID federation demoable;
existing OTP/JWT unaffected.

- **N1-1** OAuth 2.1 + OIDC AS wrapping the identity graph (JWKS, /authorize, /token, /userinfo) · `L`
- **N1-2** WebAuthn/FIDO2 passkey registration + assertion (device-bound) · `L` · deps N1-1
- **N1-3** Inbound OIDC RP adapter for national ID (via `IntegrationRegistry`) · `M` · deps N1-1
- **N1-4** Step-up (ACR) feeds the assurance risk score → PDK · `S` · deps N1-2, P1-4

### EPIC N2 — ISO 20022 payment interoperability `payments`
**Deps:** none (extends provider abstraction). **Acceptance:** sandbox
`pacs.008`/`camt.053` settles + reconciles with zero variance; ledger unchanged.

- **N2-1** `Iso20022Adapter` (canonical money ↔ pain/pacs/camt) · `L`
- **N2-2** `camt.053` statements feed existing reconciliation · `M` · deps N2-1
- **N2-3** Sanctions/AML screening hooks → fraud engine · `M`

### EPIC N3 — Compliance & data-governance automation `compliance` `data`
**Deps:** F2, F5, F6. **Acceptance:** every PII flow has a DPIA + enforced consent;
lineage traces every metric to source events; retention enforced.

- **N3-1** Data catalog + lineage over the event log · `M` · deps F2-3
- **N3-2** Consent lifecycle as first-class events; PDK-enforced purpose limitation · `M` · deps P1-2
- **N3-3** Retention policies + automated erasure (crypto-shred) · `M` · deps F5-3
- **N3-4** Automated compliance reports (extends DPI certification) · `S`

### EPIC N4 — WCAG 2.2 AAA + inclusive i18n `a11y`
**Deps:** none. **Acceptance:** CI fails on new AAA violations; screen-reader/keyboard
journeys pass; supported-locale matrix; low-literacy/low-bandwidth modes.

- **N4-1** axe-core AAA gate in the Playwright suite · `S`
- **N4-2** ARIA/semantic remediation of wallet/QR/admin flows · `L`
- **N4-3** Full localization framework + RTL + sign-language/audio for heritage · `L`

---

## STAGE 5 — GLOBAL READINESS

### EPIC G1 — Physical cell provisioning + data residency + jurisdiction packs `platform` (**Strategic Leap**)
**Goal:** realize the shipped logical `CellRegistry` as physical cells with residency
zones and per-country regulatory packs. **Deps:** F1, F2, F4, P1, P5. **Acceptance:**
a cell failure leaves others unaffected (game day); a new country onboards via a
jurisdiction pack with zero code change; data never leaves its residency zone.

- **G1-1** Cell router (tenant→cell) + global control plane · `L` · deps F4-1
- **G1-2** Per-cell isolated stack (DB/broker/cache/read-models) via IDP · `L` · deps P5-2
- **G1-3** Jurisdiction packs (residency, currency, regulatory, localization) as policy/config · `L` · deps P1-2
- **G1-4** Cross-cell flows: explicit, residency-aware, policy-approved (extends `crossCell`) · `M` · deps F2-2

### EPIC G2 — Sustainability + FinOps `sustainability`
**Deps:** F1, F2. **Acceptance:** gCO₂/transaction tracked; deferrable work scheduled
to low-carbon windows; per-tenant/cell cost attribution.

- **G2-1** Carbon-aware scheduling of projection rebuilds/lakehouse/backups · `M`
- **G2-2** Event-log hot→cold storage tiering · `M` · deps F2-3
- **G2-3** FinOps cost/carbon attribution per tenant/cell · `M` · deps F4-1

### EPIC G3 — Global observability + multi-country SLOs `sre`
**Deps:** P2, P4, G1. **Acceptance:** fleet-wide traces/SLOs per cell/country; worst-
case blast radius minimized + measured.

- **G3-1** Per-cell + aggregated observability · `M` · deps P2-4, G1-2
- **G3-2** Multi-country SLO + error-budget rollups · `S` · deps P4-1

---

## Critical path (shortest route to safe national rollout)

```
F1 → F2 → F4 → F5 → P1 → N1 → E1        (identity/authz/data-protection spine)
F1 → F3                                  (scale-out, parallel)
F2 → P2/P3 → P4                          (observability + reliability)
F1/F2/F4/P1/P5 → G1                       (sovereign multi-country, last)
```

Each stage preserves backward compatibility and the existing architectural strengths;
nothing here reopens the ledger's authority or the governed-plane boundaries already
implemented in Phase 6.
