# Strategy Review

A critique of what ClawGold's signal logic actually decides, and where that
logic looks statistically weak.

**Scope.** This document describes problems; it does not fix them. The
correctness work elsewhere in this branch deliberately left the trading
logic alone, because what the strategy *should* decide is a trading call,
not an engineering one. Nothing here is a claim about profitability in
either direction — the honest summary is that the strategy's edge is
currently **unmeasured**, and most of what follows is about why.

Findings are ordered by how much they could cost.

---

## 1. The backtest does not test the strategy that trades

`scripts/backtest.py:14` backtests `MAStrategy`: a **simple** moving-average
crossover, 10/20 period, on **daily** bars, long-only.

The live system does something else entirely:

| | Backtest | Live pipeline |
|---|---|---|
| Average | SMA | EMA |
| Periods | 10 / 20 | 20 / 50 |
| Timeframes | D1 only | M15, H1, H4, D1 combined |
| Direction | Long-only | Long and short |
| Inputs | Price only | Price + news sentiment + AI consensus |
| Sizing | Fixed | Risk-budgeted from a stop |

So the one artefact that could justify the strategy validates a *different*
strategy. Every threshold in the live path is therefore unbacked by
evidence from the live path.

Compounding this, the backtest itself has the classic problems:

- **Fixed window, no walk-forward.** `2020-01-01` to `2024-01-01`
  (`backtest.py:38`), one contiguous run, no train/test split, no
  out-of-sample period.
- **A strongly favourable window.** Gold rose substantially over that
  period. A long-only trend-follower will look good on it almost
  regardless of merit. This is the single most misleading property of the
  current backtest.
- **Costs are barely modelled.** 0.1% commission (`backtest.py:65`) and
  nothing else — no spread, no slippage, no swap. The live config assumes a
  $0.30 spread; on a 0.20-lot position that is $6 per round trip, and the
  system is designed to trade several times a day.
- **No risk-adjusted metrics.** Only total return is reported
  (`backtest.py:106`). No Sharpe, no max drawdown, no trade count, no win
  rate. Total return alone cannot distinguish skill from leverage.

**What would settle it:** backtest the actual live signal —
`multi_timeframe_analysis` blended with sentiment — walk-forward across at
least one full gold cycle including 2013–2015 (a sustained downtrend), with
spread and slippage, reporting drawdown and trade count alongside return.

---

## 2. Keyword sentiment is context-blind, and one keyword is inverted for gold

`scripts/sentiment_analyzer.py:42` scores text by counting bullish and
bearish keyword hits: `score = (bullish − bearish) / total`.

**No negation handling.** "Gold is *not* rising" contains `rising` and
scores bullish. "Unlikely to rally" scores bullish. Bag-of-words counting
has no way to see the negation.

**No structural awareness.** `support` is bullish and `resistance` is
bearish (lines 46, 54), but the phrases that actually carry those words in
market commentary are "broke support" (bearish) and "broke resistance"
(bullish) — the exact inversions.

**`inflation` is classified bearish** (line 55). For most risk assets that
is defensible. For **gold specifically it is backwards**: gold is widely
traded as an inflation hedge, and inflation prints are among the most
reliably *bullish* catalysts for it. This is a domain error sitting in the
signal path of a gold-only system.

**The weight modifiers are dead code.** `STRONG_INDICATORS` and
`WEAK_INDICATORS` (lines 61–62) are defined and never read, so "gold surged
massively" and "gold surged slightly" score identically.

Minor: `rally` and `support` appear twice in the bullish list. Regex
alternation means this does not double-count, so it is untidy rather than
wrong.

**What would settle it:** score a few hundred real gold headlines by hand
and measure the classifier against them. If agreement is near chance, the
sentiment input is noise being averaged into the signal at equal weight
with the technicals.

---

## 3. Four timeframes are not four independent votes

`scripts/advanced_trader.py:457` computes EMA-20 vs EMA-50 on M15, H1, H4
and D1, then counts how many agree: 3+ bullish is `strong_buy`, 2 is `buy`.

The counting treats the four as independent confirmations. They are not.
They are the same indicator, on the same instrument, over overlapping
windows — a D1 uptrend mechanically drags H4 and H1 with it. Agreement
across them is close to guaranteed in a trending market and close to
meaningless as evidence.

The effect is that `confluence_score` systematically **overstates**
conviction exactly when the market is trending, which is when position
sizes are largest. A 4-of-4 alignment should not be read as four times the
evidence of 1-of-4.

**What would settle it:** measure the pairwise correlation of the four
timeframe verdicts on historical data. If it is as high as it looks, either
weight them by their marginal information or replace the count with a
single higher-timeframe trend filter plus a lower-timeframe trigger.

---

## 4. Every threshold is an unvalidated magic number

Collected from the code:

| Threshold | Value | Where |
|---|---|---|
| Minimum confidence to execute | 0.60 | `decision_engine.py`, `trading_graph.py:61` |
| Maximum risk score | 0.70 | `decision_engine.py` |
| Minimum profit probability | 0.55 | `decision_engine.py` |
| Sentiment label boundary | ±0.20 | `sentiment_analyzer.py:119` |
| Signal direction boundary | ±0.15 | `trading_graph.py` (`analyze_node`) |
| Confluence for "strong" | 3 of 4 | `advanced_trader.py:457` |
| Strength tiers | 0.4 / 0.6 / 0.8 | `news_aggregator.py:131` |
| Regime multipliers | 0.3 – 1.0 | `decision_engine.py` |

None is derived from data. They are plausible-looking round numbers, and
plausible-looking round numbers are where overfitting hides in plain
sight — they feel principled precisely because nobody fitted them.

The regime multipliers are the ones most worth checking: "reduce size to
30% at the weekend" and "50% before high-impact news" are asserted, not
measured, and they directly scale every position.

---

## 5. The "weak" signal tier can never trade

`news_aggregator.py:131` classifies confidence above 0.4 as `weak_buy` /
`weak_sell`. The execution floor is 0.6.

So the entire 0.4–0.6 band is unreachable: a weak signal is only ever a log
line, a Telegram message, or a broadcast to subscribers. That is not
necessarily wrong — but it means **paying subscribers can receive signals
the system itself has judged untradeable**, which is worth being deliberate
about rather than discovering by accident.

Either raise the weak boundary to meet the floor, or stop broadcasting the
band the system will not act on.

---

## 6. Model consensus is not independent evidence

`agent_executor.consensus()` runs the same prompt across up to three AI
CLIs and scores agreement; `news_aggregator._generate_signal` then
multiplies confidence by that agreement
(`confidence = avg_confidence × consensus_strength`).

That formula treats agreement as corroboration. Large language models are
trained on heavily overlapping corpora and, given the same prompt about the
same asset on the same day, will often reach the same conclusion for the
same reasons — including the same *wrong* reasons. Three models agreeing is
much closer to one opinion sampled three times than to three independent
analysts.

Worse, the self-reported confidence being multiplied in is a number the
model wrote about itself. LLM verbalised confidence is not calibrated, and
nothing here calibrates it.

**What would settle it:** log each provider's directional call and the
subsequent price move, then measure whether high-agreement calls actually
resolve correctly more often than low-agreement ones. If they do not,
`consensus_strength` is inflating conviction for free.

---

## 7. Stops are fixed-distance, not volatility-scaled

Position sizing (as reworked in this branch) is now correct arithmetic:
volume follows from the risk budget and the stop distance. But the stop
distance itself is a **constant** — `trading.default_stop_distance`, $5.00.

A $5 stop is a very different proposition when gold's daily range is $15
than when it is $60. A fixed stop in a quiet market gets hit by noise; in a
volatile one it is so tight that the position size becomes large enough to
be dangerous if it gaps.

The 2R take-profit inherits the same problem.

**What would settle it:** scale the stop by realised volatility — an ATR
multiple is the standard approach and would need roughly ten lines in
`validate_node`. This is the highest-value change in this document relative
to its cost, and the one I would do first.

---

## 8. Five concurrent positions in one instrument is one position

`risk.max_positions: 5` and `risk.max_total_risk: 0.05` together imply five
independent 1% risks summing to a 5% exposure.

The system trades **only XAUUSD**. Five open gold positions are five
fractions of a single directional bet, correlation ≈ 1. If gold gaps
against the book, all five lose together — the realised risk is the full
5% at once, not five diversified 1% bets.

The total-risk cap is therefore doing less than it appears to. It is not
wrong, but it should be read as "maximum 5% on one idea", and 5% of account
equity on a single gap is a large number.

---

## 9. Sentiment can be up to four hours stale

`agent.cache.ttl_hours: 4` caches AI research keyed by prompt hash. Since
the research prompt is largely fixed ("XAUUSD gold price today — market
sentiment and analysis"), the same cached answer is reused for up to four
hours.

For a daily-horizon view that is fine. It is applied to intraday entries,
where four hours spans multiple sessions and, frequently, the news event
that mattered. A cache hit immediately after a payrolls release returns the
pre-release view with no indication that it is stale.

**What would settle it:** key the cache on the day plus session, expire it
on high-impact calendar events, or simply drop the TTL to under an hour for
anything feeding a live entry.

---

## 10. Parameter evolution has no holdout

`adaptive_learning.optimize_parameters` runs a genetic search — generate a
population, score with `_evaluate_fitness`, keep survivors, mutate — over
recorded performance.

There is no train/validation split. A genetic search over one dataset with
no holdout will reliably find parameters that fit that dataset's noise, and
`get_adaptive_params` then serves those parameters to live trading. The
faster this loop runs, the more confidently it overfits.

**What would settle it:** evolve on one period, score on an untouched one,
and only promote parameters that survive both.

---

## Summary

| # | Finding | Severity | Cheapest fix |
|---|---|---|---|
| 1 | Backtest validates a different strategy | High | Backtest the live signal, walk-forward, with costs |
| 2 | Keyword sentiment context-blind; `inflation` inverted for gold | High | Hand-label a sample and measure; reclassify `inflation` |
| 3 | Correlated timeframes counted as independent | Medium | Measure correlation; weight or reduce to two |
| 4 | Unvalidated thresholds throughout | Medium | Sensitivity-test the top three |
| 5 | Weak tier unreachable but still broadcast | Medium | Align the boundary with the floor |
| 6 | Model consensus treated as independent | Medium | Log calls vs outcomes and measure |
| 7 | Fixed stop distance, not volatility-scaled | Medium | ATR-based stop (~10 lines) |
| 8 | Five positions in one instrument | Low | Document it; treat the cap as single-idea risk |
| 9 | Sentiment up to 4h stale on intraday entries | Low | Shorten the TTL for live entries |
| 10 | Parameter evolution with no holdout | Low | Split train/validation |

If only one thing gets done: **#1**. Until the live signal is backtested
against the live rules, every other number in the system — including the
ones this branch made arithmetically correct — is being applied on faith.

The order I would tackle them in is #1, then #7 (cheap and immediately
protective), then #2.
