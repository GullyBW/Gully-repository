# PayPal Integration & Capability-Based Payments (Phase 3, WS1/WS2)

## Capability discovery (WS2)

Business logic never hardcodes provider assumptions. Every provider declares its
capabilities and business code queries them:

```
provider.supportsRefunds()       supportsPartialRefunds()   supportsRecurringPayments()
        supportsSubscriptions()  supportsEscrow()           supportsMultiCurrency()
        supportsPayouts()        supportsWebhooks()         supportsChargebacks()
        supportedCurrencies()    supportedCountries()
```

Discovery endpoints:
- `GET /v1/payments/providers` — the full capability matrix.
- `GET /v1/payments/select?currency=USD&country=US&needs=partial_refunds` — returns a
  provider name that satisfies the requirement set, or null. Adding a provider never
  requires touching `PaymentService` or any module.

| Capability | Orange/MyZaka/Smega | PayPal |
| --- | --- | --- |
| currencies | BWP | USD, EUR, GBP, ZAR, BWP |
| partial refunds | ✖ (MyZaka: no refunds) | ✔ |
| chargebacks | ✖ | ✔ |
| recurring / subscriptions | ✖ | ✔ |
| multi-currency | ✖ | ✔ |

The `PaymentService` uses these predicates instead of provider names: a partial refund
is allowed only if `provider.supportsPartialRefunds()`, a non-BWP collection only if
`provider.supportsMultiCurrency()`, etc.

## PayPal lifecycle (WS1)

```
 client            PaymentService         PayPalProvider          Ledger
   │ createOrder / collect (currency)  │                        │
   ├──────────────────────────────────▶ createOrder → CREATED   │
   │◀── intent {provider_ref, approve_url}                       │
   │  buyer approves at approve_url                              │
   │ POST /v1/payments/paypal/orders/{id}/capture               │
   │                                   ├─ captureOrder → signed webhook
   │                                   ├─ processWebhook (verify sig/replay/dupe/amount)
   │                                   ├────────────────────────▶ providerDeposit (FX→BWP)
   │◀── intent: completed                                        │
```

- **Multi-currency**: PayPal collects in USD/EUR/GBP/ZAR; the amount is converted to BWP
  thebe at a declared FX rate **stored on the intent** (`fx_rate`, `charged_amount_minor`),
  so the ledger stays single-currency and every conversion is auditable. Reconciliation
  converts statement lines back to BWP before matching.
- **Authorize vs capture**: `POST …/authorize` places a hold (AUTHORIZE intent); `capture`
  moves the money. Immediate flows use CAPTURE.
- **Refunds & partial refunds**: `POST /v1/payments/intents/{id}/refund` with an optional
  `amount_minor`. Cumulative refunds are capped at the original; a partial requires the
  capability. The original intent moves to `partially_refunded` until fully refunded.
- **Chargebacks**: a `CUSTOMER.DISPUTE.CREATED` / `PAYMENT.CAPTURE.REVERSED` webhook (or
  the admin dispute console) reverses the ledger deposit and opens a fraud review. Handled
  before the duplicate/amount checks since it references the original transaction.

## Sandbox vs production

Without `MOTSE_PAYPAL_API_KEY` the provider runs in sandbox: `createOrder`/`captureOrder`/
`sandboxResolve`/`sandboxChargeback` simulate the operator with signed webhooks, so the
full order → capture → refund → chargeback → reconciliation loop is exercisable in CI.
Going live is configuration (`MOTSE_PAYPAL_API_KEY` + credentials); the HTTP dispatch
slots behind the same methods.

The Ledger remains the only financial source of truth — no provider mutates a balance.
