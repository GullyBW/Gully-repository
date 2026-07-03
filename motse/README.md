# Motse — Platform Implementation

Reference implementation of **Motse — System & Engineering Documentation v1.0**: a
ten-module civic, cultural, and financial platform for Botswana, organised around three
platform primitives that every module consumes — a **verified identity graph**, a
**unified money movement service (double-entry ledger)**, and a **governance/audit
engine**.

```bash
npm run motse:test    # 7 suites / 54 tests
npm run motse:start   # boots the modular monolith on :4100 (/v1, /health)
```

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
