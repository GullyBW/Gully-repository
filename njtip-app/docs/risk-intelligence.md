# Enterprise Risk Intelligence (Phase 11, Part 2 · Phase 12, Part 2)

The threat model extends into a full risk lifecycle (`src/security/threat-model.js`,
`RiskRegister`):

```
Threat → Risk → Control → Evidence → Verification → Residual Risk → Owner → Review Date
```

Gated by `APP-FIT-RISK-INTELLIGENCE`. Live: `GET /api/security/risk`.

> **Risk is time-bound.** An acceptance expires, a review comes due, and neither renews itself.

## Control effectiveness — scored, not asserted

| Control state | Weight | Why |
|---|---|---|
| implemented and **holding** | +1.0 | The control is doing its job |
| **unimplemented** | 0 | No protection, but nobody was relying on it |
| implemented and **failing** | **−0.5** | Worse than nothing: it was relied upon |

Effectiveness is the normalised sum over a threat's controls, read from the **live** fitness gate.

## Residual risk

```
inherent   = severity → { critical 1.0, high 0.75, medium 0.5, low 0.25 }
residual   = inherent × (1 − controlEffectiveness)
band       = critical ≥ 0.6 · high ≥ 0.35 · medium ≥ 0.15 · low > 0 · none = 0
treatment  = controlled | accepted (time-boxed) | open — treat or accept
```

## Risk acceptance workflow

An acceptance requires a **named human authority**, a **rationale**, and an **expiry of at most 365
days** — an acceptance without an expiry is not an acceptance, it is an omission. When it lapses the
risk reopens on its own, the lapse is reported by `expiredAcceptances()`, and `validate()` fails.
Revoking an acceptance early also requires a named human and a reason.

## Review cadence and reminders

| Severity | Reassessment cadence |
|---|---|
| critical | 30 days |
| high | 90 days |
| medium | 180 days |
| low | 365 days |

A threat that has never been reassessed is **overdue from the moment it is modelled** — the clock
starts at zero, not at first review. `reviewReminders()` returns every overdue threat with how late
it is.

## Threat intelligence ingestion

External intelligence **raises attention on a threat and nothing else** (`effect:
raises-attention-only`) — the same trust-lowering-only discipline the threat feed already follows. It
refuses identity data and refuses to reference an unmodelled threat.

## Heat map and trend

`heatMap()` places every threat by residual band with its owner, treatment, intelligence count and
review status. `snapshot()` + `trend()` give a deterministic least-squares direction over recorded
totals — `improving`, `stable` or `worsening` — so "is our risk going down?" has an answer derived
from control state rather than sentiment.

---

# Quantitative Risk Intelligence (Phase 12, Part 2)

Gated by `APP-FIT-RISK-QUANTITATIVE`. Live: `GET /api/security/risk/quantitative`.

```
Risk           = Likelihood × Impact            (1..25)
Residual risk  = Risk × (1 − control effectiveness − compensating credit)
```

## Two scales, with stated meanings

Ordinal 1–5, and the **meanings matter more than the numbers**: without them two assessors use the
same word for different things and the register stops being comparable, which is the only reason it
exists.

| Likelihood | | Impact | |
|---|---|---|---|
| `rare` 1 | Not expected in the planning horizon | `negligible` 1 | No effect on a case, person or obligation |
| `unlikely` 2 | Would need an unusual combination | `minor` 2 | Recoverable disruption |
| `possible` 3 | Has occurred in comparable systems | `moderate` 3 | A case is delayed, or an obligation missed |
| `likely` 4 | Expected once absent a control | `major` 4 | Evidence, outcome or decision affected |
| `almost-certain` 5 | Occurring, or will | `severe` 5 | A constitutional guarantee fails |

Bands: `critical ≥ 15 · high ≥ 9 · medium ≥ 5 · low ≥ 1`, tolerance ceiling **4**.

> **The qualitative band is derived from the quantitative score, never entered beside it.** Two
> people calling the same risk "high" and "medium" is how a register stops being comparable, and
> the only way to prevent it is to have one number underneath.

An unscored risk reports `unscored` — **never a plausible number**. Severity supplies a default
*impact*, but never a default *likelihood*, which would be a guess wearing a number. And a score is
a judgement: `score()` refuses without a named assessor and a rationale, because an unattributed
judgement cannot be challenged.

## Compensating controls

Credited **only when a fitness function verifies them** (+0.1 each, capped at 0.3). A compensating
control nobody checks is indistinguishable from one that is not there — and a stack of them is not
equivalent to the primary control that was supposed to be present.

## Treatment plans

`treat` · `transfer` · `avoid` · `accept` — the last three require board sign-off. A plan needs an
owner, a named author, a rationale, **at least one action** (a plan with no actions is an
intention), and a due date within 365 days. Closing one requires evidence.

## Predictive forecasting

Deterministic least-squares over recorded exposure snapshots, projecting when the register is
expected to cross the enterprise tolerance, with `confidence` from r². As everywhere: a forecast is
an early warning, not a measurement — a reason to look, not a result.
