# Phase 6 · WS4 — Engineering Standards

**Traces:** DevSecOps `../design/07`, Security `../design/04`, Observability `../design/06`.
Organization-wide standards so all teams build consistently and safely. **Fail-closed and
data-minimization are defaults, not options.**

---

## 1. Coding standards
- Language-appropriate style guides + linters/formatters enforced in CI (block on violation).
- **Minimal dependencies on 🔒 critical paths** (T-3); every dependency pinned + provenance-checked.
- No secrets, no PII, no reporter identifiers in code, comments, logs, or test fixtures (CI-scanned).
- Immutable-by-default data structures for security-critical state; explicit error handling
  (fail-closed).

## 2. API design standards
- API-first (contract before code, `03`); REST + problem+json; SemVer; uniform errors; no
  enumeration oracles; `additionalProperties:false` on external inputs.
- Idempotency keys for writes; pagination defaults; rate limits anonymity-preserving.

## 3. Logging standards
- **Structured logs**; **no PII/IP/content/identity** — ever (CI redaction check).
- Correlation IDs that are **not** user-identifying; log levels disciplined; security events → SIEM.

## 4. Observability standards
- Metrics (RED/USE), traces (sampled, no sensitive payloads), logs — privacy-budgeted
  (`../design/06`). Every service exposes health + SLO metrics. Dashboards access-controlled.

## 5. Testing standards
- **Test-first**; coverage targets on critical paths; **privacy tests and governance/invariant
  tests are release-blocking** (`../phase3/04`). Contract tests for every API/event. Synthetic data
  only.

## 6. Documentation standards
- Every context has a spec (`02`); every DDR recorded; runbooks per service (`../phase3/06`);
  docs-as-code, versioned, reviewed. Traceability front-matter on artifacts (`01`).

## 7. Infrastructure standards
- **IaC for everything**; immutable images; per-zone isolation (no cross-zone DB route); drift
  detection; least-privilege service identities (mTLS). Reproducible, reviewed, policy-gated (`09`).

## 8. Dependency management
- Pinned + provenance (SLSA); SBOM per build with diff; automated CVE scanning + patch SLAs;
  minimal surface on 🔒 paths; no unvetted transitive deps (CI-blocked).

## 9. Secrets management
- Secrets only from the secrets manager (short-lived, rotated); **never** in code/images/logs/CI
  output (CI secret-scan blocks). Human access to secrets is JIT + dual-control + audited.

## 10. Cryptographic key handling 🔒
- Keys in HSM; envelope encryption; **threshold (M-of-N)** for de-anon-capable ops (DDR-10).
- **No developer ever holds production keys**; crypto-agility (versioned primitives); **crypto code
  is human-expert-built + ISRB-signed**, never autonomously generated (WS10). Test with synthetic
  keys only.

## 11. Release management
- Progressive delivery (canary/blue-green) + rehearsed rollback; feature flags/kill-switches;
  **🔒 subsystem releases require ISRB sign-off token** (CI HUMAN gate); **prod deploy blocked while
  any readiness gate ≠ GREEN** (`../design/07`).

## 12. Quality gate

- **Traces to:** `../design/04/06/07`; DDR-09/10/13/15; T-3, RK-06/12.
- **Preserves:** fail-closed, minimization, zero standing privilege, autonomy boundary.
- **Residual risks:** standards drift (mitigated: CI enforcement); developer friction (accepted).
- **Trade-offs:** ⚠️ strict standards slow some work — the price of a safety-critical system.
- **Acceptance criteria:** standards enforced in CI (lint, secret-scan, redaction, SBOM, invariant);
  🔒 crypto/key standards reviewed; no PII in any artifact (verified).
- **🔒 Required review:** ARB, ISRB (crypto/key/release), SRE (infra/observability).

*Next: `05-reference-implementation.md`.*
