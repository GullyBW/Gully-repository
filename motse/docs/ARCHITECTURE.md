# Motse — Architecture (Phase 1)

## System topology

```
                                   ┌──────────────────────────────────────────────┐
  Flutter app ──┐                  │            Motse Core (modular monolith)     │
  USSD/SMS ─────┤   ┌──────────┐   │ ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ │
  Admin portal ─┼──▶│ Gateway  │──▶│ │Identity│ │ Ledger │ │ Media  │ │Governance│ │
  (served at    │   │ auth ·   │   │ └────────┘ └────────┘ └────────┘ └─────────┘ │
   /admin)      │   │ idempo · │   │ ┌──────────────────────────────────────────┐ │
  Operators ────┘   │ rate-lim │   │ │ lelapa kgotla heritage puo mafelo loeto  │ │
  (webhooks)        └──────────┘   │ │ kgetsi letlole mmino                     │ │
                                   │ └──────────────────────────────────────────┘ │
                                   │  Event bus (versioned, replayable)           │
                                   └───────┬──────────────┬───────────────────────┘
                                           │              │
                     ┌─────────────────────┼──────────────┼─────────────────────┐
                     │ Payments            │ Notifications│ Search    AI (ifaces)│
                     │ Orange · MyZaka ·   │ in-app sms   │ inverted  transcribe │
                     │ Smega (adapters)    │ push email   │ index     translate… │
                     └─────────────────────┴──────────────┴─────────────────────┘
                       Monitoring: /metrics · /health · /health/ready · logs
```

The composition root is `src/container.js`; every service receives its dependencies
by injection and no module reaches around a boundary. Business logic lives in
services; `src/app.js` and `src/admin/admin.routes.js` are thin controllers.

## Phase-1 additions

| Component | Path | Notes |
| --- | --- | --- |
| Admin API | `src/admin/admin.routes.js` | `/v1/admin/*`, `platform_admin(platform)` role required |
| Admin portal | `src/admin/portal.html` | self-contained SPA served at `/admin` (see below) |
| Payments | `src/payments/` | provider abstraction + Orange Money, MyZaka, Smega |
| Notifications | `src/notifications/` | event-driven, 5 channels, preferences + quiet hours |
| Monitoring | `src/monitoring/` | metrics registry, structured logger, domain collectors |
| Security | `src/security/` | secrets+rotation, replay guard, fraud engine, rate limiter |
| Search | `src/search/` | inverted index, event-maintained, fail-closed on restricted |
| AI foundation | `src/ai/` | provider interfaces only; safety gate before any provider |

### A note on the portal stack

The brief suggested Next.js/React/TypeScript. This implementation deliberately ships
the portal as a **single self-contained page** served by the same Express process:

- the repo is a zero-build CommonJS backend — adding a second build system for an
  ops console roughly triples CI time and dependency surface;
- the strict CSP (`default-src 'self'`) means no external scripts anyway;
- the portal is fully functional (all seven modules, login, actions) and its API is
  the tested contract — a Next.js front-end can replace the page later without any
  backend change, which is exactly the loose coupling the brief asks for.

## Payment flows (sequence)

### C2B collection (customer pays in)

```
 App          PaymentService        Provider(adapter)      Operator          Ledger
  │ collect()        │                     │                  │                │
  ├─────────────────▶│ fraud.assess()      │                  │                │
  │                  ├────────────────────▶│ initiateCollection                │
  │                  │                     ├─────────────────▶│ (push to phone)│
  │                  │◀── provider_ref ────┤                  │                │
  │◀─ intent:pending ┤                     │                  │                │
  │                  │                     │   subscriber approves on handset  │
  │                  │◀────────── signed webhook (HMAC+ts+nonce) ──────────────│
  │                  ├─ verify sig/replay/duplicate/amount    │                │
  │                  ├────────────────────────────────────────┼───────────────▶│ providerDeposit
  │                  │                                        │                │ (clearing → wallet)
  │◀─ intent:completed + notification                         │                │
```

### B2C payout (money out) — failure path

```
 payout() ──▶ ledger.requestPayout (wallet → clearing)  [money leaves NOW]
          ──▶ provider.initiatePayout ──▶ operator
 webhook(failure) ──▶ ledger.failPayout ──▶ reversal posting (clearing → wallet)
                  ──▶ intent:failed ──▶ member notified, payout in admin review queue
```

Invariants: the ledger is the only source of truth; the trial balance stays at zero
through every path (asserted in tests); a webhook can settle an intent exactly once.

## Event-driven notification flow

```
kgotla.publishAlert ──▶ bus: kgotla.alert.published
   ├─▶ SmsGateway fan-out (per-ward throttling)
   └─▶ NotificationService → per-resident: in-app + (prefs ? channels)
        civic_emergency is exempt from prefs and quiet hours (§12)
```

## Search indexing rule

Only fail-closed public read models feed the index (`heritage.publicSearchIndex()`
etc.). The filter runs inside Motse before any document reaches an engine, so a
misconfigured managed engine can never have seen restricted content. Family circles
are query-time scoped to their members.
