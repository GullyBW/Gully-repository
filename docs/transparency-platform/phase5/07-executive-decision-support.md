# Phase 5 · WS7 — Executive Decision Support (Briefing Packs)

**Traces:** Executive Summary `../phase4/01`, ERM `../phase4/09`, Evidence `06`, Portfolio `05`.
**Purpose:** audience-specific briefing packs so each decision-maker gets what *they* need to decide
— consistent facts, tailored framing. Each pack: **status · major risks · outstanding approvals ·
funding implications · progress · recommended decisions.**

---

## 1. Pack index (audience → decision they own)

| Audience | Primary decision | Emphasis |
|----------|------------------|----------|
| Cabinet / Executive Leadership | Mandate + policy support + funding endorsement | Strategic value, honest limits, national risk |
| Oversight Board | Go/no-go at each decision point (DP-1..6) | Full evidence, residual risks, independence |
| Technical Steering Committee | Delivery go/no-go, priorities | Roadmap, dependencies, technical risk |
| Funding Partners | Fund / continue funding | Budget, sustainability, independence, benefits |
| Procurement Authorities | Award decisions 🔒 | CoI controls, portability, value-for-money |
| Independent Auditors | Assurance opinions | Evidence, traceability, verifiable inputs |
| Justice-Sector Leadership | Institutional participation (MoUs) | Separation of powers, benefits, CoI protection |
| Operational Teams | Run readiness | Runbooks, SLOs, incident/DR |

## 2. Common briefing template (populated from live trackers `05`)

```
NJTIP BRIEFING — [audience] — [date] — [version]
1. CURRENT STATUS ....... phase, gate status (ORG G1-G10), % to next decision point
2. MAJOR RISKS .......... top Critical/High (RK + ER) with mitigation + owner
3. OUTSTANDING APPROVALS  legal / privacy / security / procurement / funding (🔒)
4. FUNDING IMPLICATIONS .. spend vs BWP envelope; runway; FX; independence note
5. PROGRESS ............. milestones done / due; benefits on/off track
6. RECOMMENDED DECISIONS  the specific decision requested + options + PMO recommendation
```

## 3. Audience-specific emphasis (what changes per pack)

- **Cabinet/Executive:** lead with the honest bottom line — value is real **but** contingent on
  governance independence, participation, and funding; NJTIP protects people even from its operators
  but cannot supply political will. Avoid technical depth; keep the residual-risk honesty.
- **Oversight Board:** the full evidence catalogue (`06`) + residual-risk acceptance; this is the
  body that signs go-live — no rosy framing.
- **Funders:** sustainability + independence + benefits evidence; explicit that
  institution-tied funding is refused (RK-15).
- **Procurement:** CoI controls, portability/no-lock-in, transparent process 🔒.
- **Justice-sector leadership:** separation-of-powers guarantees, CoI protections (their unit cannot
  self-review), and the value to their institution — to earn MoUs (RK-04).
- **Auditors:** traceability (`11`) + verifiable audit inputs (DDR-13) so they can check, not just
  read.
- **Operational teams:** runbooks, SLOs, break-glass, incident/DR — no strategy fluff.

## 4. Honesty rule for all packs

**[REC]** Every pack uses the **same underlying facts** (`05`/`06`) — framing differs, facts do not.
No pack overstates readiness or understates residual risk (RK-07 discipline applied to executives,
not just reporters). Discrepancies between packs are prohibited and checked by the PMO.

## 5. Quality gate

- **Traces to:** `../phase4/01/09`, `05`, `06`.
- **Preserves:** consistent facts across audiences; honesty about residuals.
- **Residual risks:** audience framing could drift into spin (mitigated: shared-facts rule + PMO
  check).
- **Trade-offs:** ⚠️ maintaining multiple synchronized packs is effort — justified for aligned
  decision-making.
- **Acceptance criteria:** each pack covers the 6 template sections from live trackers; facts
  identical across packs; recommended decisions explicit.
- **🔒 Required review:** PMO (consistency), OB (executive/oversight packs), legal/finance where
  their decisions feature.

*Next: `08-implementation-assurance.md`.*
