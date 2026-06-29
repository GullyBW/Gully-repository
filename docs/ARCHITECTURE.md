# Architecture overview

Tirelo Services is a two-part marketplace: a Node.js/Express API and an
Ionic/Angular client (web PWA + native Android/iOS via Capacitor).

## High-level

```
Ionic/Angular app ──HTTPS REST──▶  Express API ──▶ services ──▶ repositories ──▶ PostgreSQL
        │                              │                              ▲
        └────────Socket.IO────────────┘                              │
                                       └── CacheService (Redis | memory)
External: Google Maps · FCM · payment gateways (Orange Money / MyZaka / card / bank)
```

## Layering (backend)

- **routes/** — Express routers; input validation (Joi) + auth/role middleware.
- **controllers/** — thin HTTP adapters (`{ success, data }` envelope).
- **services/** — business logic; the only place that talks to repositories.
- **repositories/** — storage behind getters/setters; PostgreSQL (JSONB) by
  default, Mongo as an alternate driver, in-memory for tests (`setXRepository`).
  The active set is chosen by `DB_DRIVER` (see [POSTGRES.md](./POSTGRES.md)).
- **domain/** — pure helpers (status machines, serialization), no I/O.
- **db/** — `postgres.js` (pg pool + `ensureSchema`) and `schema.sql`.
- **models/** — Mongoose schemas (used only when `DB_DRIVER=mongo`).
- **middleware/**, **utils/**, **realtime/** (Socket.IO gateway + bus).

The **payment module** (`src/services/payment.service.js`, `src/providers/*`,
`src/domain/transaction.js`) is stable and must not be modified; everything else
integrates with it through `PaymentService`.

## Folder structure

```
src/
  app.js                 Express app factory (middleware + route mounting)
  server.js              Production entry (DB connect, Socket.IO, graceful shutdown)
  db/                    postgres.js (pool + ensureSchema) + schema.sql
  test-server.js         In-memory API for E2E / smoke (no external deps)
  config/                Central env-driven config
  routes/ controllers/ services/ repositories/ domain/ models/
  middleware/ utils/ realtime/ providers/   (providers = payment gateways)
tests/                   Jest unit/integration (in-memory repos)
e2e/                     Playwright API journeys (+ ui/ specs)
mobile/                  Ionic/Angular app (standalone components)
  src/app/core/          services, guards, interceptors, models
  src/app/components/    reusable UI (chart, provider-card, map-picker, …)
  src/app/pages/         lazy-loaded standalone pages
docs/                    this documentation
deploy/                  nginx + backup samples
```

See `README.md` for the module/endpoint catalogue and the per-area details.
