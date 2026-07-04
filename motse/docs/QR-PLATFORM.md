# QR Code Platform (Phase 5, WS21)

QR codes are a first-class, reusable platform capability — not a payment feature.
One secure service issues, verifies and revokes signed, time-limited QR codes
used across payments, identity, tourism, heritage, governance, trusts, learning
and the wallet.

- **Service** — `src/qr/qr.service.js` (`platform.qr`)
- **Customer API** — `/v1/qr`, `/v1/qr/verify`, `/v1/qr/decode`, `/v1/qr/pay`, `/v1/qr/:id/revoke`
- **Admin API** — `/v1/admin/qr*`
- **SDK** — `MotseClient.generateQr/verifyQr/decodeQr/payWithQr/myQrCodes/revokeQr` + `MotseClient.verifyQrOffline`

## Token format & security

A QR token is a compact, JWT-like string `base64url(payload).hmacSignature`. The
signing secret lives in the `SecretManager` and rotates (verification accepts
current + previous, like every other Motse signature). The platform stores only
QR *metadata*, never anything that lets an attacker forge a code.

Every scan is checked for, and every QR supports:

| Property | Mechanism |
| --- | --- |
| Digital signature / tamper detection | HMAC-SHA256 over the payload; constant-time compare |
| Expiration | `expiresInMs` → `exp`; rejected when past |
| Revocation | `revoke()` → `state=revoked`; rejected thereafter |
| Replay protection | `singleUse` — rejected once `scans > 0` |
| Tenant isolation | `tenant` on the code; cross-tenant scans rejected (WS1-ready) |
| Amount binding | payment QRs reject an amount mismatch |
| Permission validation | `visibility: 'restricted'` + `requiredRole`/`requiredLevel` gate restricted data |
| Audit + events + analytics + fraud | every generate/scan/revoke/reject is instrumented |

Outcomes emit `qr.generated`, `qr.scanned`, `qr.revoked`, `qr.rejected` events
(feeding the Event Store + `qr_activity` projection), append to the audit chain,
bump PII-free analytics, and run a QR-scan velocity fraud check that blocks
abusive scanning.

## Kinds

`payment`, `identity`, `tourism`, `heritage`, `governance`, `trust`, `learning`,
`wallet`, `access` — covering merchant/customer-presented and dynamic/static
payment QRs, identity & visitor passes, tickets & check-in, artifact/site info
(restricted-content aware), attendance & document verification, receipts, lessons
& certificates, and wallet pay/receive/request.

## Lifecycle

```
generate(actor, { kind, ref, amountMinor, expiresInMs, singleUse, visibility, ... })
   → { qr_id, token, expires_at }              (signed; metadata persisted)

verify(token, { scannerRef, tenant, amountMinor })
   → signature → expiry → revocation → replay → tenant → amount → fraud → permission
   → { valid, kind, ref, amount_minor, data, restricted?, authorized }   (scan recorded)

decode(token)            structure only, never trusted
revoke(actor, qrId)      one-way; idempotent
```

**Restricted content:** a `restricted` payload is returned only to authorized
scanners (`requiredLevel`/`requiredRole` satisfied via the Identity Graph);
everyone else sees the public `data` with `restricted: null` — the same
fail-closed posture as heritage restricted content.

## Payments

`payWithQr(actor, token, { cardId | provider, msisdn })` verifies a payment QR
(whose `ref` is the destination account and whose amount/currency are embedded)
and drives the existing rails — cards (`CardService.createIntent`) or
mobile-money/PayPal (`PaymentService.collect`). The Ledger stays the single
source of truth; QR is only the presentation layer.

## Offline verification

`QrService.verifyOffline(secret, token, nowMs)` (and `MotseClient.verifyQrOffline`)
verify the signature and expiry with no server round-trip — for offline gate
scanning. Revocation and replay require an online `verify` (documented limitation
of any signed-token system); production swaps the HMAC for an asymmetric key so
verifiers never hold signing material.

## Administration (WS21)

`GET /v1/admin/qr` (filter kind/tenant/state), `GET /v1/admin/qr/report` (usage +
security posture: counts by kind/state, valid vs rejected scans, rejection
reasons), `GET /v1/admin/qr/:id/scans` (scan history), `POST /v1/admin/qr/:id/revoke`,
`POST /v1/admin/qr/bulk` (batch generation for printing).

## Backward compatibility

The QR service is additive and reuses existing primitives (SecretManager, Audit,
Fraud, Analytics, Identity, Payments, Cards, Event Store). No existing module,
route or test was modified; every QR mutation is authorized, audited, idempotent,
event-producing, fraud-checked and analytics-enabled.
