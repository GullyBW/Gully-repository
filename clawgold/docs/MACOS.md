# Running ClawGold on macOS (and Linux)

## The honest starting point

**The `MetaTrader5` package itself is Windows-only, and no patch changes
that.** Checking PyPI for release 5.0.4803, every published wheel is
`win_amd64`:

```
MetaTrader5-5.0.4803-cp310-cp310-win_amd64.whl
MetaTrader5-5.0.4803-cp311-cp311-win_amd64.whl
MetaTrader5-5.0.4803-cp312-cp312-win_amd64.whl
MetaTrader5-5.0.4803-cp313-cp313-win_amd64.whl
...
```

No `macosx_*`, no `manylinux_*`. The metadata says `Platform: Windows`. The
package is a thin closed-source binary that talks to a running Windows MT5
terminal over local Windows IPC; there is no source to recompile.

**But that does not mean a Mac cannot trade live.** MetaQuotes ships an
official macOS build of the *terminal*, which is the Windows terminal running
inside a bundled Wine (CrossOver) wrapper. That wrapper contains a working
Windows environment — so the official `MetaTrader5` package can run *inside
it*, on your Mac, with no second machine.

That is what [`mt5-mac`](https://pypi.org/project/mt5-mac/) does, and ClawGold
supports it as a first-class backend.

```
        macOS, one machine
┌──────────────────────────────────────────────┐
│ ClawGold                                      │
│   import mt5_mac as mt5                       │
│              │ JSON over stdin/stdout         │
│              ▼                                │
│ Wine subprocess (inside MetaTrader 5.app)     │
│   Windows Python 3.9                          │
│   import MetaTrader5   ← the official package │
│              │                                │
│              ▼                                │
│ terminal64.exe ──▶ your broker                │
└──────────────────────────────────────────────┘
```

So the order path is the real one: real terminal, real MT5 API, real broker.

## Your three options

| Option | Live? | Needs a second machine? | Mode |
|---|---|---|---|
| **A** — paper trading | No | No | `simulation` |
| **B** — mt5-mac, on the Mac | Yes | **No** | `real` |
| **C** — bridge to another host | Yes | Yes | `remote` |

B is usually what you want on a Mac. C still earns its place: an always-on VPS
keeps trading when your laptop sleeps, and it is the only route on Linux.

Every option goes through the same `Broker` interface, so the risk manager,
the pipeline, the kill switch and the journal cannot tell them apart.

```
   Your Mac                         MT5 host (Windows VM / VPS / Wine)
┌──────────────────────┐         ┌─────────────────────────────────────┐
│ ClawGold             │         │  mt5_bridge_server.py               │
│  RemoteMT5Broker  ───┼── HTTP ─┼─▶  MT5Broker ──▶ MetaTrader 5       │
│                      │  (SSH   │                    terminal          │
│  risk, pipeline,     │  tunnel)│                       │              │
│  kill switch — all   │         │                       ▼              │
│  unchanged           │         │                    Broker            │
└──────────────────────┘         └─────────────────────────────────────┘
```

---

## Option A — Free: paper trading, nothing else needed

If you are developing, backtesting, or evaluating the strategy, you do not
need MT5 at all. This works on macOS today with no account and no bridge:

```bash
pip install -r requirements-dev.txt   # no MT5 of any kind
python claw.py preflight
python claw.py graph run
```

`requirements-dev.txt` installs no MT5 package at all, which is what CI and
the Linux container use. `requirements.txt` also installs cleanly on a Mac —
its environment markers skip `MetaTrader5` and pull `mt5-mac` instead — so use
that one if you intend to trade live later.

Given the strategy's edge is unmeasured (`docs/STRATEGY_REVIEW.md`), this
is where most of the useful work happens anyway.

---

## Option B — Live trading on the Mac itself, with mt5-mac

### 1. Install

```bash
# Install MetaTrader 5 for macOS from metatrader5.com into /Applications first.
pip install -r requirements.txt     # mt5-mac installs automatically on macOS
```

`requirements.txt` carries environment markers, so `MetaTrader5` is skipped on
macOS and `mt5-mac` is skipped everywhere else. The same file works on all
three platforms.

On the **first** `connect()`, mt5-mac provisions a Windows Python 3.9 and the
official `MetaTrader5` package inside MetaTrader 5.app's bundled Wine — about
an 8 MB download, once. Launch MetaTrader 5.app manually and let it finish
loading before the first run.

### 2. Configure

In `.env`:

```bash
TRADING_MODE=real
MT5_LOGIN=12345678
MT5_PASSWORD=your_password
MT5_SERVER=YourBroker-Server
LEVERAGE=<your account's actual leverage>
```

### 3. Verify before trusting it

```bash
python claw.py preflight --live     # reports the mt5-mac package explicitly
python claw.py balance
python claw.py entry-check
```

### What ClawGold normalises for you

mt5-mac is close to a drop-in for `MetaTrader5`, but not one. Three
differences matter, and every one lands somewhere that costs money, so
`scripts/broker.py` reconciles them rather than leaving them to chance:

| Difference | Unhandled consequence |
|---|---|
| Success code is `RES_E_SUCCESS`, not `TRADE_RETCODE_DONE` (both 10009) | `AttributeError` raised *after* an order is sent, while deciding whether it filled |
| `copy_rates_*` returns `MqlRates` NamedTuples, not numpy structured rows | `row["close"]` raises `TypeError` — all market data fails |
| Symbol specs expose `contract_size`, not `trade_contract_size` | **Silent**: sizing falls back to the built-in default contract size |

The third is the dangerous one, because nothing raises. `test/test_mt5_mac_compat.py`
pins all three against rows shaped like the real package's.

### Known limits

- **`last_error()` always returns 0** in mt5-mac 0.3.0, so MT5's own error
  codes are not available. Failure messages are correspondingly vaguer than on
  Windows.
- **Your Mac must stay awake.** Trading stops when it sleeps. For unattended
  running, use Option C against a VPS.
- **`mt5-mac` is third-party and at 0.3.0** — beta, MIT-licensed, not a
  MetaQuotes product. Run it in `simulation` first, then on a demo account,
  before a funded one.
- Timeframe constants differ from MetaTrader5's (minute counts vs MetaQuotes'
  encoding). ClawGold maps them per backend, so this is only a concern if you
  call the package directly.

---

## Option C — Live trading via the bridge

### 1. Choose where the terminal runs

| Host | Cost | Notes |
|---|---|---|
| **Windows VPS** | ~$5–15/mo | Most reliable. Runs 24/7, close to the broker. |
| **Windows VM on your Mac** | Free–$100 | Parallels, VMware Fusion, UTM. Only trades while the Mac is on. |
| **macOS + Wine/CrossOver** | Free–$74 | MetaQuotes ships an official Wine-based macOS build of the terminal. Fiddliest option; the bridge must run under *Wine's* Python, not your Mac's. |
| **Another Windows PC** | — | Fine if it stays on. |

An Apple-silicon Mac cannot run x86 Windows natively; UTM/Parallels handle
this with emulation or the ARM build of Windows, and MT5 runs under
Windows' own x86 emulation. It works, but a VPS is less trouble.

### 2. On the MT5 host

Install and log in to the MetaTrader 5 terminal, then:

```powershell
git clone <your-repo>
cd clawgold
pip install -r requirements.txt      # includes MetaTrader5

# Generate a strong token
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Start the bridge (loopback only — see step 3)
python scripts\mt5_bridge_server.py --token <that-token>
```

The bridge binds `127.0.0.1:8760` by default and **refuses to start
without a token**, because the endpoint can place real trades.

Check it locally:

```powershell
curl http://127.0.0.1:8760/health
# {"ok": true, "connected": true, "read_only": false, ...}
```

### 3. Connect your Mac — over an SSH tunnel

Do **not** expose the bridge port to the internet. Forward it:

```bash
ssh -N -L 8760:127.0.0.1:8760 user@your-mt5-host
```

The bridge now looks local to your Mac, encrypted end to end, with no
open port on the MT5 host.

### 4. Configure ClawGold on the Mac

In `.env`:

```bash
TRADING_MODE=remote
MT5_BRIDGE_URL=http://127.0.0.1:8760
MT5_BRIDGE_TOKEN=<the same token>
```

Then verify before trusting it:

```bash
python claw.py validate
python claw.py preflight --live
python claw.py balance
python claw.py entry-check
```

Preflight reaches `/health` (no token needed) *before* trying an
authenticated read, so it can tell you which of these you have:

| Symptom | Meaning |
|---|---|
| `Bridge: unreachable at ...` | Tunnel down, or the server is not running |
| `reachable, but not connected to MetaTrader 5` | Terminal closed or not logged in |
| `token rejected` | `MT5_BRIDGE_TOKEN` does not match `--token` |
| `Bridge: connected via ..., balance ...` | Working |

### 5. Run it

```bash
python claw.py graph run          # one pass, with the approval gate
python scripts/trade_worker.py    # the service loop
```

---

## Security

This endpoint places real trades. The design reflects that:

- **A token is mandatory.** The server will not start without one, and it
  is compared with `hmac.compare_digest` so it cannot be guessed by timing.
- **Loopback by default.** Binding anywhere else needs an explicit
  `--allow-remote` *and* a token of at least 32 characters.
- **No TLS in the bridge itself.** Terminating TLS correctly is a job for
  an SSH tunnel or a reverse proxy; a half-implementation here would be
  worse than declining to. `claw.py validate` warns if you point at a
  non-local host over plain `http://`.
- **`--read-only`** runs a bridge that answers every query and refuses
  every order. Good for a monitoring or research host.
- **The bridge always uses live mode.** It would be worse than useless to
  serve a paper broker over it — the client could not tell, and would
  believe simulated fills were real.

Keep the token in `.env`, which is gitignored and excluded from the Docker
build context.

---

## Behaviour worth knowing

**A failed order is marked uncertain.** If the network drops mid-order,
`RemoteMT5Broker` returns `{"success": False, "uncertain": True}` rather
than a plain failure — the trade may actually have been placed. Check
positions before retrying. A clean broker rejection (volume too small,
market closed) has no `uncertain` flag.

**Latency is real.** Every call is a network round trip. Over an SSH
tunnel to a nearby VPS that is a few milliseconds; over a slow link it is
not. This system trades on 15-minute-and-up timeframes, so it tolerates
that fine — it would be unsuitable for scalping.

**MT5's API is not thread-safe**, so the bridge serialises every call into
the terminal behind a lock.

**Docker cannot help here.** The ClawGold image is Linux, so it cannot run
MetaTrader5 either. Point a containerised ClawGold at a bridge exactly as
you would from a Mac.

---

## Quick reference

```bash
# MT5 host
python scripts/mt5_bridge_server.py --token <secret>
python scripts/mt5_bridge_server.py --token <secret> --read-only
python scripts/mt5_bridge_server.py --token <secret> --port 9000

# Mac
ssh -N -L 8760:127.0.0.1:8760 user@mt5-host
curl http://127.0.0.1:8760/health
python claw.py preflight --live
```

| Mode | Broker | Platform | MT5 package used | Real money |
|---|---|---|---|---|
| `simulation` | PaperBroker | Any | none | No |
| `real` | MT5Broker | Windows | `MetaTrader5` | Yes |
| `real` | MT5Broker | macOS | `mt5-mac` (wraps `MetaTrader5` in Wine) | Yes |
| `remote` | RemoteMT5Broker | Any | none locally | Yes |
