# 10 — Risk Register

> **Purpose.** Consolidate risks from the threat model (`08`), trust model (`09`), and the
> program/delivery dimension (funding, adoption, legal, governance) into one owner-assigned,
> ratable register. Security/privacy risks reference their STRIDE/LINDDUN IDs; program risks
> stand alone. This register is **live** — it is maintained through every later phase and is
> the source for GitHub "risk" and "security backlog" items in the Delivery phase.
>
> **Rating:** L and I on 1–5 (Impact scored **safety/rights-first**). Severity = L×I band:
> Low 1–5 · Medium 6–11 · High 12–19 · Critical 20–25 (per `08 §2.4`).

---

## 10.1 Critical & High risks (the ones that decide the program)

| ID | Risk | Cat | Threat ref | L | I | Sev | Detection | Mitigation | Recovery | Residual | Owner |
|----|------|-----|-----------|---|---|-----|-----------|------------|----------|----------|-------|
| RK-01 | Reporter de-anonymized via **compelled disclosure** | Security/Legal | I-1, NC-2 | 4 | 5 | **20 Crit** | Warrant canary, access audit, anomaly | Data minimization; threshold key custody so operator *cannot* comply; jurisdiction choice | Notify affected class via safe channel; invoke legal defence; governance disclosure | **Cannot be zeroed**; residual if minimization/threshold fails or custodians comply | Security Architect + Legal |
| RK-02 | Reporter de-anonymized via **metadata** | Privacy | I-2, ID-2, DT-1 | 4 | 5 | **20 Crit** | Traffic analysis monitoring, red-team | Metadata-resistant transport; no IP logs; padding; strip client metadata; no 3rd-party SDKs | Rotate transport (bridges); notify; forensic review | Global passive adversary (TA-6) | Privacy Engineer |
| RK-03 | **Governance capture** makes split-trust theatre | Governance | A-GOV-01, E-1 | 3 | 5 | **15 High** | Independent audit, transparency reporting, member vetting | Genuinely independent multi-stakeholder trust; CoI rules; M-of-N; term limits; public reporting | Reconstitute governance; external oversight; disclose | If capture succeeds, technical controls degrade | Governance Board |
| RK-04 | **Institutional non-participation** (arms don't adopt) | Program | A-JUS-05 | 3 | 4 | **12 High** | Adoption metrics, MoU status | Phased rollout; incentives; MoUs before Zone-O build; start with operator-controlled MVP | Re-scope to citizen-facing modes; escalate politically | Voluntary adoption never guaranteed | Program Sponsor |
| RK-05 | **Fake/phishing intake** harvests reports | Security | S-1 | 4 | 5 | **20 Crit** | CT monitoring, takedown intel, user reports | Signed reproducible builds; published fingerprints; cert/onion pinning; official channels | Revoke/rotate keys; public warning; takedown | User who never verifies | Security Architect |
| RK-06 | **Insider/operator** abuses access (Zone R de-anon or Zone O case-fixing) | Security | E-1, E-3, T-5 | 3 | 5 | **15 High** | Tamper-evident audit, anomaly detection, SoD alerts | Zero standing privilege; JIT+dual control; SoD; threshold; anomaly detection | Revoke; forensic; prosecute; disclose | Multi-party collusion | Security + Governance |
| RK-07 | **False confidence** harms a reporter (unclear risk comms) | Safety/Ethics | U-1, U-2 | 4 | 5 | **20 Crit** | Comprehension testing, UX research | Honest, layered, Setswana/English pre-submission risk UX; no over-claiming "anonymous" | Improve copy; targeted outreach; incident review | Users skip/misread warnings | Safety UX + Ethics |
| RK-08 | **Evidence integrity** disputed / inadmissible | Security/Legal | T-1, A-LEG-05 | 3 | 5 | **15 High** | Integrity checks on access, admissibility review | Hashing, trusted timestamp, append-only custody, admissibility-aligned records | Re-verify chain; expert testimony; legal | Garbage-in / off-platform handling | Forensics + Legal |
| RK-09 | **Separation-of-powers breach** (cross-arm over-reach) | Security/Legal | I-6, T-5 | 3 | 5 | **15 High** | Cross-zone access audit, anomaly | Arm-owned zones; no shared DB; ACL+ABAC; audited events only | Revoke grants; audit; constitutional escalation | Lawful-but-broad grants | Judicial advisor + Security |
| RK-10 | **Whistleblower protection** doesn't reach the channel (legal exposure to reporters) | Legal | A-LEG-02, NC-2 | 3 | 5 | **15 High** | Legal monitoring | Botswana legal review before launch; honest UX about legal status; route to protected authorities where needed | Adjust routing/model; legal support fund; disclose | Statutory interpretation shifts | Legal Counsel |
| RK-11 | **Re-identification from transparency data** | Privacy | I-8, L-1 | 3 | 5 | **15 High** | Disclosure-control review, red-team on published sets | k-anonymity/min-cell suppression; DP-style noise; governance sign-off per dataset | Withdraw dataset; tighten thresholds; notify | External-data linkage | Privacy Engineer |
| RK-12 | **Supply-chain compromise** of client/pipeline | Security | T-3 | 3 | 5 | **15 High** | SBOM diff, provenance checks, build verification | Reproducible builds; SLSA provenance; pinned deps; tiny TCB; signed releases | Rebuild from source; rotate; disclose | Nation-state upstream (TA-6) | DevSecOps |
| RK-13 | **DDoS / loss of availability** at a critical moment | Security | D-1, D-4 | 4 | 4 | **16 High** | Uptime + traffic monitoring | Privacy-aware DDoS scrubbing/CDN; autoscale; graceful degradation; onion DoS defenses; DR | Failover; degrade to minimal intake; scrub | Sustained state-scale DDoS | SRE |
| RK-14 | **AI assistance biases** triage/redaction/prioritization | AI/Fairness | T-7, A-AI-01/03 | 2 | 4 | **8 Med** | AI output audit, bias evaluation | Advisory-only; human-in-loop; version pinning; bias tests; self-hosted; audit | Roll back model; human re-review; disclose | Subtle residual bias | AI Systems + Ethics |

## 10.2 Program, funding & sustainability risks

| ID | Risk | Cat | L | I | Sev | Mitigation | Recovery | Owner |
|----|------|-----|---|---|-----|------------|----------|-------|
| RK-15 | **Funding shortfall / donor exit** threatens independence or continuity | Financial | 3 | 4 | **12 High** | Diversified funding; low idle-cost, portable architecture; endowment/sustainability plan (A-FIN-02) | Reduce scope to core safety functions; seek bridge funding | Sponsor + Finance |
| RK-16 | **FX volatility** (BWP/USD) inflates offshore/tooling cost | Financial | 3 | 3 | 9 Med | FX contingency; prefer in-region/BWP spend; avoid lock-in | Re-budget; renegotiate | Finance |
| RK-17 | **Political pressure** to defund, legislate against, or capture the platform | Governance/Political | 3 | 5 | **15 High** | Independence; offshore governance fallback; broad stakeholder coalition; transparency | Activate resilience plan; public/donor support | Governance Board |
| RK-18 | **Scarce local security/crypto expertise** → weak implementation or slow IR | Operational | 3 | 4 | **12 High** | Regional/remote sourcing under operator-in-threat-model controls; managed SOC; training pipeline (A-OPS-01) | Emergency expert engagement | Ops Lead |
| RK-19 | **Scope creep** beyond justice-sector / MVP | Program | 3 | 3 | 9 Med | Purpose limitation; governance gate for new domains (DD-2/DD-3); firm MVP cut line | Re-baseline scope | Product |
| RK-20 | **Legacy-system integration** harder/costlier than assumed | Technical | 3 | 4 | **12 High** | Integrate-not-replace via ACLs (A-JUS-02); phased; discovery of each system | Prioritize highest-value integrations; defer rest | Solution Architect |
| RK-21 | **Low digital literacy / connectivity** limits adoption & equity | Adoption/Equity | 3 | 4 | **12 High** | Multi-channel, Setswana-first, offline, assisted access, accessibility (P5) | Add channels; community intermediaries | UX + Program |
| RK-22 | **Data-protection non-compliance** (DPA/Commissioner) | Legal/Compliance | 2 | 4 | 8 Med | DPIA; compliance-by-design; Commissioner engagement (NC-1) | Remediate; notify regulator | Legal + Privacy |
| RK-23 | **Customary-justice mishandling** excludes or disrupts dikgotla | Equity/Cultural | 2 | 4 | 8 Med | Co-design with Kgosis; don't impose formal models (A-JUS-06) | Redesign with community input | Cultural advisor + Product |
| RK-24 | **Physical coercion** of reporter/operator/governance member | Safety | 2 | 5 | **10 Med** | Ephemerality; panic mode; split trust so one coerced person can't de-anon; duress procedures | Support affected person; invoke IR | Security + Governance |

## 10.3 Risk heat summary

| Severity | Count | IDs |
|----------|-------|-----|
| **Critical (20–25)** | 4 | RK-01, RK-02, RK-05, RK-07 |
| **High (12–19)** | 13 | RK-03, RK-04, RK-06, RK-08, RK-09, RK-10, RK-11, RK-12, RK-13, RK-15, RK-17, RK-18, RK-20, RK-21 |
| **Medium (6–11)** | 7 | RK-14, RK-16, RK-19, RK-22, RK-23, RK-24, (RK-16) |
| Low | 0 tracked | — |

> **Interpretation.** The Critical cluster is entirely **reporter-safety** (de-anonymization by
> compulsion, metadata, phishing) and **honesty** (false confidence). The High cluster splits
> between **integrity/separation-of-powers** (Zone O) and **program viability** (funding,
> adoption, political pressure, integration, equity). A purely technical program that ignores
> RK-03/04/10/15/17 (governance, participation, law, funding, politics) **will fail even if the
> code is perfect** — which is why governance is designed as a first-class subsystem.

## 10.4 Risk governance

- **Ownership:** every risk has a named owner role; owners report status to the governance
  Audit/Risk committee on a fixed cadence (defined in Governance batch).
- **Triggers for re-rating:** any incident, any assumption invalidation (`01`), any scope
  change, any change in the Botswana legal/political environment.
- **Traceability:** each risk links to threats (`08`), assumptions (`01`), and — from the
  Delivery phase — to the mitigating GitHub epics/stories and their acceptance criteria.

## 10.5 Definition-of-Done

- [x] Consolidated register with L/I/severity, detection, mitigation, recovery, residual, owner.
- [x] Security/privacy risks cross-referenced to STRIDE/LINDDUN; program risks included.
- [x] Heat summary and honest interpretation (technical success ≠ program success).
- [x] Risk-governance cadence, re-rating triggers, and traceability defined.
- **Required specialist review:** security, privacy, legal, governance, finance, and program/
  change-management leads each own and validate their rows before the register is baselined.

*Next: `11-discovery-confirmation-checkpoint.md` — the blueprint stops there.*
