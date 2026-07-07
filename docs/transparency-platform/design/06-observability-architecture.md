# Design 06 — Observability Architecture

**Implements:** D-05, D-10 · **Inputs:** Security `04`, Data `02`, Risk `../10`.

> Three intertwined concerns: **operational observability** (metrics/logs/traces + SLOs),
> **security observability** (SIEM/SecOps + tamper-evident audit), and **public accountability
> observability** (the **Public Trust Index** + Justice Analytics). All must observe the system
> **without becoming a de-anonymization or privacy hazard** — observability is itself in the
> threat model (DT-2, I-2).

---

## 1. Principles

- **Privacy-budgeted telemetry:** collect the minimum needed to operate; **no reporter IP, no
  content, no identity** in logs/metrics/traces; the intake path emits only aggregate health
  signals.
- **Zone-aware:** each zone has its own logging/metrics pipeline; only **aggregates and audit
  digests** flow to the Independent zone for cross-system views.
- **Tamper-evidence over convenience:** audit is append-only and anchored (below).

## 2. Operational observability

| Signal | Approach | Notes |
|--------|----------|-------|
| Metrics | Prometheus-style per service + SLO burn alerts | RED/USE metrics; no PII labels |
| Logs | Structured, per-zone aggregation; redaction at source | PII-scrubbing enforced (CI-tested) |
| Traces | Distributed tracing across services | Sampled; no sensitive payloads |
| Dashboards | Per-zone ops + platform SRE | Access-controlled (ABAC) |

**SLOs (seed — refine in ops phase):** intake availability ≥ 99.9% (a filing must succeed when
it matters); routing latency P95 target; evidence integrity-check success 100%; DR restore
within RTO/RPO. Error budgets gate risky deploys (`07`).

## 3. Security observability — SIEM / SecOps

### DDR-13 — Tamper-evident, externally-anchored audit; SIEM/SecOps
| Field | Content |
|-------|---------|
| **Context** | Insider/operator abuse (E-1/E-3), case-fixing (T-5), and repudiation (R-2/R-3) must be **detectable** even by/against privileged staff. |
| **Decision** | A platform-wide **append-only, hash-chained audit** with **periodic external anchoring** of digests (independent transparency log/notary). **Separation of duties**: log administrators ≠ system administrators; auditors have independent read. Security events stream to a **SIEM** with **anomaly detection** on privileged access, cross-zone egress, evidence access, and threshold operations. 24/7 **SecOps** (in-house or vetted managed, A-OPS-01) runs the IR playbooks (`04 §5`). |
| **Alternatives** | Mutable DB logs — rejected (T-2). Internal-only audit — rejected (privileged actor can erase). |
| **Threats mitigated** | T-2, R-2, R-3, E-1, E-3, T-5 |
| **Privacy implications** | Audit stores actor/action refs + hashes, not content or reporter identity; anchoring exposes only digests. |
| **Trade-offs** | ⚠️ anchoring/SoD operational overhead; append-only storage growth (retention-governed). |
| **Future review trigger** | New privileged capability; anchor provider change; hash deprecation. |

**What is audited:** every privileged action, every cross-zone event/API call, every evidence
and case-record access, every threshold operation, every AI invocation + human decision, every
governance decision. **What is not:** reporter identity (does not exist), report content (only
access refs).

## 4. Public accountability observability

### DDR-14 — Public Trust Index pipeline with disclosure control
| Field | Content |
|-------|---------|
| **Context** | Public trust is the asset that makes the platform usable (A10); it must be *measurable, honest, and non-attributable* (P6, D-10). |
| **Decision** | Compute a **Public Trust Index** from independently-verifiable inputs — **responsiveness** (intake→action latency, non-attributable), **uptime/SLO adherence**, **evidence-integrity-check pass rate**, **independent-audit results**, **adoption**, and **transparency-report cadence** — via the **Justice Analytics** pipeline (`02 §4`) with **k-anonymity/DP disclosure control**. **Methodology is published**; inputs are auditable; **no individual case or person is exposed.** |
| **Alternatives** | Opaque "trust score" — rejected: unaccountable, gameable. Raw case stats — rejected (re-identification I-8, breaches Mode-4 rules). |
| **Threats mitigated** | I-8, L-1, DD-2 (via purpose limitation), R-1 (responsiveness exposes "black hole") |
| **Privacy implications** | Aggregate-only, thresholded, methodology-transparent. |
| **Legal implications** | Publication respects open-justice exceptions (A-JUS-04, NC-3); governance signs off each dataset. |
| **Trade-offs** | ⚠️ a composite index can mislead if over-simplified — mitigated by publishing components + methodology, not just a headline number. |
| **Future review trigger** | New input metric; methodology change; gaming detected. |

**Index composition (illustrative — validate with oversight/stakeholders):**
| Component | Source | Direction |
|-----------|--------|-----------|
| Responsiveness | Oversight/Analytics (non-attributable latency) | higher = better |
| Availability | SLO adherence | higher = better |
| Integrity | Evidence/audit integrity-check pass rate | higher = better |
| Independence | Independent-audit findings closed | higher = better |
| Adoption | Aggregate usage (privacy-preserving) | context |
| Transparency | Report cadence met | higher = better |

## 5. Observability vs privacy (the tension, resolved)

| Risk | Control |
|------|---------|
| Telemetry leaks reporter identity (DT-2, I-2) | No IP/identity/content in any signal; intake emits only aggregate health |
| Trace payloads leak sensitive data | No sensitive payloads; sampling; redaction |
| Trust Index enables re-identification (I-8) | k-anon/DP + suppression + governance sign-off |
| Audit itself becomes a surveillance tool (DD-2) | Purpose limitation; auditors read for accountability only; access audited |

## 6. Quality gate

- **Threats mapped:** T-2, R-2/R-3, E-1/E-3, T-5, I-8, L-1, DD-2, DT-2, I-2, R-1.
- **Residual risks:** anomaly-detection false negatives; index gaming; auxiliary-data
  re-identification (RK-11); managed-SOC trust boundary (A-OPS-01 → operator-in-threat controls).
- **Trade-offs:** telemetry richness vs privacy (resolved for privacy); index simplicity vs
  honesty (resolved by publishing components + methodology).
- **Success criteria:** no PII/IP/content in any log/metric/trace (CI + sampling audits);
  audit chain verifies + anchors on schedule; SIEM alerts on all privileged/cross-zone/threshold
  events; Trust Index publishes on cadence with public methodology and no sub-threshold cells.
- **Specialist review:** 🔒 SRE/observability, security (SIEM/audit), privacy (telemetry + index),
  statistics (disclosure control), oversight bodies (index composition).

*Next: `07-devsecops-architecture.md`.*
