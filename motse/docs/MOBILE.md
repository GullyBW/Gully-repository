# Mobile Architecture (Phase 2, WS1/WS2)

Three clients share one design language (identical color tokens) and one API:

| Client | Location | Verified how |
| --- | --- | --- |
| Flutter app (Android-first, iOS, tablets) | `motse/mobile_flutter/` | `flutter test` contract tests; **not compiled in this repo's CI environment (no Flutter SDK)** — run `flutter analyze && flutter test` on adoption |
| PWA (desktop/mobile/tablet browsers) | `motse/src/pwa/` served at `/app` | Playwright browser tests + jest suite |
| USSD/SMS (feature phones) | `motse/src/gateway/` | jest parity suite |

## The offline contract (both app clients)

```
capture ──▶ local outbox (SQLite / localStorage)
                │  client uuid + per-aggregate seq + Idempotency-Key
    reconnect ──▶ POST /v1/sync/outbox  (batch)
                │
   outcomes:  applied → drop from queue
              duplicate → drop (already landed — exactly once)
              rejected → drop + surface error
              conflict → KEEP + show reconciliation card (user decides)
```

The server side of this protocol is unchanged from the core platform (§8) — the
Flutter `core/outbox.dart` and the PWA `queueMutation()` are two implementations
of the same client contract, tested against the same backend.

## Login sequence (all clients)

```
client                    identity service              assurance
  │ POST /v1/identity/otp        │                          │
  │◀─ sandbox_code (dev only) ───┤                          │
  │ POST otp/verify {code, geo}  │                          │
  │                              ├─ mint device-bound token │
  │                              ├──────────────────────────▶ recordLogin:
  │                              │                          │  new-device event,
  │◀─ {user, session} ───────────┤                          │  impossible travel,
  │  store in secure storage     │                          │  ATO heuristics
```

Tokens: 15-minute access (device-bound), rotating refresh. All three clients
implement one automatic refresh-and-retry on 401, then sign out.

## Feature ↔ endpoint map (what each screen calls)

| Screen | Endpoints |
| --- | --- |
| Home | `/v1/wallet/accounts` · `/v1/notifications` · `/v1/kgetsi/campaigns` · `/v1/heritage/search` · `/v1/flags` |
| Heritage | `/v1/heritage/search` · `/v1/search` · `/v1/media/{id}/url` (signed) · `/v1/mafelo/packs/{district}/manifest` |
| Kgetsi | `/v1/kgetsi/campaigns` · outbox `kgetsi.contribute` · `/v1/public/campaigns/{id}/ledger` |
| Loeto | `/v1/loeto/experiences` · `/v1/loeto/bookings` (+`/review`, `/ics`) |
| Lelapa | `/v1/lelapa/circles` (+`/tree`, `/invitations`, `/relations`, `/events`) |
| Puo | `/v1/puo/courses` · `/v1/puo/lessons/{id}/complete` · `/v1/puo/progress` |
| Wallet | `/v1/wallet/accounts` · `/v1/wallet/history` · `/v1/wallet/payouts` · `/v1/payments/intents` |
| Identity | level display; L2 requests happen at the kgotla (§5.1) — the app explains the path |

Hard rules the clients follow:

- **No restriction logic client-side** — the server's read path decides;
  clients render what they receive and surface `MEMBERSHIP_REQUIRED` politely.
- **Biometric/PIN re-auth before money** (Flutter `session.reauthenticate`) —
  shared family devices are the norm (§5.3).
- **Data budgets (P8)**: list endpoints are paginated, field masks available,
  media is opt-in on cellular.
