# Architecture Overview

This document describes the high-level architecture of ClawGold.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       CLI Layer  (claw.py)                       │
│                                                                  │
│  trade · positions · graph · preflight · entry-check ·           │
│  kill-switch · validate · agent · news · perf · pamm             │
└──────────────────────────────────────────────────────────────────┘
                                 │
┌──────────────────────────────────────────────────────────────────┐
│          Orchestration  (trading_graph.py — LangGraph)           │
│                                                                  │
│  calendar_gate → research → analyze → validate → human_review    │
│       │                        ↑          │             │        │
│  kill switch            (retry ≤3×)   risk gates    interrupt    │
│                                          │             ↓         │
│                       learn ← monitor ← execute                  │
└──────────────────────────────────────────────────────────────────┘
                                 │
┌──────────────────────────────────────────────────────────────────┐
│                      Decision & Risk Layer                       │
│                                                                  │
│  DecisionEngine      RiskManager        instrument.py            │
│  confidence gate     gates, sizing      contract specs —         │
│  regime multiplier   entry budget       all price→money math     │
└──────────────────────────────────────────────────────────────────┘
                                 │
┌──────────────────────────────────────────────────────────────────┐
│              Execution  (broker.py — one interface)              │
│                                                                  │
│  PaperBroker         MT5Broker          RemoteMT5Broker          │
│  simulated, seeded   local MT5          MT5 on another host      │
│  any platform        terminal (Win)     via mt5_bridge_server    │
│                                                                  │
│  mode: simulation    mode: real         mode: remote             │
└──────────────────────────────────────────────────────────────────┘
                                 │
┌──────────────────────────────────────────────────────────────────┐
│                    Supporting & Cross-cutting                    │
│                                                                  │
│  free_mode · lifecycle (kill switch, shutdown) · preflight       │
│  config_loader / validator · logger · notifier · SQLite          │
└──────────────────────────────────────────────────────────────────┘
                                 │
┌──────────────────────────────────────────────────────────────────┐
│                        External Services                         │
│                                                                  │
│  MT5 terminal   ·   AI CLIs (opencode/gemini/codex/claude)       │
│  Telegram       ·   yfinance                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Two invariants worth stating

**Nothing above the Broker interface knows which backend it has.** The risk
manager, the pipeline, the kill switch and the journal are identical whether
orders go to a simulator, a local terminal, or a terminal on another
continent. That is what makes the same code run on macOS, in CI, and in
production.

**All price-to-money conversion happens in `instrument.py`.** Position
sizing, margin, and risk all derive from one contract spec per symbol, so
they cannot disagree with each other.

## Core Components

### 1. CLI Layer (`claw.py`)

The command-line interface providing unified access to all functionality.

**Responsibilities:**
- Parse command-line arguments
- Route commands to appropriate handlers
- Display formatted output
- Handle user interactions

### 2. Execution Layer (`broker.py`)

One `Broker` interface, three backends, chosen by `trading.mode`.

| Backend | Mode | Platform | Real money |
| ------- | ---- | -------- | ---------- |
| `PaperBroker` | `simulation` | Any | No |
| `MT5Broker` | `real` | Windows only | Yes |
| `RemoteMT5Broker` | `remote` | Any | Yes |

**Responsibilities:**
- Connection lifecycle (context manager)
- Account, positions, ticks and OHLC bars as plain dicts
- Market orders, closes, stop/target modification
- Platform-independent `Timeframe` constants, so no module needs to import
  MetaTrader5 to name a timeframe

**Why the abstraction exists.** The `MetaTrader5` package ships only
`win_amd64` wheels — it is a closed binary talking to the Windows terminal
over local IPC, so no macOS or Linux build exists. The import is lazy and
lives inside `MT5Broker.connect()`, so importing this module never fails on
a platform where MT5 is absent. `RemoteMT5Broker` reaches a terminal on
another host through `mt5_bridge_server.py`; see `MACOS.md`.

`mt5_manager.MT5Manager` remains as a compatibility shim that yields the
selected broker, so pre-existing `with MT5Manager() as mt5:` call sites work
unchanged.

### 2a. Contract Specs (`instrument.py`)

The single source of truth for how price movement becomes money — for
XAUUSD, 100 troy ounces per lot.

**Responsibilities:**
- `money_risk()` — what a stop distance costs at a given volume
- `position_size()` — largest volume inside a risk budget
- `required_margin()` / `max_volume_for_margin()` — what a broker holds to
  open a position, which is what decides whether a small account can trade
- Per-broker overrides (`min_volume`, `volume_step`) from `instruments:`

### 3. Risk Manager (`risk_manager.py`)

Trading risk assessment and limits enforcement.

**Responsibilities:**
- Validate trades against risk rules (`can_trade`)
- Size positions from the risk budget and the stop distance, capped by the
  margin an entry may commit (`calculate_position_size`)
- Report whether an entry budget can open anything at all
  (`entry_feasibility`) — the constraint that decides if a small account
  can trade
- Enforce the daily loss limit inside `can_trade`, so no execution path
  can skip it
- Track margin levels, treating a flat account (margin_level 0) as healthy
  rather than as a margin call

**Two independent constraints.** Risk asks "how much can I lose"; margin
asks "can I open it at all". Sizing takes the tighter of the two, so a $10
entry budget holds even when the risk budget would fund something larger.

### 4. Advanced Trader (`advanced_trader.py`)

Sophisticated trading strategies implementation.

**Strategies:**
- **Trailing Stop**: Dynamic stop-loss adjustment
- **Grid Trading**: Multiple pending orders at intervals
- **Breakout Detection**: Support/resistance level breaks
- **Scalping**: Short-term momentum trading
- **Multi-Timeframe Analysis**: EMA crossovers

### 5. News Aggregator (`news_aggregator.py`)

AI-powered news research and sentiment analysis.

**Responsibilities:**
- Coordinate AI tool queries
- Aggregate multiple research sources
- Calculate sentiment scores
- Generate trading signals
- Cache research results

### 6. AI Researcher (`ai_researcher.py`)

Interface to external AI CLI tools.

**Supported Tools:**
- OpenCode CLI
- KiloCode CLI
- Google Gemini CLI

**Features:**
- Parallel execution
- Response caching
- Confidence extraction
- Sentiment analysis

### 7. Sentiment Analyzer (`sentiment_analyzer.py`)

Keyword-based sentiment analysis engine.

**Methodology:**
- Bullish/bearish keyword matching
- Impact score calculation
- Sentiment trend tracking
- Keyword frequency analysis

### 8. News Database (`news_db.py`)

SQLite database for persistent storage.

**Tables:**
- `news_articles`: Stored news and analysis
- `ai_research`: Cached AI responses
- `sentiment_history`: Sentiment trends
- `market_events`: Economic events
- `price_correlations`: News-price relationships

### 9. Safety & Lifecycle (`lifecycle.py`)

**Kill switch** — a file whose presence halts new entries. Checked at the
top of the pipeline, before any research or broker work, so engaging it
takes effect on the next cycle with no restart. A file is the interface on
purpose: it works when the process is unresponsive, over SSH, from another
container sharing the volume, and it survives a restart. It does not close
open positions; that is a trading decision, not a safety default.

**Graceful shutdown** — traps SIGTERM/SIGINT so a container stop finishes
the current cycle and runs cleanup handlers, instead of the process being
killed between "order sent" and "result recorded". Workers wait on the
shutdown event rather than sleeping, so a stop does not have to wait out a
full interval.

### 10. Readiness (`preflight.py`)

Fourteen checks answering "is this ready to run?" — dependencies, config
validity, a real broker connection that reads a price, entry-budget
feasibility, writable paths, disk, committed secrets, kill-switch state.
Each result is PASS, WARN (degraded but runnable) or FAIL, and every
non-PASS carries the remedy. Exits non-zero, so it gates a deploy script;
the container entrypoint runs it on every start.

### 11. Cost Control (`free_mode.py`)

Gates the one code path that can incur a charge — LiteLLM's HTTP fallback.
In strict mode the system refuses to start when a billable API key is
present, rather than quietly spending credit. AI CLIs remain optional: the
technical signal path runs entirely offline.

## Data Flow

### Trade Execution Flow

```
signal {direction, confidence}
    │
    ├─ kill switch engaged? ────────────────► stop, no new entries
    │
    ├─ confidence < 0.60? ──────────────────► reject (before any AI call
    │                                          or broker connection)
    ▼
RiskManager
    ├─ entry_feasibility()  can the margin budget open anything?
    ├─ calculate_position_size()  min(risk allows, margin affords)
    └─ can_trade()  volume cap · position count · margin · daily loss
    │
    ▼ approved + sized
human_review  (interrupt — auto-approved in paper mode)
    │
    ▼
Broker.execute_trade()  →  PaperBroker | MT5Broker | RemoteMT5Broker
    │
    ▼
monitor (notify, broadcast) → learn (adaptive_learning) → journal
```

### News Research Flow

```
Query → AI Researcher → Parallel AI Calls
              ↓
        Cache Check → [Hit] → Return Cached
              ↓
        [Miss] → Execute AI Tools
              ↓
        Aggregate Results → Sentiment Analysis
              ↓
        Generate Signal → Store in DB → Return to User
```

### Position Monitoring Flow

```
Monitor Command → Position Monitor → MT5 Manager
         ↓
    [Loop] Fetch Positions
         ↓
    Check Thresholds → Alert if Triggered
         ↓
    Update Trailing Stops
         ↓
    Display Status
```

## Design Patterns

### 1. Context Managers

Used for resource management (MT5 connections, database transactions).

```python
with MT5Manager() as mt5:
    account = mt5.get_account_info()
    # Connection auto-closes on exit
```

### 2. Strategy Pattern

Trading strategies are interchangeable.

```python
class TradingStrategy(ABC):
    @abstractmethod
    def analyze(self, symbol: str) -> Signal:
        pass
```

### 3. Observer Pattern

Position monitoring uses event-driven alerts.

```python
monitor = PositionMonitor(on_alert=handler_function)
```

### 4. Repository Pattern

Database operations abstracted behind repository classes.

```python
news_db = NewsDatabase()
articles = news_db.get_recent_news(symbol)
```

## Threading Model

### Parallel Operations

- **AI Research**: Multiple AI tools run concurrently using `ThreadPoolExecutor`
- **News Fetching**: Background refresh of news feeds
- **Position Monitoring**: Continuous monitoring in separate thread

### Thread Safety

- Database connections are per-thread
- MT5 connection is single-threaded (serializes access)
- Configuration is read-only after initialization

## Caching Strategy

### Cache Layers

1. **AI Research Cache**: 6-hour TTL for AI responses
2. **Price Cache**: 5-second TTL for tick data
3. **News Cache**: 1-hour TTL for news articles

### Cache Invalidation

- Time-based expiration
- Manual clear via CLI
- Automatic cleanup of old data

## Error Handling

### Error Types

1. **Connection Errors**: MT5 disconnection, network issues
2. **Validation Errors**: Risk limit violations, invalid parameters
3. **Execution Errors**: Order rejection, insufficient margin
4. **AI Tool Errors**: CLI not found, timeout, rate limiting

### Error Recovery

- Automatic reconnection to MT5
- Fallback to cached data
- Graceful degradation of features
- Comprehensive error logging

## Security Considerations

### Credential Management

- Credentials stored in config.yaml or environment variables
- .env file support for local development
- No credentials in logs or error messages

### Data Protection

- Local-only database (no cloud)
- No sensitive data in AI queries
- Log rotation to prevent data accumulation

## Performance Optimizations

1. **Connection Pooling**: Reuse MT5 connections
2. **Parallel AI Queries**: Reduce research time
3. **Database Indexing**: Fast news retrieval
4. **Lazy Loading**: Load modules on demand
5. **Caching**: Reduce redundant operations

## Extension Points

### Adding New Strategies

1. Create strategy class in `scripts/strategies/`
2. Implement required interface
3. Register in CLI

### Adding New AI Tools

1. Add tool handler in `ai_researcher.py`
2. Define command and prompt template
3. Add to tool registry

### Adding New Commands

1. Create command function in `claw.py`
2. Define argument parser
3. Add to subparsers

## Testing Architecture

### Test Levels

1. **Unit Tests**: Individual functions
2. **Integration Tests**: Component interactions
3. **Live Tests**: Real MT5 connection

### Mock Strategy

- MT5 connection mocked for unit tests
- AI tools return canned responses
- Database uses in-memory SQLite

## Deployment Considerations

### Requirements

| Mode | Platform | Needs |
| ---- | -------- | ----- |
| `simulation` | any (macOS, Linux, Windows, Docker) | Python 3.10+, `requirements-dev.txt` |
| `real` | Windows only | `requirements.txt` (includes MetaTrader5), a running MT5 terminal |
| `remote` | any | `requirements-dev.txt` here; a bridge host running the terminal |

- Python 3.10+
- Disk space for SQLite growth; preflight fails under 50 MB
- RAM for AI CLI subprocesses, when any are installed

`requirements.txt` pins `MetaTrader5`, which cannot install off Windows, so
`requirements-dev.txt` exists as the portable set. The Docker image is
Linux and therefore cannot trade live directly; point it at a bridge.

### Monitoring

- Log files in `logs/` directory
- Database statistics via CLI
- Health check endpoint (future)

## Future Architecture

### Planned Enhancements

1. **Web Dashboard**: Real-time monitoring UI
2. **API Server**: REST API for external integrations
3. **Machine Learning**: Price prediction models
4. **Multi-Asset**: Support for other instruments
5. **Cloud Sync**: Optional cloud backup

---

*Last Updated: 2026-03-04*
