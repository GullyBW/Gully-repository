"""
Backtest configuration, data sources, and engine arithmetic.

The mt5 tests matter most: they are the only thing standing behind the claim
that a Mac can backtest against a real terminal, since CI runs on Linux where
neither MT5 package can be installed.
"""

import os
import sys
import types
import unittest
from datetime import datetime, timezone
from typing import NamedTuple
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import backtest  # noqa: E402
from backtest import BacktestError  # noqa: E402


class MqlRates(NamedTuple):
    """mt5-mac's row shape: a NamedTuple, not a numpy structured row."""
    time: int
    open: float
    high: float
    low: float
    close: float
    tick_volume: int
    spread: int
    real_volume: int


def noisy_bars(count=600, start=1767225600, seed=7):
    """
    A seeded random walk, which whipsaws and therefore produces losing
    trades. A clean sine wave never loses, so it cannot exercise the
    profit-factor consistency check below.
    """
    import random
    rng = random.Random(seed)
    price = 2650.0
    bars = []
    for i in range(count):
        price *= 1 + rng.gauss(0, 0.0015)
        bars.append({"time": start + i * 900, "open": price, "high": price + 1.5,
                     "low": price - 1.5, "close": price, "volume": 100})
    return bars


def oscillating_bars(count=400, start=1767225600):
    """Bars that actually cross, so the strategy trades."""
    import math
    return [
        {"time": start + i * 900,
         "open": 2650 + 20 * math.sin(i / 15),
         "high": 2653 + 20 * math.sin(i / 15),
         "low": 2647 + 20 * math.sin(i / 15),
         "close": 2650 + 20 * math.sin(i / 15),
         "volume": 100}
        for i in range(count)
    ]


class TestShippedConfig(unittest.TestCase):
    def setUp(self):
        self.settings = backtest.load_backtest_config()

    def test_matches_the_committed_block(self):
        self.assertEqual(self.settings["symbol"], "XAUUSD")
        self.assertEqual(self.settings["timeframe"], "M15")
        self.assertEqual(self.settings["mode"], "backtest")
        self.assertEqual(self.settings["initial_balance"], 10000.0)
        self.assertEqual(str(self.settings["start_date"]), "2026-01-01")
        self.assertEqual(str(self.settings["end_date"]), "2026-03-01")
        self.assertEqual(self.settings["data_source"], "mt5")

    def test_cli_overrides_win(self):
        settings = backtest.load_backtest_config({"timeframe": "H1", "symbol": None})
        self.assertEqual(settings["timeframe"], "H1")
        self.assertEqual(settings["symbol"], "XAUUSD")   # None does not override

    def test_backtest_mode_can_never_trade_live(self):
        from broker import resolve_mode
        self.assertEqual(resolve_mode({"trading": {"mode": "backtest"}}), "paper")


class TestDateParsing(unittest.TestCase):
    def test_iso_dates(self):
        self.assertEqual(backtest._parse_date("2026-01-01").year, 2026)

    def test_date_objects_from_yaml(self):
        parsed = backtest._parse_date(datetime(2026, 3, 1))
        self.assertEqual(parsed.month, 3)

    def test_garbage_is_rejected(self):
        with self.assertRaises(BacktestError):
            backtest._parse_date("last tuesday")


class TestMT5DataSource(unittest.TestCase):
    """The macOS route. CI cannot install either MT5 package, so it is faked."""

    def _fake_mt5_mac(self, rows=None, initialize=True):
        calls = {}
        module = types.ModuleType("mt5_mac")
        module.TIMEFRAME_M15 = 15          # mt5-mac uses minute counts
        module.initialize = lambda *a, **k: initialize
        module.shutdown = lambda: calls.__setitem__("shutdown", True)

        def copy_rates_range(symbol, timeframe, start, end):
            calls.update(symbol=symbol, timeframe=timeframe, start=start, end=end)
            if rows is not None:
                return rows
            base = int(start.timestamp())
            return tuple(MqlRates(base + i * 900, 2650.0, 2652.0, 2648.0,
                                  2651.0, 100, 3, 0) for i in range(50))
        module.copy_rates_range = copy_rates_range
        return module, calls

    def test_darwin_fetches_through_mt5_mac(self):
        module, calls = self._fake_mt5_mac()
        with mock.patch.object(sys, "platform", "darwin"), \
             mock.patch.dict(sys.modules, {"mt5_mac": module}):
            bars = backtest.fetch_rates(backtest.load_backtest_config())

        self.assertEqual(calls["symbol"], "XAUUSD")
        self.assertEqual(calls["timeframe"], 15)
        self.assertEqual(calls["start"].date().isoformat(), "2026-01-01")
        self.assertEqual(calls["end"].date().isoformat(), "2026-03-01")
        self.assertTrue(calls.get("shutdown"), "the terminal was not shut down")
        self.assertEqual(len(bars), 50)

    def test_namedtuple_rows_are_parsed(self):
        """mt5-mac rows are not subscriptable by name; rate_field handles it."""
        module, _ = self._fake_mt5_mac()
        with mock.patch.object(sys, "platform", "darwin"), \
             mock.patch.dict(sys.modules, {"mt5_mac": module}):
            bars = backtest.fetch_rates(backtest.load_backtest_config())
        self.assertEqual(bars[0]["close"], 2651.0)
        self.assertIsInstance(bars[0]["time"], int)

    def test_missing_package_names_the_remedy(self):
        with mock.patch("broker.import_mt5_module", side_effect=ImportError()), \
             mock.patch.object(sys, "platform", "darwin"):
            with self.assertRaises(BacktestError) as ctx:
                backtest.fetch_rates(backtest.load_backtest_config())
        self.assertIn("pip install mt5-mac", str(ctx.exception))

    def test_linux_says_there_is_nothing_to_install(self):
        with mock.patch("broker.import_mt5_module", side_effect=ImportError()), \
             mock.patch.object(sys, "platform", "linux"):
            with self.assertRaises(BacktestError) as ctx:
                backtest.fetch_rates(backtest.load_backtest_config())
        message = str(ctx.exception)
        self.assertIn("Windows-only", message)
        self.assertIn("paper", message)

    def test_terminal_not_running_is_actionable(self):
        module, _ = self._fake_mt5_mac(initialize=False)
        with mock.patch.object(sys, "platform", "darwin"), \
             mock.patch.dict(sys.modules, {"mt5_mac": module}):
            with self.assertRaises(BacktestError) as ctx:
                backtest.fetch_rates(backtest.load_backtest_config())
        self.assertIn("terminal", str(ctx.exception).lower())

    def test_empty_history_explains_why(self):
        module, _ = self._fake_mt5_mac(rows=())
        with mock.patch.object(sys, "platform", "darwin"), \
             mock.patch.dict(sys.modules, {"mt5_mac": module}):
            with self.assertRaises(BacktestError) as ctx:
                backtest.fetch_rates(backtest.load_backtest_config())
        self.assertIn("no bars", str(ctx.exception))

    def test_unknown_timeframe_is_refused(self):
        module, _ = self._fake_mt5_mac()
        settings = backtest.load_backtest_config({"timeframe": "M7"})
        with mock.patch.object(sys, "platform", "darwin"), \
             mock.patch.dict(sys.modules, {"mt5_mac": module}):
            with self.assertRaises(BacktestError):
                backtest.fetch_rates(settings)

    def test_unknown_data_source_is_refused(self):
        with self.assertRaises(BacktestError):
            backtest.fetch_rates(backtest.load_backtest_config({"data_source": "bloomberg"}))


class TestEngine(unittest.TestCase):
    def setUp(self):
        self.settings = backtest.load_backtest_config({"data_source": "paper"})

    def test_flat_market_makes_no_trades(self):
        bars = [{"time": 1767225600 + i * 900, "open": 2650.0, "high": 2650.0,
                 "low": 2650.0, "close": 2650.0, "volume": 1} for i in range(100)]
        results = backtest.run_engine(bars, self.settings)
        self.assertEqual(results["trades"], 0)
        self.assertEqual(results["final_balance"], 10000.0)

    def test_oscillating_market_trades(self):
        results = backtest.run_engine(oscillating_bars(), self.settings)
        self.assertGreater(results["trades"], 0)
        self.assertEqual(results["wins"] + results["losses"], results["trades"])

    def test_profit_factor_agrees_with_the_equity_curve(self):
        """
        The bug this pins: commission was charged to the balance but excluded
        from per-trade profit, so PF read above 1 while the account shrank.
        """
        results = backtest.run_engine(noisy_bars(), self.settings)
        self.assertGreater(results["losses"], 0, "fixture produced no losing trades")
        self.assertIsNotNone(results["profit_factor"])
        made_money = results["final_balance"] > results["initial_balance"]
        self.assertEqual(made_money, results["profit_factor"] > 1.0,
                         f"PF {results['profit_factor']} contradicts return "
                         f"{results['total_return_pct']}%")

    def test_commission_is_reported(self):
        results = backtest.run_engine(oscillating_bars(), self.settings)
        self.assertGreater(results["total_costs"], 0)

    def test_zero_commission_leaves_the_balance_untouched_by_costs(self):
        settings = dict(self.settings, commission=0.0)
        results = backtest.run_engine(oscillating_bars(), settings)
        self.assertEqual(results["total_costs"], 0.0)

    def test_too_few_bars_is_refused(self):
        bars = [{"time": i, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}
                for i in range(5)]
        with self.assertRaises(BacktestError):
            backtest.run_engine(bars, self.settings)

    def test_inverted_periods_are_refused(self):
        with self.assertRaises(BacktestError):
            backtest.run_engine(oscillating_bars(),
                                dict(self.settings, short_period=50, long_period=10))

    def test_drawdown_is_never_negative(self):
        results = backtest.run_engine(oscillating_bars(), self.settings)
        self.assertGreaterEqual(results["max_drawdown_pct"], 0.0)


class TestMovingAverage(unittest.TestCase):
    def test_matches_a_hand_computed_average(self):
        sma = backtest.simple_moving_average([1, 2, 3, 4, 5], 3)
        self.assertIsNone(sma[1])
        self.assertAlmostEqual(sma[2], 2.0)
        self.assertAlmostEqual(sma[4], 4.0)

    def test_too_short_a_series_yields_nothing(self):
        self.assertTrue(all(v is None for v in backtest.simple_moving_average([1, 2], 5)))


class TestEntryPoints(unittest.TestCase):
    def test_claw_py_calls_a_function_that_exists(self):
        """claw.py called backtest.run(), which did not exist."""
        self.assertTrue(callable(backtest.run))

    def test_run_backtest_alias_survives(self):
        self.assertTrue(callable(backtest.run_backtest))

    def test_module_defines_run_backtest_once(self):
        """It was defined twice; the second shadowed the first and was broken."""
        source = (backtest.ROOT / "scripts" / "backtest.py").read_text()
        self.assertEqual(source.count("\ndef run_backtest("), 1)


if __name__ == "__main__":
    unittest.main()
