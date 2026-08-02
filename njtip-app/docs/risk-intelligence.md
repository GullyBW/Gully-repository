# Enterprise Risk Intelligence (Phase 11, Part 2)

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
