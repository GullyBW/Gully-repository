# API Reference

Complete API documentation for ClawGold modules.

## Table of Contents

- [Broker](#broker)
- [Instrument](#instrument)
- [MT5 Manager](#mt5-manager)
- [Risk Manager](#risk-manager)
- [Advanced Trader](#advanced-trader)
- [News Aggregator](#news-aggregator)
- [AI Researcher](#ai-researcher)
- [Sentiment Analyzer](#sentiment-analyzer)
- [News Database](#news-database)
- [Free Mode](#free-mode)
- [Lifecycle](#lifecycle)
- [Preflight](#preflight)

---

## Broker

One interface in front of order execution, with three backends selected by
`trading.mode`.

```python
from scripts.broker import get_broker, Timeframe

with get_broker(config) as broker:
    tick = broker.get_tick("XAUUSD")
    broker.execute_trade("BUY", 0.10, sl=2645.0, tp=2660.0)
```

| Backend | `trading.mode` | Platform | Real money |
| ------- | -------------- | -------- | ---------- |
| `PaperBroker` | `simulation` | Any | No |
| `MT5Broker` | `real` | Windows only | Yes |
| `RemoteMT5Broker` | `remote` | Any | Yes |

Every backend implements the same methods, so callers never branch on which
one they have.

#### Methods

##### `connect() -> None` / `disconnect() -> None`

Open and close the connection. Raises `BrokerError` on failure. Both
backends are context managers, so `with get_broker(cfg) as b:` is the
normal form.

##### `get_account_info() -> Optional[Dict]`

`balance`, `equity`, `margin`, `margin_free`, `profit`, `margin_level`,
`currency`. Note `margin_level` is `0` when no positions are open — that is
healthy, not a margin call.

##### `get_positions(symbol: Optional[str] = None) -> List[Dict]`

Open positions as dicts: `ticket`, `symbol`, `type` (0 BUY / 1 SELL),
`volume`, `price_open`, `price_current`, `sl`, `tp`, `profit`, `time`.

##### `get_tick(symbol: str) -> Optional[Dict]`

`bid`, `ask`, `last`, `time`.

##### `get_rates(symbol: str, timeframe: int, count: int) -> Optional[List[Dict]]`

`count` most recent bars, oldest first, each with `time`, `open`, `high`,
`low`, `close`, `tick_volume`. Use `Timeframe.M15` / `.H1` / `.H4` / `.D1`
rather than MetaTrader5's own constants — no module needs to import MT5 to
name a timeframe.

##### `execute_trade(action, volume, symbol=None, sl=None, tp=None, deviation=10) -> Dict`

Send a market order. Returns `{'success': bool, 'ticket': int, 'price':
float, ...}` or `{'success': False, 'error': str}`.

On `RemoteMT5Broker` a transport failure returns `uncertain: True` as well —
the order may in fact have been placed, so check positions before retrying.

##### `close_position(ticket: int) -> Dict` / `close_all_positions() -> List[Dict]`

##### `modify_position(ticket, sl=None, tp=None) -> Dict`

#### Module functions

##### `get_broker(config=None, config_path=None) -> Broker`

Build the backend named by `trading.mode`. Raises `BrokerError` when `real`
is set on a platform where MetaTrader5 cannot exist, naming the remote
route rather than failing later with an ImportError.

##### `resolve_mode(config=None) -> str`

Normalises `trading.mode` to `'paper'`, `'real'` or `'remote'`. Anything
unrecognised resolves to `'paper'` — the safe reading of a mistake is "do
not send real orders".

##### `is_live_mode(mode: str) -> bool`

True for `real` and `remote`. Both reach a real terminal, so every rule
that applies to real money applies to both.

##### `metatrader5_available() -> bool`

Whether the MetaTrader5 package can be imported on this host.

---

## Instrument

The only place price movement becomes money. For XAUUSD a lot is 100 troy
ounces, so a $1.00 move is worth $100 per lot.

```python
from scripts.instrument import money_risk, position_size, required_margin

money_risk("XAUUSD", volume=0.10, price_distance=8.50)        # 85.0
position_size("XAUUSD", balance=10_000, risk_fraction=0.01,
              stop_distance=5.00)                              # 0.20 lots
required_margin("XAUUSD", volume=0.01, price=2650, leverage=500)  # 5.30
```

##### `money_risk(symbol, volume, price_distance) -> float`

Money at stake if price moves `price_distance` against `volume` lots.

##### `position_size(symbol, balance, risk_fraction, stop_distance) -> float`

Largest volume whose loss at the stop stays within the risk budget, rounded
**down** to the broker's volume step. Returns `0.0` when the budget cannot
fund the minimum volume — callers must treat that as "do not trade", never
as "use the minimum".

##### `required_margin(symbol, volume, price, leverage) -> float`

What the broker holds to open the position. Different question from risk.

##### `max_volume_for_margin(symbol, margin_budget, price, leverage) -> float`

Largest volume whose margin fits the budget. `0.0` when even the minimum
does not fit.

##### `min_margin_to_trade(symbol, price, leverage) -> float`

Margin for the smallest position the broker accepts. At 1:100 that is
$26.50 for 0.01 lots of gold at $2650 — which is why a $10 entry needs
either higher leverage or a micro account.

##### `normalize_volume(symbol, volume) -> float`

Clamp to the broker's step and bounds, rounding down.

##### `apply_config_overrides(config) -> None`

Apply per-broker `instruments:` overrides. Invalid values (a negative
`min_volume`) are rejected and logged rather than registered.

---

## MT5 Manager

### MT5Manager

Compatibility shim that yields the broker selected by `trading.mode`. It no
longer talks to MetaTrader 5 itself — see [Broker](#broker) for the
interface it hands you.

```python
from scripts.mt5_manager import MT5Manager

# Yields MT5Broker, PaperBroker or RemoteMT5Broker depending on the config
with MT5Manager(config_path=None, config=None) as broker:
    account = broker.get_account_info()
```

Entering the context in simulation mode no longer raises — the original
refused anything but `mode: real`, which meant the only way to run the
system was to point it at a live account.

The methods below are the Broker interface; they are documented in full
under [Broker](#broker).

#### Methods

##### `get_account_info() -> Optional[Dict]`

Retrieve account information.

**Returns:**
```python
{
    'balance': float,      # Account balance
    'equity': float,       # Account equity
    'margin': float,       # Used margin
    'margin_free': float,  # Free margin
    'profit': float,       # Current profit/loss
    'margin_level': float, # Margin level percentage
    'currency': str        # Account currency
}
```

**Example:**
```python
with MT5Manager() as mt5:
    account = mt5.get_account_info()
    print(f"Balance: {account['balance']} USD")
```

---

##### `get_positions(symbol: Optional[str] = None) -> List[Dict]`

Get open positions.

**Parameters:**
- `symbol` (str, optional): Filter by symbol

**Returns:**
```python
[
    {
        'ticket': int,
        'symbol': str,
        'type': int,           # 0=Buy, 1=Sell
        'volume': float,
        'price_open': float,
        'price_current': float,
        'profit': float,
        'swap': float
    }
]
```

---

##### `get_tick(symbol: str) -> Optional[Dict]`

Get current price tick.

**Parameters:**
- `symbol` (str): Trading symbol (e.g., 'XAUUSD')

**Returns:**
```python
{
    'bid': float,
    'ask': float,
    'last': float,
    'time': int,
    'volume': int
}
```

---

##### `execute_trade(action: str, volume: float, deviation: int = 10) -> Dict`

Execute market order.

**Parameters:**
- `action` (str): 'BUY' or 'SELL'
- `volume` (float): Volume in lots
- `deviation` (int): Price deviation in points

**Returns:**
```python
{
    'success': bool,
    'order': int,          # Order ticket
    'volume': float,
    'price': float,
    'error': str           # Only if success=False
}
```

---

##### `close_position(ticket: int) -> Dict`

Close specific position.

**Parameters:**
- `ticket` (int): Position ticket number

**Returns:**
```python
{
    'success': bool,
    'ticket': int,
    'profit': float,
    'error': str
}
```

---

##### `close_all_positions() -> List[Dict]`

Close all open positions.

**Returns:** List of close results for each position.

---

## Risk Manager

### RiskManager

Trading risk assessment and management.

```python
from scripts.risk_manager import RiskManager, RiskLimits

config = {'trading': {'risk_per_trade': 0.01}, 'risk': {...}}
rm = RiskManager(config)
```

#### Methods

##### `can_trade(symbol, action, volume, account_info=None, positions=None, stop_distance=None, daily_pnl=None) -> Tuple[bool, str]`

Check if trade is allowed.

**Parameters:**
- `symbol` (str): Trading symbol
- `action` (str): 'BUY' or 'SELL'
- `volume` (float): Trade volume in lots
- `account_info` (dict, optional): Current account info
- `positions` (list, optional): Current positions
- `stop_distance` (float, optional): Distance to the stop in price units.
  Defaults to `trading.default_stop_distance`. This is what makes the risk
  figure real — money at risk is a function of the stop, not of volume
  alone.
- `daily_pnl` (float, optional): Realised P&L today. When supplied, the
  daily loss limit is enforced here rather than only in a separate call an
  execution path could skip.

**Returns:**
```python
(can_trade: bool, reason: str)
```

**Example:**
```python
can_trade, reason = rm.can_trade('XAUUSD', 'BUY', 0.1)
if not can_trade:
    print(f"Trade rejected: {reason}")
```

---

##### `calculate_position_size(account_balance, stop_distance=None, symbol=None, stop_loss_pips=None, price=None, entry_budget=None) -> float`

Calculate recommended position size.

**Parameters:**
- `account_balance` (float): Account balance
- `stop_distance` (float, optional): Stop distance in price units
- `symbol` (str, optional): Defaults to the configured trading symbol
- `stop_loss_pips` (float, optional): Deprecated alternative to
  `stop_distance`, converted via the instrument's pip size
- `price` (float, optional): Needed to apply an entry budget's margin cap
- `entry_budget` (float, optional): Max margin for this entry. Defaults to
  `trading.entry_budget`. The final volume is the smaller of what risk
  allows and what margin affords.

**Returns 0.0** when the budget cannot fund the minimum volume. Treat that
as "do not trade" — it does not clamp up to the minimum.

**Returns:** Recommended volume in lots

---

##### `entry_feasibility(price, symbol=None, entry_budget=None) -> Dict`

Can a position be opened at all, given the entry budget? Small accounts
fail on margin long before they fail on risk, and that is a hard broker
constraint rather than something sizing can work around.

**Returns:**
```python
{
    'feasible': bool,      # can anything be opened
    'budget': float,       # the margin cap applied
    'min_volume': float,   # the broker's smallest position
    'min_margin': float,   # margin that smallest position needs
    'volume': float,       # largest volume the budget affords
    'shortfall': float,    # extra margin needed (0 when feasible)
    'leverage': float, 'price': float, 'symbol': str,
    'reason': str,         # plain-language explanation
}
```

**Example:**
```python
check = rm.entry_feasibility(price=2650.0)
if not check['feasible']:
    print(check['reason'])
    # $10.00 cannot open the smallest XAUUSD position. The broker minimum
    # is 0.01 lots, which needs $26.50 margin at 1:100 — $16.50 more than
    # the budget. Options: raise the entry budget, use higher leverage, or
    # a broker offering a smaller minimum volume.
```

---

##### `check_daily_loss(daily_pnl: float) -> Tuple[bool, str]`

Whether the daily loss limit still permits trading. Also enforced inside
`can_trade` when `daily_pnl` is supplied, so no execution path can skip it.

---

##### `get_risk_summary(account_info: dict, positions: list) -> dict`

Generate risk summary.

**Returns:**
```python
{
    'balance': float,
    'equity': float,
    'margin_used': float,
    'margin_level': float,
    'total_positions': int,
    'margin_status': str  # 'SAFE', 'WARNING', 'DANGER'
}
```

---

## Advanced Trader

### AdvancedTrader

Sophisticated trading strategies.

```python
from scripts.advanced_trader import AdvancedTrader, TrailingStopConfig

config = {...}
trader = AdvancedTrader(config)
```

#### Methods

##### `apply_trailing_stop(ticket: int, config: TrailingStopConfig) -> bool`

Apply trailing stop to position.

**Parameters:**
- `ticket` (int): Position ticket
- `config` (TrailingStopConfig): Trailing stop settings

**TrailingStopConfig:**
```python
{
    'activation_profit': float,  # Points to activate
    'trailing_distance': float,  # Points to trail
    'step_size': float           # Minimum step
}
```

---

##### `start_grid_trading(config: GridConfig, center_price: float, direction: str = 'both') -> List[TradeLevel]`

Initialize grid trading.

**GridConfig:**
```python
{
    'levels': int,         # Number of grid levels
    'grid_size': float,    # Points between levels
    'volume_per_level': float,
    'take_profit': float,
    'stop_loss': float
}
```

---

##### `detect_breakout(symbol: str, config: BreakoutConfig) -> Tuple[bool, str]`

Detect price breakout.

**Returns:** `(is_breakout: bool, direction: str)`

Direction: `'buy'`, `'sell'`, or `''`

---

##### `multi_timeframe_analysis(symbol: str) -> Dict`

Analyze multiple timeframes.

**Returns:**
```python
{
    'timeframes': {
        'M15': {'signal': str, 'price': float, 'ema_20': float, ...},
        'H1': {...},
        'H4': {...},
        'D1': {...}
    },
    'overall_signal': str,
    'confluence_score': float
}
```

---

## News Aggregator

### NewsAggregator

AI-powered news research and analysis.

```python
from scripts.news_aggregator import NewsAggregator

aggregator = NewsAggregator(db_path='data/news.db')
```

#### Methods

##### `research_symbol(symbol: str, query: str = None, hours: int = 24, use_ai: bool = True) -> Dict`

Comprehensive research on a symbol.

**Parameters:**
- `symbol` (str): Trading symbol
- `query` (str, optional): Custom search query
- `hours` (int): Lookback period
- `use_ai` (bool): Use AI tools

**Returns:**
```python
{
    'symbol': str,
    'query': str,
    'cached_news': List[Dict],
    'ai_analysis': Dict,
    'sentiment': Dict,
    'trading_signal': Dict
}
```

---

##### `get_sentiment_trend(symbol: str, hours: int = 72) -> Dict`

Get sentiment trend over time.

**Returns:**
```python
{
    'symbol': str,
    'trend': str,        # 'improving', 'deteriorating', 'stable'
    'momentum': float,
    'current_sentiment': float,
    'history': List[Dict]
}
```

---

##### `get_trading_signal(research_results: Dict) -> Dict`

Generate trading signal from research.

**Returns:**
```python
{
    'direction': str,      # 'buy', 'sell', 'neutral'
    'confidence': float,   # 0-1
    'strength': int,       # 0-3
    'recommendation': str, # e.g., 'strong_buy'
    'factors': List[str]
}
```

---

## AI Researcher

### AIResearcher

Interface to AI CLI tools.

```python
from scripts.ai_researcher import AIResearcher, AIResult

researcher = AIResearcher(cache_db=news_db, cache_ttl_hours=6)
```

#### Methods

##### `research_single(tool: str, query: str, use_cache: bool = True) -> AIResult`

Research using single AI tool.

**Parameters:**
- `tool` (str): 'opencode', 'kilocode', or 'gemini'
- `query` (str): Research query
- `use_cache` (bool): Use cached results

**Returns:** `AIResult` object

**AIResult:**
```python
{
    'tool': str,
    'query': str,
    'response': str,
    'success': bool,
    'execution_time': float,
    'confidence': float,
    'sources': List[str]
}
```

---

##### `research_all(query: str, tools: List[str] = None, use_cache: bool = True, parallel: bool = True) -> List[AIResult]`

Research using all AI tools.

**Parameters:**
- `tools` (List[str], optional): Specific tools to use
- `parallel` (bool): Run in parallel

**Returns:** List of `AIResult` objects

---

##### `aggregate_results(results: List[AIResult]) -> Dict`

Aggregate results from multiple tools.

**Returns:**
```python
{
    'success': bool,
    'consensus_sentiment': str,
    'consensus_strength': float,
    'average_confidence': float,
    'tools_used': List[str],
    'sentiment_distribution': Dict,
    'combined_analysis': str
}
```

---

## Sentiment Analyzer

### SentimentAnalyzer

Sentiment analysis engine.

```python
from scripts.sentiment_analyzer import SentimentAnalyzer, SentimentScore

analyzer = SentimentAnalyzer()
```

#### Methods

##### `analyze_text(text: str) -> SentimentScore`

Analyze sentiment of text.

**Returns:**
```python
{
    'score': float,        # -1 to 1
    'confidence': float,   # 0 to 1
    'label': str,          # 'bullish', 'bearish', 'neutral'
    'keywords': List[str]
}
```

---

##### `analyze_multiple(texts: List[str]) -> Dict`

Analyze multiple texts.

**Returns:**
```python
{
    'average_score': float,
    'average_confidence': float,
    'dominant_sentiment': str,
    'sentiment_distribution': Dict,
    'all_keywords': List[str],
    'keyword_frequency': Dict
}
```

---

##### `calculate_impact_score(text: str, source_weight: float = 1.0) -> float`

Calculate potential market impact.

**Returns:** Impact score (0-1)

---

## News Database

### NewsDatabase

SQLite database for news storage.

```python
from scripts.news_db import NewsDatabase, NewsArticle

db = NewsDatabase('data/news.db')
```

#### Methods

##### `add_news(article: NewsArticle) -> int`

Add news article.

**NewsArticle:**
```python
{
    'id': Optional[int],
    'title': str,
    'content': str,
    'source': str,
    'url': Optional[str],
    'published_at': datetime,
    'symbol': str,
    'category': str,
    'sentiment': Optional[float],
    'impact_score': Optional[float],
    'ai_analysis': Optional[str]
}
```

**Returns:** Article ID

---

##### `get_recent_news(symbol: str, hours: int = 24, category: str = None) -> List[Dict]`

Get recent news for symbol.

---

##### `add_ai_research(query: str, tool: str, response: str, symbol: str = None, category: str = None, confidence: float = None, sources: List[str] = None, ttl_hours: int = 24) -> int`

Store AI research result.

---

##### `get_cached_research(query: str, tool: str, max_age_hours: int = 24) -> Optional[Dict]`

Get cached research if not expired.

---

##### `add_sentiment_snapshot(symbol: str, sentiment: float, news_count: int, bullish: int, bearish: int, neutral: int, weighted_score: float)`

Record sentiment snapshot.

---

##### `get_sentiment_trend(symbol: str, hours: int = 24) -> List[Dict]`

Get sentiment history.

---

## Configuration

### Config Loader

```python
from scripts.config_loader import load_config

config = load_config('config.yaml')
```

**Config Structure:**
```python
{
    'trading': {
        'mode': str,              # 'real' or 'simulation'
        'symbol': str,
        'risk_per_trade': float
    },
    'risk': {
        'max_positions': int,
        'max_daily_loss': float,
        'max_position_size': float
    },
    'mt5': {
        'login': int,
        'password': str,
        'server': str
    }
}
```

---

## Free Mode

Gates the one code path that can incur a charge.

```python
from scripts.free_mode import FreeMode

free = FreeMode.from_config(config)
free.assert_no_paid_services()   # raises PaidServiceError in strict mode
```

##### `FreeMode.from_config(config) -> FreeMode`

Reads `free_mode:` — `enabled`, `allow_paid_llm_fallback`,
`skip_ai_research`, `strict`.

##### `permits_paid_llm() -> bool`

Whether a billed LiteLLM call may be made. False in free mode unless
`allow_paid_llm_fallback` is set.

##### `detect_paid_services() -> List[str]`

Billable services that appear configured (OpenAI/Anthropic/Gemini keys,
Langfuse cloud). Presence of a key is not proof of spending, so this
reports rather than assumes.

##### `assert_no_paid_services() -> None`

In strict free mode, raises `PaidServiceError` when a paid key is present —
failing before a run rather than after a bill.

##### `describe() -> str`

One-line summary for startup logs.

---

## Lifecycle

```python
from scripts.lifecycle import KillSwitch, GracefulShutdown

switch = KillSwitch.from_config(config)
if switch.engaged:
    return                       # take no new entries

with GracefulShutdown() as shutdown:
    while not shutdown.requested:
        do_one_cycle()
        if shutdown.wait(interval):
            break
```

### KillSwitch

A file whose presence halts new entries. The file is the interface on
purpose: it works when the process is unresponsive, over SSH, from another
container sharing the volume, and it survives a restart.

##### `engaged -> bool`

##### `engage(reason: str = "") -> None`

Writes the file with a timestamp, reason and PID, so whoever finds it later
knows why.

##### `release() -> bool`

Returns True if a switch was actually cleared.

##### `describe() -> str`

State plus the recorded reason.

**It stops new entries; it does not close open positions.** Closing is a
trading decision, not a safety default.

### GracefulShutdown

##### `requested -> bool`

##### `wait(timeout: float) -> bool`

Sleep, but wake immediately on shutdown. Use this instead of `time.sleep`
in a service loop, so a container stop does not wait out the interval.

##### `on_shutdown(handler)` 

Register a cleanup handler; usable as a decorator. Handlers run once, in
order, and a handler that raises is logged without stopping the others.

##### `entries_permitted(config=None, shutdown=None) -> (bool, str)`

Combined gate: kill switch plus shutdown state.

---

## Preflight

```python
from scripts.preflight import run_preflight

report = run_preflight(strict=False, live_check=False)
print(report.render())
if not report.ok:
    sys.exit(1)
```

##### `run_preflight(strict=False, live_check=False) -> PreflightReport`

Runs every readiness check. `strict` makes warnings disqualifying;
`live_check` adds the live-trading checks (implied when the mode is already
live).

##### `PreflightReport.ok -> bool`

##### `PreflightReport.failures` / `.warnings -> List[Check]`

##### `PreflightReport.render() -> str`

Each `Check` carries `name`, `status` (`PASS` / `WARN` / `FAIL`), `detail`
and, for anything non-passing, a `remedy`.

---

## Examples

### Complete Trading Workflow

```python
from scripts.mt5_manager import MT5Manager
from scripts.risk_manager import RiskManager
from scripts.news_aggregator import NewsAggregator
from scripts.config_loader import load_config

config = load_config('config.yaml')

# 1. Research
aggregator = NewsAggregator()
research = aggregator.research_symbol('XAUUSD')
signal = research['trading_signal']

if signal['confidence'] > 0.7 and signal['direction'] == 'buy':
    # 2. Check risk
    rm = RiskManager(config)
    
    with MT5Manager() as mt5:
        account = mt5.get_account_info()
        positions = mt5.get_positions()
        
        can_trade, reason = rm.can_trade(
            'XAUUSD', 'BUY', 0.1, account, positions
        )
        
        if can_trade:
            # 3. Execute
            result = mt5.execute_trade('BUY', 0.1)
            print(f"Trade executed: {result}")
```

---

*Last Updated: 2026-03-04*
