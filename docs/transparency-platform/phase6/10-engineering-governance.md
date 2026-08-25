# Phase 6 · WS10 — Engineering Governance & AI Autonomy Boundary

**Traces:** Governance `../phase3/01`, DevSecOps `../design/07 §6`, PMO `../phase5/01`. **Purpose:**
keep engineering execution aligned with approved governance, and draw the **AI autonomy boundary**
explicitly and enforceably. This is the control that lets engineering move fast on the safe parts
while the safety-critical parts stay under human expert control.

---

## 1. Engineering ↔ governance alignment

| Engineering act | Governing body | Control |
|-----------------|----------------|---------|
| Architecture-affecting change | ARB | veto on invariant/DDR breach (`../phase3/01`) |
| 🔒 subsystem build/release | ISRB | sign-off token; CI HUMAN gate |
| New data field/purpose | PRB | field_policy approval (`../design/02`) |
| Constitutional/invariant change | OB super-majority | policy change (`../phase2/02`) |
| Production go-live | **OB only** | Go-Live Gate (`../phase3/08`), PRR (`08`) |
| Procurement/funding for eng | OB 🔒 | not an engineering decision |

**[FACT]** Engineering (and the PMO) can build, test, and recommend — but **cannot authorize
production, waive gates, or override governance.**

## 2. AI autonomy boundary (explicit, enforceable)

| AI **may** (on synthetic data) | AI **must never** |
|-------------------------------|-------------------|
| Generate specifications | Approve production changes |
| Generate non-critical code | Bypass governance |
| Generate tests | Bypass security gates |
| Generate documentation | Replace legal review |
| Scaffold IaC/CI | Replace judicial review |
| Draft work packages | Replace procurement approval |
| — | Replace human oversight |
| — | Autonomously build/finalize 🔒 CRITICAL SUBSYSTEMS (anonymity, crypto/key custody, chain of custody, metadata intake, zone-egress/ABAC, AI boundaries) |

**Enforcement:** the CI **HUMAN gate** blocks merges touching 🔒 critical paths without an ISRB
sign-off token (`09`, `../design/07`); 🔒 modules are human-expert-built; AI-generated artifacts are
**always human-reviewed before merge** and never auto-approved.

## 3. Change control for engineering

RFC → CAB (TSC/ARB/ISRB per class) → decision → gated release. 🔒/constitutional changes escalate
(ARB veto / OB super-majority). All engineering decisions recorded in the anchored audit (DDR-13)
and the architecture repository (`01`).

## 4. Separation of duties in engineering
- No developer holds production keys (crypto in HSM, `04 §10`); zero standing privilege for ops
  (`../phase3/06`); build/sign/deploy duties separated; reviewers ≠ authors for 🔒 paths.

## 5. Honesty & residual (engineering-level)
⚠️ Fast AI-assisted engineering is powerful **and** a risk: the discipline that makes it safe is the
autonomy boundary + CI enforcement + human review of 🔒 paths. Removing those to "go faster" would
directly threaten reporter safety — so they are **non-negotiable**, enforced by tooling, not
goodwill.

## 6. Quality gate

- **Traces to:** `../phase3/01`, `../design/07 §6`, `../phase5/01`; D-01/D-09; RK-06/12.
- **Preserves:** governance authority; autonomy boundary; gate discipline.
- **Threats mitigated:** T-3/T-7 (supply chain/AI), E-1/E-3 (SoD), premature/unauthorized go-live.
- **Residual risks:** human-review fatigue on 🔒 paths (mitigated: scope 🔒 tightly, resource ISRB);
  boundary-erosion pressure (explicitly resisted).
- **Trade-offs:** ⚠️ 🔒 gating slows critical-path delivery — accepted; the alternative risks lives.
- **Acceptance criteria:** CI HUMAN gate enforced; AI cannot merge 🔒 code; no engineering path
  authorizes production; all changes audited.
- **🔒 Required review:** OB (boundary policy), ISRB (enforcement), ARB.

---

## Phase 6 complete — Engineering Execution Framework delivered

Phase 6 provides the **architecture repository, per-context specs, executable contracts, engineering
standards, a synthetic-only reference-implementation design, a V&V framework, build-ready work
packages, systems-engineering reviews, DevSecOps guidance, and engineering governance** — a complete,
traceable, testable, governable engineering programme.

**[FACT]** No production deployment or production data; approved architecture and governance were not
redesigned; the 🔒 critical subsystems remain human-expert-built and are never autonomously
generated; production go-live remains the Oversight Board's decision behind the readiness gates.

*Engineering may now proceed on synthetic data through the SE reviews (`08`) and readiness gates —
the safe parts fast, the safety-critical parts under human expert control.*
