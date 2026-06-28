# Testing guide

## Backend unit/integration (Jest)

```bash
npm test
```

108 tests run against **in-memory repositories** (no MongoDB). Coverage spans
auth/security, providers & discovery, bookings, reviews, favourites,
availability, geo, notifications/FCM, uploads, admin, analytics, messaging
(incl. reactions/report/block) and payments.

## End-to-end (Playwright)

```bash
npm run test:e2e          # boots src/test-server.js automatically
npx playwright show-report
```

E2E specs (`e2e/*.spec.ts`) exercise full journeys over HTTP against an
in-memory API server (no external services), so they are deterministic and run
in CI:

- `customer.spec` — register → verify → browse → favourite → book → pay
  (gateway webhook) → chat → complete → review.
- `provider.spec` — profile → availability → accept booking → complete →
  analytics + CSV export.
- `admin.spec` — dashboard → verify provider → bookings → payments → broadcast →
  audit logs.
- `messaging.spec` — send/history/reactions/report + block both directions.
- `notifications.spec` — booking lifecycle notifications, device registration,
  preferences, unread count.

Reports: `playwright-report/` (HTML) with screenshots/traces on failure.

### Browser/UI E2E (optional)

`e2e/ui/` would drive the rendered Ionic app. To run it you must serve the built
PWA next to the API:

```bash
# terminal 1
PORT=4010 node src/test-server.js
# terminal 2
cd mobile && npx ng build && npx http-server www -p 8100 -P http://127.0.0.1:4010
# then point a Playwright "ui" project at http://127.0.0.1:8100
```

These are excluded from the default config (`testIgnore: **/ui/**`) to keep CI
deterministic; enable them once your hosting/CI provides a served front end.

## Frontend build check

```bash
cd mobile && npx ng build --configuration production
```

## CI

`.github/workflows/ci.yml` runs: backend Jest, Playwright E2E, the Ionic
production build, and the Docker image build on every push/PR.
