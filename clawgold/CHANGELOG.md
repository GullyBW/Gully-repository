# Changelog

All notable changes to ClawGold will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-09-08

### Added — live MT5 trading from macOS and Linux

The `MetaTrader5` package cannot be made macOS-compatible: release 5.0.4803
publishes only `win_amd64` wheels, and it is a closed-source binary talking
to the Windows terminal over local IPC. There is no source to recompile and
no cross-platform build to enable. So instead of porting it, the terminal
now runs where it works and is reached across a boundary.

- **`scripts/mt5_bridge_server.py`** — a stdlib-only HTTP server that runs
  on the MT5 host (Windows VM, VPS, or macOS under Wine) and exposes the
  terminal. Requires a token, compares it with `hmac.compare_digest`, binds
  loopback by default, and needs an explicit `--allow-remote` plus a
  32-character token to bind anywhere else. `--read-only` serves every
  query and refuses every order. `/health` needs no token so a monitor can
  poll liveness without holding a credential.
- **`RemoteMT5Broker`** — implements the same `Broker` interface as the
  local backends, so the risk manager, pipeline, kill switch and journal
  are unchanged. Selected with `trading.mode: remote`.
- Config `mt5.bridge.{url,token,timeout}`, with `MT5_BRIDGE_URL`,
  `MT5_BRIDGE_TOKEN` and `MT5_BRIDGE_TIMEOUT` overrides.
- `docs/MACOS.md` — why the package cannot be ported, the four hosting
  options, SSH-tunnel setup, and the security model.
- 39 tests, including a real bridge server driven over real HTTP by a real
  client, placing and closing an order end to end.

### Changed

- `get_broker` now fails at construction when `mode: real` is set on a
  platform where MetaTrader5 cannot exist, naming the remote-bridge route,
  rather than deferring to a bare ImportError at connect time.
- `resolve_mode` understands `remote`/`bridge`; `is_live_mode()` treats
  them as live, so every safety rule that applies to real money applies to
  them too.
- The validator checks bridge URL and token, and warns when the URL is
  plain HTTP to a non-local host — the token and every order would cross
  the network in the clear.
- Preflight reaches `/health` before an authenticated read, so it can tell
  "bridge unreachable" from "terminal not logged in" from "token rejected".
- In remote mode preflight no longer demands local MT5 credentials: they
  live on the bridge host, which is the point.

## [3.0.0] - 2026-09-08

Hardening fork. The system now runs cross-platform, defaults to paper
trading, and is deployable as a service. A number of upstream defects that
silently disabled features are fixed.

### Added

- **Broker abstraction** (`scripts/broker.py`) — a `Broker` interface with
  two backends: `MT5Broker` for the live terminal and `PaperBroker`, an
  in-process simulator with a seeded, deterministic price series. Selected
  by `trading.mode`. The MetaTrader5 import is lazy, so the system runs on
  Linux, macOS and in Docker.
- **Contract specs** (`scripts/instrument.py`) — one source of truth for
  how price movement becomes money (XAUUSD = 100 oz/lot), with per-broker
  overrides via `instruments:` in config.
- **Entry budget** — `trading.entry_budget` caps the *margin* a single
  entry may commit, separately from `risk_per_trade`, which caps what it
  can lose. Sizing takes the tighter of the two, which is what makes a
  $10-per-entry account workable.
- **Free mode** (`scripts/free_mode.py`) — blocks every paid service. In
  strict mode the system refuses to start when a billable API key is
  present, rather than quietly spending credit.
- **Preflight** (`scripts/preflight.py`, `claw.py preflight`) — 14 readiness
  checks covering config, broker connectivity, writable paths, disk, and
  committed secrets. Run automatically by the container entrypoint.
- **Kill switch and graceful shutdown** (`scripts/lifecycle.py`) — a file
  that halts new entries with no restart, and SIGTERM handling so a
  container stop unwinds instead of being killed mid-order.
- **Trading worker** (`scripts/trade_worker.py`) — the deployable service
  loop, with a heartbeat file the container healthcheck reads.
- **`claw.py entry-check`** — reports whether the entry budget can open a
  position, and names the remedies when it cannot.
- 260 tests (upstream could discover 14), plus a GitHub Actions workflow.
- `docs/DEPLOYMENT.md`, `docs/FREE_AND_SMALL_ACCOUNT.md`,
  `docs/STRATEGY_REVIEW.md`.

### Changed

- **`trading.mode` defaults to `simulation`**, not `real`.
- **Single orchestration engine.** `trading_graph.py` is now the only one;
  `orchestrator.py` is a deprecation shim delegating to it. The economic
  calendar pause and adaptive-learning loop were ported across.
- `mt5_manager.MT5Manager` is a compatibility shim over the broker, so all
  existing call sites work unchanged.
- The Docker image runs as a non-root user, has a heartbeat healthcheck,
  and its default command is a long-running worker rather than a one-shot
  that exited immediately.
- `docker-compose.yml` drops the fake alpine "db" container that existed
  only to own a volume. SQLite is in-process; the volume alone suffices.
- Tests run via `run_tests.py`; `unittest discover -s test` can silently
  run CPython's stdlib `test` suite instead of this one.

### Fixed

- `execute_node` called `mt5.connect()` and `mt5.place_order()`, neither of
  which existed — **the pipeline had never placed an order**.
- `AgentExecutor(config)` passed positionally bound the dict to `cache_dir`
  and raised inside `Path()`, which callers swallowed — silently disabling
  every AI-augmented feature.
- `AgentResult` now supports mapping access; four callers used
  `result.get('output')` on a dataclass.
- `AIResearcher.get_market_sentiment` did not exist, so every research step
  fell back to neutral.
- `_extract_confidence` missed "80% confidence", zeroing `avg_confidence`
  and with it the whole AI signal.
- The margin check rejected every trade on a flat account (MT5 reports
  `margin_level` 0 with no positions, and `0 < 100`).
- Position sizing returns 0.0 ("do not trade") instead of clamping up to
  the minimum when the risk budget cannot fund it.
- `config_validator` accepted only `mode: real`, so `claw.py validate`
  **rejected the configuration the project ships**.
- `apply_config_overrides` registered invalid contract values (a negative
  `min_volume`) before validation could run.
- `rich`, `litellm` and `apscheduler` raised at import time; all three are
  optional and now degrade with a clear message.
- `SignalService` defaulted to the upstream author's Telegram channel IDs.
- `close_positions.py` sent `TRADE_ACTION_CLOSE_POSITION`, which
  MetaTrader5 does not define.
- `claw_gold.py` read bars with attribute access on a numpy structured
  array, raising `AttributeError`.

### Security

- The committed config carries no credentials; preflight fails if it finds
  any. `.dockerignore` excludes `.env` from the build context.
- The dashboard binds to `127.0.0.1` rather than `0.0.0.0` — it has no
  authentication.

## [2.0.0] - 2026-03-04

### ⚡ Phase 1: High-Impact Upgrades (Complete)

#### Added
- **LiteLLM Integration** (`scripts/llm_client.py`)
  - Unified interface for all AI providers (OpenCode, KiloCode, Gemini, Codex)
  - Automatic provider fallback chain
  - Exponential backoff retry logic (2 retries default)
  - Cost tracking per provider via SQLite (`data/llm_costs.db`)
  - Configurable timeouts per provider
  - `get_llm_client()` singleton factory for memory efficiency

- **APScheduler Migration** (`scripts/scheduler_apscheduler.py`)
  - Replaced custom threading scheduler with APScheduler 3.10.0+
  - Three scheduling modes: daily (time-based), interval (seconds), cron (advanced)
  - SQLite job persistence (`data/scheduler.db`) for crash recovery
  - Thread pool executor (max 4 concurrent jobs)
  - Misfired job grace period (30 seconds)
  - Job enable/disable without deletion
  - `get_scheduler_manager()` singleton factory

- **Rich Logger Enhancement** (`scripts/rich_logger.py`)
  - Enhanced console logging with Rich 13.0.0+
  - Colored output by log level (DEBUG, INFO, SUCCESS, FAILURE, ERROR, CRITICAL)
  - Formatted panels, tables, and progress bars
  - File logging to `logs/clawgold.log` with timestamps
  - `get_rich_logger()` singleton factory

#### Changed
- **agent_executor.py**: Migrated from subprocess CLI calls to LiteLLM unified interface
  - Automatic tool discovery (all tools available via LiteLLM)
  - Improved error handling and logging with Rich logger
  - Backward-compatible `AgentResult` interface preserved
  - Cost tracking integrated with LiteLLM client

- **agent_scheduler.py**: Migrated to APScheduler backend
  - Leverages `scheduler_apscheduler.py` for robust job management
  - Automatic task registration with APScheduler on startup
  - Enhanced logging with Rich logger for better UX
  - Notification integration on task completion

#### Dependencies (New)
- `litellm>=1.0.0` — Unified LLM provider interface
- `apscheduler>=3.10.0` — Enterprise-grade job scheduling
- `rich>=13.0.0` — Beautiful format console output

#### Backward Compatibility
✅ **100% backward compatible** — All existing APIs preserved. Phase 1 improvements are internal refactors with zero breaking changes.

#### Performance
- **Cost Reduction**: ~10-15% reduction in API failures due to automatic fallback
- **Reliability**: Job persistence ensures no task loss on restart
- **UX**: Enhanced logging reduces debugging time

#### Documentation
- `PHASE1_INTEGRATION.md` — Quick reference guide with code examples
- `PHASE1_GRADUAL_INTEGRATION.md` — Gradual adoption strategy
- `PHASE_UPGRADE.md` — Complete technical roadmap (Phases 1-3)

---

## [Unreleased]

### Added
- **Phase 2 Planned**: PydanticAI + Langfuse SDK
  - Structured response validation
  - Enterprise observability
  - Enhanced tracing with custom attributes

- **Phase 3 Planned**: Peewee ORM + DiskCache + OmegaConf
  - Full database ORM layer
  - Distributed caching
  - Configuration management at scale

---

## Previous Changes


  - Config settings: enable/disable, API keys, cost rates, trace filters

- AI-powered news research system with parallel AI tool aggregation
- Sentiment analysis engine with keyword-based scoring
- News database with SQLite caching (6-hour TTL)
- Multi-timeframe technical analysis (M15, H1, H4, D1)

### Planned
- Web dashboard for real-time monitoring
- Telegram notifications for trading signals
- Backtesting framework for strategies
- Machine learning model for price prediction

---

## [1.1.0] - 2026-03-04

### Added
- **AI News Research System**
  - Parallel AI tool queries (OpenCode, KiloCode, Gemini)
  - Consensus algorithm for sentiment aggregation
  - Automatic caching with configurable TTL
  - News database schema with 5 tables
  
- **Sentiment Analysis**
  - Real-time sentiment scoring
  - Trend analysis over time
  - Keyword extraction and frequency analysis
  - Impact score calculation

- **CLI Commands**
  - `claw.py news research <symbol>` - AI-powered research
  - `claw.py news sentiment <symbol>` - Sentiment analysis
  - `claw.py news signal <symbol>` - Trading signals from news
  - `claw.py news stats` - Database statistics
  - `claw.py news cleanup` - Data maintenance

### Changed
- Enhanced README with comprehensive documentation
- Added architecture flowchart

---

## [1.0.0] - 2026-03-03

### Added
- **Core Trading System**
  - MT5 integration with context manager
  - Account balance and position monitoring
  - Real-time price fetching
  - Trade execution (buy/sell)
  - Position closing (all or by ticket)

- **Risk Management**
  - Position size limits
  - Daily loss limits
  - Margin level monitoring
  - Risk per trade configuration
  - Max positions enforcement

- **Advanced Strategies**
  - Trailing stop implementation
  - Grid trading system
  - Breakout detection with volume confirmation
  - Scalping strategy
  - Multi-timeframe EMA analysis

- **Position Monitoring**
  - Real-time P/L alerts
  - Configurable alert thresholds
  - Trailing stop auto-adjustment
  - Position status dashboard

- **CLI Interface**
  - Unified command structure
  - Subcommand organization
  - Progress indicators
  - Colored output

- **Configuration**
  - YAML-based configuration
  - Environment variable support
  - Config validation
  - Profile-based settings

- **Logging**
  - Unified logging system
  - File and console output
  - Structured log format
  - Rotation support

### Technical
- Python 3.10+ support
- SQLite database for local storage
- ThreadPoolExecutor for parallel operations
- Context managers for resource handling
- Type hints throughout codebase

---

## [0.9.0] - 2026-03-01

### Added
- Initial beta release
- Basic MT5 connection
- Simple buy/sell commands
- Configuration file support

### Fixed
- MT5 terminal path detection
- Connection timeout handling

---

## Template for New Releases

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security improvements
```

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.1.0 | 2026-03-04 | AI News Research & Sentiment Analysis |
| 1.0.0 | 2026-03-03 | Initial stable release with full trading system |
| 0.9.0 | 2026-03-01 | Beta release with basic features |

---

**Legend:**
- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security-related changes
