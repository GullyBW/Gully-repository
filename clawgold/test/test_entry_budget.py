"""
Margin arithmetic and the entry budget.

These decide whether a small account can open a position at all, so the
expected values are computed by hand from the contract spec rather than
taken from whatever the code returns.

Reference numbers, XAUUSD at $2650/oz, 100 oz per lot:
    0.01 lots = 1 oz  = $2,650 notional
        margin at 1:100  = $26.50
        margin at 1:500  = $5.30
    0.001 lots = 0.1 oz = $265 notional
        margin at 1:100  = $2.65
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from instrument import (  # noqa: E402
    ContractSpec, apply_config_overrides, get_spec, max_volume_for_margin,
    min_margin_to_trade, register_spec, required_margin,
)
from risk_manager import RiskManager  # noqa: E402

PRICE = 2650.0

STANDARD_SPEC = ContractSpec(
    symbol="XAUUSD", contract_size=100.0, point=0.01, pip=0.10,
    min_volume=0.01, max_volume=100.0, volume_step=0.01, digits=2,
)
MICRO_SPEC = ContractSpec(
    symbol="XAUUSD", contract_size=100.0, point=0.01, pip=0.10,
    min_volume=0.001, max_volume=100.0, volume_step=0.001, digits=2,
)


def config(**trading_overrides):
    cfg = {
        "trading": {
            "mode": "simulation", "symbol": "XAUUSD", "risk_per_trade": 0.01,
            "default_stop_distance": 5.0, "entry_budget": 10.0, "leverage": 500,
        },
        "risk": {
            "max_positions": 5, "max_daily_loss": 500.0, "max_position_size": 1.0,
            "max_total_risk": 0.05, "min_margin_level": 100.0,
        },
    }
    cfg["trading"].update(trading_overrides)
    return cfg


class MarginTestCase(unittest.TestCase):
    """Every test here depends on the standard spec being in place."""

    def setUp(self):
        register_spec(STANDARD_SPEC)

    def tearDown(self):
        register_spec(STANDARD_SPEC)


class TestRequiredMargin(MarginTestCase):
    def test_standard_leverage(self):
        self.assertAlmostEqual(required_margin("XAUUSD", 0.01, PRICE, 100), 26.50)

    def test_high_leverage(self):
        self.assertAlmostEqual(required_margin("XAUUSD", 0.01, PRICE, 500), 5.30)

    def test_scales_linearly_with_volume(self):
        one = required_margin("XAUUSD", 0.01, PRICE, 500)
        ten = required_margin("XAUUSD", 0.10, PRICE, 500)
        self.assertAlmostEqual(ten, one * 10)

    def test_leverage_below_one_is_treated_as_unleveraged(self):
        self.assertAlmostEqual(required_margin("XAUUSD", 0.01, PRICE, 0), 2650.0)

    def test_min_margin_to_trade_uses_the_broker_minimum(self):
        self.assertAlmostEqual(min_margin_to_trade("XAUUSD", PRICE, 500), 5.30)


class TestMaxVolumeForMargin(MarginTestCase):
    def test_ten_dollars_affords_the_minimum_at_high_leverage(self):
        self.assertAlmostEqual(max_volume_for_margin("XAUUSD", 10.0, PRICE, 500), 0.01)

    def test_ten_dollars_affords_nothing_at_standard_leverage(self):
        """The headline constraint: $10 cannot open 0.01 lots of gold at 1:100."""
        self.assertEqual(max_volume_for_margin("XAUUSD", 10.0, PRICE, 100), 0.0)

    def test_result_actually_fits_the_budget(self):
        for budget in (10.0, 25.0, 100.0, 500.0):
            volume = max_volume_for_margin("XAUUSD", budget, PRICE, 500)
            if volume > 0:
                self.assertLessEqual(
                    required_margin("XAUUSD", volume, PRICE, 500), budget,
                    f"budget ${budget} produced an unaffordable volume",
                )

    def test_rounds_down_never_up(self):
        # $30 at 1:500 affords 0.056... lots; the step is 0.01, so 0.05.
        self.assertAlmostEqual(max_volume_for_margin("XAUUSD", 30.0, PRICE, 500), 0.05)

    def test_zero_and_negative_budgets(self):
        self.assertEqual(max_volume_for_margin("XAUUSD", 0.0, PRICE, 500), 0.0)
        self.assertEqual(max_volume_for_margin("XAUUSD", -5.0, PRICE, 500), 0.0)

    def test_micro_lots_make_ten_dollars_work_at_standard_leverage(self):
        register_spec(MICRO_SPEC)
        volume = max_volume_for_margin("XAUUSD", 10.0, PRICE, 100)
        self.assertGreater(volume, 0)
        self.assertLessEqual(required_margin("XAUUSD", volume, PRICE, 100), 10.0)


class TestEntryFeasibility(MarginTestCase):
    def test_feasible_at_high_leverage(self):
        check = RiskManager(config()).entry_feasibility(PRICE)
        self.assertTrue(check["feasible"])
        self.assertAlmostEqual(check["volume"], 0.01)
        self.assertEqual(check["shortfall"], 0.0)

    def test_infeasible_at_standard_leverage(self):
        check = RiskManager(config(leverage=100)).entry_feasibility(PRICE)
        self.assertFalse(check["feasible"])
        self.assertAlmostEqual(check["min_margin"], 26.50)
        self.assertAlmostEqual(check["shortfall"], 16.50)

    def test_infeasible_reason_names_the_remedies(self):
        reason = RiskManager(config(leverage=100)).entry_feasibility(PRICE)["reason"]
        self.assertIn("26.50", reason)
        self.assertIn("leverage", reason)
        self.assertIn("min_volume", reason)

    def test_no_budget_means_no_cap(self):
        check = RiskManager(config(entry_budget=0)).entry_feasibility(PRICE)
        self.assertTrue(check["feasible"])
        self.assertIn("risk alone", check["reason"])

    def test_explicit_budget_overrides_config(self):
        rm = RiskManager(config(leverage=100))
        self.assertTrue(rm.entry_feasibility(PRICE, entry_budget=30.0)["feasible"])


class TestSizingUnderTheBudget(MarginTestCase):
    def test_budget_caps_a_larger_risk_based_size(self):
        """
        Risk would allow 0.20 lots on a $10k balance at a $5 stop; a $10
        entry budget only affords 0.01. The tighter constraint must win.
        """
        rm = RiskManager(config())
        unbudgeted = rm.calculate_position_size(10_000, stop_distance=5.0)
        budgeted = rm.calculate_position_size(10_000, stop_distance=5.0, price=PRICE)
        self.assertAlmostEqual(unbudgeted, 0.20)
        self.assertAlmostEqual(budgeted, 0.01)

    def test_sized_position_fits_the_budget(self):
        rm = RiskManager(config())
        volume = rm.calculate_position_size(10_000, stop_distance=5.0, price=PRICE)
        self.assertLessEqual(required_margin("XAUUSD", volume, PRICE, 500), 10.0)

    def test_returns_zero_when_the_budget_cannot_open_anything(self):
        rm = RiskManager(config(leverage=100))
        self.assertEqual(
            rm.calculate_position_size(10_000, stop_distance=5.0, price=PRICE), 0.0)

    def test_risk_still_wins_when_it_is_the_tighter_constraint(self):
        """A large budget must not talk the risk budget upwards."""
        rm = RiskManager(config(entry_budget=100_000))
        volume = rm.calculate_position_size(10_000, stop_distance=5.0, price=PRICE)
        self.assertAlmostEqual(volume, 0.20)

    def test_missing_price_falls_back_to_risk_sizing(self):
        rm = RiskManager(config())
        self.assertAlmostEqual(
            rm.calculate_position_size(10_000, stop_distance=5.0), 0.20)

    def test_a_ten_dollar_account_can_place_a_trade(self):
        """The end-to-end claim: a $10 balance produces a tradeable volume."""
        rm = RiskManager(config(risk_per_trade=0.5))
        volume = rm.calculate_position_size(10.0, stop_distance=5.0, price=PRICE)
        self.assertGreater(volume, 0.0)
        self.assertLessEqual(required_margin("XAUUSD", volume, PRICE, 500), 10.0)


class TestConfigOverrides(MarginTestCase):
    def test_min_volume_and_step_come_from_config(self):
        apply_config_overrides({
            "instruments": {"XAUUSD": {"min_volume": 0.001, "volume_step": 0.001}}
        })
        spec = get_spec("XAUUSD")
        self.assertAlmostEqual(spec.min_volume, 0.001)
        self.assertAlmostEqual(spec.volume_step, 0.001)

    def test_unrelated_fields_are_preserved(self):
        apply_config_overrides({"instruments": {"XAUUSD": {"min_volume": 0.001}}})
        self.assertAlmostEqual(get_spec("XAUUSD").contract_size, 100.0)

    def test_empty_or_malformed_overrides_are_ignored(self):
        apply_config_overrides({})
        apply_config_overrides({"instruments": {"XAUUSD": "not-a-dict"}})
        self.assertAlmostEqual(get_spec("XAUUSD").min_volume, 0.01)


if __name__ == "__main__":
    unittest.main()
