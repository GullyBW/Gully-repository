# Native Card Payments & Enterprise Payment Gateway (Phase 4)

Production-grade native debit & credit card payments built on the existing
`PaymentProvider` architecture. Cards join Orange Money, MyZaka, Smega and PayPal as a
first-class rail, while the Ledger remains the **only** source of financial truth and the
platform **never** stores a PAN, CVV, PIN, magnetic-stripe or EMV secret — only
gateway-issued tokens.

- **WS1** `CardPaymentProvider` — `src/payments/card.provider.js`
- **WS2** Gateway abstraction — `src/payments/gateways/{gateway.adapter,adapters,gateway.registry}.js`
- **WS5–WS10** `CardService` lifecycle orchestrator — `src/payments/card.service.js`
- Wiring — `src/container.js`; HTTP — `src/app.js` + `src/admin/admin.routes.js`
- Wallet UI — `src/pwa/app.html`; Admin UI — `src/admin/portal.html`
- SDK — `sdk/js/motse.js`; OpenAPI — `sdk/openapi.json`

## 1. Card Payment Architecture (WS1)

```
                       PaymentService (registry, clearing accounts, reconciliation)
                              │  registerProvider('card') → opens ledger clearing account
        ┌──────────┬─────────┼───────────┬──────────────┐
   OrangeMoney   MyZaka    Smega       PayPal      CardPaymentProvider  ◀── PaymentProvider contract
                                                          │
                                                   GatewayRegistry  (configurable order + failover)
                                                          │
   Stripe · Adyen · Braintree · Peach · DPO · PayGate · (future gateways by config)
```

`CardPaymentProvider extends PaymentProvider`, so it registers with `PaymentService`,
receives a ledger **clearing account** (`provider:card`), and participates in capability
discovery (`GET /v1/payments/providers`) and reconciliation exactly like every other
provider. The richer card lifecycle (authorize → capture, partial capture, void,
subscriptions, saved cards, 3-D Secure) lives in **`CardService`**, a sibling of
`LedgerService`/`EscrowService` — so no existing provider or module changed.

**Card networks:** Visa, Mastercard, American Express, Discover; future networks are added
by configuration (`brands`, per-gateway `supportedBrands`), never by touching business
logic.

## 2. Gateway Architecture (WS2)

`CardPaymentProvider` depends **only** on the `GatewayRegistry`, never on a concrete
gateway. Each `GatewayAdapter` subclass declares a routing profile (brands, currencies,
regional strengths); the base adapter provides a faithful sandbox for the full lifecycle
with fault injection.

- **Selection** is configuration: `MOTSE_GATEWAY_ORDER=stripe,adyen,braintree,peach,dpo,paygate`.
- **Routing** filters candidates by card **brand** + **currency**, then tries them in the
  configured order.
- **Automatic failover**: a *transient* failure (timeout, gateway down — `e.transient`)
  fails over to the next capable gateway and marks the first degraded; a *hard* decline is
  a real answer and is **not** retried. Bounded by `maxAttempts` (default 3).
- A saved card is tied to the gateway that issued its token (`preferred`), and fails over
  from there.

Adding a gateway = a new `GatewayAdapter` subclass + one line in `GATEWAY_CLASSES` — the
provider and every service above it are unchanged.

## 3. Secure Card Processing & Tokenization (WS3)

The PAN never reaches the platform. The client enters card data into the gateway's
**Hosted Checkout / Hosted Payment Fields** (an iframe we never see) and receives an
opaque `hosted_field_ref`, which the platform exchanges for a gateway **token**:

```
POST /v1/cards { hosted_field_ref, brand, last4, exp_month, exp_year }
   → gateway.tokenize(hostedFieldRef) → { token, last4, network_token? }
   → stored: gateway_token, customer_token, network_token, brand, last4, expiry  (NO PAN/CVV)
```

Token kinds: **Payment tokens** (`tok_…`), **Customer tokens** (`cus_…`, the vault reused
across a user's cards on a gateway), **Network tokens** (`ntk_…`, where the network
supports it). There is no PAN/CVV/PIN parameter anywhere in `GatewayAdapter`,
`CardService` or the HTTP surface.

## 4. 3-D Secure (WS4)

3DS 2.x with risk-based authentication. `authenticate3DS` returns a **frictionless**
result (immediate liability shift, `eci`/`cavv`) or a **challenge** (`challenge_required`
+ `acs_url`); the client completes the challenge and `POST /v1/cards/intents/{id}/3ds`
confirms it. Liability-shift metadata (`liability_shift`, `eci`, `cavv`, `version`) is
stored on the intent (`three_ds`). A failed challenge declines the intent.

```
createIntent → authenticate3DS ─ frictionless → authorize immediately
                              └─ challenge → state=requires_action → complete3DS → authorize
```

## 5. Card Payment Lifecycle (WS5)

`Payment Intent → Authorization → Capture / Partial Capture → Void`, and
`Refund / Partial Refund`, `Chargeback → Dispute → Settlement → Reconciliation`. Each
mutation is **authorized, idempotent, ledger-balanced**, and emits **audit + domain event
+ notification + analytics + fraud** signals.

```
 client         CardService                 GatewayRegistry→Adapter        Ledger (BWP truth)
   │ createIntent(amount,currency,card)  │                              │
   │                       ├─ fraud.assess(card_payment)                │
   │                       ├─ 3DS ───────▶ authenticate3DS              │
   │◀── intent(authorized|requires_action)                             │
   │ capture(intentId) ───▶ gw.capture ──▶ captured                    │
   │                       ├──────────────────────────────────────────▶ providerDeposit(clearing→dest, FX→BWP)
   │ refund(intentId) ────▶ gw.refund ───▶ refunded                    │
   │                       ├──────────────────────────────────────────▶ post(dest→clearing)
   │ chargeback (webhook) ▶ gw event  ────▶ dispute opened             │
   │                       ├──────────────────────────────────────────▶ post(dest→clearing)  clawback
```

Money flow: **capture** debits the card clearing account and credits the destination via
`ledger.providerDeposit` (mirrors provider deposits); **refund/chargeback** post the
reversal (dest → clearing). All amounts are BWP thebe after FX; the charged amount +
currency are stored separately. Every posting is balanced — the trial balance stays
`balanced: true` through the entire lifecycle.

**Dispute** flow: `processChargeback` opens a dispute (`open`), evidence is submitted
(`evidence_submitted`), and `resolveDispute('won'|'lost')` either re-credits the
destination (won) or leaves the clawback in place (lost).

**Settlement / Reconciliation**: `reconcile(date)` pulls each gateway's settlement file,
converts foreign-currency lines back to BWP, and matches them against the clearing-account
postings via `ledger.reconcile`, recording a settlement run with any variance.

## 6. Saved Payment Methods (WS6)

Token-only, masked-only. `POST /v1/cards` saves a card; the wallet displays
`Visa **** **** **** 1234` with a brand logo (`/assets/card/{brand}.svg`). Supports
default card, nickname, expiry updates (pushed to the gateway), **token replacement**
(swap the token, keep the card id), delete (soft-delete + forget token + promote next
default), and multi-device sync (server-side state read by every device). The full card
number is never exposed; read models return `gateway_token_masked` = `****` + last-4 of
the token, never the usable token.

## 7. Subscriptions & Recurring (WS7)

`supportsRecurringPayments()` / `supportsSubscriptions()` are `true`. Plans: monthly
donations, annual memberships, tourism, learning. Intervals: daily/weekly/monthly/annual.
`runBilling()` charges due cycles (create intent → capture); a failed charge goes
`past_due` and **retries within a grace window**, then **cancels**. Also
pause/resume/cancel, **proration** on mid-cycle plan changes, and future billing schedules
(`next_charge_at`).

## 8. Multi-Currency (WS8)

BWP, USD, EUR, GBP, ZAR, NAD, KES, TZS, UGX (future currencies by config). Each intent
stores **original currency, settlement currency (BWP), exchange rate, FX timestamp,
provider reference, and converted amount**. The Ledger stays single-currency (BWP thebe);
capture converts the charged amount back to BWP, and reconciliation converts settlement
lines back to BWP before matching.

## 9. Fraud Detection (WS9)

Card-specific checks plug into the **existing** fraud engine (`fraud.register`): card
testing (many small charges → **deny**), BIN abuse (many BINs → review), duplicate card
(one token across accounts → review), high-risk countries, repeated chargebacks, and
suspicious refunds (large refund minutes after capture → review). Velocity, impossible
travel and SIM-swap heuristics come from the base engine. Scores drive additional
verification, manual review (the fraud review queue), temporary holds and **transaction
denial** (a denied assessment throws `PERMISSION_DENIED` and no intent is created).

## 10. PCI DSS Readiness (WS10)

- **Token-only storage** — no PAN/CVV/PIN/track/EMV, ever.
- **Sensitive-data redaction** — intents are redacted at the service boundary
  (`_redactIntent`); analytics carry no card/PII data.
- **Secure webhook validation** — HMAC-SHA256 over `${timestamp}.${nonce}.${rawBody}`,
  rotation-safe (current + previous secret), replay-protected (timestamp window + nonce),
  constant-time compare (a malformed signature is rejected, never a 500).
- **Key rotation** — gateway/provider webhook secrets rotate on a quarterly policy via the
  assurance service.
- **Security headers, encrypted secrets, audit logging, access controls, least privilege**
  — inherited from the platform edge (`helmet`, `SecretManager`, `AuditLog`, role checks).
- **Compliance reporting** — `GET /v1/admin/security/scorecard` + card analytics.

The system is designed to deploy **behind a PCI DSS–compliant gateway with no
architectural change**: card data is captured by the gateway's hosted fields and the
platform only ever holds tokens.

## 11. Administration Portal (WS11)

Admin **Cards** tab (`/admin`) and routes under `/v1/admin/cards/*`:

| Feature | Endpoint |
| --- | --- |
| Transaction Explorer (redacted) | `GET /cards/intents`, `GET /cards/intents/:id` |
| Refund Manager | `POST /cards/intents/:id/refund` |
| Chargeback / Dispute Management | `POST /cards/intents/:id/chargeback`, `GET /cards/disputes`, `POST /cards/disputes/:id/{evidence,resolve}` |
| Settlement Dashboard | `POST /cards/reconcile`, `GET /cards/settlements` |
| Gateway Status / Health / Failover | `GET /cards/gateways`, `POST /cards/gateways/{order,probe}`, `POST /cards/gateways/:name/health` |
| Provider Configuration | `GET /cards/config` |
| Card Analytics | `GET /cards/analytics` |
| Subscriptions billing | `POST /cards/subscriptions/run-billing` |
| Fraud Review Queue | `GET /v1/admin/finance/fraud-reviews` (shared engine) |

## 12. Customer Wallet (WS12)

PWA **Cards** tab (`/app`): view/add/remove cards, choose default, PCI-safe add (hosted
field ref only), payment history, refunds/disputes (via intent state), receipts, and
subscription management (pause/resume/cancel). Routes: `/v1/cards*`, `/v1/cards/intents*`,
`/v1/cards/subscriptions*`.

## 13. Analytics (WS13)

`GET /v1/admin/cards/analytics` (and a `cards` section in the analytics dashboard) — all
aggregates, **no PII / no card data**: approval / decline / chargeback / refund rates,
gateway latency & success rate (from the failover routing log), currency & brand usage,
monthly recurring revenue, average transaction value, abandoned checkout, authorization
failures, and fraud detections.

## 14. SDK & OpenAPI (WS14)

`sdk/js/motse.js` `MotseClient` card methods: `saveCard`, `listCards`, `updateCard`,
`setDefaultCard`, `replaceCardToken`, `deleteCard`, `createCardIntent`, `completeCard3ds`,
`captureCard`, `voidCard`, `refundCard`, `cardIntents`, `cardIntent`, `createSubscription`,
`subscriptions`, `pause/resume/cancel/changeSubscription`, `cardGateways` (discovery), and
`MotseClient.verifyCardWebhook` (gateway HMAC verification). `sdk/openapi.json` is
regenerated with `npm run motse:openapi` and includes every `/v1/cards*` path.

## 15. Testing (WS15)

`tests/cards-gateway.test.js`, `tests/cards.test.js`, `tests/cards-http.test.js` — 101 new
tests covering authorization, capture/partial capture, void, refund/partial refund,
chargeback, dispute, webhook replay/duplicate/forgery, gateway failover/timeout/retry, 3DS
challenge & frictionless, saved cards, recurring billing (retry/grace/cancel), fraud
scenarios, settlement, currency conversion, ledger balancing, admin portal, wallet, SDK
and the provider contract. Coverage gate: `npm run motse:coverage:p4` — **≥95%
statements, ≥95% lines, ≥90% branches** on all new components. All existing suites (392
Motse + 131 Tirelo) stay green.

## 16. Gateway Configuration & Deployment

| Env var | Effect |
| --- | --- |
| `MOTSE_GATEWAY_ORDER` | Comma list — selection/failover order (default all six) |
| `MOTSE_GATEWAY_<NAME>_API_KEY` / `_API_SECRET` | Live credentials → `live` mode (absent → sandbox) |
| `MOTSE_GATEWAY_<NAME>_BRANDS` / `_CURRENCIES` | Narrow a gateway's routing profile without code |

Going live is configuration, not code: provide gateway credentials and the sandbox
adapters become live. Deploy behind a PCI DSS–compliant gateway; the platform stores only
tokens, so its PCI scope is minimised (SAQ A posture).

## Security Model (summary)

Every card mutation **requires authorization** (member session or `platform_admin`), is
**idempotent** (Idempotency-Key / idempotency-keyed ledger postings), **preserves ledger
balance** (double-entry, single source of truth), **generates audit entries**, **emits
domain events**, **feeds fraud + analytics**, and **maintains backward compatibility** —
no existing provider, route, or test changed behaviour.
