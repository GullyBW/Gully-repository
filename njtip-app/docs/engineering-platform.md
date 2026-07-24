# Engineering Platform (Part 5)

Production-grade engineering environment with the Digital Engineering Twin integrated into every
workflow.

## Repository standards
- Monorepo: `njtip-twin/` (assurance), `njtip-app/` (product), `docs/transparency-platform/` (blueprint).
- Zero runtime dependencies on the anonymity-critical path; pinned + provenance-checked deps elsewhere.
- Traceability front-matter on architectural artifacts (Twin `src/traceability`).

## Branching strategy
- Trunk-based with short-lived feature branches; protected `main`; signed commits on 🔒 paths.
- Branch naming `feat/…`, `fix/…`, `adr/…`. Squash-merge with linked ADR for architecture changes.

## Coding conventions
- `'use strict'`; Node built-ins first; small modules; explicit error handling; **fail-closed**.
- No secrets/PII/identity in code, logs, or test fixtures (CI-scanned). Synthetic data only.

## Static analysis & quality gates (CI, fail-closed)
1. Lint + format. 2. Unit/integration tests (`node --test`). 3. **Twin fitness gate** (architecture
violations fail CI). 4. **App vertical-slice + API tests**. 5. Privacy check (no identity/PII).
6. Secret scan + SBOM diff. 7. API contract validation (`/openapi.json`). A failing gate blocks merge.

## CI/CD
- `.github/workflows/njtip-app.yml` (scoped to `njtip-app/**` + `njtip-twin/**`): runs app tests **and**
  the Twin gate on every change. `.github/workflows/njtip-twin.yml`: the assurance suite.
- No production deploy target; synthetic staging only until readiness gates pass (human decision).

## Dependency management
- Prefer zero/minimal deps; pin versions; provenance (SLSA) + SBOM for anything added; license allowlist.

## Release process
- SemVer; API under `/v1`. Release = green Twin + app CI + updated ADRs + evidence bundle archived.
  Progressive delivery + rehearsed rollback (blueprint design/07). Go-live is a human OB decision.

## Documentation standards
- Docs-as-code, versioned; ADRs for architecture; OpenAPI generated from code; README per package.

## Developer onboarding
1. `git clone`; 2. `cd njtip-app && npm test` (no install); 3. `npm start` → open UI; 4. `npm run twin`;
5. read `ARCHITECTURE-BASELINE-v1.0.md`, `component-transition-matrix.md`, and the ADRs. First task:
add a test to the vertical slice and watch the Twin gate enforce invariants.
