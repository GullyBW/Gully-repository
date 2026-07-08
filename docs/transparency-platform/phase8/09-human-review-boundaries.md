# Phase 8 · WS9 — Human Review Boundaries

**Traces:** Engineering Governance `../phase6/10`, AI Guardrails `../phase7/04`, Governance
`../phase3/01`. **Purpose:** state, unambiguously, the domains where **the twin and its automation
generate evidence but never decide** — and how that boundary is enforced. This is the ethical and
constitutional spine of the whole verification framework.

---

## 1. Mandatory human-review domains (the twin supports, never replaces)

| Domain | Twin/automation provides | Human authority |
|--------|--------------------------|-----------------|
| **Cryptography** | Verification that crypto interfaces/invariants hold on synthetic keys | Cryptographer designs/builds/signs (🔒) |
| **Anonymity mechanisms** | Adversarial sims (SIM-1/6/10); no-identity checks | ISRB + privacy expert judgment |
| **Evidence integrity** | Chain-of-custody verification; tamper sims (SIM-7) | Forensics + legal (admissibility) |
| **Legal compliance** | Compliance-control evidence (`06`) | Admitted counsel opinion |
| **Constitutional interpretation** | Separation-of-powers conformance (fitness fns) | Constitutional/judicial advisor |
| **Judicial procedure** | Workflow conformance | Judicial officers |
| **AI decision boundaries** | AI-out-of-decision-path checks; provenance | EC + AI governance |
| **Governance** | Threshold/CoI/gate enforcement evidence | Oversight Board |
| **Procurement** | (n/a technical) | OB procurement (CoI-controlled) |
| **Production approval** | Certification evidence (`07`) | **Oversight Board only** |

## 2. Why automation must not cross this line

**[FACT]** The platform's legitimacy rests on **human accountability** for the decisions that affect
rights and safety. A green twin can *demonstrate a control works*; it cannot *take responsibility* for
a legal interpretation, a constitutional judgment, or a decision to expose real reporters to real
risk. Automating those would launder accountability — the opposite of the transparency the platform
exists to create. ⚠️ This is a principle, not a limitation to engineer away.

## 3. Enforcement

- **CI HUMAN gate** blocks 🔒 critical-path changes without the named human sign-off (`../phase7/03`,
  `../phase6/10`).
- **AI tier T4** (`../phase7/04`) prohibits AI from approving production, bypassing gates, or replacing
  these reviews — no pathway exists in the tooling.
- **Certification** (`07`) and **go-live** (`../phase3/08`) are recorded human board decisions,
  anchored in the audit (DDR-13) — attributable to accountable people.

## 4. AI's proper role (stated plainly)

AI/automation **assists**: generates specs, tests, evidence, analytics, and drafts; surfaces issues;
speeds assembly. AI **never**: approves, certifies, interprets law/constitution, or replaces the
accountable human. **[DECISION]** This holds even as automation improves — the boundary is fixed by
principle, not by current capability.

## 5. Quality gate

- **Traces to:** `../phase6/10`, `../phase7/04`, `../phase3/01`; D-01/D-09.
- **Preserves:** human accountability; the autonomy boundary.
- **Threats mitigated:** accountability-laundering; unauthorized/automated high-risk decisions.
- **Residual risks:** automation-over-trust pressure (explicitly resisted; enforced by tooling).
- **Trade-offs:** ⚠️ human decisions on top of green automation are slower — non-negotiable for a
  rights-affecting platform.
- **Acceptance criteria:** every §1 domain has automation-supports/human-decides split; CI HUMAN gate
  + T4 enforce it; certification/go-live are recorded human decisions; no automated approval pathway.
- **🔒 Required review:** OB, ISRB, PRB, EC, legal/judicial — each owns its boundary.

*Next: `10-continuous-learning.md`.*
