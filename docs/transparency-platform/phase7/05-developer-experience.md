# Phase 7 · WS5 — Developer Experience (DX)

**Traces:** Architecture Repository `../phase6/01`, Contracts `../phase6/03`, Knowledge Platform `10`.
**Purpose:** make it fast and pleasant to build NJTIP correctly — a great DX that **raises**
compliance (because the compliant path is the easy, well-documented one), never one that trades
governance for convenience.

---

## 1. DX surfaces

| Surface | Contents | Source |
|---------|----------|--------|
| **Documentation portal** | Standards, golden paths, playbooks, onboarding, decisions | `../phase6/04`, `02`, `10` |
| **API catalog** | All OpenAPI contracts, try-it (synthetic), versioning | `../phase6/03` |
| **Event catalog** | All event schemas, producers/consumers, zone-cross flags | `../06 §6.4`, `../phase6/03` |
| **Architecture repository** | Traceability graph; requirement↔DDR↔component↔test↔evidence | `../phase6/01` |
| **Synthetic datasets** | Reproducible, labelled, safe test data + generators | `../phase6/05` |
| **Mock services** | Stand-ins for each context + external ACLs (synthetic) | `../phase6/03/05` |
| **Debugging tools** | Local tracing, log viewers (redacted), invariant explainers | `07` |
| **Onboarding guides** | Day-1 → first compliant service | `01` |
| **Engineering playbooks** | "How to add an event", "how to onboard an external system", "how to handle 🔒 paths" | `10` |

## 2. Onboarding experience (target: productive fast, safely)

Day-1: access (FIDO2), env, synthetic data, portal tour. Day-2: build first golden-path service on
the IDP (`01`). Week-1: understand the invariants, the 🔒 boundaries, and the CI gates. Mentor +
champion throughout (skills pipeline, A-OPS-01).

## 3. DX principles

- **Compliant is the default & documented:** golden paths (`02`) + IDP (`01`) mean the easy path is
  the safe path; anti-patterns are documented and CI-caught.
- **Fast feedback:** local invariant/privacy/contract tests give instant "you broke a rule" signals
  (shift-left, `03`).
- **Discoverability:** everything is in the knowledge platform (`10`), searchable and traceable.
- **Honest tooling:** debugging tools show **redacted** data only; there is no "reveal PII" affordance
  (there is no PII for reporters, and none is exposed for others).

## 4. Measuring & improving DX (without surveilling developers)

**[REC]** Measure DX at the **platform/team** level (onboarding time, build/test times, golden-path
adoption, self-service success rate, satisfaction survey) to improve the *platform* — **never** to
evaluate individuals (`09`). Feedback → knowledge platform → golden-path/IDP improvements.

## 5. DX vs governance (the balance, stated honestly)

⚠️ There is a real tension: the smoothest DX would let developers do anything. NJTIP resolves it by
making the **guardrailed** path the smooth one — so DX and governance reinforce rather than fight.
Where they truly conflict (e.g., a developer wants prod data for debugging), governance wins
(synthetic-only), and the DX investment goes into making synthetic data good enough that they don't
need prod.

## 6. Quality gate

- **Traces to:** `../phase6/01/03/04/05`, `10`; supports RK-18 (skills), RK-21 (via quality delivery).
- **Preserves:** synthetic-only; no PII-reveal tooling; governance defaults.
- **Threats mitigated:** reduces human-error violations (I-6, ID-1) by making compliance easy.
- **Residual risks:** DX debt if under-invested (mitigated: DX metrics `09`); tool sprawl (mitigated:
  single portal).
- **Trade-offs:** ⚠️ building great DX is upfront cost — pays back in consistency, speed, and safety.
- **Acceptance criteria:** portal + API/event catalogs + arch repo + synthetic data + mocks + playbooks
  available; onboarding to first compliant service within target; no prod-data or PII-reveal
  affordance exists.
- **🔒 Required review:** platform-eng/DX lead, privacy (tooling redaction), ARB.

*Next: `06-quality-engineering-platform.md`.*
