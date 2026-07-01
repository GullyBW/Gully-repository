# Day-Trading Subsystem

A self-contained, intraday algorithmic-trading engine that pulls real-time
market data and news through **Interactive Brokers**, fuses **technical
analysis** with **news sentiment** via an explainable strategy ensemble, sizes
every trade through an institutional **risk manager**, and executes on a
**paper broker** by default (live routing is hard-gated behind two independent
switches).

It ships with a fully-offline **market simulator** so the entire stack — engine,
strategies, risk, backtester and REST API — runs and is testable with zero
external dependencies, exactly like the marketplace's built-in geo sandbox.

> ⚠️ **Not financial advice.** This is engineering software for research and
> paper trading. Markets carry risk of loss. Do not enable live order routing
> without understanding the code, the risk limits, and your broker agreement.

---

## Design goals — learning from bank/quant desks, fixing where they lag

Institutional trading stacks are strong on data plumbing and risk, but they
commonly lag in three places. This system is built to close those gaps:

| Where desks lag | What this system does |
| --- | --- |
| **News lives in a silo**, slow to become a tradable signal | A fast, transparent finance-sentiment engine turns headlines into a vote on the *same cycle* they arrive, blended with price action for confirmation. |
| **Opaque black-box models** — hard to explain a fill to risk/compliance | Every signal is fully explainable: it carries each strategy's vote and the human-readable reasons behind it. |
| **Backtest ≠ live** (separate research vs. production code) | The backtester replays bars through the *exact same* analysis → ensemble → risk → portfolio pipeline the live engine uses. No divergent research path. |

Plus the table-stakes it shares with the best desks: volatility-targeted +
fractional-Kelly sizing, ATR stops, gross-exposure and position-count limits, a
daily-loss kill switch, and realistic cost modelling (spread, slippage,
commission).

---

## Pipeline

```
 Interactive Brokers  ┐
 (or offline sim)     ├─▶ Market data (OHLCV, quotes)  ─▶ Technical analysis ─┐
 News + financials    ┘                                    (20+ indicators,   │
                          ─▶ News + sentiment ─────────────  patterns)        │
                                                                              ▼
                                                             Strategy ensemble
                                                        (momentum · mean-reversion
                                                         · breakout · news)
                                                                              │
                                                                              ▼
                                                             Risk manager (sizing,
                                                          stops, limits, kill switch)
                                                                              │
                                                                              ▼
                                                       Order manager  ─▶  Paper broker
                                                       (live gate)         (or live IBKR)
                                                                              │
                                                                              ▼
                                                        Portfolio (P&L, equity curve)
                                                                              │
                                                                              ▼
                                                    REST API  +  realtime socket feed
```

## Module map (`src/trading/`)

| Path | Responsibility |
| --- | --- |
| `providers/marketData.provider.js` | Adapter contract (quote, bars, news, fundamentals, order). |
| `providers/ibkr.provider.js` | **Interactive Brokers** Client Portal Web API adapter. |
| `providers/simulated.provider.js` | Offline, seeded GBM price + synthetic-news generator. |
| `analysis/indicators.js` | Pure TA library: SMA/EMA, RSI, MACD, Bollinger, ATR, Stochastic, ADX/DI, OBV, VWAP, ROC, regression slope, crossovers. |
| `analysis/patterns.js` | Candlestick patterns (doji, hammer, engulfing, star…). |
| `analysis/sentiment.js` | Finance-tuned lexical sentiment with negation, intensifiers and time-decay aggregation. |
| `analysis/technicalAnalyzer.js` | Assembles a full indicator snapshot + trend/volatility regime. |
| `news/newsService.js` | Pulls & scores market + company news into one reading. |
| `strategy/*` | Four strategies + the ensemble blender. |
| `risk/riskManager.js` | Position sizing, stops/targets and portfolio limits. |
| `portfolio/portfolio.js` | Cash, positions (long/short), realised/unrealised P&L, equity curve. |
| `execution/paperBroker.js` | Simulated fills with spread, slippage and commission. |
| `execution/orderManager.js` | The OMS + live-routing safety gate. |
| `engine/tradingEngine.js` | Orchestrates one decision cycle end-to-end. |
| `backtest/backtester.js` | Event-driven backtest + performance metrics. |

---

## Safety model (read before going live)

Real orders can **only** be routed when **both** of these are true:

1. `TRADING_RUN_MODE=live`, **and**
2. `TRADING_LIVE_ORDERS_ENABLED=true`.

If either is off, the Order Manager routes to the paper broker. Two independent
switches mean a single stray config value can never, on its own, send a real
order. On any live-routing error the OMS transparently **degrades to paper** so
a broker outage cannot crash the loop. Every order is recorded for audit.

Defaults are: `simulated` data, `paper` mode, live orders **disabled**.

---

## Connecting Interactive Brokers

1. Download and run the **IBKR Client Portal Web API Gateway**, then browse to
   `https://localhost:5000` and log in to create an authenticated session.
2. Set the environment:
   ```bash
   TRADING_DATA_PROVIDER=ibkr
   IBKR_GATEWAY_URL=https://localhost:5000/v1/api
   IBKR_ACCOUNT_ID=DU1234567          # your paper or live account id
   IBKR_TLS_REJECT_UNAUTHORIZED=false # self-signed localhost cert
   ```
3. Leave `TRADING_RUN_MODE=paper` to trade on this app's internal paper broker
   using **real IBKR data**. Flip both live switches only when you are ready to
   route real orders through IBKR.

The adapter resolves symbols → `conid`, fetches snapshots and historical bars,
reads fundamentals and contract news, and (in live mode) posts orders and
auto-confirms the gateway's warning handshake.

---

## REST API

All routes require a Bearer token (same JWT as the rest of the API). Engine
controls (`/cycle`, `/engine/*`) require the `admin` role.

| Method & path | Description |
| --- | --- |
| `GET /api/trading/quote/:symbol` | Latest quote. |
| `GET /api/trading/bars/:symbol?timeframe=5min&limit=200` | Historical OHLCV. |
| `GET /api/trading/news[/:symbol]` | Recent market/company news. |
| `GET /api/trading/sentiment/:symbol` | Blended news-sentiment reading. |
| `GET /api/trading/analyze/:symbol` | Technicals + news + blended signal. |
| `GET /api/trading/signal/:symbol` | Signal **+ risk-managed decision** (no execution). |
| `POST /api/trading/backtest` | Backtest a strategy (body: `{ symbol, timeframe?, limit?, startingEquity?, bars? }`). |
| `GET /api/trading/portfolio` | Paper portfolio snapshot. |
| `GET /api/trading/orders` | Recent routed orders. |
| `GET /api/trading/state` | Engine status + portfolio. |
| `POST /api/trading/cycle` · admin | Run one decision cycle now (`{ symbols?: [...] }`). |
| `POST /api/trading/engine/start` · admin | Start the periodic loop (`{ intervalMs?, symbols? }`). |
| `POST /api/trading/engine/stop` · admin | Stop the loop. |

### Realtime feed

Socket.IO clients (authenticated with the same JWT) can `emit('trading:subscribe')`
to join the `trading` room and receive `trading:cycle` and `trading:fill`
events as the engine trades.

### Example

```bash
# Blended signal + the exact size/stop the risk manager would use
curl -H "Authorization: Bearer $TOKEN" localhost:4000/api/trading/signal/NVDA

# Backtest the technical ensemble on 500 simulated 5-min bars
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"symbol":"NVDA","timeframe":"5min","limit":500}' \
  localhost:4000/api/trading/backtest
```

---

## Strategies & the ensemble

| Strategy | Edge | Key risk control |
| --- | --- | --- |
| **Momentum** | Trend continuation (MA stack, MACD, RSI). | Only pays when ADX confirms a real trend; discounts overbought exhaustion. |
| **Mean-reversion** | Fades stretched moves (Bollinger %B, RSI, Stochastic). | **Refuses to fade a strong trend** (ADX gate) — the mistake that blows up naive reverters. |
| **Breakout** | Range breaks on expanding vol/volume (Donchian + squeeze). | Requires OBV/volume confirmation; flags fakeouts. |
| **News-sentiment** | Fresh, time-decayed news sentiment. | Checks price action *confirms* the story; discounts "priced-in" moves. |

The **ensemble** weights each vote by (a) the operator's configured trust in the
strategy and (b) the strategy's own confidence in that setup, then reports an
**agreement** score (how many directional strategies concur). The final signal
carries every contributing vote and reason.

## Risk manager

For each candidate entry it takes the **minimum** of four independent sizes —
risk-budget (≤ *X%* of equity to the stop), volatility target, fractional
Kelly, and a hard notional cap — then trims for the gross-exposure limit.
It sets ATR-based stop and take-profit, and blocks new risk when the
position-count limit or the daily-loss kill switch is hit. `assess()` is pure
and never mutates state.

## Backtest metrics

`total return`, `Sharpe` (annualised from the bar timeframe), `max drawdown`,
`win rate`, `profit factor`, `average win/loss`, `expectancy`, and trade counts.
Costs (spread/slippage/commission) are modelled and exits are checked intrabar
against each bar's high/low.

---

## Testing

```bash
npm test -- trading            # all five trading suites
```

- `tests/trading.indicators.test.js` — indicators vs. hand-computed values + patterns.
- `tests/trading.sentiment.test.js` — sentiment scoring, negation, time-decay.
- `tests/trading.risk.test.js` — portfolio P&L (long/short) + risk sizing/limits.
- `tests/trading.strategy.test.js` — strategies, ensemble, backtester.
- `tests/trading.api.test.js` — REST surface, auth, admin gating.
