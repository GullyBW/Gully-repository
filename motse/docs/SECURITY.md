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

## Key rotation runbook

1. Portal → Security → Rotate (or `POST /v1/admin/security/secrets/:name/rotate`).
2. Old version remains verify-valid for exactly one rotation (in-flight webhooks
   keep working); share the new secret with the operator before rotating twice.
3. Rotation is audited (`security.secret_rotated` on the secret's chain).
