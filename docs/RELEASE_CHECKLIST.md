# Production release checklist

## Pre-flight (engineering)

- [ ] `npm test` green (backend, 108 tests)
- [ ] `npm run test:e2e` green (Playwright journeys)
- [ ] `cd mobile && npx ng build --configuration production` succeeds (service worker generated)
- [ ] `docker build .` succeeds; `docker compose up` healthy
- [ ] No changes to the payment module; no breaking API changes
- [ ] `.env` populated from `.env.example`; secrets in a vault, not in git

## Feature verification

- [ ] **Authentication** — register, email verify, login, refresh rotation, password reset, suspended-account block
- [ ] **Payments** — each gateway (Orange Money, MyZaka, card, bank) create + webhook settlement; refund workflow audited
- [ ] **Bookings** — full lifecycle + state-machine rules + payment linkage
- [ ] **Maps** — live geocoding/places/directions with `GOOGLE_MAPS_API_KEY` (sandbox fallback verified)
- [ ] **Notifications** — in-app + FCM device registration + preferences + deep-link tap routing
- [ ] **Messaging** — Socket.IO live, typing, read receipts, reactions, forward, report, block, shared images, offline recovery
- [ ] **Analytics** — provider/customer/admin dashboards + CSV/Excel/PDF export
- [ ] **Admin** — dashboard, verify/suspend, bookings, payments, review moderation, broadcast, audit logs
- [ ] **Reviews** — completed-booking only, rating recompute, moderation
- [ ] **Uploads** — image-only validation, size limits, thumbnails, secure URLs
- [ ] **Offline** — offline banner, cached categories, queued retries
- [ ] **PWA** — installable, service worker caching, manifest + icons
- [ ] **Accessibility** — labels, focus order, contrast, keyboard navigation
- [ ] **Responsive** — phone/tablet/desktop layouts
- [ ] **Dark mode** — toggle + OS preference

## Platform / ops

- [ ] **Security** — helmet/CSP, rate limiting, JWT + refresh rotation, input validation, HTTPS only, secrets rotated
- [ ] **Performance** — gzip, response cache, lazy routes, image lazy-load, Redis cache in multi-instance
- [ ] **Docker deployment** — image runs as non-root, healthcheck passing
- [ ] **CI/CD** — pipeline green; protected main branch
- [ ] **Backups** — DB nightly dump + managed snapshots; restore tested
- [ ] **Monitoring** — `/health/*`, `/metrics`, structured logs shipped, crash reporting (Sentry) wired, alerts configured
- [ ] **Disaster recovery** — documented RPO/RTO; runbook for redeploy + restore

## Store submission

- [ ] Android signed `.aab`, store listing, screenshots, feature graphic, privacy policy
- [ ] iOS archive uploaded, App Store metadata, screenshots, privacy nutrition labels
- [ ] PWA hosted with HTTPS + SPA fallback; Lighthouse PWA pass
