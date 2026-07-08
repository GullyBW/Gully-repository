# Phase 4 · 03 — Compliance Mapping

**Traces:** Security `../design/04`, Data `../design/02`, Governance `../phase2/01-03`, Assurance
`../phase3/03`. **Convention:** **[VERIFIED]** = design maps to a widely-documented standard;
**`⟦validate⟧`** = Botswana-legal applicability pending counsel. 🔒 privacy-regulation & legal items.

---

## 1. Frameworks in scope

| Framework | Applicability | Status |
|-----------|--------------|--------|
| **Botswana Data Protection Act, 2018** | Primary legal obligation for personal data | `⟦validate⟧` 🔒 (counsel + Commissioner) |
| **Botswana cybercrime/evidence law** | Cybercrime & Computer Related Crimes Act; evidence admissibility | `⟦validate⟧` 🔒 |
| **GDPR principles** | Reference for privacy-by-design (where applicable) | [VERIFIED] reference only |
| **ISO/IEC 27001** | ISMS controls | [VERIFIED] design-aligned; certify later |
| **ISO/IEC 27701** | Privacy information management | [VERIFIED] design-aligned |
| **OWASP ASVS** | Application security verification | [VERIFIED] test target (`../phase3/04`) |
| **OWASP MASVS** | Mobile/PWA security | [VERIFIED] test target |
| **NIST CSF** | Cyber risk functions (Identify/Protect/Detect/Respond/Recover) | [VERIFIED] mapped below |
| **SOC 2 (where relevant)** | Trust-services criteria for any managed service | [VERIFIED] for vendors |

## 2. Control mapping (representative)

| Objective | Control (NJTIP) | Standard(s) | Evidence | Owner | Residual |
|-----------|-----------------|-------------|----------|-------|----------|
| Lawful, minimal data | No reporter identity; per-field policy; purpose limitation | DPA `⟦validate⟧`, 27701, GDPR-principle | `field_policy`, DPIA | PRB 🔒 | statutory interpretation (RK-22) |
| Access control | Zero standing privilege, FIDO2, ABAC | 27001 A.9, NIST PR.AC, ASVS | IAM config, access audit | ISRB | coerced insider |
| Encryption & keys | Envelope enc, HSM, threshold custody | 27001 A.10, NIST PR.DS | KMS policy, crypto review | Crypto 🔒 | compulsion residual (RK-01) |
| Evidence integrity | Chain of custody, anchoring | 27001, evidence law `⟦validate⟧` | custody ledger, anchor proof | Forensics 🔒 | admissibility ruling |
| Logging & detection | Tamper-evident anchored audit, SIEM | 27001 A.12, NIST DE | audit chain, SIEM rules | SecOps | anomaly false-negs |
| Incident response | IR runbooks, IRB, game-days | 27001 A.16, NIST RS | IR test report | IRB | novel attack |
| Resilience/recovery | DR/BCP, RTO/RPO | 27001 A.17, NIST RC | DR drill report | SRE | large-scale disaster |
| Supply chain | SLSA, SBOM, reproducible build | NIST SSDF, SLSA | provenance, SBOM | DevSecOps 🔒 | upstream 0-day |
| Privacy by design | Minimization, disclosure control, DPIA | 27701, GDPR-principle, DPA `⟦validate⟧` | DPIA, disclosure params | PRB 🔒 | re-identification (RK-11) |
| App security | ASVS/MASVS verification | OWASP | test results | QA/ISRB | new CVEs |
| Governance/assurance | Independent bodies, audits | 27001 clause 5/9, SOC 2 | charters, audit reports | OB | capture (RK-03) |

## 3. Evidence & review responsibilities

- Each control's **evidence artifact** is versioned in the **Production Evidence Package** (`13`).
- **Review cadence:** internal continuous (policy engine `../phase2/02 §6`) + independent annual
  audits (`../phase3/03 A8`, `12`).
- **Certification (optional/later):** ISO 27001/27701 certification and SOC 2 attestation for
  managed components are post-MVP goals, not launch blockers, but the design is built to pass them.

## 4. Verified vs assumption (explicit)

- **[VERIFIED]** control-to-standard alignment for ISO/NIST/OWASP/SOC 2 (these are public
  standards; our design maps to them).
- **`⟦validate⟧`** everything about **Botswana** statutory applicability, lawful basis, retention
  mandates, and evidence admissibility — **counsel + Commissioner must confirm.** 🔒

## 5. Quality gate

- **Traces to:** `../design/02/04`, `../phase2/*`, `../phase3/03`; A-LEG-01/05, NC-1.
- **Threats mitigated:** NC-1 (non-compliance), plus the security/privacy threats each control
  addresses.
- **Residual risks:** legal-applicability uncertainty (RK-22); certification effort; standard drift.
- **Trade-offs:** ⚠️ pursuing multiple frameworks adds overhead — bought for defensibility & funder
  confidence.
- **Acceptance criteria:** every in-scope control has an owner + evidence artifact; DPA/evidence-law
  items confirmed by counsel before go-live (readiness G2/G3).
- **🔒 Required review:** legal (DPA, evidence law), privacy (DPIA/27701), security (27001/ASVS),
  auditors (SOC 2).

*Next: `04-comparative-analysis.md`.*
