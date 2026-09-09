"""
Historical backtesting for ClawGold.

Data sources
------------
``backtest.data_source`` in config.yaml selects where bars come from:

  mt5       MetaTrader 5 historical rates. On macOS this goes through
            mt5-mac, which runs the official MetaTrader5 package inside
            MetaTrader 5.app's bundled Wine; on Windows through MetaTrader5
            directly. Both are reached via broker.import_mt5_module(), so
            the platform choice is made in exactly one place. Requires a
            running, logged-in terminal.
  yfinance  Daily GC=F gold futures. Free and needs no terminal, but it is a
            different instrument from your broker's XAUUSD and daily-only, so
            an M15 request cannot be honoured.
  paper     Deterministic synthetic bars from PaperBroker. Runs anywhere with
            no account. Proves the pipeline end to end and says nothing
            whatsoever about real performance.

What this measures
------------------
The strategy here is an SMA crossover. That is **not** the strategy
trading_graph.py trades. Backtesting it tells you about the crossover, not
about ClawGold's live behaviour — see docs/STRATEGY_REVIEW.md, which is the
single most important caveat on any number this file prints.

The engine is dependency-free (no backtrader, no pandas) so it runs in CI and
in the container, where those are deliberately absent.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

try:
    from agent_executor import AgentExecutor
    from config_loader import load_config
    AGENT_AVAILABLE = True
except ImportError:
    AGENT_AVAILABLE = False

from logger import get_logger

logger = get_logger(__name__)

DEFAULTS: Dict[str, Any] = {
    "symbol": "XAUUSD",
    "timeframe": "M15",
    "mode": "backtest",
    "initial_balance": 10000.0,
    "start_date": "2026-01-01",
    "end_date": "2026-03-01",
    "data_source": "mt5",
    "strategy": "ma_crossover",
    "short_period": 10,
    "long_period": 20,
    "commission": 0.001,
}


class BacktestError(RuntimeError):
    """Raised when a backtest cannot be run as configured."""


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

def load_backtest_config(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The backtest block from config.yaml, with CLI overrides applied last."""
    settings = dict(DEFAULTS)
    try:
        import yaml
        block = (yaml.safe_load((ROOT / "config.yaml").read_text()) or {}).get("backtest") or {}
        settings.update({k: v for k, v in block.items() if v is not None})
    except Exception as exc:
        logger.warning("Could not read the backtest config, using defaults: %s", exc)
    if overrides:
        settings.update({k: v for k, v in overrides.items() if v is not None})
    return settings


def _parse_date(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc)
    text = str(value)
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise BacktestError(f"Cannot parse date {value!r}; expected YYYY-MM-DD.")


# ─────────────────────────────────────────────────────────────────────────────
# Data sources
# ─────────────────────────────────────────────────────────────────────────────

def fetch_rates_mt5(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Historical rates from a MetaTrader 5 terminal, via copy_rates_range.

    The package is chosen by platform in broker.import_mt5_module: mt5-mac on
    macOS, MetaTrader5 elsewhere. Row shapes differ between the two (numpy
    structured rows vs MqlRates NamedTuples), so broker.rate_field reads both.
    """
    from broker import import_mt5_module, mt5_flavour, rate_field

    flavour = mt5_flavour()
    try:
        mt5 = import_mt5_module()
    except ImportError as exc:
        raise BacktestError(
            f"data_source is 'mt5' but {flavour} is not installed on this "
            f"platform ({sys.platform}).\n"
            + ("  pip install mt5-mac   (and install MetaTrader 5.app)\n"
               if sys.platform == "darwin" else
               "  MetaQuotes ships Windows-only wheels; there is nothing to "
               "install on Linux.\n")
            + "  Use data_source: yfinance or paper to backtest without a terminal."
        ) from exc

    timeframe = getattr(mt5, f"TIMEFRAME_{settings['timeframe'].upper()}", None)
    if timeframe is None:
        raise BacktestError(
            f"{flavour} has no timeframe {settings['timeframe']!r}.")

    if not mt5.initialize():
        raise BacktestError(
            f"{flavour} could not reach a MetaTrader 5 terminal. Start the "
            "terminal, log in, and try again."
        )

    try:
        start, end = _parse_date(settings["start_date"]), _parse_date(settings["end_date"])
        rates = mt5.copy_rates_range(settings["symbol"], timeframe, start, end)
        if rates is None or len(rates) == 0:
            raise BacktestError(
                f"{flavour} returned no bars for {settings['symbol']} "
                f"{settings['timeframe']} between {settings['start_date']} and "
                f"{settings['end_date']}. The terminal may not hold history that "
                "far back — scroll the chart back in MT5 to force a download, or "
                "check the symbol name (brokers use suffixes like XAUUSDm)."
            )
        return [
            {
                "time": int(rate_field(r, "time")),
                "open": float(rate_field(r, "open")),
                "high": float(rate_field(r, "high")),
                "low": float(rate_field(r, "low")),
                "close": float(rate_field(r, "close")),
                "volume": float(rate_field(r, "tick_volume")),
            }
            for r in rates
        ]
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


def fetch_rates_yfinance(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Daily GC=F bars. A different instrument from a broker's XAUUSD."""
    try:
        import yfinance as yf
    except ImportError as exc:
        raise BacktestError(
            "data_source is 'yfinance' but the package is not installed "
            "(pip install yfinance)."
        ) from exc

    if settings["timeframe"].upper() not in ("D1", "1D"):
        logger.warning(
            "yfinance GC=F is daily; the requested %s timeframe cannot be "
            "honoured and daily bars will be used instead.", settings["timeframe"])

    frame = yf.download("GC=F", start=settings["start_date"],
                        end=settings["end_date"], interval="1d",
                        progress=False, auto_adjust=False)
    if frame is None or frame.empty:
        raise BacktestError("yfinance returned no data for GC=F in that range.")
    if hasattr(frame.columns, "droplevel"):
        try:
            frame.columns = frame.columns.droplevel(1)
        except (ValueError, IndexError):
            pass

    bars = []
    for stamp, row in frame.iterrows():
        bars.append({
            "time": int(stamp.timestamp()),
            "open": float(row["Open"]), "high": float(row["High"]),
            "low": float(row["Low"]), "close": float(row["Close"]),
            "volume": float(row.get("Volume", 0) or 0),
        })
    return bars


def fetch_rates_paper(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Deterministic synthetic bars from PaperBroker.

    Runs anywhere with no terminal and no account. It exercises the whole
    path, but the prices are a seeded random walk — never read performance
    on this source as evidence about the market.
    """
    from broker import PaperBroker, Timeframe

    minutes = {"M1": 1, "M5": 5, "M15": 15, "M30": 30,
               "H1": 60, "H4": 240, "D1": 1440}.get(settings["timeframe"].upper())
    if minutes is None:
        raise BacktestError(f"Unknown timeframe {settings['timeframe']!r}.")

    span = _parse_date(settings["end_date"]) - _parse_date(settings["start_date"])
    count = max(1, int(span.total_seconds() // 60 // minutes))
    count = min(count, 20000)          # keep a long M15 range tractable

    import yaml
    config = yaml.safe_load((ROOT / "config.yaml").read_text()) or {}
    broker = PaperBroker(config)
    broker.connect()
    try:
        bars = broker.get_rates(settings["symbol"], minutes, count) or []
    finally:
        broker.disconnect()
    return [
        {"time": b["time"], "open": b["open"], "high": b["high"],
         "low": b["low"], "close": b["close"], "volume": b.get("tick_volume", 0)}
        for b in bars
    ]


DATA_SOURCES = {
    "mt5": fetch_rates_mt5,
    "metatrader5": fetch_rates_mt5,
    "mt5-mac": fetch_rates_mt5,
    "yfinance": fetch_rates_yfinance,
    "yahoo": fetch_rates_yfinance,
    "paper": fetch_rates_paper,
    "simulation": fetch_rates_paper,
}


def fetch_rates(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    source = str(settings["data_source"]).lower()
    if source not in DATA_SOURCES:
        raise BacktestError(
            f"Unknown data_source {source!r}; expected one of "
            f"{sorted(set(DATA_SOURCES))}.")
    return DATA_SOURCES[source](settings)


# ─────────────────────────────────────────────────────────────────────────────
# Engine
# ─────────────────────────────────────────────────────────────────────────────

def simple_moving_average(values: List[float], period: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    window = sum(values[:period])
    out[period - 1] = window / period
    for i in range(period, len(values)):
        window += values[i] - values[i - period]
        out[i] = window / period
    return out


def _close(balance: float, entry: float, exit_price: float, entry_cost: float,
           commission: float, when: int) -> tuple:
    """
    Close a position and record it **net of both commission legs**.

    Charging commission to the balance but reporting gross profit per trade
    makes profit factor disagree with the equity curve — at 148 trades and
    0.1% a side, the costs are most of the result and PF would look healthy
    while the account shrank.
    """
    gross_return = (exit_price - entry) / entry
    gross_profit = balance * gross_return
    balance += gross_profit
    exit_cost = balance * commission
    balance -= exit_cost
    return balance, {
        "entry": entry,
        "exit": exit_price,
        "return_pct": gross_return * 100.0,
        "gross_profit": gross_profit,
        "costs": entry_cost + exit_cost,
        "profit": gross_profit - entry_cost - exit_cost,   # net
        "time": when,
    }


def run_engine(bars: List[Dict[str, Any]], settings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Long-only SMA crossover, matching the inherited backtrader strategy:
    buy when the fast SMA crosses above the slow one, close when it crosses back.

    Deliberately simple and dependency-free. Commission is charged on both
    legs; slippage and spread are NOT modelled, so results are optimistic.
    """
    short_p = int(settings["short_period"])
    long_p = int(settings["long_period"])
    if short_p >= long_p:
        raise BacktestError(
            f"short_period ({short_p}) must be below long_period ({long_p}).")
    if len(bars) <= long_p:
        raise BacktestError(
            f"Only {len(bars)} bars; the {long_p}-period average needs more.")

    closes = [b["close"] for b in bars]
    fast = simple_moving_average(closes, short_p)
    slow = simple_moving_average(closes, long_p)
    commission = float(settings["commission"])

    balance = float(settings["initial_balance"])
    equity_curve = [balance]
    position_price: Optional[float] = None
    entry_cost = 0.0
    trades: List[Dict[str, Any]] = []

    for i in range(1, len(bars)):
        if fast[i] is None or slow[i] is None or fast[i - 1] is None or slow[i - 1] is None:
            equity_curve.append(balance)
            continue

        crossed_up = fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]
        crossed_down = fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]
        price = closes[i]

        if crossed_up and position_price is None:
            position_price = price
            entry_cost = balance * commission
            balance -= entry_cost
        elif crossed_down and position_price is not None:
            balance, trade = _close(balance, position_price, price,
                                    entry_cost, commission, bars[i]["time"])
            trades.append(trade)
            position_price = None

        mark = balance if position_price is None else \
            balance * (1 + (price - position_price) / position_price)
        equity_curve.append(mark)

    # An open position at the end is closed at the last price, so the reported
    # balance reflects a flat book rather than an unrealised paper gain.
    if position_price is not None:
        balance, trade = _close(balance, position_price, closes[-1],
                                entry_cost, commission, bars[-1]["time"])
        trade["forced_close"] = True
        trades.append(trade)

    peak, max_dd = equity_curve[0], 0.0
    for value in equity_curve:
        peak = max(peak, value)
        if peak > 0:
            max_dd = max(max_dd, (peak - value) / peak * 100.0)

    wins = [t for t in trades if t["profit"] > 0]
    losses = [t for t in trades if t["profit"] <= 0]
    gross_win = sum(t["profit"] for t in wins)
    gross_loss = abs(sum(t["profit"] for t in losses))
    initial = float(settings["initial_balance"])

    return {
        "bars": len(bars),
        "first_bar": datetime.fromtimestamp(bars[0]["time"], timezone.utc).isoformat(),
        "last_bar": datetime.fromtimestamp(bars[-1]["time"], timezone.utc).isoformat(),
        "initial_balance": initial,
        "final_balance": round(balance, 2),
        "total_return_pct": round((balance - initial) / initial * 100.0, 2),
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(len(wins) / len(trades) * 100.0, 2) if trades else 0.0,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else None,
        "total_costs": round(sum(t["costs"] for t in trades), 2),
        "max_drawdown_pct": round(max_dd, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────────────

def describe_results_with_ai(results: Dict[str, Any]) -> str:
    """Uses AI to explain backtest results and suggest improvements."""
    if not AGENT_AVAILABLE:
        return "AI not available for results interpretation."
    try:
        executor = AgentExecutor(load_config())
        prompt = (
            "Analyze these backtest results for an XAUUSD (Gold) trading "
            f"strategy:\n{json.dumps(results)}\n\n"
            "Please provide:\n"
            "1. Performance summary (Win rate, Profit Factor, Sharpe Ratio)\n"
            "2. Strengths and weaknesses observed\n"
            "3. Potential optimizations for the strategy parameters\n"
            "4. Market conditions where this strategy would perform best/worst\n\n"
            "Respond clearly as a quantitative analyst."
        )
        return executor.run_best(prompt, task_name="backtest_analysis").get(
            "output", "AI failed to interpret results.")
    except Exception as exc:
        return f"AI analysis error: {exc}"


def print_report(settings: Dict[str, Any], results: Dict[str, Any], source_used: str) -> None:
    print("\n" + "=" * 68)
    print("  BACKTEST RESULTS")
    print("=" * 68)
    print(f"  Symbol            {settings['symbol']}  {settings['timeframe']}")
    print(f"  Range             {settings['start_date']} to {settings['end_date']}")
    print(f"  Data source       {source_used}")
    print(f"  Bars              {results['bars']}  "
          f"({results['first_bar'][:16]} to {results['last_bar'][:16]})")
    if results.get("range_mismatch"):
        print(f"  ** The data does NOT cover the requested range — {source_used} "
              f"returned\n     the {results['bars']} most recent bars instead.")
    print(f"  Strategy          SMA {settings['short_period']}/{settings['long_period']}, "
          f"commission {float(settings['commission']) * 100:.2f}%")
    print("-" * 68)
    print(f"  Starting balance  ${results['initial_balance']:,.2f}")
    print(f"  Final balance     ${results['final_balance']:,.2f}")
    print(f"  Total return      {results['total_return_pct']:+.2f}%")
    print(f"  Trades            {results['trades']}  "
          f"({results['wins']} won / {results['losses']} lost)")
    print(f"  Win rate          {results['win_rate_pct']:.1f}%")
    print(f"  Commission paid   ${results['total_costs']:,.2f}")
    pf = results["profit_factor"]
    print(f"  Profit factor     {pf if pf is not None else 'n/a (no losing trades)'}")
    print(f"  Max drawdown      {results['max_drawdown_pct']:.2f}%")
    print("=" * 68)

    if source_used.startswith("paper"):
        print("\n  ** SYNTHETIC DATA — these numbers are meaningless as evidence.")
        print("     PaperBroker generates a seeded random walk. This run proves")
        print("     the pipeline works; it says nothing about the market.")
    print("\n  Note: this is an SMA crossover, NOT the strategy trading_graph.py")
    print("  trades. See docs/STRATEGY_REVIEW.md.\n")


# ─────────────────────────────────────────────────────────────────────────────
# Entry points
# ─────────────────────────────────────────────────────────────────────────────

def run(symbol: Optional[str] = None, timeframe: Optional[str] = None,
        start_date: Optional[str] = None, end_date: Optional[str] = None,
        data_source: Optional[str] = None, initial_balance: Optional[float] = None,
        strategy: Optional[str] = None, period: Optional[str] = None,
        explain: bool = False, **_ignored) -> Dict[str, Any]:
    """
    Run a backtest. Returns the metrics dict.

    `period` and `strategy` are accepted for backwards compatibility with the
    old CLI signature; `period` is ignored in favour of explicit dates.
    """
    settings = load_backtest_config({
        "symbol": symbol, "timeframe": timeframe, "start_date": start_date,
        "end_date": end_date, "data_source": data_source,
        "initial_balance": initial_balance, "strategy": strategy,
    })
    if period:
        logger.info("--period %s ignored; using start_date/end_date instead.", period)

    source = str(settings["data_source"]).lower()
    print(f"[BACKTEST] {settings['symbol']} {settings['timeframe']} "
          f"{settings['start_date']}..{settings['end_date']} via {source}")

    bars = fetch_rates(settings)
    results = run_engine(bars, settings)

    # A source may ignore the requested dates (PaperBroker honours the bar
    # count only). Saying so beats a header that claims a range the data
    # does not cover.
    requested_start = _parse_date(settings["start_date"]).timestamp()
    requested_end = _parse_date(settings["end_date"]).timestamp()
    results["range_mismatch"] = not (
        bars[0]["time"] <= requested_end and bars[-1]["time"] >= requested_start)

    print_report(settings, results, source)

    if explain:
        print("=" * 68)
        print("  AI ANALYSIS")
        print("=" * 68)
        print(describe_results_with_ai(results))
    return results


def run_backtest(**kwargs) -> Dict[str, Any]:
    """Backwards-compatible alias for run()."""
    return run(**kwargs)


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Run a ClawGold backtest.")
    parser.add_argument("--symbol", "-s")
    parser.add_argument("--timeframe", "-t")
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--data-source", choices=sorted(set(DATA_SOURCES)))
    parser.add_argument("--initial-balance", type=float)
    parser.add_argument("--explain", action="store_true", help="Add AI analysis")
    args = parser.parse_args(argv)

    try:
        run(symbol=args.symbol, timeframe=args.timeframe,
            start_date=args.start_date, end_date=args.end_date,
            data_source=args.data_source, initial_balance=args.initial_balance,
            explain=args.explain)
        return 0
    except BacktestError as exc:
        print(f"\n[BACKTEST] Cannot run: {exc}\n", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
