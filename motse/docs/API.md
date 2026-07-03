# API Reference (Phase 1 surface)

Conventions (engineering doc §7.1): JSON over HTTPS, URI versioning `/v1/`,
cursor pagination (`page_token`/`next_page_token`, `page_size` ≤ 100), field masks
(`?fields=a,b`), mandatory `Idempotency-Key` header on every mutation (48 h dedupe;
replays return the original response with `Idempotent-Replay: true`), problem-details
errors `{ code, message, domain_reason, retryable, trace_id }` using the canonical
codes (Appendix B + `RATE_LIMITED`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, …).
Auth: `Authorization: Bearer <access>` + `X-Device-Id` (tokens are device-bound).

## Core (pre-existing, unchanged)

```
POST /v1/identity/otp | /v1/identity/otp/verify | /v1/identity/sessions/refresh
POST /v1/identity/users/{id}/ward-endorsement
POST /v1/heritage/consents | /v1/heritage/items | …/publish | …/validate | …/contest
GET  /v1/heritage/items/{id} | /v1/heritage/search | /v1/morafe/{id}/feed
POST /v1/media/uploads | …/chunks | …/complete          GET /v1/media/{id}/url
POST /v1/ledger/accounts | /v1/ledger/transfers          GET …/balance
POST /v1/kgotla/wards | …/notices | …/letsemas | /v1/kgotla/letsemas/{id}/join | …/alerts
POST /v1/kgetsi/campaigns | …/endorse | …/live | …/contributions
POST /v1/kgetsi/campaigns/{id}/milestones/{m}/evidence | …/approve | …/release
POST /v1/loeto/experiences | /v1/loeto/bookings | …/settle
POST /v1/puo/courses | …/lessons | /v1/puo/threads | …/corrections
POST /v1/trusts | …/resolutions | …/resolutions/{r}/sign
GET  /v1/mafelo/packs/{district}/manifest
GET  /v1/public/campaigns/{id}/ledger | /v1/public/trusts/{id}/treasury
GET  /v1/public/audit/{objectRef} | …/proof/{entryId}
POST /v1/sync/outbox | /v1/gateway/ussd/session | /v1/gateway/sms/inbound
GET  /health
```

## Phase 1 — user-facing

```
POST /v1/payments/collections            {provider, msisdn, amount_minor, dest_account_id}
POST /v1/payments/payouts                {provider, source_account_id, msisdn, amount_minor}
POST /v1/payments/intents/{id}/refund
GET  /v1/payments/intents/{id}
POST /v1/payments/webhooks/{provider}    operator callback (HMAC headers, no Idempotency-Key)
GET  /v1/notifications                   my inbox (paginated)
POST /v1/notifications/{id}/read
PUT  /v1/notifications/preferences/{category}   {channels:{push:false,…}}
GET  /v1/search?q=…&types=heritage,village&limit=20
POST /v1/identity/devices/signals        {rooted|jailbroken|emulator}
GET  /v1/ai/capabilities
POST /v1/ai/{capability}                 404 until a provider is registered
GET  /health/ready | /metrics
```

## Phase 1 — administration (`platform_admin(platform)` + L3)

```
POST /v1/admin/bootstrap                              X-Bootstrap-Token (deploy-time)
GET  /v1/admin/dashboard
GET  /v1/admin/users?query&level&suspended            GET /v1/admin/users/{id}
POST /v1/admin/users/{id}/level|suspend|reinstate|institution|roles|roles/revoke|sessions/revoke
POST /v1/admin/sessions/{sid}/revoke                  GET /v1/admin/otp-audit
GET  /v1/admin/councils | /v1/admin/elections | /v1/admin/disputes | /v1/admin/resolutions
POST /v1/admin/councils | …/{id}/seats | …/{id}/elections
POST /v1/admin/seats/{id}/freeze|unfreeze
POST /v1/admin/elections/{id}/close | /v1/admin/disputes/{id}/escalate|resolve
GET  /v1/admin/ledger/journal?ref&purpose | trial-balance | accounts | escrows
GET  /v1/admin/ledger/split-templates | reconciliation-runs | rejections | payouts?state | idempotency
GET  /v1/admin/heritage/flagged | consents | deletions | restricted (audited)
POST /v1/admin/heritage/deletion-sweep
GET  /v1/admin/finance/escrows | milestones/pending | payments | payouts/failed | fraud-reviews
POST /v1/admin/finance/payments/{id}/verify | reconcile | retries/drain | fraud-reviews/{id}/close
GET  /v1/admin/audit/object/{ref} | actor/{ref} | proof/{ref}/{entryId} | export?prefix&format=csv
GET  /v1/admin/security/denials | secrets | permission-audit
POST /v1/admin/security/secrets/{name}/rotate | /v1/admin/search/reindex
GET  /v1/admin/notifications/stats
```

Guarantees: ledger routes are read-only (no write endpoint exists); audit records
are immutable (no mutation endpoint exists); the restricted heritage view returns
metadata only, is audited per access, and has no export counterpart.
