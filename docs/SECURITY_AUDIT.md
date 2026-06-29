# Security audit

Scope: Tirelo Services API + Ionic client. Payment module reviewed but unchanged.
Legend: ✅ implemented · ⚠️ implemented with a recommended hardening · ❗ action required before launch.

## Controls

| Area | Status | Implementation / notes |
| --- | --- | --- |
| Authentication | ✅ | bcrypt password hashing; JWT access tokens; login is enumeration-resistant (constant-time compare for unknown users). |
| Authorization | ✅ | `authenticate` + `authorize(role)` middleware; participant checks in bookings/messages; admin-only routes. |
| Refresh tokens | ✅ | Rotation on every use; only a SHA-256 hash stored; revoked on reuse and on password reset. |
| Password reset | ✅ | One-time token + 1h expiry; always-200 response (no enumeration); revokes all sessions on success. |
| Email verification | ✅ | One-time token; `emailVerified` flag. |
| Input validation | ✅ | Joi schemas on all routes with `stripUnknown`; regex inputs escaped in search. |
| Rate limiting | ⚠️ | `express-rate-limit` on `/api` (prod). **Recommend** stricter per-route limits on auth endpoints + account lockout after N failed logins. |
| CSRF | ✅ | Stateless Bearer-token auth (no auth cookies) → CSRF not applicable. |
| XSS | ✅ | API emits JSON only; Angular auto-escapes templates; Helmet CSP enabled. |
| SQL/NoSQL injection | ✅ | PostgreSQL via **parameterized `pg` queries** ($1/$2 placeholders, no string interpolation); Mongoose typed schemas on the Mongo driver; Joi validation; regex escaping in provider/user search. |
| Content Security Policy | ✅ | Helmet defaults; `crossOriginResourcePolicy: cross-origin` for uploaded images. |
| CORS | ⚠️ | Production API adds no CORS (same-origin). **Recommend** an explicit origin allow-list if the PWA is hosted on a different origin than the API. |
| Secrets management | ⚠️ | Env-driven; `.env` git-ignored. **❗ Override `JWT_SECRET`** and all default secrets in production (defaults are dev-only). |
| Encryption | ✅ | TLS terminated at the proxy (HSTS recommended); bcrypt for passwords; refresh tokens hashed at rest. |
| File upload validation | ✅ | Multer memory storage; image-only MIME allow-list; size limit; randomised filenames; no path from user input. |
| JWT expiry | ✅ | Short access TTL (`ACCESS_TOKEN_TTL`, default 15m) + refresh rotation; configurable. |
| Session management | ✅ | Refresh-token store; list/revoke sessions; revoke-all on password change. |
| Audit logging | ✅ | `AuditService` records logins, failures, verifications, suspensions, refunds, broadcasts, conversation reports, blocks. |
| Security headers | ✅ | Helmet; JSON body size limit (1mb); request-id correlation. |
| Dependency hygiene | ⚠️ | `npm audit` in CI (`release.yml`). **Recommend** failing the pipeline on high/critical prod-dep vulns. |

## OWASP Top 10 (2021) mapping

| # | Risk | Status |
| --- | --- | --- |
| A01 Broken Access Control | ✅ role + participant checks, admin guard (client + server) |
| A02 Cryptographic Failures | ✅ bcrypt, hashed refresh tokens, TLS |
| A03 Injection | ✅ schema validation, parameterised queries, escaped regex |
| A04 Insecure Design | ✅ repository/service layering, state machines, least-privilege roles |
| A05 Security Misconfiguration | ⚠️ enforce non-default secrets; enable HSTS; CORS allow-list |
| A06 Vulnerable Components | ⚠️ CI audit; keep deps patched |
| A07 Auth Failures | ✅ rotation + revocation; ⚠️ add lockout/MFA for high-risk accounts |
| A08 Data Integrity Failures | ✅ signed JWTs; signed payment webhooks (HMAC) |
| A09 Logging/Monitoring | ✅ audit log + structured logs + metrics; ship to a SIEM in prod |
| A10 SSRF | ✅ no user-controlled outbound URLs except configured provider/maps endpoints |

## Recommended remediations before launch

1. **❗ Set strong production secrets** (`JWT_SECRET`, provider keys, `FCM_SERVICE_ACCOUNT`).
2. Add **auth-endpoint rate limits + account lockout** after repeated failures.
3. Enable **HSTS** + TLS-only at the reverse proxy; configure an explicit **CORS allow-list** if PWA and API differ in origin.
4. Make CI **fail on high/critical** production-dependency vulnerabilities.
5. (Optional) Add **MFA** for admin accounts and **Crashlytics/Sentry** in the mobile client.
