# Phase 4 · 10 — National Digital Public Infrastructure (DPI) Alignment

**Traces:** Integration `../design/03`, Interoperability `../phase2/07`, Constitutional Architecture
`../design/01`. **Premise:** describe how NJTIP *can* align with broader digital-government
objectives — **without assuming any specific existing national infrastructure exists** (all such
claims are `⟦validate⟧`). 🔒 institutional/policy validation required.

---

## 1. Alignment principles

NJTIP is designed as a **good DPI citizen**: it uses open standards, owner-controlled data exchange,
and shared governance principles that let it interoperate with wider e-government efforts **if and
when** they exist — while never compromising its own constitutional zones or reporter-safety model.

| Principle | NJTIP provision | DPI benefit |
|-----------|-----------------|-------------|
| **Open standards** | Published, versioned API/event standards (`../phase2/07`) | Any conformant system can integrate |
| **Interoperability without central pooling** | Three-zone model + ACL-fronted exchange (D-06/D-07) | Aligns with owner-controlled DPI exchange patterns (cf. X-Road, `04`) |
| **Federated identity (bounded)** | Zone-scoped federation; no cross-zone identity join | Reuses institutional IdPs without breaching separation of powers |
| **Shared governance principles** | Independent oversight, transparency, auditability | Compatible with national data-governance norms `⟦validate⟧` |
| **Reusable building blocks** | Chain of custody, anchored audit, disclosure control | Patterns other public services could reuse |

## 2. Future integration opportunities (opportunistic, not assumed)

`⟦validate⟧` — contingent on these existing and being appropriate:
- **National ID / auth systems:** *only* for identified official/professional users, *never* for
  anonymous reporters (would break D-02); zone-scoped, minimal-claim, opaque-identifier use.
- **Government service bus / interoperability layer:** integrate via our standards profile + ACLs
  if a national bus exists.
- **National PKI / trust services:** for signatures/timestamps where independently trustworthy.
- **Open-data / transparency portals:** publish NJTIP aggregate transparency data through national
  channels (aggregate-only, disclosure-controlled).

## 3. Guardrails on DPI integration (non-negotiable)

- **No national-ID for reporters** (D-02): anonymity is not negotiable for the reporting mode, even
  for DPI convenience.
- **No central data pool**: DPI alignment must not collapse the three zones (D-06); exchange only,
  never pooling (mitigates I-6).
- **Independence preserved**: DPI integration must not create dependence on, or control by, an arm
  under scrutiny (RK-03).
- **Purpose limitation**: reusing NJTIP data for other government purposes requires DPIA + governance
  approval (DD-2/DD-3).

## 4. What NJTIP contributes back to DPI

Reusable, audited patterns for **privacy-preserving transparency**, **verifiable evidence
integrity**, **owner-controlled exchange**, and **executable governance** — a reference for
rights-respecting public-sector digital services.

## 5. Quality gate

- **Traces to:** D-02/D-06/D-07; `../design/03`, `../phase2/07`; RK-03, DD-2/3, I-6.
- **Threats mitigated:** I-6 (no pooling), ID-1 (no reporter national-ID), DD-2/3 (purpose limits).
- **Residual risks:** national infrastructure may not exist or may not meet our trust bar
  (`⟦validate⟧`); integration pressure could tempt guardrail erosion (explicitly resisted).
- **Trade-offs:** ⚠️ refusing national-ID for reporters and refusing central pooling forgoes some
  DPI convenience — accepted for safety and separation of powers.
- **Acceptance criteria:** any DPI integration passes the four guardrails (§3) and governance
  approval; no reporter national-ID path exists.
- **🔒 Required review:** integration architect, privacy, legal, national e-gov/policy stakeholders.

*Next: `11-business-continuity-resilience.md`.*
