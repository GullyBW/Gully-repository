# Motse SDK & Developer Platform (Phase 3, WS11/WS12)

## JavaScript / TypeScript SDK

`sdk/js/motse.js` — zero-dependency, isomorphic (Node 18+ and browsers). Types in
`motse.d.ts`.

```js
const { MotseClient, MotsePartner } = require('./sdk/js/motse');

// Member client — OTP session, device-bound tokens, idempotency, auto-refresh.
const client = new MotseClient({ baseUrl: 'https://api.motse.bw' });
const { sandbox_code } = await client.requestOtp('+2677...');   // dev shows the code
await client.verifyOtp('+2677...', sandbox_code);
const wallet = await client.wallet();
const campaigns = await client.campaigns('live');

// Partner client — API-key auth for the public developer API.
const partner = new MotsePartner({ baseUrl, apiKey: 'msk_...' });
const ledger = await partner.campaignLedger('cmp_...');
// Verify a webhook delivery (Node):
MotsePartner.verifyWebhook(appWebhookSecret, rawBody, req.headers['x-motse-signature']);
```

## Flutter / REST / OpenAPI

`npm run motse:openapi` regenerates `sdk/openapi.json` (OpenAPI 3.0, ~90 paths) from the
live route table. Generate clients for any language with `openapi-generator`:

```bash
openapi-generator-cli generate -i sdk/openapi.json -g dart -o clients/dart
openapi-generator-cli generate -i sdk/openapi.json -g typescript-fetch -o clients/ts
```

## Developer platform

Register an application (member-authed), receive an API key **once**, choose scopes
(`public:read`, `heritage:read`, `events:subscribe`, `payments:read`), get per-app rate
limits and usage analytics. Subscribe to webhooks for **whitelisted public events only**
— restricted cultural content is never fanned out to partners (fail closed). Deliveries
are HMAC-signed with the app's secret, retried on failure, and a chronically-failing
subscription auto-suspends.

```
POST /v1/developer/apps                 (member) → { app, api_key }   key shown once
GET  /v1/developer/apps | /apps/{id}/usage
POST /v1/developer/subscriptions        {app_id, event_types, url}
GET  /v1/partner/campaigns/{id}/ledger  (X-Api-Key, public:read)
GET  /v1/partner/search | /v1/partner/heritage
```

Developer portal: `/developers`. Admin oversight: `/v1/admin/developer/{apps,subscriptions,deliveries}`.

## Guides

- **Authentication**: OTP → device-bound access (15 min) + rotating refresh; the SDK
  refreshes once on 401 then signs out. Partners use `X-Api-Key`.
- **Webhooks**: verify the `X-Motse-Signature` HMAC over the raw body before trusting a
  delivery. See `MotsePartner.verifyWebhook`.
- **Plugins**: see [../docs/PLUGINS.md](../docs/PLUGINS.md) to extend the platform core.
- **Example app**: the PWA (`src/pwa/app.html`) is a complete reference consumer.
