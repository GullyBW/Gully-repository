# Deployment, Operations & Disaster Recovery

## Running

```bash
npm ci
npm run motse:start          # boots on :4100 (MOTSE_PORT to override)
npm run motse:test           # 12 suites / 126 tests
```

Endpoints: `/v1/*` (API), `/admin` (portal), `/health` (liveness),
`/health/ready` (readiness: ledger balanced, providers registered, retry queue
healthy, event bus up), `/metrics` (Prometheus text format).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOTSE_PORT` | `4100` | HTTP port |
| `MOTSE_SECRET` | `motse-dev-secret` | token/media/pack signing root — SET IN PROD |
| `MOTSE_ADMIN_BOOTSTRAP_TOKEN` | dev: `dev-bootstrap-token`; prod: unset (disabled) | one-time admin bootstrap |
| `MOTSE_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`/`silent` |
| `MOTSE_RATE_CAPACITY` | `300` | rate-limit bucket size per identity |
| `MOTSE_RATE_REFILL` | `5` | tokens/second refill |
| `MOTSE_ORANGE_API_KEY` (+`_API_SECRET`, `_MERCHANT_ID`) | unset → sandbox | Orange Money live credentials |
| `MOTSE_MYZAKA_API_KEY` (+…) | unset → sandbox | MyZaka live credentials |
| `MOTSE_SMEGA_API_KEY` (+…) | unset → sandbox | Smega live credentials |

## Scheduled jobs (wire to Cloud Scheduler / cron)

| Job | Call | Cadence |
| --- | --- | --- |
| Payment retry drain | `payments.drainRetries()` / `POST /v1/admin/finance/retries/drain` | 1 min |
| Daily reconciliation | `payments.reconcileDaily(provider, date)` per provider | nightly |
| Deletion sweep | `media.runDeletionSweep()` / `POST /v1/admin/heritage/deletion-sweep` | daily |
| Search reindex (belt & braces; events keep it live) | `POST /v1/admin/search/reindex` | hourly |

## Monitoring

Scrape `/metrics`. Key series: `motse_http_requests_total`,
`motse_http_request_duration_ms_*`, `motse_domain_events_total`,
`motse_payments_total`, `motse_webhooks_rejected_total`,
`motse_ledger_trial_balance_minor` (**alert if ≠ 0 — Sev-1**),
`motse_reconciliation_variance_total` (**Sev-1**), `motse_payment_retry_queue_depth`,
`motse_payment_dead_letters`, `motse_escrows_stuck`, `motse_authz_denials_total`,
`motse_outbox_mutations_applied`, `motse_notifications_total`.

Structured JSON logs carry `trace_id` end-to-end; pass `X-Trace-Id` from clients to
correlate. `/health/ready` returning 503 blocks canary promotion.

## Disaster recovery

This tier is stateless above its stores; DR is a property of the store bindings
(engineering doc §16: Ledger on Postgres PITR, RPO ≤ 5 min / RTO ≤ 1 h; engagement
data multi-region, RPO ≤ 1 h / RTO ≤ 4 h).

Recovery order and verification:
1. Restore the Ledger store; boot; check `/health` `trial_balance.balanced == true`
   and `/v1/admin/ledger/trial-balance`.
2. Replay the event log (`bus.replay()`) to rebuild projections (public campaign
   ledgers, search index — or `POST /v1/admin/search/reindex`).
3. Run reconciliation against every provider for the gap window; variances page.
4. Verify audit chains for high-value objects
   (`GET /v1/admin/audit/object/:ref` → `verification.valid`).
5. Drain the payment retry queue; `verify()` any intents stuck `pending_provider`
   (operator lookup is the source of truth for in-flight money).

Quarterly restore drills are calendared, not aspirational (§16); the repatriation
export path doubles as the tested backup path.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| 429s | rate limiter — raise `MOTSE_RATE_CAPACITY`, check per-actor keying |
| 401 after admin action | expected: suspension/session-revocation kills tokens; sign in again |
| `/health/ready` 503 | body lists the failing check (dead letters, imbalance…) |
| Missing notifications | `/v1/admin/notifications/stats` failed counts; check adapter transports |
| Restricted item visible anywhere public | treat as Sev-1 cultural incident (§16): freeze via dispute, audit `heritage:<id>` chain, run the leak tests |
| Payment stuck | see PAYMENTS.md troubleshooting table |
