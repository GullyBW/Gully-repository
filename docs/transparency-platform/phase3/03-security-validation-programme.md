# Phase 3 · WS3 — Security Validation Programme (Continuous Assurance)

**Operationalizes:** Security `../design/04`, Observability `../design/06`, DevSecOps
`../design/07`, ISRB `../phase2/01` · **Traces:** whole threat model `../08`, RK-01/02/06/12/13.

> A **continuous** assurance programme (not a one-off audit). Each activity has scope, frequency,
> owner, success criteria, and reporting. Because the operator is in the threat model (D-01) and
> the top risks are de-anonymization and insider abuse, assurance must repeatedly attack the
> platform's own controls — especially anonymity, threshold custody, chain-of-custody, and
> metadata handling. 🔒 Cryptographic-review and key-custody activities require external expert
> validation.

---

## 1. Assurance activities

| # | Activity | Scope | Frequency | Owner | Success criteria | Reporting |
|---|----------|-------|-----------|-------|------------------|-----------|
| A1 | **Penetration testing** | External + authenticated app/API, intake path, zone boundaries | Pre-go-live + ≥ annual + on major change | ISRB (external firm 🔒) | No High/Critical open at go-live; findings tracked to closure | ISRB→OB |
| A2 | **Red team** | Goal-based: attempt to de-anonymize a test reporter; breach a zone; case-fix | ≥ annual + pre-national-rollout | ISRB (external 🔒) | Red team cannot de-anon/zone-breach without detected collusion | ISRB→OB, IRB |
| A3 | **Blue team** | Detection & response effectiveness vs A2/A5 | Continuous + per exercise | SecOps/OMT | Detections fire; MTTR within target | SecOps→ISRB |
| A4 | **Purple team** | Joint red+blue to improve detections | Semi-annual | ISRB + SecOps | Detection gaps closed; new rules deployed | ISRB→OB |
| A5 | **Vulnerability management** | Continuous scanning (SAST/DAST/SCA), triage, patch SLAs | Continuous | DevSecOps | Critical patched ≤ SLA; no unpinned deps | Dashboard→ISRB |
| A6 | **Supply-chain review** | SBOM diff, provenance (SLSA), reproducible-build verification, dependency risk | Per build + quarterly deep review | DevSecOps 🔒 | Independent rebuild matches fingerprint; no unvetted deps | ISRB |
| A7 | **Threat-model review** | Refresh `../08` for new components/threats; re-rate risks | Semi-annual + on major change | ARB + ISRB | Model current; new threats have mitigations + RTM rows | ARB→OB |
| A8 | **Security audits** | Control effectiveness vs ISO 27001/ASVS/MASVS-style baselines | Annual (independent) | ISRB (external 🔒) | Findings closed; controls evidenced | OB + public (aggregate) |
| A9 | **Cryptographic review** | KMS/HSM, threshold custody, envelope encryption, primitives, crypto-agility/PQC readiness | Pre-go-live + annual + on crypto change | External cryptographer 🔒 | No exploitable weakness; threshold correctness proven | ISRB→OB |
| A10 | **DR testing** | Per-zone restore; ciphertext-only offshore; key≠ciphertext; RTO/RPO | Semi-annual + pre-go-live | SRE + ISRB | RTO/RPO met; separation verified | OB (readiness) |

## 2. How activities attack the crown-jewel controls

| Control | Attacked by | Must survive |
|---------|-------------|--------------|
| Anonymity / no-identity (D-02) | A1, A2, A9 | Red team cannot recover a test reporter's identity |
| Threshold custody (DDR-10) | A2, A9 | No de-anon-capable op without M distinct custodians |
| Metadata-resistant intake (DDR-11) | A1, A2 | No IP/metadata linkage recoverable |
| Zone isolation (DDR-04) | A1, A2, A7 | No cross-zone raw read/DB path |
| Chain of custody (DDR-06) | A1, A9 | Tamper always detected; ledger anchored |
| Supply chain (DDR-15) | A6 | Reproducible build verified independently |

## 3. Findings management

- All findings → central register with severity, owner, SLA, and **link to the threat/risk they
  realize** (traceability, no orphans).
- Critical/High **block go-live** (feeds readiness scorecard `07` and go-live gate `08`).
- Independent-audit and pen-test **completion + closure rate** feed the **Public Trust Index**
  (`../phase2/09`, security-posture + independence components).

## 4. Quality gate

- **Traces to:** `../08` (all), D-01/D-02; DDR-04/06/10/11/15; RK-01/02/06/12/13.
- **Threats mitigated:** validates mitigations for I-1/I-2, E-1/E-3, T-1/T-2/T-3, D-1 — assurance
  that designed controls actually hold.
- **Residual risks:** assurance reduces but cannot prove absence of 0-days/nation-state (TA-6);
  scarce local expertise → external sourcing (RK-18, 🔒 procurement).
- **Dependencies:** external firms (procurement), synthetic-data test env (`../design/07 §3`),
  ISRB constituted (`01`).
- **Trade-offs:** ⚠️ continuous external assurance is costly — accepted; a single credible
  de-anonymization ends the platform.
- **Measurable outcomes:** each activity scheduled with owner + criteria; no open Critical/High at
  go-live; red team cannot de-anon/zone-breach; crypto review clean; DR meets RTO/RPO.
- **🔒 Required review:** external penetration/red-team firm, external cryptographer, ISRB;
  procurement for firm selection.

*Next: `04-enterprise-test-strategy.md`.*
