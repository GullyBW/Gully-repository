# Security Model (Phase 1)

## Layers

1. **Edge** — helmet security headers (CSP `default-src 'self'`, nosniff,
   frame-options), token-bucket rate limiting keyed by authenticated actor
   (fallback: IP), configurable via `MOTSE_RATE_CAPACITY` / `MOTSE_RATE_REFILL`.
2. **Authentication** — OTP → short-lived (15 min) HMAC access tokens bound to a
   device id + rotating refresh tokens; session revocation and account suspension
   invalidate tokens immediately (checked on every verify).
3. **Authorization** — verification levels L0–L3 plus contextual `(role, scope)`
   RBAC; enforcement in services (not controllers); frozen governance seats read as
   `SEAT_FROZEN`. Every 401/403 is recorded (`security_denials` + metric) — the
   portal's permission-audit view lists live grants and denials.
4. **Webhooks** — HMAC-SHA256 over exact raw bytes with `SecretManager` rotating
   secrets (current+previous verify window), ±5-minute timestamp window, nonce
   replay cache, per-ref duplicate detection, amount cross-check against the intent.
5. **Money** — fraud engine hooks run before every collect/payout (velocity deny,
   large-amount review, SIM-swap heuristic on payouts); root/jailbreak device
   signals disable payouts on that device; payout failures auto-reverse.
6. **Secrets** — versioned, rotation-safe, never enumerable with values, rotation
   audited; production backend is GCP Secret Manager behind the same interface.
7. **Cultural data** — restricted class isolated end-to-end: server-side membership
   attestation, identity-bound short-TTL URLs, exclusion from search/packs/exports/
   AI (fail closed), audited admin metadata access, no export path.

## OWASP Top 10 (2021) review

| Risk | Status |
| --- | --- |
| A01 Broken access control | Central `requireLevel`/`requireRole` in services; deny-by-default restricted reads; denials logged; admin surface role-gated; tests cover member/outsider/anonymous paths. |
| A02 Cryptographic failures | HMAC-SHA256 signatures; constant-time comparisons (`timingSafeEqual`); msisdn stored hashed; secrets versioned + rotated; TLS terminates at the platform edge (Cloud Run). |
| A03 Injection | No SQL in this tier (repository interface); JSON body parsing with 1 MB limit; the portal escapes all rendered values (`esc()`); CSV export quotes fields. |
| A04 Insecure design | Double-entry invariants, idempotency everywhere, escrow release gates, dual approval — abuse cases (§13.2 of the engineering doc) are encoded as tests. |
| A05 Security misconfiguration | helmet defaults on; bootstrap endpoint disabled in production unless a token is explicitly set; readiness endpoint reports degraded dependencies. |
| A06 Vulnerable components | Dependency surface deliberately tiny (express, helmet at this tier); lockfile pinned; `npm audit` in CI recommended (see DEPLOYMENT). |
| A07 Auth failures | OTP with TTL + single use + hash-only storage; device binding; short token TTL; rotating refresh; suspension revokes sessions; rate limiter throttles brute force. |
| A08 Software/data integrity | Hash-chained audit log with third-party-verifiable inclusion proofs; signed offline packs; webhook signatures over raw bytes. |
| A09 Logging/monitoring failures | Structured logs with trace ids; authz-denial metrics; Sev-1 variance events page admins; RED metrics per route. |
| A10 SSRF | The core makes no outbound requests from user input; provider adapters call fixed operator endpoints configured by env. |

## Phase 2 — security assurance layer (WS6)

Detection on top of the Phase-1 enforcement, all surfaced in the portal's
Security/Ops tabs and `GET /v1/admin/security/report`:

- **Security event stream** — typed events (`new_device`,
  `otp_bruteforce_suspected`, `account_takeover_suspected`,
  `impossible_travel`, `api_abuse`) with severities; high severity auto-opens
  a Sev-2 incident.
- **Account-takeover detection** — ≥5 OTP failures followed by a success from
  a never-seen device places a 24-hour payout hold (releasable by an admin,
  audited both ways).
- **Impossible travel** — consecutive logins whose implied speed exceeds
  900 km/h (and >100 km apart) raise high severity + hold. Login geo is
  optional and used for nothing else.
- **SIM-swap monitoring** — device registration ages are recorded at login;
  payouts from devices younger than 24h open fraud reviews, and payouts to an
  msisdn different from the account's registered number are flagged for review.
- **API abuse detection** — 40+ 4xx responses in 5 minutes per identity/IP
  blocks that key for 15 minutes (429), with a security event.
- **Device risk scoring** — root/jailbreak signals, registration age, active
  holds and account-sharing breadth blend into a 0–100 score with reasons
  (`GET /v1/admin/security/device-risk/{userRef}?device_id=…`).
- **Credential rotation automation** — per-secret interval policies (90 days
  for webhook secrets) executed by the weekly job or on demand; the previous
  version stays verify-valid for exactly one rotation.
- **Continuous dependency scanning** — `npm run motse:security-scan` in CI on
  every push; high/critical advisories fail the build (§13.1 supply chain).

## Key rotation runbook

1. Portal → Security → Rotate (or `POST /v1/admin/security/secrets/:name/rotate`).
2. Old version remains verify-valid for exactly one rotation (in-flight webhooks
   keep working); share the new secret with the operator before rotating twice.
3. Rotation is audited (`security.secret_rotated` on the secret's chain).
