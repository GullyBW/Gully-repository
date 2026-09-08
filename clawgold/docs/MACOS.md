# Running ClawGold on macOS (and Linux)

## The honest starting point

**The `MetaTrader5` Python package cannot be made macOS-compatible.** This
is not a limitation of ClawGold, and it is not something a patch can fix.

Checking PyPI for the current release, 5.0.4803, every published wheel is
Windows-only:

```
MetaTrader5-5.0.4803-cp310-cp310-win_amd64.whl
MetaTrader5-5.0.4803-cp311-cp311-win_amd64.whl
MetaTrader5-5.0.4803-cp312-cp312-win_amd64.whl
MetaTrader5-5.0.4803-cp313-cp313-win_amd64.whl
...
```

No `macosx_*`, no `manylinux_*`. The metadata says `Platform: Windows`.

That is because the package is not really a library — it is a thin
closed-source binary that talks to a running Windows MT5 terminal over
local Windows IPC. There is no source to recompile and no cross-platform
build to enable. Only MetaQuotes could publish one, and they have not.

**So `pip install MetaTrader5` on a Mac will always fail.** Anything
claiming otherwise is either a different package or a wrapper around the
approach below.

## What you can do instead

Run the terminal where it works, and reach it from your Mac.

ClawGold ships this as a first-class backend. `RemoteMT5Broker` implements
exactly the same `Broker` interface as the local one, so the risk manager,
the pipeline, the kill switch and the journal cannot tell the difference.

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
pip install -r requirements-dev.txt   # note: -dev, not requirements.txt
python claw.py preflight
python claw.py graph run
```

`requirements-dev.txt` exists precisely because `requirements.txt` pins
`MetaTrader5` and therefore cannot install on a Mac.

Given the strategy's edge is unmeasured (`docs/STRATEGY_REVIEW.md`), this
is where most of the useful work happens anyway.

---

## Option B — Live trading via the bridge

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

| Mode | Broker | Platform | Real money |
|---|---|---|---|
| `simulation` | PaperBroker | Any | No |
| `real` | MT5Broker | Windows only | Yes |
| `remote` | RemoteMT5Broker | Any | Yes |
