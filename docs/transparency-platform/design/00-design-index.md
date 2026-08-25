# NJTIP — Design Phase Index

**Status:** DRAFT — Design Phase (produced; pauses for approval before Governance & engineering
work items, per ratified decision **D-11**).
**Inputs:** Discovery Phase (`../01`–`../11`) + Ratified Decisions (`../12`).
**Last updated:** 2026-07-07

> The Design Phase turns the validated Discovery model into an **implementation-ready reference
> architecture**, in the order the client ratified (**D-11**). Each document (a) states its
> scope and the decisions (D-##) it implements, (b) records major choices as **DDRs** mapped to
> STRIDE/LINDDUN threats, (c) states residual risks and trade-offs, and (d) gives **measurable
> success criteria** (the Quality Gates). Nothing here re-derives Discovery; it references it.

## Documents (D-11 order)

| # | Document | Implements | Focus |
|---|----------|-----------|-------|
| 01 | [Enterprise Reference Architecture](./01-enterprise-reference-architecture.md) | D-01,03,05,06,08,10 | The whole-system skeleton, **Constitutional Architecture** (3 zones), deployment-model comparison & hybrid justification, MVP slice |
| 02 | [Data Architecture](./02-data-architecture.md) | D-02,05,06,10 | Zone-isolated data ownership, minimization, retention, **Digital Chain of Custody**, **Justice Analytics**, per-field policy |
| 03 | [Integration Architecture](./03-integration-architecture.md) | D-06,07,10 | Event-driven backbone, standards-based external integration, **Interoperability Standards**, anti-corruption layers |
| 04 | [Security Architecture](./04-security-architecture.md) | D-01,02,06 | Zero Trust, IAM, cryptography & key management (threshold/HSM), secrets, IR/DR/BCP, monitoring hooks |
| 05 | [AI Architecture](./05-ai-architecture.md) | D-09,10 | Assistive-only, human-in-loop, out-of-decision-path, self-hosted sensitive models, evaluation & audit |
| 06 | [Observability Architecture](./06-observability-architecture.md) | D-05,10 | Metrics/logs/traces, SIEM/SecOps, tamper-evident audit, **Public Trust Index**, SLOs |
| 07 | [DevSecOps Architecture](./07-devsecops-architecture.md) | D-05,07 | Secure SDLC, supply chain (SLSA/SBOM), IaC, CI/CD, reproducible builds, environments |

## Cross-document invariants (must hold in every doc)

1. **Constitutional Architecture (D-06):** three data zones; no shared database; every
   cross-zone interaction is an audited, purpose-bound API/event behind an ACL.
2. **Operator-in-threat-model (D-01):** no single operator/admin can de-anonymize a reporter;
   de-anon-capable operations require M-of-N threshold.
3. **Technical inability to de-anonymize (D-02):** the system does not hold reporter identity to
   begin with; retention is minimized so compelled disclosure is bounded by legitimately-held data.
4. **AI never decides (D-09):** AI is advisory, explainable, logged, and architecturally outside
   every decision write-path.
5. **MVP-first (D-05):** each doc marks what is **MVP** vs **later phase**; the MVP is
   Confidential Reporting + Security Foundation + Secure Routing.
6. **🔒 human-expert-review-required** on anonymity, crypto, chain-of-custody, metadata, and AI
   before any implementation — even after design approval.

## DDR register (index)

DDRs are numbered globally across the Design phase and listed here as they are created.

| DDR | Title | Doc | Threats |
|-----|-------|-----|---------|
| DDR-01 | Modular, event-driven, three-zone reference architecture | 01 | I-6, E-3, T-5 |
| DDR-02 | Hybrid deployment model (in-country judiciary + resilient offshore governance) | 01 | I-1, I-2, D-1, RK-17 |
| DDR-03 | PWA-first client with offline drafting | 01 | DT-1, S-1, RK-21 |
| DDR-04 | Zone-isolated polyglot persistence, no shared DB | 02 | I-6, I-4, E-3 |
| DDR-05 | Data minimization + purpose-bound field policy + cryptographic erasure | 02 | I-1, ID-1, DD-1, NC-2 |
| DDR-06 | Digital Chain of Custody: hash-chained ledger + external anchoring | 02 | T-1, T-2, T-5 |
| DDR-07 | Event-driven backbone with outbox + schema registry; PII never crosses boundaries | 03 | I-6, DD-1, L-2 |
| DDR-08 | Standards-based external integration via per-system ACL gateways | 03 | I-6, T-4, RK-20 |
| DDR-09 | Zero-Trust access: phishing-resistant MFA, ABAC, zero standing privilege | 04 | S-3, E-1, E-3 |
| DDR-10 | Threshold (M-of-N) key custody + HSM; envelope encryption everywhere | 04 | I-1, E-1, RK-01 |
| DDR-11 | Metadata-resistant intake transport (onion/enclave) | 04 | I-2, ID-2, DT-1 |
| DDR-12 | AI as advisory sidecar, self-hosted for sensitive data, human-in-loop | 05 | T-7, DD-2, A-AI-* |
| DDR-13 | Tamper-evident, externally-anchored audit; SIEM/SecOps | 06 | T-2, R-2, R-3 |
| DDR-14 | Public Trust Index pipeline with disclosure control | 06 | I-8, L-1, DD-2 |
| DDR-15 | Secure SDLC: SLSA provenance, SBOM, reproducible builds, IaC, policy-as-code | 07 | T-3, RK-12 |

*Read `01`→`07`, then respond at the Design Approval Gate at the end of `07`.*
