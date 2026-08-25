# Phase 6 · WS9 — DevSecOps Engineering (Implementation Guidance)

**Operationalizes:** DevSecOps Architecture `../design/07`, Standards `04`. **Implementation-ready**
guidance for IaC, CI/CD, automated security testing, supply-chain security, SBOM, artifact signing,
deployment automation, rollback, and DR validation — all synthetic-data, all fail-closed.

---

## 1. Infrastructure as Code
- Everything as IaC; per-zone modules with isolated networks/stores/keys (`../design/02`); immutable
  images; drift detection; **policy-as-code gates** (zone isolation, no-secret, controls-present).
- No manual production changes; break-glass is JIT + dual-control + recorded (`../phase3/06`).

## 2. CI/CD pipeline (build-ready stages)
```
lint → unit → SAST + secret-scan → SCA + SBOM-diff + provenance(SLSA) →
policy-as-code(conftest) → invariant-tests(no-cross-zone-DB, no-identity-col, field-policy) →
DAST → contract-tests → [HUMAN gate if 🔒 path] → sign artifacts → deploy(synthetic staging)
                                                              prod stage: BLOCKED unless ORG_GATE==GREEN
```
Fail-closed: any stage failure blocks; missing ISRB token on 🔒 path blocks; gate ≠ GREEN blocks prod.

## 3. Automated security testing
- SAST + DAST + dependency/container scanning in CI; periodic pen test/red team out-of-band
  (`../phase3/03`); fuzzing on input parsers; **privacy tests** (no PII/IP retained) as blockers.

## 4. Software supply-chain security
- **SLSA provenance** for every artifact; pinned deps; **reproducible builds** with **independent
  rebuild verification** + **published client fingerprint** (S-1); minimal TCB on 🔒 paths (T-3).

## 5. SBOM generation
- SBOM per build (CycloneDX/SPDX-style); **diff vs previous** — new/unpinned/vulnerable deps block;
  SBOM archived as evidence (EV-05).

## 6. Artifact signing
- All artifacts + releases **cryptographically signed**; signatures verified at deploy; signing keys
  in HSM; client build fingerprints published for user verification (authenticity, S-1).

## 7. Deployment automation & rollback
- Progressive delivery (canary/blue-green); automated **rollback** on SLO burn or invariant/security
  alarm; feature flags/kill-switches (disable a channel/AI task without redeploy); every deploy
  audited.

## 8. Disaster-recovery validation
- Automated **DR drills** per zone (restore, RTO/RPO); verify **ciphertext-only offshore** and
  **key≠ciphertext co-location**; degrade-to-minimal-intake tested; results → evidence (EV-11).

## 9. What DevSecOps must NOT do
- Never deploy to production (no prod target in the reference impl); never auto-merge 🔒 changes;
  never use production data; never bypass the readiness gates. **[FACT]** enforced by pipeline
  design, not policy alone.

## 10. Quality gate

- **Traces to:** `../design/07`, `04`; DDR-15; T-3, S-1, RK-12/13.
- **Preserves:** fail-closed, autonomy boundary, synthetic-only, gate enforcement.
- **Residual risks:** upstream/nation-state supply-chain (TA-6) reduced not removed; pipeline-insider
  (mitigated: SoD, signing, provenance, audit).
- **Trade-offs:** ⚠️ reproducible builds + provenance + gates slow delivery — bought for supply-chain
  trust and safety.
- **Acceptance criteria:** pipeline enforces all gates; independent rebuild matches fingerprint; SBOM
  diffed; DR drill passes; prod stage disabled/blocked.
- **🔒 Required review:** DevSecOps lead, ISRB (signing/HUMAN gate), SRE (DR), supply-chain security.

*Next: `10-engineering-governance.md`.*
