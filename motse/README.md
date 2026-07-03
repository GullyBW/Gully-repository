# Motse — Platform Implementation

Reference implementation of **Motse — System & Engineering Documentation v1.0**: a
ten-module civic, cultural, and financial platform for Botswana, organised around three
platform primitives that every module consumes — a **verified identity graph**, a
**unified money movement service (double-entry ledger)**, and a **governance/audit
engine**.

```bash
npm run motse:test         # 30 suites / 291 tests
npm run motse:coverage     # Phase-1/2 coverage gate (95/95/90)
npm run motse:coverage:p3  # Phase-3 coverage gate (95/95/90)
npm run motse:start        # :4100 — /v1 API, /admin, /app PWA, /developers, /metrics
npm run motse:bench        # in-process performance benchmark
npm run motse:load         # HTTP load test against a running server
npm run motse:resilience   # load & resilience simulation (10k/50k/100k)
npm run motse:ai-eval      # AI quality report (thresholded)
npm run motse:security-scan / motse:secret-scan   # dependency + secret scans
npm run motse:openapi      # regenerate sdk/openapi.json
```

## Phase 3 — production readiness, PayPal & extensibility

| Workstream | Where | Notes |
| --- | --- | --- |
| PayPal + capability-based payments | `src/payments/paypal.provider.js`, `base.provider.js` | orders/authorize/capture, partial refunds, chargebacks, multi-currency FX→BWP; capability discovery ([PAYPAL](docs/PAYPAL.md)) |
| Configurable workflow engine | `src/workflow/` | 8 seeded flows as data; N-of-M, parallel, timeouts, escalation, delegation ([WORKFLOW](docs/WORKFLOW.md)) |
| Plugin architecture | `src/plugins/` | signed, permission-sandboxed, hot enable/disable, `/v1/ext/*` ([PLUGINS](docs/PLUGINS.md)) |
| Live pilot framework | `src/pilot/` | morafe enrollment, rollback, feedback, 7-metric live dashboard ([PILOTS](docs/PILOTS.md)) |
| AI evaluation framework | `src/ai/evaluation/` | gold datasets, thresholded quality reports ([AI](docs/AI.md)) |
| Security assurance + scorecards | `src/security/scorecard.js`, `scripts/secret-scan.js` | graded runtime scorecard, pen-test suite, secret/dependency scans |
| Operations Center | `src/ops/ops.service.js` | unified 13-panel view, diagnostics, maintenance scheduling |
| Load & resilience testing | `scripts/resilience-test.js` | user-scale + spikes + provider failure + failover, ledger-integrity asserted |
| Public SDK + developer platform | `sdk/`, `src/developer/` | JS/TS SDK, OpenAPI, API-key apps, signed webhooks ([SDK](sdk/README.md)) |
| National rollout | `deploy/motse/terraform/multiregion.tf`, Helm blue/green, `src/i18n/` | multi-region, blue/green, canary, localization ([NATIONAL-ROLLOUT](docs/NATIONAL-ROLLOUT.md)) |
| Flutter CI validation | `.github/workflows/motse-flutter.yml` | analyze + test + build + compatibility report |

Coverage on Phase-3 components: 98.9% statements / 90.3% branches / 99.8% lines.

## Phase 2 — national-platform readiness

| Workstream | Where | Verified |
| --- | --- | --- |
| Flutter app (offline-first, all modules) | [`mobile_flutter/`](mobile_flutter) | Dart contract tests; **needs `flutter analyze && flutter test` on adoption (no SDK here)** |
| PWA (desktop/mobile/tablet) | `src/pwa/` → `/app` | Playwright browser run + jest |
| Infrastructure as code | [`../deploy/motse/`](../deploy/motse) | CI builds+smokes the image; helm/terraform validate on adoption |
| Observability | `deploy/motse/observability/` (10 Grafana dashboards + alert rules) | generator run; alerts reviewed |
| Analytics (PII-free) | `src/analytics/` + portal Analytics tab | jest incl. a no-user-ids-in-output assertion |
| Security assurance | `src/security/assurance.service.js` + Security tab | jest: ATO, impossible travel, SIM-swap, abuse, rotation |
| Pilot management + flags | `src/pilot/` + Pilots tab | jest: stage gates, per-ward flag rollout, onboarding |
| AI providers (through the safety gate) | `src/ai/providers/` | jest: real local providers + cloud adapters w/ fake transports |
| Integrations (bank/gov-ID/GIS/email/WhatsApp/calendar) | `src/integrations/` | jest incl. notification bridging + ICS |
| Ops tooling (incidents, maintenance, backups/DR, capacity) | `src/ops/` + Ops tab | jest incl. a full restore drill on a fresh platform |

Docs: [MOBILE](docs/MOBILE.md) · [INFRASTRUCTURE](docs/INFRASTRUCTURE.md) ·
[OPERATIONS (runbooks)](docs/OPERATIONS.md) · [ANALYTICS](docs/ANALYTICS.md) ·
[PILOTS](docs/PILOTS.md) · [AI](docs/AI.md) · [SECURITY](docs/SECURITY.md) ·
[API](docs/API.md) · [PAYMENTS](docs/PAYMENTS.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) ·
[TESTING](docs/TESTING.md) · [ADMIN-PORTAL](docs/ADMIN-PORTAL.md)

## Phase 1 — production readiness

Built on top of the core platform (docs in [`docs/`](docs)):

- **Administration portal** — `/admin` (self-contained SPA) + `/v1/admin` API:
  dashboard, identity management, councils & governance (Ring-3 freezes, elections,
  disputes), read-only ledger explorer, heritage administration (flagged queue,
  consents, deletion receipts, audited restricted view), financial administration
  (escrow monitoring, milestone queue, failed payouts, fraud reviews), audit
  explorer with inclusion-proof verification and CSV export.
  → [docs/ADMIN-PORTAL.md](docs/ADMIN-PORTAL.md)
- **Botswana payments** — Orange Money, Mascom MyZaka, BeMobile Smega behind one
  `PaymentProvider` contract: C2B, B2C, refunds (where supported), HMAC-signed
  webhooks with replay/duplicate defences, retry queue with dead-lettering, daily
  reconciliation with Sev-1 variance paging. Sandbox mode without credentials.
  → [docs/PAYMENTS.md](docs/PAYMENTS.md)
- **Notifications** — event-driven, five channels (in-app/SMS/push/email/WhatsApp
  adapter slot), per-category preferences, quiet hours, civic-emergency exemption.
- **Monitoring** — Prometheus `/metrics`, `/health/ready`, structured JSON logs
  with trace ids, ledger/escrow/payment/queue/sync gauges.
- **Security hardening** — rate limiting, secret rotation, webhook signing, replay
  protection, fraud hooks, device trust, security headers, denial auditing, OWASP
  review. → [docs/SECURITY.md](docs/SECURITY.md)
- **Search** — event-maintained inverted index over all ten modules; restricted
  content fails closed out of the index; member-scoped family search.
- **AI foundation** — provider interfaces only (transcription, translation,
  summarization, knowledge search, tagging, recommendations) behind a safety gate
  that enforces `no_derivatives_no_training` before any provider sees content.

Coverage on Phase-1 components: 91.7% statements / 95.1% lines.

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
├── gateway/          USSD menu state machine + SMS keywords (P9 feature-phone parity)
├── sync/             offline outbox replay (ordered per aggregate, exactly-once)
└── app.js            API gateway: auth, Idempotency-Key enforcement, problem details
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
```

## What is intentionally out of scope here

Flutter/React clients, real GCP infrastructure (Terraform, Cloud Run, Pub/Sub,
Firestore/Cloud SQL adapters), real mobile-money provider integrations, ASR
transcription, and the search-index service. The seams for all of them exist: storage
behind `kernel/store.js`, providers behind ledger clearing accounts + webhook-shaped
methods, events behind the bus, and the SMS transport injectable on `SmsGateway`.

*Build once. Amortize ten times. Betray no one's trust.*
