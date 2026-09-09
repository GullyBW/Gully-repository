# Deployment

How to run ClawGold as a service, in paper or live mode, and what to do
when something goes wrong.

**Read this first:** the container image **cannot run MetaTrader5** — that
package is Windows-only and is deliberately excluded. Docker gets you
research, signals, backtesting and paper trading directly.

For live execution you have three routes:

- **`mode: real` on Windows** — run ClawGold alongside the terminal, using
  the `MetaTrader5` package.
- **`mode: real` on macOS** — run ClawGold on the Mac, using `mt5-mac`,
  which drives the official `MetaTrader5` package inside the Wine runtime
  bundled in MetaTrader 5.app. No second machine. See [`MACOS.md`](MACOS.md).
- **`mode: remote`** — run ClawGold anywhere (macOS, Linux, Docker) and
  reach a terminal on another host through `mt5_bridge_server.py`. Still the
  only route on Linux, and the right one for unattended 24/7 running.

All three are covered below.

---

## 1. Before anything: preflight

One command answers "is this ready to run?"

```bash
python claw.py preflight
```

```
[PREFLIGHT] ClawGold readiness
========================================================================
  PASS  Python version          3.11.15
  PASS  Core dependencies       yaml, pandas, numpy
  PASS  Config loads            config.yaml
  PASS  Config valid            no errors or warnings
  PASS  Trading mode            simulation (paper broker, no real orders)
  PASS  Broker                  PaperBroker — XAUUSD 2650.47/2650.77, balance $10,000.00
  PASS  Entry budget            $10.00 affords 0.01 lots at 1:500
  PASS  Free mode               on — no paid service configured
  PASS  Writable paths          data/, logs/
  PASS  No committed secrets    config.yaml carries no credentials
  PASS  Kill switch             clear
------------------------------------------------------------------------
  RESULT: ready to run.
```

It exits non-zero when not ready, so it works in a deploy script.

| Flag | Effect |
|---|---|
| `--strict` | Warnings count as failures |
| `--live` | Also check live-trading readiness (MT5 credentials, alerting) |

The container entrypoint runs this automatically on every start. A
container with a broken config fails immediately and visibly rather than
looping, or worse, appearing healthy while trading nothing.

---

## 2. Paper deployment (Docker)

This is the recommended way to run everything except live execution.

```bash
cd clawgold
cp .env.example .env          # optional; the stack starts without it

docker compose up -d research    # news + sentiment worker
docker compose up -d trader      # the paper trading loop

docker compose logs -f trader
docker compose ps                # health column shows the heartbeat state
```

Add the dashboard when you want it:

```bash
docker compose --profile ui up -d dashboard
# http://127.0.0.1:8501
```

### The services

| Service | What it does | Needs an account? |
|---|---|---|
| `research` | News aggregation and sentiment into `data/news.db` | No |
| `trader` | Runs the trading pipeline on an interval | No (paper) |
| `dashboard` | Read-only Streamlit view, `--profile ui` | No |

### Deliberate choices worth knowing

- **The dashboard binds to `127.0.0.1`, not `0.0.0.0`.** It has no
  authentication. Exposing it on all interfaces would publish your account
  balance and positions to the network. Put it behind an authenticating
  reverse proxy to share it.
- **The container runs as uid 1000, not root.** A trading process has no
  reason to be root.
- **`stop_grace_period: 60s`.** SIGTERM reaches the worker, which finishes
  its cycle and exits cleanly rather than being killed mid-order.
- **`data/` and `logs/` are named volumes.** The trade journal, the
  databases and the kill switch survive a container replacement. Losing
  `data/` loses your trade history.
- **There is no database container.** SQLite is an in-process library, not
  a server. The previous stack ran an alpine container that touched an
  empty file and slept forever purely to own a volume; the volume alone
  does that job.

### Health

The healthcheck reads the worker's heartbeat file, so a process that is
running but wedged is reported unhealthy — a bare process check would not
catch that.

| Heartbeat status | Health | Meaning |
|---|---|---|
| `running`, fresh | healthy | Working normally |
| `halted` | **healthy** | Kill switch engaged — a deliberate act, not a fault |
| `error` | unhealthy | Last cycle raised |
| stale (>15 min) | unhealthy | Wedged |
| `stopped` | unhealthy | Worker exited; replace the container |

`halted` staying healthy is deliberate: engaging the kill switch must not
cause the orchestrator to restart the container out from under you.

---

## 3. Live deployment

A MetaTrader 5 terminal has to run on Windows somewhere — the MT5 Python
API binds to a local Windows terminal and MetaQuotes publishes no other
build. What varies is whether ClawGold runs on that same machine.

### 3a. ClawGold on Windows, next to the terminal (`mode: real`)

```powershell
git clone <your-repo>
cd clawgold
pip install -r requirements.txt        # includes MetaTrader5

copy .env.example .env
# Set in .env:
#   TRADING_MODE=real
#   MT5_LOGIN, MT5_PASSWORD, MT5_SERVER
#   LEVERAGE=<your account's actual leverage>
#   ENTRY_BUDGET=<margin cap per entry>

python claw.py preflight --live
python claw.py entry-check
python claw.py balance
```

### Go-live checklist

Work down this list. Each item exists because skipping it costs money.

- [ ] `python claw.py preflight --live` passes
- [ ] `python claw.py entry-check` says **CAN TRADE** at your real leverage
      and your broker's real minimum volume
- [ ] `instruments.XAUUSD.min_volume` and `volume_step` match your broker's
      contract specification — these are not guessable
- [ ] `trading.leverage` matches the account, not an assumption
- [ ] Ran in `simulation` for long enough to see the pipeline take real
      signals end to end
- [ ] Telegram alerting configured and a test message received
      (`python claw.py notify test`)
- [ ] `risk_per_trade` set deliberately; the default 1% is not a
      recommendation for your account size
- [ ] `max_daily_loss` set to a number you would accept losing today
- [ ] You have read `docs/STRATEGY_REVIEW.md` — **the strategy's edge is
      unmeasured**; the code being correct is not the same as the strategy
      being profitable
- [ ] You know how to engage the kill switch without looking it up

### Start it

```powershell
python scripts\trade_worker.py
```

Or run once and watch:

```powershell
python claw.py graph run
```

For an unattended service, use NSSM or Task Scheduler. Set
`TRADE_AUTO_APPROVE=false` to keep the human approval gate — with it
`true`, orders are placed with no human in the loop.

### 3b. ClawGold on macOS, terminal on the same Mac (`mode: real`)

```bash
# MetaTrader 5.app must be installed in /Applications.
pip install -r requirements.txt      # pulls mt5-mac on macOS

# .env here
#   TRADING_MODE=real
#   MT5_LOGIN, MT5_PASSWORD, MT5_SERVER
#   LEVERAGE=<your account's actual leverage>

python claw.py preflight --live
python claw.py balance
```

The first connect provisions a Windows Python inside MetaTrader 5.app's
bundled Wine (~8 MB, once). The Mac must stay awake to keep trading — for
unattended running use the bridge route below against a VPS. The go-live
checklist above applies unchanged, and `docs/MACOS.md` lists the API
differences ClawGold normalises and mt5-mac's known limits.

### 3c. ClawGold on macOS or Linux, terminal elsewhere (`mode: remote`)

`RemoteMT5Broker` implements the same `Broker` interface, so the risk
manager, pipeline, kill switch and journal are unchanged.

```bash
# On the MT5 host (Windows VM, VPS, or macOS under Wine)
python -c "import secrets; print(secrets.token_urlsafe(32))"   # generate a token
python scripts/mt5_bridge_server.py --token <that-token>

# From your machine — tunnel rather than exposing the port
ssh -N -L 8760:127.0.0.1:8760 user@mt5-host

# .env here
#   TRADING_MODE=remote
#   MT5_BRIDGE_URL=http://127.0.0.1:8760
#   MT5_BRIDGE_TOKEN=<same token>

python claw.py preflight --live     # reports exactly which link is broken
python claw.py balance
```

The bridge refuses to start without a token, binds loopback by default,
and supports `--read-only` for a monitoring host. Full setup, security
notes and troubleshooting: [`MACOS.md`](MACOS.md).

---

## 4. Stopping trading

### Kill switch — stop new entries now

```bash
python claw.py kill-switch on --reason "news event"
python claw.py kill-switch            # status
python claw.py kill-switch off        # resume
```

It is a file (`data/KILL_SWITCH`). That is the interface on purpose: it
works when the process is unresponsive, over SSH, from cron, from another
container sharing the volume, and it survives a restart.

The pipeline checks it **before** any research or broker work, so engaging
it takes effect on the next cycle with no restart.

**It stops new entries. It does not close open positions** — closing is a
trading decision, not a safety default. To flatten:

```bash
python claw.py close --all
```

In Docker the volume is shared, so this works from the host:

```bash
docker compose exec trader python claw.py kill-switch on --reason "..."
```

### Stopping the service

```bash
docker compose stop trader     # SIGTERM, finishes the cycle, exits cleanly
docker compose down            # stop everything (volumes are kept)
```

Never `docker kill` a trader with open positions — SIGKILL can land
between "order sent" and "result recorded", leaving a position the journal
does not know about.

---

## 5. Rollback

Data lives in volumes, not the image, so rolling back the code is safe:

```bash
docker compose down
git checkout <previous-good-commit>
docker compose build
docker compose up -d
```

Before rolling back a running system:

1. `python claw.py kill-switch on --reason "rolling back"`
2. Decide about open positions — the new version will not know their intent
3. Roll back, run `preflight`, then release the switch

To roll back **data** as well, back up the volume first:

```bash
docker run --rm -v clawgold_clawgold_data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/clawgold-data-$(date +%F).tar.gz -C /data .
```

---

## 6. Monitoring

```bash
docker compose logs -f trader             # live
docker compose ps                         # health
cat data/heartbeat.json                   # last cycle
python claw.py positions                  # open positions
python claw.py perf stats                 # track record
python claw.py agent metrics              # AI tool success rates
```

Logs rotate at two levels, so a chatty failure loop cannot fill the disk:
Docker's json-file driver caps container stdout (`docker-compose.yml`), and
the application's own file handler is a `RotatingFileHandler` configured
from `config.yaml`:

```yaml
logging:
  level: "INFO"
  format: "json"              # one object per line, for a log shipper
  file_path: logs/clawgold.log
  max_bytes: 10485760         # 10 MB
  backup_count: 5             # so at most ~60 MB total
  log_trades_only: false      # true limits the *file* to trade records
```

`claw.py validate` rejects a non-positive `max_bytes` or `backup_count`,
since either silently disables rotation.

### Pruning what rotation does not cover

```bash
python scripts/clean_runtime_data.py             # bytecode + archives >14 days
python scripts/clean_runtime_data.py --dry-run   # show, change nothing
python scripts/clean_runtime_data.py --days 30   # keep archives longer
```

It removes `__pycache__`/`.pyc`, orphaned SQLite sidecars and test
databases, and archived logs past the age threshold. It never touches the
log currently being written, and it **refuses to delete the databases
holding real state** — `clawgold.db` is the trade journal — unless given
`--force`. Safe to run from cron; it exits non-zero only on bad arguments.

### What to alert on

| Signal | Why it matters |
|---|---|
| Container unhealthy | Worker wedged or erroring |
| `data/KILL_SWITCH` exists unexpectedly | Someone or something halted trading |
| Daily loss limit hit | Risk limit tripped |
| No `heartbeat.json` update in 15 min | Worker stalled |
| Disk under 500 MB | SQLite writes will start failing |

---

## 7. Configuration reference

Everything in `config.yaml` can be overridden by environment variable,
which is how you configure a container without rebuilding it.

| Variable | Meaning |
|---|---|
| `TRADING_MODE` | `simulation` (default), `real`, or `remote` |
| `ENTRY_BUDGET` | Max margin per entry; 0 disables the cap |
| `LEVERAGE` | Account leverage, for margin arithmetic |
| `RISK_PER_TRADE` | Fraction of balance risked per trade |
| `DEFAULT_STOP_DISTANCE` | Stop distance in price units |
| `FREE_MODE` | `true` blocks every paid service |
| `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` | Live credentials |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerting |
| `TRADE_INTERVAL_SECONDS` | Seconds between pipeline runs |
| `TRADE_AUTO_APPROVE` | Skip the human gate |
| `PREFLIGHT_STRICT` | Warnings block container startup |
| `PREFLIGHT_SKIP` | Skip preflight — not for live |

**Secrets belong in `.env`, never in `config.yaml`.** `.env` is gitignored
and excluded from the Docker build context; preflight fails if it finds a
credential committed in `config.yaml`.

---

## 8. Troubleshooting

**Container restarts immediately.** Preflight is failing. `docker compose
logs trader` shows which check and its remedy.

**"Cannot open the smallest position".** Your entry budget cannot cover the
margin. Run `claw.py entry-check` — it names the three ways out.

**Signals are always HOLD.** Usually correct behaviour rather than a fault:
confluence and sentiment disagree, or no AI CLI is installed so only the
technical path contributes. Check `claw.py agent tools`.

**"No AI CLI tools available".** Expected in free mode with nothing
installed. The technical path still produces signals. Install a free CLI
(`npm install -g @google/gemini-cli`) to restore the research half.

**Live orders rejected.** Check the broker's own constraints first:
minimum volume, market hours, margin. `claw.py entry-check` covers margin;
the audit trail in the pipeline output names the rest.

**Database locked.** Two processes writing the same SQLite file. Run one
trader per data volume.

---

## 9. What this system will not do for you

Stated plainly, because deployment readiness is often mistaken for
readiness to make money:

- It has **no measured edge**. `docs/STRATEGY_REVIEW.md` explains why: the
  backtest validates a different strategy from the one that trades.
- The engineering is sound — sizing arithmetic, risk gates, execution path
  and shutdown are tested. That is a different claim from profitability.
- Deploy it in `simulation`, watch it for a meaningful period, and read the
  strategy review before pointing it at real money.
