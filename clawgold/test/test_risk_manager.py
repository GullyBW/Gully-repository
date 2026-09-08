"""
Risk gates.

Several of these are regression tests for behaviour that used to reject or
approve trades for the wrong reason.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from risk_manager import RiskManager  # noqa: E402


def config(**trading_overrides):
    cfg = {
        "trading": {
            "mode": "simulation",
            "symbol": "XAUUSD",
            "risk_per_trade": 0.01,
            "default_stop_distance": 5.0,
        },
        "risk": {
            "max_positions": 5,
            "max_daily_loss": 500.0,
            "max_position_size": 1.0,
            "max_total_risk": 0.05,
            "min_margin_level": 100.0,
        },
    }
    cfg["trading"].update(trading_overrides)
    return cfg


FLAT_ACCOUNT = {"balance": 10_000, "equity": 10_000, "margin": 0.0, "margin_level": 0.0}
OPEN_ACCOUNT = {"balance": 10_000, "equity": 10_000, "margin": 265.0, "margin_level": 3773.0}


class TestPositionSizing(unittest.TestCase):
    def setUp(self):
        self.rm = RiskManager(config())

    def test_sizes_from_the_stop_distance(self):
        self.assertAlmostEqual(self.rm.calculate_position_size(10_000, stop_distance=5.0), 0.20)

    def test_uses_the_configured_default_stop(self):
        self.assertAlmostEqual(self.rm.calculate_position_size(10_000), 0.20)

    def test_returns_zero_rather_than_clamping_up(self):
        """
        Regression: max(volume, 0.01) used to force a trade the budget could
        not cover. 0.0 means "do not trade".
        """
        self.assertEqual(self.rm.calculate_position_size(50, stop_distance=50.0), 0.0)

    def test_never_exceeds_the_configured_cap(self):
        rm = RiskManager(config(risk_per_trade=0.9))
        self.assertLessEqual(rm.calculate_position_size(1_000_000, stop_distance=1.0), 1.0)

    def test_legacy_pips_argument_still_works(self):
        # 500 pips x 0.10 = a $50 stop -> 0.02 lots
        self.assertAlmostEqual(self.rm.calculate_position_size(10_000, stop_loss_pips=500), 0.02)

    def test_non_positive_stop_returns_zero(self):
        self.assertEqual(self.rm.calculate_position_size(10_000, stop_distance=0.0), 0.0)
        self.assertEqual(self.rm.calculate_position_size(10_000, stop_distance=-5.0), 0.0)


class TestCanTrade(unittest.TestCase):
    def setUp(self):
        self.rm = RiskManager(config())

    def test_correctly_sized_trade_is_allowed(self):
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 0.20, FLAT_ACCOUNT, [], stop_distance=5.0)
        self.assertTrue(allowed, reason)

    def test_flat_account_is_not_treated_as_a_margin_call(self):
        """
        Regression: MT5 reports margin_level 0 with no open positions. The
        old check compared 0 < 100 and rejected every opening trade, so the
        system could never take its first position.
        """
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 0.10, FLAT_ACCOUNT, [], stop_distance=5.0)
        self.assertTrue(allowed, reason)

    def test_low_margin_level_with_open_positions_is_rejected(self):
        account = {"balance": 10_000, "margin": 900.0, "margin_level": 80.0}
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 0.10, account, [{"volume": 0.1, "symbol": "XAUUSD"}],
            stop_distance=5.0)
        self.assertFalse(allowed)
        self.assertIn("Margin level", reason)

    def test_oversized_trade_is_rejected_with_the_numbers(self):
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 1.0, FLAT_ACCOUNT, [], stop_distance=5.0)
        self.assertFalse(allowed)
        self.assertIn("$500.00", reason)
        self.assertIn("$100.00", reason)

    def test_volume_above_the_hard_cap_is_rejected(self):
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 5.0, FLAT_ACCOUNT, [], stop_distance=5.0)
        self.assertFalse(allowed)
        self.assertIn("max position size", reason)

    def test_zero_volume_is_rejected(self):
        allowed, _ = self.rm.can_trade("XAUUSD", "BUY", 0.0, FLAT_ACCOUNT, [])
        self.assertFalse(allowed)

    def test_position_count_limit(self):
        positions = [{"volume": 0.01, "symbol": "XAUUSD"} for _ in range(5)]
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 0.01, OPEN_ACCOUNT, positions, stop_distance=5.0)
        self.assertFalse(allowed)
        self.assertIn("Max positions", reason)

    def test_daily_loss_limit_is_enforced_inside_can_trade(self):
        """The limit used to live only in a separate call callers could skip."""
        allowed, reason = self.rm.can_trade(
            "XAUUSD", "BUY", 0.10, FLAT_ACCOUNT, [], stop_distance=5.0, daily_pnl=-600)
        self.assertFalse(allowed)
        self.assertIn("Daily loss limit", reason)

    def test_daily_loss_within_limit_still_allows_trading(self):
        allowed, _ = self.rm.can_trade(
            "XAUUSD", "BUY", 0.10, FLAT_ACCOUNT, [], stop_distance=5.0, daily_pnl=-100)
        self.assertTrue(allowed)

    def test_total_exposure_cap_across_open_positions(self):
        # 5% of $10,000 = $500 total. Two 0.4-lot positions at a $5 stop is
        # $200 each, so a third would breach the cap.
        positions = [
            {"volume": 0.4, "symbol": "XAUUSD"},
            {"volume": 0.4, "symbol": "XAUUSD"},
        ]
        rm = RiskManager(config(risk_per_trade=0.05))
        allowed, reason = rm.can_trade(
            "XAUUSD", "BUY", 0.4, OPEN_ACCOUNT, positions, stop_distance=5.0)
        self.assertFalse(allowed)
        self.assertIn("Total risk", reason)

    def test_wider_stop_shrinks_the_allowed_volume(self):
        tight_ok, _ = self.rm.can_trade(
            "XAUUSD", "BUY", 0.20, FLAT_ACCOUNT, [], stop_distance=5.0)
        wide_ok, _ = self.rm.can_trade(
            "XAUUSD", "BUY", 0.20, FLAT_ACCOUNT, [], stop_distance=50.0)
        self.assertTrue(tight_ok)
        self.assertFalse(wide_ok)


class TestDailyLoss(unittest.TestCase):
    def setUp(self):
        self.rm = RiskManager(config())

    def test_within_limit(self):
        self.assertTrue(self.rm.check_daily_loss(-499.0)[0])

    def test_beyond_limit(self):
        self.assertFalse(self.rm.check_daily_loss(-501.0)[0])

    def test_profit_is_always_fine(self):
        self.assertTrue(self.rm.check_daily_loss(1_000.0)[0])


class TestRiskSummary(unittest.TestCase):
    def test_summary_reports_exposure_and_status(self):
        rm = RiskManager(config())
        summary = rm.get_risk_summary(OPEN_ACCOUNT, [{"volume": 0.1}, {"volume": 0.2}])
        self.assertAlmostEqual(summary["total_exposure"], 0.3)
        self.assertEqual(summary["total_positions"], 2)
        self.assertEqual(summary["margin_status"], "SAFE")


if __name__ == "__main__":
    unittest.main()
