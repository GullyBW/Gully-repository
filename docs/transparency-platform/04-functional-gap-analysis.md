# 04 — Functional Gap Analysis

> **Method.** For each capability area we state the *current state* (assumed baseline —
> tagged `⟦validate⟧`, since Botswana-specific maturity must be confirmed), the *desired
> state*, the resulting **gap**, its priority, the **owning NJTIP component** that closes it,
> and the **root problem (P#)** it traces to. This is the bridge from Problem Analysis (`02`)
> to the Capability Map (`07`) and Service catalogue (`05`).
>
> **Priority key:** MVP (release 1) · Phase 2 · Phase 3+. Priorities are *proposals* subject
> to the Confirmation Checkpoint (scope + separation-of-powers decisions may move items).

---

## 4.1 Gap table — Citizen & Reporting

| Capability | Current (assumed) `⟦validate⟧` | Desired | Gap | Prio | Owning component | Root |
|-----------|-------------------------------|---------|-----|------|------------------|------|
| Confidential integrity reporting | No trusted safe channel; fear of retaliation | Metadata-resistant, operator-in-threat-model anonymous reporting | Safe channel absent | **MVP** | Secure Reporting Portal · Citizen App/PWA | P1 |
| Honest risk communication | Users unaware of residual risk | Layered, Setswana/English, pre-submission risk guidance | Informed-consent gap | **MVP** | Citizen App/PWA (safety-critical UX) | P1/U-1 |
| Report status without de-anonymizing | None | Anonymous case thread + non-attributable responsiveness metrics | "Black hole" | **MVP** | Reporting Portal · Notification | P1/R-1 |
| Multi-channel access | Smartphone-only assumed | Smartphone/PWA + (per checkpoint) USSD/SMS/voice + offline draft | Reach gap | MVP→P2 | Citizen App/PWA · Notification | P5 |
| Setswana-first, accessible, low-literacy UX | English-dominant, complex | Bilingual, iconographic, WCAG, trauma-informed | Exclusion | **MVP** | All citizen surfaces | P5/P9 |
| Case & rights information | Fragmented/none | Guidance on formal + customary pathways, next steps | Information asymmetry | P2 | Citizen App · Transparency Portal | P5/P9 |

## 4.2 Gap table — Investigation & Prosecution

| Capability | Current (assumed) `⟦validate⟧` | Desired | Gap | Prio | Owning component | Root |
|-----------|-------------------------------|---------|-----|------|------------------|------|
| Report/tip intake to investigators | Manual, siloed | Conflict-of-interest-aware routing to authorized recipients | Mis-routing / self-review risk | **MVP** | Investigator Workspace · API Gateway · Governance routing | P4/P7/T-4 |
| Evidence capture with chain of custody | Paper logs, no tamper-evidence | Cryptographic hashing, trusted timestamp, append-only custody | Integrity unprovable | **MVP** | Evidence Management System | P3/T-1 |
| Case collaboration (police↔DPP) | Re-keying, handoff loss | Shared, permissioned case model + events | Fragmentation | P2 | Case Management · Investigator/Prosecutor Workspaces | P4 |
| Disclosure tracking | Manual | Audited disclosure workflow (equality of arms) | Disclosure failures | P2 | Prosecutor · Public Defender Workspaces | P9 |
| Least-privilege sensitive actions | Broad access | Dual control, JIT access, full audit | Insider misuse | **MVP (for evidence)** | IAM · Audit Platform | P7/E-1 |

## 4.3 Gap table — Adjudication & Courts

| Capability | Current (assumed) `⟦validate⟧` | Desired | Gap | Prio | Owning component | Root |
|-----------|-------------------------------|---------|-----|------|------------------|------|
| Single source of case status | Fragmented across agencies | Judiciary-owned case state machine, role-scoped visibility | No source of truth | P2 | Case Management · Court Admin Portal | P2/P4 |
| Shared scheduling / cause list | Manual, conflict-prone | Shared calendar, conflict detection, notifications | Delay from scheduling | P2 | Court Admin Portal · Notification | P2 |
| Court document & records management | Paper/hybrid, loss-prone | Digital records + integrity + registrar-controlled sealing | Records loss | P2→P3 | Digital Archive · Court Admin Portal | P8 |
| Judicial-independence data ownership | Ad hoc | Hard trust boundary; executive cannot read judiciary data | Separation-of-powers risk | **MVP (as architecture rule)** | IAM · Trust Model | P4/A-JUS-03 |
| Open-justice-compliant publication | None/manual | Auto-redacted, exception-aware publication | Unlawful disclosure/over-suppression | P3 | Transparency Dashboard | P6/A-JUS-04 |
| Appeals workflow | Manual | Structured, transparent appeals state machine | Due-process gap | P3 | Case Management · Governance | P9 |

## 4.4 Gap table — Corrections, Oversight & Transparency

| Capability | Current (assumed) `⟦validate⟧` | Desired | Gap | Prio | Owning component | Root |
|-----------|-------------------------------|---------|-----|------|------------------|------|
| Remand/over-detention visibility | Not linked to case delay | Remand-status linkage surfaced to oversight | Over-detention unseen | P3 | Prison integration · Analytics · Oversight Portal | P2 |
| Responsiveness accountability | None | Non-attributable intake→action latency metrics | Unaccountable "black hole" | P2 | Oversight Portal · Analytics | P1/P6/R-1 |
| Independent oversight tooling | Limited | Oversight Portal + pattern analytics + escalation | Weak scrutiny | P2 | Oversight Portal | P6/P7 |
| Public transparency dashboard | None | Verified, aggregated, anonymized, non-attributable stats | Transparency deficit | P2 | Transparency Dashboard · Analytics | P6 |
| Policy analytics | Anecdote-driven | Privacy-preserving aggregate insight, purpose-limited | Weak evidence base | P3 | Analytics Platform | P10 |
| Tamper-evident audit | Weak/none | Append-only, externally-anchored audit across platform | Undetected abuse | **MVP** | Audit Platform | P7/T-2 |

## 4.5 Gap table — Cross-cutting platform capabilities

| Capability | Current (assumed) `⟦validate⟧` | Desired | Gap | Prio | Owning component | Root |
|-----------|-------------------------------|---------|-----|------|------------------|------|
| Identity & access (humans + services) | Fragmented per agency | Federated IAM, zero trust, phishing-resistant MFA, ABAC | Weak authz | **MVP** | Identity Platform · API Gateway | P7/S-3/E-1 |
| Secure messaging | Insecure/ad hoc | E2E-appropriate secure messaging per mode | Comms exposure | MVP→P2 | Secure Messaging Platform | P1/P9 |
| Notifications | None/manual | Event-driven, privacy-aware notifications | Info gaps | MVP | Notification Platform | P2/P5 |
| Encryption & key management | Inconsistent | Central crypto/KMS/HSM, threshold custody for anonymity | Confidentiality risk | **MVP** | KMS/HSM · Security Arch | I-1/I-4/E-1 |
| AI assistance (bounded) | None | Translation, categorization, dedup, PII redaction, summarization, prioritization — human-in-loop | Manual overload / language gap | P2 | AI Decision-Support Services | P5/P10/A-AI-01 |
| Observability & SIEM | Limited | Metrics, logs, tracing, SIEM, anomaly detection | Blind operations | **MVP** | Monitoring Platform | P7 |
| DR & business continuity | Unknown | Backups, DR site, tested RTO/RPO | Outage/data loss | **MVP** | DR Platform | NFR |
| Digital archive | Paper/loss-prone | Integrity-protected, retention-governed archive | Memory loss | P3 | Digital Archive | P8 |

## 4.6 MVP vs later — proposed cut line (for checkpoint)

**Proposed MVP (release 1)** concentrates on the highest-leverage, lowest-inter-agency-
dependency, safety-critical slice:

1. **Confidential reporting** (Citizen App/PWA + Secure Reporting Portal) with honest risk UX.
2. **Evidence Management** with cryptographic integrity (needed by any recipient action).
3. **Conflict-of-interest-aware routing** to authorized recipients + **Investigator intake**.
4. **IAM + KMS/HSM + tamper-evident Audit + Monitoring + DR** (the security spine everything
   else needs).
5. **Non-attributable responsiveness metrics** so Mode 1 is not a black hole.

**Deferred to Phase 2+** (higher inter-agency dependency, needs A-JUS-05 participation):
full case management across courts, prosecutor/defender workspaces, court admin/scheduling,
public transparency dashboard, oversight analytics, prison integration, digital archive,
AI services, appeals.

> **Rationale.** MVP delivers the safety-critical, mostly operator-controlled slice (Mode 1 +
> the security spine) that does **not** depend on every institution adopting simultaneously
> (A-JUS-05 is the biggest delivery risk). Court/prosecution/defence workspaces are
> sequenced *after* institutional MoUs exist. This is a proposal — **Q5/scope at the
> checkpoint may change it.**

## 4.7 Definition-of-Done

- [x] Gaps derived from current→desired across all justice domains and cross-cutting platform.
- [x] Each gap mapped to an owning component and back to a root problem (P#).
- [x] Priorities proposed with an explicit, justified MVP cut line for checkpoint decision.
- [x] Botswana-specific baselines tagged `⟦validate⟧`.
- **Required specialist review:** institutional-systems audit to confirm current-state
  baselines; product/sponsor to ratify MVP cut line; security review of the "security spine"
  as MVP-mandatory.

*Next: `05-service-blueprint.md`.*
