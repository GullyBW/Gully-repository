# Motse — Flutter Application (Phase 2, WS1)

Android-first (low-cost device fleet), iOS for diaspora, tablet-aware
(navigation rail ≥720dp), offline-first (P1).

```bash
flutter pub get
flutter run --dart-define=MOTSE_API=http://10.0.2.2:4100   # Android emulator → local backend
flutter test                                               # contract/widget tests
flutter test integration_test --dart-define=MOTSE_API=...  # against a live backend
```

> **Verification status:** this source tree was authored in an environment
> without the Flutter SDK, so it has not been compiled here. The API
> contract logic (idempotency, refresh, device binding, problem-details)
> is covered by `test/outbox_protocol_test.dart` with mocked HTTP, and the
> backend contract itself is proven by the 150+ server-side tests. Run
> `flutter analyze && flutter test` as the first CI step when adopting.

## Architecture

```
lib/
├── main.dart              theme tokens (shared with PWA/portal), AppState, entry
├── shell.dart             bottom nav (phone) / navigation rail (tablet)
├── core/
│   ├── api_client.dart    Idempotency-Key on mutations, device binding,
│   │                      one-shot rotating token refresh, typed errors
│   ├── session.dart       encrypted token storage, biometric re-auth for
│   │                      privileged actions (§5.3 shared-device reality)
│   └── outbox.dart        SQLite outbox → POST /v1/sync/outbox; per-aggregate
│                          seq numbers; reconciliation cards; connectivity-
│                          triggered flush (the backend replay protocol, §8)
└── features/
    ├── auth/              OTP login + device registration
    ├── home/              dashboard (profile, level, wallet, notifications,
    │                      campaigns, heritage highlights)
    ├── heritage/          browse/search, signed-URL audio/video playback,
    │                      offline packs (signed manifests), restriction-aware
    ├── kgetsi/            contributions via the OFFLINE OUTBOX, milestone
    │                      tracking, escrow status, transparency ledger
    ├── loeto/             listings, escrow-backed booking, history, reviews,
    │                      offline itineraries (.ics)
    ├── lelapa/            circles, family tree, invitations, relationships, events
    └── more/              Puo (lessons+progress), Wallet (receipts/payouts),
                           Notifications, Identity & trusted devices, sync-now
```

Design decisions:

- **Money flows through the outbox** where the backend supports replay
  (`kgetsi.contribute`): giving works in a dead zone and lands exactly once.
  Bookings/payouts require connectivity by design (escrow opens server-side).
- **Biometric re-auth before every payment** — family devices are common;
  sessions are cheap, money actions are not (§5.3).
- **No restriction logic client-side.** The server's read path decides;
  the client only renders what it is given and surfaces
  `MEMBERSHIP_REQUIRED` politely.
- Push notifications register through the existing notification service
  (FCM token upload is a config step in `main.dart` once Firebase is added
  per-flavor; SMS fallback and in-app inbox work with no setup).
