# 12 — Ratified Decisions (Confirmation Checkpoint Outcome)

**Status:** RATIFIED by client at the Discovery Confirmation Checkpoint (2026-07-07).
These decisions are **authoritative**. Every Design-phase DDR references the decision(s) it
implements. Where a decision resolves an earlier assumption, the assumption's status is updated
in `01-assumptions-register.md`.

> These answers unblock the Design phase. They do **not** remove the requirement for specialist
> validation of the underlying assumptions (legal, judicial, governance) — they fix the
> *architectural direction*, which qualified review must still confirm before deployment.

---

| ID | Decision | Ratifies / resolves | Drives |
|----|----------|---------------------|--------|
| **D-01** | **Independent operator + independent oversight; operator treated as a potential threat actor.** | A-ORG-01, A-GOV-01 → status *Decided* | Trust Model zones; threshold key custody; governance-as-subsystem |
| **D-02** | **Architect for technical inability to de-anonymize reporters.** Data minimization means lawful compliance is bounded by what the system legitimately retains — the system cannot disclose identity it never holds. | I-1, ID-1, NC-2; A-LEG-02/04 | Security & Data architecture; retention; threshold crypto |
| **D-03** | **Hybrid hosting.** Deployment model to be justified against the threat model, legal requirements, and operational resilience (comparison of ≥4 models required). | A-TEC-03, A-LEG-04/08 | Enterprise Reference Architecture §deployment |
| **D-04** | **PWA-first, with offline drafting where practical.** Additional channels (USSD/SMS/voice) evaluated after the core platform is established. | A-TEC-01/02; DT-1 | Enterprise Reference & UX; channel roadmap |
| **D-05** | **MVP = Confidential Reporting + Security Foundation (Identity, Key Management, Audit, Monitoring) + Secure Routing.** Broader justice workflows deferred to later phases. | A-ORG-02, A-JUS-05; RK-04 | Scope of all Design docs (MVP-first) |
| **D-06** | **Three non-collapsible constitutional data zones** (Executive · Judiciary · Independent) with **independent storage, encryption, administration, and audited API-based communication** — no shared database. | A-JUS-01/03; I-6, E-3 | Data & Integration & Security architecture; "Constitutional Architecture" |
| **D-07** | **Integrate with existing justice-sector systems via standards-based APIs**, not replace them. | A-JUS-02; RK-20 | Integration Architecture; interoperability standards |
| **D-08** | **Accommodate customary justice structures architecturally from the outset**; defer *implementation* until governance and stakeholder engagement are in place. | A-JUS-06; RK-23 | Domain/reference architecture extensibility; deferred build |
| **D-09** | **AI is assistive only** — supports administrative tasks; **never makes legal or judicial decisions.** | A-AI-01/02/03; T-7 | AI Architecture (bounded, human-in-loop, out of decision path) |
| **D-10** | **Add five cross-cutting architectural capabilities:** Constitutional Architecture · Digital Chain of Custody · Interoperability Standards · Public Trust Index · Justice Analytics. | (new) | Capability map §7.6; woven through Design docs |
| **D-11** | **Design Phase order:** Enterprise Reference → Data → Integration → Security → AI → Observability → DevSecOps architecture. **Then**, after approval, Governance, detailed implementation specs, and engineering work items. | (process) | Delivery contract (`00 §0.3`) |

## 12.1 The five cross-cutting capabilities (D-10) — definitions & homes

| Capability | Definition | Primary home | Success measure (seed) |
|-----------|------------|--------------|------------------------|
| **Constitutional Architecture** | Separation of powers rendered as enforceable architecture: three data zones, no shared DB, directional audited APIs, and machine-checkable invariants that no arm silently reads/writes another's data. | Enterprise Reference (`design/01`) + Data (`design/02`) + Security (`design/04`) | 100% cross-zone access via audited API; 0 shared-DB paths; automated invariant tests pass |
| **Digital Chain of Custody** | End-to-end, cryptographically verifiable custody for evidence *and* consequential records (orders, disclosures): hash, trusted timestamp, append-only ledger, external anchoring, integrity re-verify on every access. | Data (`design/02`) + Security (`design/04`) | Any object's custody reconstructable; tamper detectable ≤1 audit cycle; anchored digests |
| **Interoperability Standards** | A published, versioned standards profile (data formats, API contracts, identifiers, security) enabling standards-based integration (D-07) without leaking legacy models across zones. | Integration (`design/03`) | ≥1 reference integration per external system class; conformance test suite green |
| **Public Trust Index** | A transparent, methodology-published composite metric of platform/justice trustworthiness (responsiveness, uptime, integrity checks, independent-audit results, adoption) — non-attributable, aggregate-only. | Observability (`design/06`) + Justice Analytics | Index published on cadence; methodology public; inputs independently verifiable |
| **Justice Analytics** | Privacy-preserving aggregate analytics for oversight/policy and the Trust Index, with disclosure control (k-anonymity/DP) and strict purpose limitation. | Data (`design/02`) + Observability (`design/06`) | No sub-threshold cell published; purpose-limitation enforced; DPIA passed |

## 12.2 Assumption status updates (written back to `01`)

| Assumption | New status |
|-----------|-----------|
| A-ORG-01 (independent operator) | **Decided** via D-01 (still needs legal/governance constitution) |
| A-GOV-01 (independent oversight) | **Decided direction** via D-01 (residual RK-03 remains: capture risk) |
| A-ORG-02 (justice-sector scope) | **Confirmed**; MVP narrowed by D-05 |
| A-JUS-01/03 (separation of powers) | **Adopted as architecture** via D-06 (needs judicial/constitutional review) |
| A-JUS-02 (integrate not replace) | **Confirmed** via D-07 |
| A-JUS-06 (customary justice) | **Accommodate-now/build-later** via D-08 |
| A-AI-01 (AI assistive-only) | **Confirmed hard constraint** via D-09 |

## 12.3 What is now unblocked / still blocked

- **Unblocked:** the seven Design-phase architecture documents (`design/01`–`design/07`).
- **Still blocked until Design approval (D-11 gate):** Governance Framework detail, per-context
  implementation specs, OpenAPI/schemas/migrations, GitHub epics/stories, IaC/CI-CD build,
  runbooks.
- **Still 🔒 HUMAN-EXPERT-REVIEW-REQUIRED before implementation regardless of approval:**
  anonymity, cryptography, evidence-integrity/chain-of-custody, metadata handling, and AI
  subsystems.

*Next: `design/00-design-index.md` and the seven architecture documents.*
