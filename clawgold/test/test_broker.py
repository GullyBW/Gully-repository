"""
Paper broker behaviour and the broker factory's mode resolution.

The factory tests matter most: they are what stops an ambiguous config from
sending real orders.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from broker import (  # noqa: E402
    Broker, BrokerError, MT5Broker, PaperBroker, Timeframe, get_broker, resolve_mode,
)


def paper_config(**overrides):
    cfg = {
        "trading": {"mode": "simulation", "symbol": "XAUUSD", "initial_balance": 10_000},
        "paper": {"start_price": 2650.0, "spread": 0.30,
                  "daily_volatility": 0.011, "leverage": 100, "seed": 42},
    }
    cfg.update(overrides)
    return cfg


class TestModeResolution(unittest.TestCase):
    def test_simulation_resolves_to_paper(self):
        self.assertEqual(resolve_mode({"trading": {"mode": "simulation"}}), "paper")

    def test_real_resolves_to_real(self):
        self.assertEqual(resolve_mode({"trading": {"mode": "real"}}), "real")

    def test_live_is_an_alias_for_real(self):
        self.assertEqual(resolve_mode({"trading": {"mode": "live"}}), "real")

    def test_mode_is_case_and_space_insensitive(self):
        self.assertEqual(resolve_mode({"trading": {"mode": "  REAL "}}), "real")

    def test_unrecognised_mode_falls_back_to_paper(self):
        """An unreadable mode must never be read as permission to trade live."""
        self.assertEqual(resolve_mode({"trading": {"mode": "yolo"}}), "paper")

    def test_missing_config_defaults_to_paper(self):
        self.assertEqual(resolve_mode({}), "paper")
        self.assertEqual(resolve_mode(None), "paper")


class TestBrokerFactory(unittest.TestCase):
    def test_paper_config_builds_paper_broker(self):
        broker = get_broker(paper_config())
        self.assertIsInstance(broker, PaperBroker)
        self.assertFalse(broker.is_live)

    def test_real_mode_without_login_is_refused(self):
        """A half-configured live setup must fail loudly, not connect as login 0."""
        cfg = paper_config()
        cfg["trading"]["mode"] = "real"
        cfg["mt5"] = {"login": 0}
        with self.assertRaises(BrokerError) as ctx:
            get_broker(cfg)
        self.assertIn("no MT5 login", str(ctx.exception))

    def test_real_mode_with_login_builds_mt5_broker(self):
        cfg = paper_config()
        cfg["trading"]["mode"] = "real"
        cfg["mt5"] = {"login": 12345678, "server": "Demo", "password": "x"}
        broker = get_broker(cfg)
        self.assertIsInstance(broker, MT5Broker)
        self.assertTrue(broker.is_live)

    def test_mt5_broker_import_error_is_actionable(self):
        """On a platform without MetaTrader5, connect() explains the way out."""
        cfg = paper_config()
        cfg["trading"]["mode"] = "real"
        cfg["mt5"] = {"login": 1, "server": "Demo", "password": "x"}
        broker = get_broker(cfg)
        try:
            import MetaTrader5  # noqa: F401
        except ImportError:
            with self.assertRaises(BrokerError) as ctx:
                broker.connect()
            self.assertIn("simulation", str(ctx.exception))


class TestPaperBrokerReads(unittest.TestCase):
    def setUp(self):
        self.broker = PaperBroker(paper_config())
        self.broker.connect()

    def tearDown(self):
        self.broker.disconnect()

    def test_implements_the_broker_interface(self):
        self.assertIsInstance(self.broker, Broker)

    def test_tick_has_a_positive_spread(self):
        tick = self.broker.get_tick("XAUUSD")
        self.assertGreater(tick["ask"], tick["bid"])
        self.assertAlmostEqual(tick["ask"] - tick["bid"], 0.30, places=2)

    def test_rates_are_chronological_and_the_right_length(self):
        bars = self.broker.get_rates("XAUUSD", Timeframe.H1, 50)
        self.assertEqual(len(bars), 50)
        self.assertTrue(all(bars[i]["time"] < bars[i + 1]["time"] for i in range(len(bars) - 1)))

    def test_bars_are_internally_consistent(self):
        for bar in self.broker.get_rates("XAUUSD", Timeframe.H1, 30):
            self.assertGreaterEqual(bar["high"], max(bar["open"], bar["close"]))
            self.assertLessEqual(bar["low"], min(bar["open"], bar["close"]))

    def test_repeated_rate_requests_are_stable(self):
        """Comparing two timeframes must not get two unrelated random walks."""
        first = self.broker.get_rates("XAUUSD", Timeframe.H1, 20)
        second = self.broker.get_rates("XAUUSD", Timeframe.H1, 20)
        self.assertEqual([b["close"] for b in first], [b["close"] for b in second])

    def test_same_seed_reproduces_the_same_series(self):
        other = PaperBroker(paper_config())
        other.connect()
        self.assertEqual(
            [b["close"] for b in self.broker.get_rates("XAUUSD", Timeframe.D1, 10)],
            [b["close"] for b in other.get_rates("XAUUSD", Timeframe.D1, 10)],
        )

    def test_flat_account_reports_zero_margin_level(self):
        account = self.broker.get_account_info()
        self.assertEqual(account["margin"], 0.0)
        self.assertEqual(account["margin_level"], 0.0)
        self.assertEqual(account["balance"], 10_000)


class TestPaperBrokerOrders(unittest.TestCase):
    def setUp(self):
        self.broker = PaperBroker(paper_config())
        self.broker.connect()

    def test_buy_opens_a_position(self):
        result = self.broker.execute_trade("BUY", 0.10)
        self.assertTrue(result["success"])
        positions = self.broker.get_positions()
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["type"], 0)
        self.assertAlmostEqual(positions[0]["volume"], 0.10)

    def test_sell_opens_a_short(self):
        self.broker.execute_trade("SELL", 0.10)
        self.assertEqual(self.broker.get_positions()[0]["type"], 1)

    def test_invalid_action_is_rejected(self):
        result = self.broker.execute_trade("SIDEWAYS", 0.10)
        self.assertFalse(result["success"])
        self.assertIn("Invalid action", result["error"])

    def test_volume_below_minimum_is_rejected(self):
        result = self.broker.execute_trade("BUY", 0.0001)
        self.assertFalse(result["success"])
        self.assertIn("minimum", result["error"])

    def test_oversized_order_is_refused_for_margin(self):
        result = self.broker.execute_trade("BUY", 90.0)
        self.assertFalse(result["success"])
        self.assertIn("margin", result["error"].lower())

    def test_close_realises_pnl_into_the_balance(self):
        opened = self.broker.execute_trade("BUY", 0.10)
        closed = self.broker.close_position(opened["ticket"])
        self.assertTrue(closed["success"])
        self.assertEqual(self.broker.get_positions(), [])
        self.assertAlmostEqual(
            self.broker.get_account_info()["balance"],
            10_000 + closed["profit"],
            places=2,
        )

    def test_closing_an_unknown_ticket_fails_cleanly(self):
        result = self.broker.close_position(9999)
        self.assertFalse(result["success"])
        self.assertIn("not found", result["error"])

    def test_modify_position_moves_the_stop(self):
        opened = self.broker.execute_trade("BUY", 0.10)
        self.broker.modify_position(opened["ticket"], sl=2600.0, tp=2700.0)
        position = self.broker.get_positions()[0]
        self.assertEqual(position["sl"], 2600.0)
        self.assertEqual(position["tp"], 2700.0)

    def test_stop_loss_triggers_and_closes_the_position(self):
        opened = self.broker.execute_trade("BUY", 0.10)
        # A stop far above the market closes the long on the next observed price.
        self.broker.modify_position(opened["ticket"], sl=opened["price"] + 500)
        self.broker.get_tick("XAUUSD")
        self.assertEqual(self.broker.get_positions(), [])
        self.assertEqual(self.broker.closed_trades[-1]["reason"], "sl")

    def test_open_position_consumes_margin(self):
        self.broker.execute_trade("BUY", 0.10)
        account = self.broker.get_account_info()
        self.assertGreater(account["margin"], 0)
        self.assertGreater(account["margin_level"], 0)

    def test_close_all_positions(self):
        self.broker.execute_trade("BUY", 0.05)
        self.broker.execute_trade("SELL", 0.05)
        self.assertEqual(len(self.broker.get_positions()), 2)
        self.broker.close_all_positions()
        self.assertEqual(self.broker.get_positions(), [])

    def test_reset_returns_to_the_opening_state(self):
        self.broker.execute_trade("BUY", 0.10)
        self.broker.reset()
        self.assertEqual(self.broker.get_positions(), [])
        self.assertEqual(self.broker.get_account_info()["balance"], 10_000)


if __name__ == "__main__":
    unittest.main()
