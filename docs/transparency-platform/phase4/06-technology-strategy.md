# Phase 4 · 06 — Technology Strategy

**Traces:** all Design docs `../design/*`, DevSecOps `../design/07`, Interoperability `../phase2/07`.
**Premise:** justify technology by requirements and approved architecture — **not preference**;
avoid lock-in that threatens sustainability (A-FIN-02).

---

## 1. Technology selection principles

1. **Requirement- and threat-driven**, mapped to DDRs — never chosen on fashion.
2. **Open standards & open source preferred** for portability, auditability, and sovereignty
   (supports reproducible builds DDR-15 and independent review).
3. **Minimal TCB on the anonymity-critical path** — fewest, most-audited dependencies (T-3).
4. **Portability over lock-in** — avoid single-vendor dependencies that could strand the platform
   if a funder/vendor exits (A-FIN-02, RK-15).
5. **Proven over novel** for security-critical components; novelty only with expert review (🔒).
6. **Cost-predictable & FX-aware** (A-FIN-03) — favor in-region/BWP-denominated where feasible.

## 2. Selection by layer (categories, not mandates — final choices via ARB + ISRB)

| Layer | Selection criteria | Candidate class (illustrative) | Constraint |
|-------|--------------------|-------------------------------|------------|
| Client | Offline, low-bandwidth, verifiable, no store trail | PWA (web standards); optional wrapper | DDR-03; no 3P SDK on anonymity path |
| Intake transport | Metadata resistance, censorship resilience | Onion service / enclave + pluggable transports | DDR-11 🔒 |
| Services | DDD, event-driven, portable | Containerized services, language per fitness | zone isolation |
| Event backbone | Durable, ordered, replayable | Log-based broker + schema registry | PII-free events |
| Data | Polyglot per need; per-zone isolation | Relational + object store + append-only log store | DDR-04 |
| Crypto/keys | FIPS-validated HSM, threshold | HSM + KMS + threshold scheme | DDR-10 🔒 |
| IAM | Phishing-resistant, ABAC | OIDC + FIDO2 + policy engine | DDR-09 |
| Observability | Metrics/logs/traces + SIEM | Open observability stack | privacy-budgeted |
| IaC/CI-CD | Reproducible, policy-as-code | IaC + provenance (SLSA) + SBOM | DDR-15 |
| AI | Self-hosted for sensitive data, explainable | Self-hosted models + eval harness | D-09 🔒 |

## 3. Interoperability approach

Standards-based, versioned API/event contracts behind per-system ACLs (`../phase2/07`); no
cross-zone identity federation; conformance-tested onboarding. Aligns with national DPI patterns
(`10`).

## 4. Scalability strategy

- **Horizontal, stateless services** + autoscaling; read models (CQRS) absorb read load.
- **Intake availability is Tier-1** — scales independently and degrades to minimal-intake under
  stress (D-1/D-4).
- Capacity forecasting + load testing (`../phase3/04/06`); abuse/flood controls preserve anonymity
  (S-4/D-3).

## 5. Operational support model

Enterprise Service Management (`../phase3/06`) with zero standing privilege; blended in-country +
regional/remote specialists under operator-in-threat-model controls (A-OPS-01); managed SOC only
under the same JIT/dual-control/audit regime.

## 6. Lifecycle & modernization

- **Crypto-agility** (DDR-10): versioned primitives; planned post-quantum migration path.
- **Dependency lifecycle:** SBOM-tracked; patch SLAs; deprecate/replace on EOL.
- **Architecture evolution:** DDRs carry future-review triggers; ARB governs change; threat-model
  refresh semi-annually (`../phase3/03 A7`).
- **Data lifecycle:** retention + crypto-erase (`../design/02`); archive modernization over time.

## 7. Quality gate

- **Traces to:** DDR-03/04/09/10/11/15, D-07/D-09; `../design/*`, `../phase2/07`.
- **Threats mitigated:** T-3 (minimal TCB), plus enabling all security DDRs; supports RK-15 (lock-in).
- **Residual risks:** open-source maintenance burden; scarce local skills for some stacks (RK-18);
  FX on any foreign-priced tooling.
- **Trade-offs:** ⚠️ open-standards/portability can cost more up-front than a turnkey vendor —
  bought for sustainability and independence.
- **Acceptance criteria:** every technology choice traces to a requirement/DDR and passes ARB+ISRB;
  no lock-in on the anonymity-critical path; reproducible builds verified.
- **🔒 Required review:** ARB, ISRB, cryptographer (intake/keys), procurement (vendor terms).

*Next: `07-sustainability-funding-strategy.md`.*
