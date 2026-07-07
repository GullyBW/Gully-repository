# Payments — Botswana Provider Integrations

Three providers ship in Phase 1 behind one contract (`src/payments/base.provider.js`):

| Provider | key | C2B | B2C | Operator refunds |
| --- | --- | --- | --- | --- |
| Orange Money | `orange_money` | ✔ | ✔ | ✔ |
| Mascom MyZaka | `myzaka` | ✔ | ✔ | ✖ (use B2C payout) |
| BeMobile Smega | `smega` | ✔ | ✔ | ✔ |

Every provider implements: `initiateCollection`, `initiatePayout`, `initiateRefund`,
`verifyTransaction`, `getStatus`, `balanceCheck`, `fetchStatement`, `parseWebhook`.
Business logic lives in `PaymentService` and the Ledger — a provider only translates
operator dialect.

## Sandbox vs live

Without credentials a provider runs in **sandbox mode**: it simulates the operator
(pending transactions, signed webhooks via `sandboxResolve`, daily statements), so
the complete flow — initiate → webhook → ledger posting → reconciliation — runs
end-to-end in dev and CI. Going live is configuration:

```
MOTSE_ORANGE_API_KEY / MOTSE_ORANGE_API_SECRET / MOTSE_ORANGE_MERCHANT_ID
MOTSE_MYZAKA_API_KEY / MOTSE_MYZAKA_API_SECRET / MOTSE_MYZAKA_MERCHANT_ID
MOTSE_SMEGA_API_KEY  / MOTSE_SMEGA_API_SECRET  / MOTSE_SMEGA_MERCHANT_ID
```

## Provider onboarding checklist (adding a 4th provider)

1. Subclass `PaymentProvider`; set the capability matrix; override `parseWebhook`
   and `_webhookBody` for the operator dialect.
2. Register it in `src/container.js` (`payments.registerProvider(...)`) — this also
   opens its ledger clearing account.
3. Exchange webhook signing secrets; store via `SecretManager` name
   `webhook:<provider>` (rotate from the admin portal, Security tab).
4. Point the operator's callback at `POST /v1/payments/webhooks/<provider>` with
   headers `X-Motse-Signature` (HMAC-SHA256 of `ts.nonce.rawBody`),
   `X-Motse-Timestamp`, `X-Motse-Nonce`.
5. Schedule `payments.reconcileDaily(provider, date)` nightly; wire the statement
   fetch in `fetchStatement`.
6. Add the provider to the `describe.each` list in `tests/payments.test.js` — the
   whole lifecycle suite runs against it unchanged.

## Money-safety properties (all test-asserted)

- Webhooks: HMAC over exact raw bytes, rotating secrets (current+previous verify),
  ±5-minute timestamp window, nonce replay cache, one outcome per provider ref
  (duplicates return `{duplicate:true}` without touching the ledger), amount must
  match the intent.
- Payout failure automatically reverses the clearing posting — funds return to the
  member, the payout lands in the admin "failed payouts" queue.
- Transient dispatch failures retry with exponential backoff (2s→32s, 5 attempts)
  then dead-letter; dead letters degrade `/health/ready` and are drainable from the
  portal.
- Nightly reconciliation matches ledger postings against operator statements;
  missing/duplicated/malformed lines produce a variance > 0, which pages platform
  admins (Sev-1 per the engineering doc §9.2) and is stored for the ledger explorer.
- The global trial balance is asserted zero after every flow.

## Troubleshooting payments

| Symptom | Check | Fix |
| --- | --- | --- |
| Intent stuck `pending_provider` | operator dashboard; `POST /v1/admin/finance/payments/:id/verify` | verify() syncs from `verifyTransaction` |
| Intent `retrying` | `/v1/admin/dashboard` retry queue depth | `POST /v1/admin/finance/retries/drain` (scheduler does this in prod) |
| Webhook 403 `bad_signature` | secret version mismatch | re-share secret or rotate; previous version stays valid for one rotation |
| Webhook 403 replay | operator retrying with same nonce after >10min | operator should re-sign; duplicates of settled refs are safe (200 duplicate) |
| Variance > 0 | `/v1/admin/ledger/reconciliation-runs` unmatched lines | investigate each line; never adjust the ledger by hand — post a correcting entry through a service |
