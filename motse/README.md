# Motse — Platform Implementation

Reference implementation of **Motse — System & Engineering Documentation v1.0**: a
civic, cultural, and financial **Digital Public Infrastructure** platform for
Botswana, organised around three platform primitives every module consumes — a
**verified identity graph**, a **unified money-movement service (double-entry
ledger)**, and a **governance/audit engine**.

It has since grown into a full **enterprise operational platform**: transactions and
distributed coordination, observability, runtime governance, disaster-recovery
validation, and a **self-validating, continuously-learning intelligence layer** that
reconciles its own telemetry against the ledger, measures the effectiveness of its
own recommendations, briefs leadership, learns from outcomes, and fails CI when its
evidence quality regresses.

> **📖 Start with the [documentation hub](docs/README.md)** — it maps every doc by
> layer. This README is the orientation; the hub is the map.

**Status:** Motse **800** tests / 57 suites · Tirelo root **131** tests · chaos/
production harness **119/119** · evidence-integrity gate **PASS** · **17 targeted
coverage gates** each ≥95% statements / 95% lines / 90% branches — all green in CI.

```bash
npm run motse:start           # :4100 — /v1 API, /admin, /app PWA, /developers, /metrics
npm run motse:test            # full Motse suite (57 suites / 800 tests)
npm run motse:validate:smoke  # chaos/production-validation harness (119 checks)
npm run motse:evidence        # evidence-integrity gate (every metric sourced, every rec evidenced)
npm run motse:slo             # regenerate SLO dashboards + Prometheus alerts
npm run motse:bench | :load | :resilience   # performance / load / resilience
```

---

## The platform, by layer

Each layer is **additive** over the layer below, backward-compatible, read-only over
the systems it observes, and independently tested to a ≥95/95/90 gate.

### Foundation — correctness under load
Unit-of-Work transactions with journaled rollback · Transactional Outbox
(at-least-once, retention/replay) · immutable Event Store + CQRS projections ·
distributed KV (in-memory → Redis) for idempotency, locks and rate limiting.
→ [FOUNDATION](docs/FOUNDATION.md) · [EVENTS-CQRS](docs/EVENTS-CQRS.md)

### Observability & resilience
OpenTelemetry tracing + OTLP export · Prometheus metrics · structured logs
correlated to traces · health/readiness · a 5-state dependency-health machine ·
circuit breakers, bulkheads, adaptive retries, load shedding, self-healing · runtime
(heap/GC/event-loop) intelligence.
→ [OBSERVABILITY](docs/OBSERVABILITY.md) · [OBSERVABILITY-STACK](docs/OBSERVABILITY-STACK.md) · [RESILIENCE-RUNTIME](docs/RESILIENCE-RUNTIME.md) · [ENTERPRISE-MISSIONS](docs/ENTERPRISE-MISSIONS.md)

### Operations, configuration & governance
Typed, validated, **live-applied** runtime configuration · configuration governance
(risk tiers, approval workflow, forensic change records) · rollback/snapshots ·
predictive capacity planning · disaster-recovery validation (RTO/RPO) · four governed
DPI planes (Identity, Policy Kernel, AI Gateway, Data Product) with provenance.
→ [CONFIG-CAPACITY](docs/CONFIG-CAPACITY.md) · [GOVERNANCE-DR](docs/GOVERNANCE-DR.md) · [GOVERNED-PLANES](docs/GOVERNED-PLANES.md) · [OPERATIONS](docs/OPERATIONS.md)

### Business & operational intelligence
Business observability (value processed, customers reached, SLA per capability) ·
evidence-based operational recommendations (trend-driven, not static thresholds) ·
governance analytics (compliance/maturity, rollback rate) · forecast-accuracy
validation by backtesting the capacity planner.
→ [BUSINESS-INTELLIGENCE](docs/BUSINESS-INTELLIGENCE.md) · [GOVERNANCE-FORECAST-ANALYTICS](docs/GOVERNANCE-FORECAST-ANALYTICS.md)

### Enterprise intelligence — the platform validates & improves itself
| Capability | What it does | Doc |
| --- | --- | --- |
| **Business outcome validation** | Reconciles business telemetry against the **ledger** (authoritative record); every discrepancy carries root cause, financial exposure and remediation | [BUSINESS-VALIDATION-…](docs/BUSINESS-VALIDATION-RECOMMENDATION-EFFECTIVENESS.md) |
| **Recommendation effectiveness** | Tracks recommendations as measurable products (precision/recall/ROI) and recalibrates confidence from outcomes | ↑ same |
| **Executive intelligence** | One briefing answering what/why/who/value/recommended/confidence/what-if, with a single sourced operational-confidence score | [EXECUTIVE-…](docs/EXECUTIVE-OPERATIONAL-INTELLIGENCE.md) |
| **Continuous learning** | Persists a knowledge base of measured signals; learns trends, a calibrated forecast-confidence multiplier, and an evidence-gated maturity score | [CONTINUOUS-LEARNING](docs/CONTINUOUS-LEARNING.md) |
| **Evidence integrity** | CI gate that fails the build on dead metric references, unsupported recommendations/confidence, or ungoverned config | [EVIDENCE-INTEGRITY](docs/EVIDENCE-INTEGRITY.md) |

Validated end-to-end by the chaos/production harness ([PRODUCTION-VALIDATION](docs/PRODUCTION-VALIDATION.md)).

### The product (what all of the above operates)
- **Administration portal** — `/admin` SPA + `/v1/admin` API: dashboard, identity,
  councils/governance, ledger explorer, heritage administration, financial ops, audit
  explorer, and the full analytics/executive/learning surfaces. → [ADMIN-PORTAL](docs/ADMIN-PORTAL.md)
- **Payments** — Orange Money · MyZaka · Smega mobile money, PayPal remittance, and
  native cards (gateway abstraction + failover, tokenization, 3DS, multi-currency,
  dispute/settlement/reconciliation) behind one `PaymentProvider` contract.
  → [PAYMENTS](docs/PAYMENTS.md) · [PAYPAL](docs/PAYPAL.md) · [CARD-PAYMENTS](docs/CARD-PAYMENTS.md)
- **Domain modules** — `lelapa · kgotla · heritage · puo · mafelo · loeto · kgetsi ·
  letlole · mmino` on the identity/ledger/governance primitives.
- **Platform services** — PII-free analytics, AI provider interfaces + evaluation,
  configurable workflows, signed plugins, the QR platform, pilots/flags, a public
  SDK + OpenAPI, offline-first PWA/mobile, and national-rollout infrastructure.
  → [ANALYTICS](docs/ANALYTICS.md) · [AI](docs/AI.md) · [WORKFLOW](docs/WORKFLOW.md) · [PLUGINS](docs/PLUGINS.md) · [QR-PLATFORM](docs/QR-PLATFORM.md) · [PILOTS](docs/PILOTS.md) · [MOBILE](docs/MOBILE.md) · [NATIONAL-ROLLOUT](docs/NATIONAL-ROLLOUT.md)

---

## Architecture

A **modular monolith** (doc P6): domains live behind hard interface boundaries in one
deployable; Identity, Ledger and Media are structured as day-one extractions (their only
coupling point is `src/container.js`). Modules integrate through **versioned, replayable
domain events** (`src/kernel/eventBus.js`) — projections such as the public campaign
ledger are rebuilt from the event log, which is also how BigQuery would stay consistent
in production.

```
motse/src
├── kernel/           errors (Appendix B codes), event bus, idempotency (48h),
│                     cursor pagination + field masks, storage-agnostic store
├── platform/
│   ├── identity/     L0–L3 levels, (role, scope) RBAC, sessions, device binding,
│   │                 morafe membership attestation, MSISDN↔account (USSD identity)
│   ├── ledger/       double-entry postings, escrow engine, splits (largest-remainder),
│   │                 payouts, provider reconciliation with Sev-1 variance events
│   ├── governance/   hash-chained audit log + inclusion proofs, councils, seats,
│   │                 Ring-3 seat freezes, elder elections, dispute rings
│   └── media/        resumable uploads, transcode fan-out, signed short-TTL URLs,
│                     restricted bucket class, no-training flag, 14/90-day deletion
├── modules/          lelapa · kgotla · heritage · puo · mafelo · loeto · kgetsi ·
│                     letlole · mmino  (ten layers of the blueprint)
├── observability/    tracing/health · dependency health · runtime/capacity ·
│                     business/operational/governance analytics · forecast accuracy ·
│                     reconciliation · recommendation effectiveness · executive
│                     intelligence · continuous learning · evidence integrity
├── resilience/ config/ ops/ governance/   enterprise operational platform
├── gateway/          USSD menu state machine + SMS keywords (P9 feature-phone parity)
├── sync/             offline outbox replay (ordered per aggregate, exactly-once)
├── container.js      composition root (createPlatform) · app.js  API gateway
```

Storage is behind the repository interface in `kernel/store.js` (in-memory here);
production maps each system of record per doc §6.1 (Firestore for engagement data,
Postgres for the ledger, GCS for media). Amounts are integer minor units (thebe).

## Where each hard requirement is enforced

| Doc rule | Enforcement | Proven by |
| --- | --- | --- |
| P3: postings balance to zero | `ledger.service.js` rejects imbalanced sets (`LEDGER_IMBALANCE_REJECTED`) | `ledger.test.js` property tests |
| §7.1: Idempotency-Key on all mutations, 48h dedupe | gateway middleware in `app.js` + `kernel/idempotency.js` | `api.test.js` replay test |
| §9.2: release ≤ funded, evidence + two distinct L3 approvers | `kgetsi.service.js` + `escrow.service.js` (defence in depth) | `kgetsi.test.js` |
| §9.2: medical class → fee 0, provider-direct payout | forced at campaign open + release destination check | `kgetsi.test.js` |
| §9.2: freeze blocks release, never refunds | `escrow.service.js` | `kgetsi.test.js` dispute test |
| §9.3: splits sum exactly | largest-remainder apportionment | `ledger.test.js`, `loeto-puo.test.js` |
| §9.2: reconciliation variance > 0 pages | `ledger.reconcile()` emits `ledger.reconciliation.variance` | `ledger.test.js` synthetic provider files |
| §10.1: publication never requires validation; custodians cannot delete | heritage state machine has no custodian delete — `flag` is the ceiling | `heritage.test.js` |
| §10.2: Ring 3 seat freeze suspends grants automatically | `governance.freezeSeat` → role suspension → `SEAT_FROZEN` | `identity-governance.test.js` |
| §10.2: audit log is hash-chained with public inclusion proofs | `auditLog.js`; `/v1/public/audit/...` | tamper test fails verification |
| §6.4: restricted content never in public search/packs/exports | fail-closed filters in heritage, mafelo, media | `heritage.test.js` leak tests |
| §6.4: restricted delivery = identity-bound short-TTL signed URLs | `media.signUrl` requires server-side membership attestation | `heritage.test.js` |
| §6.4: no_derivatives_no_training honoured by every pipeline job | `media.assertDerivableForTraining` throws | `heritage.test.js` |
| §6.4/§14: deletion contract — soft now, hard ≤14d, purge ≤90d + signed receipt | `media.requestDeletion` + `runDeletionSweep` | `heritage.test.js` clock-advance test |
| §14: consent — spoken audio in subject's language; revocation → takedown | `CONSENT_MISSING` gate; `revokeConsent` withdraws items | `heritage.test.js` |
| §8/P9: USSD parity — same commands, same idempotency | gateway calls the same service methods | `sync-parity.test.js` (app vs USSD vs SMS join) |
| §8: 7-day outbox replay, exactly once, ordered per aggregate | `sync/outbox.js` | `sync-parity.test.js` clock-skew test |
| §8: conflicts → reconciliation cards, never silent overwrites | outbox `heritage.update_title` fixture | `sync-parity.test.js` |
| §5.3: device-bound tokens, rotating refresh | `identity.service.js` | `identity-governance.test.js`, `api.test.js` |
| §7.3: public transparency APIs | `/v1/public/campaigns/:id/ledger`, `/v1/public/trusts/:id/treasury`, `/v1/public/audit/...` | `api.test.js` unauthenticated access |

## API surface (representative, §7.2)

All mutations require an `Idempotency-Key` header. Errors use the problem-details
envelope `{ code, message, domain_reason, retryable, trace_id }` with the canonical
codes from Appendix B. The doc's custom verbs (`:validate`) are mounted as trailing
path segments (`/validate`) — same contract, Express-friendly syntax.

```
POST /v1/identity/otp | /v1/identity/otp/verify | /v1/identity/sessions/refresh
POST /v1/heritage/consents | /v1/heritage/items | .../publish | .../validate | .../contest
GET  /v1/heritage/items/{id} | /v1/heritage/search | /v1/morafe/{id}/feed
POST /v1/media/uploads | .../chunks | .../complete        GET /v1/media/{id}/url
POST /v1/ledger/accounts | /v1/ledger/transfers           GET .../balance
POST /v1/kgetsi/campaigns | .../endorse | .../live | .../contributions
POST /v1/kgetsi/campaigns/{id}/milestones/{m}/evidence | .../approve | .../release
POST /v1/loeto/experiences | /v1/loeto/bookings | .../settle
POST /v1/puo/courses | .../lessons | /v1/puo/threads | .../corrections
POST /v1/trusts | .../resolutions | .../resolutions/{r}/sign
GET  /v1/mafelo/packs/{district}/manifest
GET  /v1/public/campaigns/{id}/ledger | /v1/public/trusts/{id}/treasury
GET  /v1/public/audit/{objectRef} | .../proof/{entryId}
POST /v1/sync/outbox
POST /v1/gateway/ussd/session | /v1/gateway/sms/inbound
GET  /v1/admin/overview | /v1/admin/executive | /v1/admin/reconciliation | /v1/admin/learning
```

## Engineering principles

Every change is **additive · reversible · independently testable · measurable ·
observable · explainable · evidence-driven · production-safe · backward-compatible.**
Nothing weakens transaction guarantees, idempotency, governance, observability, or the
CI quality gates; nothing ships a dashboard with an unsupported metric or a
recommendation without evidence. See the [documentation hub](docs/README.md) for the
full map and [TESTING](docs/TESTING.md) for the coverage-gate discipline.

## What is intentionally out of scope here

Real GCP infrastructure (Terraform apply, Cloud Run, Pub/Sub, Firestore/Cloud SQL
adapters), real mobile-money provider integrations, ASR transcription, and the
search-index service. The seams for all of them exist: storage behind
`kernel/store.js`, providers behind ledger clearing accounts + webhook-shaped methods,
events behind the bus, the SMS transport injectable on `SmsGateway`, and the KV layer
swappable to Redis via `REDIS_URL`.
