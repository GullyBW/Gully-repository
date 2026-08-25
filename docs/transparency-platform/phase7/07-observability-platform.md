# Phase 7 · WS7 — Observability Platform

**Traces:** Observability Architecture `../design/06`, Data `../design/02`, SRE `08`. **Purpose:** a
centralized observability capability every service plugs into — **privacy-aligned by construction**.
Observability here is itself in the threat model (DT-2, I-2): the platform must see enough to operate
without ever seeing enough to de-anonymize.

---

## 1. Observability pillars (privacy-budgeted)

| Pillar | Provided | Privacy rule (enforced) |
|--------|----------|-------------------------|
| **Structured logging** | Central, schema'd logs + redaction library | **No PII/IP/content/identity**; redaction at source; CI-checked |
| **Metrics** | RED/USE per service; SLO metrics | No identifying labels; aggregate only |
| **Distributed tracing** | Cross-service traces | Sampled; **no sensitive payloads**; non-identifying correlation IDs |
| **Dashboards** | Per-zone ops + platform | Access-controlled (ABAC) |
| **Alerting** | SLO burn + security + privacy alerts | Alert payloads carry no sensitive detail |
| **SLO management** | SLO definitions, error budgets, reports | Feeds Trust Index (`../phase2/09`) |
| **Operational analytics** | Aggregate ops insight | Disclosure-controlled if externalized |

## 2. The intake exception (crucial)

**[FACT]** The metadata-resistant intake path (DDR-11) emits **only aggregate health signals** — no
per-request telemetry that could correlate to a reporter. The observability platform **must not**
instrument the intake path the way it instruments ordinary services (that would reintroduce I-2). The
golden path for intake enforces this; governance automation (`03`) blocks richer telemetry there.

## 3. Zone-aware observability

- Each zone has its own logging/metrics pipeline; only **aggregates + audit digests** flow to the
  Independent zone for cross-system views — no raw cross-zone telemetry (I-6).
- Security observability (SIEM) and the tamper-evident audit (DDR-13) are part of the platform
  (`../design/06`), feeding SecOps (`08`).

## 4. Privacy-vs-observability, resolved

⚠️ Richer telemetry is operationally convenient and a de-anonymization hazard. NJTIP resolves for
privacy: **collect the minimum to operate**, budget telemetry, forbid PII/IP everywhere, and treat
the intake path as a special minimal-signal zone. The cost is harder debugging on the intake path —
accepted, and mitigated with synthetic-env reproduction (`../phase6/05`) instead of prod telemetry.

## 5. Quality gate

- **Traces to:** `../design/06`, `../design/02`; DT-2, I-2, I-6; DDR-11/13.
- **Preserves:** privacy budgeting; intake minimal-signal; zone isolation; no PII in any signal.
- **Threats mitigated:** DT-2/I-2 (telemetry leakage), I-6 (no raw cross-zone telemetry).
- **Residual risks:** minimal intake telemetry makes some incidents harder to diagnose (mitigated:
  synthetic reproduction, strong pre-prod testing).
- **Trade-offs:** ⚠️ less observability on the intake path than an ordinary service — accepted for
  reporter safety.
- **Acceptance criteria:** no PII/IP/content/identity in any log/metric/trace (CI + sampling audit);
  intake emits only aggregate health; dashboards access-controlled; SLOs feed Trust Index.
- **🔒 Required review:** SRE/observability lead, privacy engineer (telemetry), ISRB (SIEM/audit).

*Next: `08-sre-practices.md`.*
