# Running Free, and Trading with $10

Two separate questions, often confused:

- **Free** — can I run this without paying for any service? **Yes, entirely.**
- **$10 entry** — can I open a gold position committing only $10? **Yes, but
  only on the right account.** The constraint is your broker's, not this
  code's, and the arithmetic below says exactly when it works.

---

## Part 1 — Running free

### What used to cost money

| Service | What it was for | Free mode |
|---|---|---|
| LiteLLM (OpenAI / Anthropic / Gemini keys) | HTTP fallback when no AI CLI is installed | **Blocked.** Never called. |
| Langfuse cloud | LLM tracing and cost analytics | **Off.** Already opt-in; free mode keeps it off. |
| AI CLI subscriptions | Market research and sentiment | **Optional.** Used if already installed, never required. |
| Paid market-data feed | Prices | **Not used.** MT5 demo and yfinance are free. |

### Turning it on

It is already on. `config.yaml` ships:

```yaml
free_mode:
  enabled: true
  allow_paid_llm_fallback: false   # never make a billed API call
  skip_ai_research: false          # use an AI CLI if one happens to exist
  strict: true                     # refuse to start if a paid key is set
```

`strict: true` is the important one. If you have an `OPENAI_API_KEY` (or
similar) sitting in your environment from another project, the system
**refuses to start** rather than quietly spending your credit:

```
PaidServiceError: free_mode.strict is on but billable services are
configured: OPENAI_API_KEY (billed LLM provider). Unset those variables,
set free_mode.allow_paid_llm_fallback to true to permit them, or set
free_mode.strict to false.
```

Override per-run with `FREE_MODE=false`.

### What still works with nothing installed

This is the part worth being clear about, because "free" often means
"crippled". It does not here:

- **The technical signal runs fully offline.** EMA-20/50 confluence across
  M15, H1, H4 and D1 needs price data and nothing else.
- **Sentiment runs offline.** `sentiment_analyzer.py` is keyword-based —
  no model, no API. (Read `STRATEGY_REVIEW.md` §2 before trusting it; it
  has real weaknesses, including classifying `inflation` as bearish, which
  is backwards for gold.)
- **The paper broker needs no account at all.**
- **Risk, sizing, journalling, backtesting and the scheduler** are all local.

What you lose without an AI CLI is the news research step. `analyze_node`
averages only the sources it actually has, so a missing sentiment input
does not drag the signal toward neutral — the technical path carries it
alone at full weight.

### Free ways to get the AI half back

All of these have free tiers at time of writing; check current terms
yourself, they change:

- **Gemini CLI** — `npm install -g @google/gemini-cli`
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`
- **OpenCode** — `npm install -g opencode-ai`

Install any one, and `agent_executor` discovers it automatically. Check
with `python claw.py agent tools`.

### Free brokerage

An **MT5 demo account** is free, unlimited, and behaves like the real
platform. That plus `mode: simulation` covers development completely.

---

## Part 2 — The $10 entry

### The arithmetic

One lot of XAUUSD is **100 troy ounces**. At $2,650/oz that is $265,000
notional, and the margin your broker holds is that divided by leverage.

| Volume | Ounces | Notional | Margin 1:100 | 1:500 | 1:1000 |
|---:|---:|---:|---:|---:|---:|
| 0.01 lots | 1.0 | $2,650 | $26.50 | **$5.30** | $2.65 |
| 0.005 | 0.5 | $1,325 | $13.25 | $2.65 | $1.32 |
| 0.001 | 0.1 | $265 | **$2.65** | $0.53 | $0.27 |

Read the bold cells. **On a standard 1:100 account, $10 cannot open even
the smallest gold position** — you need $26.50. Two things fix it:

1. **Higher leverage.** At 1:500, 0.01 lots costs $5.30 in margin. Works.
2. **A micro/cent account.** Some brokers accept 0.001 lots. At 1:100 that
   is $2.65. Also works.

### Configure it

```yaml
trading:
  entry_budget: 10.0    # max MARGIN per entry, in account currency
  leverage: 500         # your account's actual leverage

instruments:
  XAUUSD:
    min_volume: 0.01    # your broker's minimum — 0.001 on micro accounts
    volume_step: 0.01
```

Get `min_volume` and `volume_step` from your broker's contract
specification. They are not guessable and they decide everything here.

### Check before you rely on it

```
$ python claw.py entry-check --price 2650
```

```
[ENTRY CHECK] XAUUSD
======================================================================
  Price              : 2,650.00
  Account leverage   : 1:500
  Entry budget       : $10.00
  Broker min volume  : 0.01 lots (1 units)
  Margin for minimum : $5.30
----------------------------------------------------------------------
  RESULT             : CAN TRADE
  Volume affordable  : 0.01 lots (1 units)
  Margin held        : $5.30
  Risk at a $5.00 stop : $5.00
  Value per $1 move  : $1.00
```

And when it cannot:

```
  RESULT             : CANNOT TRADE
  Shortfall          : $16.50

  $10.00 cannot open the smallest XAUUSD position. The broker minimum is
  0.01 lots, which needs $26.50 margin at 1:100 — $16.50 more than the
  budget. Options: raise the entry budget to $26.50, use an account with
  higher leverage, or use a broker offering a smaller minimum volume.
```

It exits non-zero when infeasible, so it works in a startup script.

### Margin and risk are different questions

This trips people up, so it is worth stating plainly:

- **Margin** is what the broker *holds* to let you open the position. It
  comes back when you close.
- **Risk** is what you *lose* if the stop is hit.

`entry_budget` caps margin. `risk_per_trade` caps risk. Sizing takes the
**smaller** of the two, so a wide stop can never talk a $10 budget upwards:

```
Risk budget on $10,000 at 1% with a $5 stop  -> 0.20 lots
Margin budget of $10 at 1:500                -> 0.01 lots
Final volume                                 -> 0.01 lots
```

At 0.01 lots each $1 move in gold is worth $1.00, and the default $5 stop
risks $5.00.

---

## What $10 actually buys you

Being straight about this, because the numbers are small enough to matter:

- **0.01 lots is $1 per dollar of gold movement.** Gold routinely moves
  $20–40 in a day, so a typical day's range is ±$20–40 on the position.
- **Costs are proportionally brutal.** A $0.30 spread costs $0.30 per round
  trip — 6% of a $5 risk budget, before slippage. On a $10 account, spread
  alone is a significant drag that a large account would not notice.
- **A $5 stop on a $10 balance is 50% of the account.** Survivable once,
  not twice. If you are actually funding this with $10, set
  `risk_per_trade` far lower and expect the sizing to return 0.0 (which
  means *do not trade*, not *trade the minimum*).
- **Margin level matters more than usual.** With $10 of equity and $5.30
  held, free margin is $4.70. One adverse move and you are near a stop-out.

$10 is genuinely useful for **verifying the plumbing end to end on a live
account** — that orders route, fills come back, and journalling works.
Treating it as trading capital is a different proposition, and the
constraint is arithmetic rather than opinion.

---

## Zero-cost setup, start to finish

```bash
# 1. Free dependencies only (no MetaTrader5 — that is Windows-only)
pip install -r requirements-dev.txt

# 2. Confirm nothing paid is configured
python -c "import sys; sys.path.insert(0,'scripts'); \
  from free_mode import FreeMode; f=FreeMode(); \
  print(f.describe()); print('paid services:', f.detect_paid_services() or 'none')"

# 3. Confirm the entry budget works on your numbers
python claw.py entry-check --price 2650

# 4. Run the pipeline against the paper broker — no account needed
python claw.py graph run

# 5. Optional: add a free AI CLI for the research half
npm install -g @google/gemini-cli
python claw.py agent tools
```

Nothing above requires a payment method.
