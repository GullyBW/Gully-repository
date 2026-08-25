# Phase 5 · WS3 — Implementation Master Plan

**Operationalizes:** Roadmap `../phase2/06`, Readiness `../phase3/07`, Recommendations `02`. Adds the
**review/gate/decision-point detail** per phase. **Timelines are indicative `⟦validate⟧`, not
commitments** (depend on funding, staffing, institutional participation).

---

## 1. Master timeline (indicative)

```mermaid
gantt
  dateFormat YYYY-QQ
  title NJTIP Indicative Master Plan (validate)
  section Foundations
  P0 Governance & Readiness      :p0, 2026-Q3, 2q
  P1 Security Foundation         :p1, after p0, 3q
  section MVP
  P2 Confidential Reporting MVP  :p2, after p1, 2q
  Pilot (Wave 0)                 :pilot, after p2, 1q
  section Scale
  P3 Integration Platform        :p3, after pilot, 3q
  P4 Justice Services Expansion  :p4, after p3, 4q
  P5 National Rollout            :p5, after p4, 3q
  P6 Continuous Improvement      :p6, after p5, 4q
```

## 2. Per-phase plan (objectives · reviews · gates · exit)

| Phase | Objectives | Governance/Legal/Privacy/Security reviews | Procurement & funding | Quality gate | Exit criteria |
|-------|-----------|-------------------------------------------|-----------------------|--------------|---------------|
| **P0** | Constitute governance; legal/privacy validation; readiness setup | OB charters; legal opinions 🔒; DPIA; independent arch review | Funding P0–2 secured 🔒; HSM procurement start 🔒 | ORG G1–G5,G9,G10 evidence | Governance live; legal/privacy GREEN; funding committed |
| **P1** | Security Foundation on synthetic data | ISRB reviews; crypto review 🔒; DR drill | HSM delivered; SOC vendor (if any) 🔒 | SR-001..005, PR-002 pass | Security spine tests pass; independent review booked |
| **P2** | Confidential Reporting MVP | Pen test + red team 🔒; safety-UX + EC review; privacy tests | MVP recipient MoUs 🔒 | **ORG fully GREEN**; go-live gate | FR-001..009 pass; pilot launched |
| **Pilot** | Wave 0 evaluation | Hypercare; PIR; IRB | — | Pilot success metrics | Evaluation passed; lessons captured |
| **P3** | Integration platform | Integration + privacy review; data-sharing legal 🔒 | Institutional MoUs 🔒 | Per-integration ORG | ≥1 conformance-green integration |
| **P4** | Justice services (per MoU) | Judicial validation 🔒; per-service reviews | Per-institution agreements 🔒 | Per-service ORG | Services onboarded, gate-passed |
| **P5** | National rollout | Capacity/security re-review; channel decision (D-04) | Telecom/zero-rating 🔒 | Go-live per scope | National SLOs + equity metrics met |
| **P6** | Continuous improvement | Annual independent reviews (`08`) | Sustainability funding 🔒 | Continuous | Governed by OB |

## 3. Decision points (executive)

| DP | When | Decision | Owner 🔒 |
|----|------|----------|---------|
| DP-1 | End P0 | Proceed to build? (governance+legal+funding GREEN) | OB |
| DP-2 | End P1 | Security foundation accepted? | ISRB/OB |
| DP-3 | End P2 | **Production go-live for MVP?** (ORG GREEN + PEP signed) | OB |
| DP-4 | End Pilot | Scale to Wave 1? | OB/TSC |
| DP-5 | Per institution | Onboard this institution? (MoU + judicial validation) | OB |
| DP-6 | End P4 | National rollout + channel expansion? | OB |

## 4. Dependency highlights (critical path)

**[FACT]** Critical path runs **funding → governance/threshold custodians → security foundation →
independent review → MVP go-live**. **[REC]** Institutional MoUs (P3/P4) are the biggest *external*
dependency (RK-04) and should be pursued from P0 in parallel, since they gate all Zone-O work.

## 5. Quality gate

- **Traces to:** `../phase2/06`, `../phase3/07/08`, `02`; D-05.
- **Preserves:** MVP-first sequencing; no phase to production without its gate.
- **Residual risks:** timelines slip on funding/participation (`⟦validate⟧`); critical-path
  concentration on P0 human decisions.
- **Trade-offs:** ⚠️ parallel-tracking build (synthetic) with governance/legal reduces schedule risk
  but needs disciplined gate enforcement so nothing sneaks to prod early.
- **Acceptance criteria:** every phase has reviews/gates/exit criteria + a decision point; critical
  path identified; no gate bypass path exists.
- **🔒 Required review:** OB (decision points), legal/privacy/ISRB per phase, procurement/funding.

*Next: `04-benefits-realization-programme.md`.*
