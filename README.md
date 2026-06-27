# Tirelo Payment Service

Payment system for the **Tirelo Services** application (Local Vendor Finder — on-demand
plumbers, electricians, cleaners, traditional healers, etc.). It exposes a small,
self-contained REST API and a **pluggable payment-gateway architecture** so the rest of
the Tirelo backend (bookings, notifications) can charge customers and reconcile payments
without knowing anything about individual providers.

Built to match the project plan's stack: **Node.js + Express + MongoDB (Mongoose)**.

## Supported payment methods / gateways

| Method          | `method` value   | Type                 | Notes                                              |
| --------------- | ---------------- | -------------------- | -------------------------------------------------- |
| Orange Money    | `orange_money`   | Mobile money (USSD)  | OAuth + web-payment push, async webhook            |
| Mascom MyZaka   | `myzaka`         | Mobile money (USSD)  | API-key collection request, async webhook          |
| Card            | `card`           | Card gateway         | Hosted checkout (DPO / Flutterwave / Stripe-style) |
| Bank transfer   | `bank_transfer`  | Manual               | Returns bank details + reference; admin-confirmed  |

Every gateway implements the same `BaseProvider` contract
(`src/providers/base.provider.js`). Adding a new one (e.g. PayPal) is a single new
subclass registered in `src/providers/index.js` — no changes to routes, controllers or
the service layer.

### Sandbox mode

Each gateway runs in **sandbox mode** until real credentials are supplied via environment
variables, so the entire flow (create → provider push → webhook → settlement) is fully
exercisable without live accounts. Going live is a configuration change, not a code change.

## Architecture

```
HTTP ─▶ routes ─▶ controller ─▶ PaymentService ─▶ Provider (gateway adapter)
                                      │
                                      ▼
                          Transaction repository  (Mongo  | in-memory)
```

- **`src/providers`** — gateway adapters (one per payment method) behind a common interface.
- **`src/services/payment.service.js`** — the single integration point: create, fetch,
  list, cancel, and process provider webhooks. Storage-agnostic.
- **`src/repositories`** — pluggable persistence. `MongoTransactionRepository` in production;
  `MemoryTransactionRepository` for tests / no-DB runs.
- **`src/domain/transaction.js`** — pure status-transition & serialization rules shared by
  every repository.
- Amounts are stored in **minor units** (thebe) to avoid floating-point errors.

## API

Base path: `/api/payments`

| Method & path                       | Description                                            |
| ----------------------------------- | ----------------------------------------------------- |
| `GET  /methods`                     | List supported payment methods                        |
| `POST /`                            | Create & initiate a payment                           |
| `GET  /:reference`                  | Fetch a payment by reference                           |
| `GET  /?customerId=...`             | List a customer's payments                             |
| `POST /:reference/cancel`           | Cancel a non-completed payment                         |
| `POST /webhook/:method`             | Provider callback that settles the payment            |

Plus `GET /health`.

### Create a payment

```bash
curl -X POST http://localhost:4000/api/payments \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": "cust_123",
    "bookingId": "book_456",
    "amount": 15000,                # 150.00 BWP, in thebe
    "method": "orange_money",
    "payerMsisdn": "26771000000",
    "description": "Plumbing call-out"
  }'
```

Response:

```json
{
  "success": true,
  "data": {
    "reference": "TRL-7F3A9CLK8Z2",
    "method": "orange_money",
    "status": "processing",
    "amount": 15000,
    "currency": "BWP",
    "providerMeta": { "sandbox": true, "instructions": "Approve the Orange Money prompt..." }
  }
}
```

`payerMsisdn` is required for mobile-money methods. A `card` payment returns a
`providerMeta.checkoutUrl` to redirect the customer to; a `bank_transfer` returns the
account details and a `paymentReference` to quote.

### Settlement (webhook)

Providers call back asynchronously when the customer completes (or fails) payment:

```bash
curl -X POST http://localhost:4000/api/payments/webhook/orange_money \
  -H 'Content-Type: application/json' \
  -H 'x-signature: <hmac-sha256 of the raw body>' \
  -d '{ "order_id": "TRL-7F3A9CLK8Z2", "status": "SUCCESS", "txnid": "OM123" }'
```

Webhooks are **signature-verified** (HMAC-SHA256, constant-time compare) and
**idempotent** — replaying a webhook for an already-settled payment is a safe no-op.

### Payment lifecycle

`pending → processing → succeeded | failed | cancelled | refunded`

`succeeded`, `failed`, `cancelled` and `refunded` are terminal. Every transition is stored
as an audit event on the transaction for reconciliation.

## Getting started

```bash
npm install
cp .env.example .env        # fill in provider credentials when going live
npm run dev                 # needs a local MongoDB (see MONGODB_URI)
```

## Tests

```bash
npm test
```

The suite runs against the in-memory repository, so **no MongoDB is required**. It covers
creating payments across all gateways, webhook settlement, signature verification,
idempotency, cancellation rules and listing.

## Integrating into the Tirelo backend

This module can run as its own microservice (`npm start`) or be mounted inside the main
Express app via `createApp()` (`src/app.js`). Either way, application code should depend
only on `PaymentService`:

```js
const PaymentService = require('./src/services/payment.service');

// When a booking is confirmed:
const payment = await PaymentService.createPayment({
  customerId, bookingId, providerId,
  amount, method: 'card',
});
// Redirect / push the customer using payment.providerMeta, then react to the
// webhook (or poll PaymentService.getByReference) to mark the booking paid.
```
