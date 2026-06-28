# Tirelo Services

**Tirelo Services** is a Local Vendor Finder — it connects customers with on-demand local
service providers (plumbers, electricians, cleaners, traditional healers, etc.), with
booking and in-app payment.

This repository contains:

- **`src/`** — the backend API (**Node.js + Express + MongoDB**): user authentication,
  bookings, and a payment system with a **pluggable payment-gateway architecture**.
- **`mobile/`** — the cross-platform mobile app (**Ionic + Angular**) that customers and
  providers use to register, book services and pay.

Built to match the project plan's stack.

## Backend modules

| Module        | Path                        | What it does                                            |
| ------------- | --------------------------- | ------------------------------------------------------- |
| Auth          | `src/services/auth.service` | Register/login, JWT issuance, role-based access         |
| Bookings      | `src/services/booking.*`    | Service requests, status workflow, payment kickoff      |
| Payments      | `src/services/payment.*`    | Pluggable gateways, webhooks, settlement                |

All three services are storage-agnostic (repository pattern) and share the same
`{ success, data }` response envelope.

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

`GET /health` reports service status. All other routes are under `/api`.

### Authentication — `/api/auth`

| Method & path        | Auth   | Description                                  |
| -------------------- | ------ | -------------------------------------------- |
| `POST /register`     | —      | Create a customer or provider account        |
| `POST /login`        | —      | Log in, returns `{ user, token }`            |
| `GET  /me`           | Bearer | Current user from the JWT                     |

Passwords are hashed with bcrypt; sessions use JWTs (`Authorization: Bearer <token>`).
Login responds identically for unknown emails and wrong passwords to avoid user
enumeration. Roles: `customer`, `provider`, `admin`.

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Kabo M", "email": "kabo@example.com", "password": "super-secret-pw", "role": "customer" }'
```

### Bookings — `/api/bookings` (all routes require a Bearer token)

| Method & path                 | Who          | Description                                          |
| ----------------------------- | ------------ | --------------------------------------------------- |
| `POST /`                      | customer     | Request a service from a provider                    |
| `GET  /`                      | any          | List my bookings (as customer or provider)           |
| `GET  /:reference`            | participant  | View a booking                                       |
| `PATCH /:reference/status`    | participant  | Move status (state machine + role rules enforced)    |
| `POST /:reference/pay`        | customer     | Initiate payment for an accepted booking             |
| `GET  /:reference/payment`    | participant  | Sync & read the booking's payment status             |

Booking lifecycle: `pending → accepted → in_progress → completed` (or `declined` /
`cancelled`). Providers accept and progress bookings; customers pay once accepted.
`POST /:reference/pay` creates a transaction via the payment service and links it back to
the booking — this is where bookings meet the payment backend.

### Payments — `/api/payments`

| Method & path                       | Description                                            |
| ----------------------------------- | ----------------------------------------------------- |
| `GET  /methods`                     | List supported payment methods                        |
| `POST /`                            | Create & initiate a payment                           |
| `GET  /:reference`                  | Fetch a payment by reference                           |
| `GET  /?customerId=...`             | List a customer's payments                             |
| `POST /:reference/cancel`           | Cancel a non-completed payment                         |
| `POST /webhook/:method`             | Provider callback that settles the payment            |

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

The suite runs against the in-memory repositories, so **no MongoDB is required**. 34 tests
cover authentication (registration, login, JWT-protected routes), the booking workflow
(creation, role-guarded status transitions, access control, payment integration) and
payments (all gateways, webhook settlement, signature verification, idempotency,
cancellation).

## Mobile app (`mobile/`)

A cross-platform **Ionic + Angular** app (standalone components) that talks to this
backend. Customers register, request a service, and—once a provider accepts—pay in-app;
providers accept and progress bookings.

```bash
cd mobile
npm install
npm start        # ionic/ng serve on http://localhost:8100
```

Set the backend URL in `mobile/src/environments/environment.ts` (`apiBaseUrl`).

Structure:

- `src/app/core/` — `ApiService`, `AuthService` (JWT in localStorage + auth interceptor +
  route guard), `BookingService`, `PaymentService`, and shared `models.ts`.
- `src/app/pages/` — Login, Register, Tabs (Home, Bookings, Profile), Booking detail,
  **Payment** (choose gateway → initiate) and **Confirmation** (polls settlement, shows
  checkout URL / mobile-money prompt / bank details from `providerMeta`).

The payment screen calls `POST /api/bookings/:reference/pay`, then the confirmation screen
polls `GET /api/bookings/:reference/payment` until the payment reaches a terminal state —
which flips to `succeeded` as soon as the gateway webhook settles the transaction.

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
