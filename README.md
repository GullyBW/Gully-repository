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

| Module        | Path                              | What it does                                                  |
| ------------- | --------------------------------- | ------------------------------------------------------------ |
| Auth          | `src/services/auth.service`       | Register/login, JWT issuance, role-based access              |
| Providers     | `src/services/provider.service`   | Profiles + discovery search (filter/sort/distance/pagination) |
| Categories    | `src/services/category.service`   | Fixed service-category catalogue                             |
| Reviews       | `src/services/review.service`     | Verified-booking reviews; auto-updates provider rating       |
| Favourites    | `src/services/favourite.service`  | Save/remove/list favourite providers                         |
| Availability  | `src/services/availability.service` | Working hours, holidays, vacation; bookable-slot computation |
| Geo / Maps    | `src/services/geo.service`        | Address search, geocode, distance (Google Maps + sandbox)    |
| Notifications | `src/services/notification.service` | In-app events for both parties (push-ready)                 |
| Bookings      | `src/services/booking.service`    | Discovery-driven booking workflow + payment kickoff          |
| Payments      | `src/services/payment.service`    | Pluggable gateways, webhooks, settlement (**unchanged**)     |

Every service is storage-agnostic (repository pattern) and shares the same
`{ success, data }` response envelope. The payment module was not modified — the
marketplace was built around it, and bookings hand it a completed booking exactly
as before.

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

### Discovery — providers, categories, reviews, favourites, availability, geo

| Method & path                              | Auth        | Description                                       |
| ------------------------------------------ | ----------- | ------------------------------------------------- |
| `GET  /api/categories`                     | —           | Service categories (key/name/icon)                |
| `GET  /api/providers`                      | —           | Search providers (filters/sort/distance/paging)   |
| `GET  /api/providers/:userId`              | —           | Full provider profile                             |
| `GET  /api/providers/me`                   | provider    | Own profile                                       |
| `POST /api/providers`                      | provider    | Create/update own profile                         |
| `PATCH /api/providers/availability`        | provider    | Set live status (available/busy/offline/vacation) |
| `PATCH /api/providers/:userId/verify`      | admin       | Grant/revoke verified badge                       |
| `GET  /api/reviews/provider/:providerId`   | —           | Published reviews for a provider                  |
| `POST /api/reviews`                        | customer    | Review a completed booking (one per booking)      |
| `PATCH /api/reviews/:id`                   | author      | Edit a review                                     |
| `POST /api/reviews/:id/report`             | any         | Flag a review for moderation                      |
| `PATCH /api/reviews/:id/moderate`          | admin       | Remove/restore a review                           |
| `GET/POST/DELETE /api/favourites[...]`     | customer    | List / save / remove favourite providers          |
| `GET  /api/availability/:providerId`       | —           | Provider availability config                      |
| `GET  /api/availability/:providerId/slots` | —           | Bookable slots for `?date=YYYY-MM-DD`             |
| `PUT  /api/availability`                   | provider    | Update own availability                           |
| `GET  /api/notifications`                  | any         | List notifications (`?unreadOnly=true`)           |
| `PATCH /api/notifications/:id/read`        | owner       | Mark one read / `read-all` for all                |
| `GET  /api/geo/search`                     | any         | Address/place search (`?q=`)                      |
| `POST /api/geo/geocode`                    | any         | Address → coordinates                             |
| `GET  /api/geo/reverse` · `/distance`      | any         | Reverse geocode · point-to-point distance         |

**Provider search** accepts `category, q, minRating, maxPrice, availableOnly,
verifiedOnly, lat, lng, maxDistanceKm, sort, page, limit`. `sort` is one of
`nearest, highest_rated, lowest_price, most_jobs, fastest_response`. When `lat`/`lng`
are supplied each result includes `distanceKm` (haversine). The response is
`{ success, items, page, limit, total, hasMore }`.

Google Maps is optional: set `GOOGLE_MAPS_API_KEY` for live geocoding/places,
otherwise the geo service uses a built-in **Botswana sandbox** so search,
geocoding and distance all work in development and tests.

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

The suite runs against the in-memory repositories, so **no MongoDB is required**. 69 tests
cover authentication, payments (all gateways, webhooks, idempotency), the booking
workflow, provider profiles & discovery search (filters/sort/distance/pagination),
reviews & ratings (verified-booking rule, rating recomputation, moderation), favourites,
availability & slot computation (working days/holidays/vacation), the geo/maps service,
and lifecycle notifications.

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

- `src/app/core/` — `ApiService`, `AuthService` (JWT + interceptor + route guard) and the
  `Provider`, `Category`, `Review`, `Favourite`, `Notification`, `Availability`, `Geo`,
  `Booking` and `Payment` services, plus shared `models.ts`.
- `src/app/components/` — reusable `ProviderCardComponent`, `RatingStarsComponent` and
  `MapPickerComponent` (search + current location, ready for a Google Maps drop-in).
- `src/app/pages/` — Login, Register, Tabs (**Home** with categories + search, **Bookings**,
  **Notifications** with unread badge, **Profile**); **Provider list** (filters/sort/“near
  me”/infinite scroll), **Provider details** (profile, metrics, reviews, favourite, share),
  **Booking wizard** (date → time slot → map location → details → summary), **Map picker**,
  **Payment**, **Confirmation**, **Leave a review**, **Favourites**, and a **Provider
  dashboard** (profile editor, availability/vacation management, live status).

### Marketplace booking flow

Select category → browse/search providers → provider profile → booking wizard (date, time
slot from the provider's availability, map location) → summary → create booking →
**Payment** (`POST /api/bookings/:reference/pay`) → **Confirmation** (polls
`GET /api/bookings/:reference/payment` until the gateway webhook settles). The payment
module is untouched — it simply receives the completed booking. Provider IDs are never
entered by hand.

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

---

# Production phase (infrastructure & hardening)

The following production capabilities extend the marketplace. Every integration
is **optional with a safe fallback**, so the app runs end-to-end (and all 104
tests pass) with no external services configured.

## New backend modules

| Area              | Endpoints (base `/api`)                                              | Notes |
| ----------------- | ------------------------------------------------------------------- | ----- |
| Auth hardening    | `auth/refresh`, `auth/logout`, `auth/verify-email`, `auth/forgot-password`, `auth/reset-password`, `auth/sessions`, `auth/sessions/:id` | Refresh-token rotation, email verification, password reset, device/session management |
| Push (FCM)        | `notifications/devices`, `notifications/preferences`                 | Device-token storage, per-category preferences, push via FCM or console |
| Uploads           | `uploads/:kind` (multipart `image`)                                  | Image-only, MIME + size validation, randomised names, thumbnails, served at `/uploads` |
| Maps              | `geo/directions`, `addresses` (CRUD)                                 | Directions/Distance, saved addresses (multiple per customer) |
| Admin             | `admin/dashboard`, `admin/users`, `admin/providers/:id/verify`, `admin/users/:id/suspend`, `admin/bookings`, `admin/bookings/:ref/cancel`, `admin/payments`, `admin/payments/:ref/refund`, `admin/broadcast`, `admin/audit-logs` | Admin-only; all mutations audited |
| Analytics         | `analytics/provider`, `analytics/customer`, `analytics/admin`, `analytics/export?report=&format=csv` | Earnings, trends, demand, CSV export |
| Messaging         | `messages/conversations`, `messages/:bookingReference`, `messages/:ref/read` | Booking-scoped chat (REST) + Socket.IO gateway |
| Health/Perf       | `/health/live`, `/health/ready`                                     | Liveness/readiness; gzip, request logging, response cache, graceful shutdown |

The **payment module is unchanged** — admin/analytics read payment data via
additive, read-only repository methods only.

## Real-time chat (Socket.IO)

`src/realtime/socket.js` attaches to the HTTP server in `src/server.js` and
authenticates with the same JWT (`handshake.auth.token`). Events:
`conversation:join`, `message:send`, `message:read`, `typing`; the server emits
`message:new`, `message:read`, `typing` to per-conversation rooms.

## Configuration & graceful fallbacks

| Feature        | Enable with                          | Fallback when unset                    |
| -------------- | ------------------------------------ | -------------------------------------- |
| Google Maps    | `GOOGLE_MAPS_API_KEY`                | Botswana sandbox (search/geocode/directions) |
| Push (FCM)     | `PUSH_TRANSPORT=fcm` + `FCM_SERVICE_ACCOUNT` (+ `firebase-admin`) | Console transport (still records history) |
| Redis cache    | `REDIS_URL` (+ `ioredis`)            | In-process TTL cache                   |
| Image storage  | `STORAGE_DRIVER=local` (default)     | Local disk under `STORAGE_LOCAL_DIR`, served at `/uploads` |
| Thumbnails     | install `sharp` (optionalDependency) | Original image used for both URLs      |
| Email          | `EMAIL_TRANSPORT=smtp`               | Console transport (logs links; dev returns `devToken`) |

`firebase-admin`, `ioredis` and `sharp` are **optionalDependencies** — the app
detects them at runtime and degrades gracefully if absent.

### Setup notes

- **Google Maps**: enable the Geocoding, Places, Directions & Distance Matrix
  APIs for your key. Set `GOOGLE_MAPS_API_KEY` (backend) and optionally
  `googleMapsApiKey` in `mobile/src/environments/*` for the JS SDK.
- **FCM**: create a Firebase service account, set `FCM_SERVICE_ACCOUNT` to its
  JSON (or a path), `PUSH_TRANSPORT=fcm`, and `npm i firebase-admin`. Clients
  register tokens via `POST /api/notifications/devices`.
- **Storage**: local by default. For production set `STORAGE_DRIVER` to a cloud
  driver and implement the provider in `src/services/storage/` behind the
  existing `StorageProvider` interface (S3/GCS/R2/Azure) — no business-logic
  changes required.

## Deployment (Docker & CI)

```bash
docker compose up --build      # api + mongo + redis
```

- `Dockerfile` — production image (prod deps only, non-root, container healthcheck).
- `docker-compose.yml` — api + MongoDB + Redis with a persisted uploads volume.
- `.github/workflows/ci.yml` — runs backend tests, builds the Ionic app, and
  builds the Docker image on every push/PR.

Liveness `GET /health/live`, readiness `GET /health/ready` (checks DB + cache).
`SIGTERM`/`SIGINT` trigger graceful shutdown (drain HTTP, close Mongo + cache).

## Tests

`npm test` runs **104 tests** across 17 suites against in-memory repositories —
no MongoDB, Redis, FCM, Google Maps or cloud storage required.
