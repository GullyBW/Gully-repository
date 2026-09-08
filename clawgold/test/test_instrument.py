"""
Contract spec and money conversions.

These are the numbers that decide how much real money a position risks, so
they are asserted against hand-computed values rather than against whatever
the code currently returns.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from instrument import (  # noqa: E402
    ContractSpec, get_spec, money_risk, normalize_volume, pips_to_price,
    position_size, price_to_pips, register_spec,
)


class TestContractSpec(unittest.TestCase):
    def test_xauusd_is_one_hundred_ounces_per_lot(self):
        spec = get_spec("XAUUSD")
        self.assertEqual(spec.contract_size, 100.0)
        self.assertEqual(spec.quote_currency, "USD")

    def test_value_per_price_unit(self):
        # A $1.00 move on 1 lot of gold is $100.
        self.assertEqual(get_spec("XAUUSD").value_per_price_unit, 100.0)

    def test_value_per_pip(self):
        # A pip is 0.10 for gold, so 1 lot moves $10 per pip.
        self.assertAlmostEqual(get_spec("XAUUSD").value_per_pip, 10.0)

    def test_unknown_symbol_falls_back_rather_than_raising(self):
        spec = get_spec("NOT_A_SYMBOL")
        self.assertEqual(spec.symbol, "XAUUSD")

    def test_symbol_lookup_is_case_insensitive(self):
        self.assertEqual(get_spec("xauusd").symbol, get_spec("XAUUSD").symbol)


class TestMoneyRisk(unittest.TestCase):
    def test_known_value(self):
        # 0.10 lots x 100 oz x $8.50 = $85.00
        self.assertAlmostEqual(money_risk("XAUUSD", 0.10, 8.50), 85.0)

    def test_scales_with_stop_distance(self):
        near = money_risk("XAUUSD", 0.10, 5.0)
        far = money_risk("XAUUSD", 0.10, 10.0)
        self.assertAlmostEqual(far, near * 2)

    def test_is_unsigned(self):
        self.assertEqual(
            money_risk("XAUUSD", 0.10, -8.50),
            money_risk("XAUUSD", 0.10, 8.50),
        )

    def test_regression_risk_depends_on_the_stop(self):
        """
        The old implementation used `volume * 100`, ignoring the stop. Two
        trades with the same volume but very different stops must not report
        the same risk.
        """
        tight = money_risk("XAUUSD", 0.10, 2.0)
        wide = money_risk("XAUUSD", 0.10, 40.0)
        self.assertNotEqual(tight, wide)
        self.assertAlmostEqual(wide / tight, 20.0)


class TestPositionSize(unittest.TestCase):
    def test_known_value(self):
        # $10,000 x 1% = $100 budget; $5 stop costs $500/lot -> 0.20 lots
        self.assertAlmostEqual(position_size("XAUUSD", 10_000, 0.01, 5.0), 0.20)

    def test_wider_stop_gives_smaller_size(self):
        tight = position_size("XAUUSD", 10_000, 0.01, 5.0)
        wide = position_size("XAUUSD", 10_000, 0.01, 50.0)
        self.assertLess(wide, tight)
        self.assertAlmostEqual(wide, 0.02)

    def test_resulting_risk_stays_within_budget(self):
        balance, fraction, stop = 7_337.0, 0.0125, 6.40
        volume = position_size("XAUUSD", balance, fraction, stop)
        self.assertLessEqual(money_risk("XAUUSD", volume, stop), balance * fraction)

    def test_returns_zero_when_budget_cannot_fund_minimum(self):
        """
        Regression: the old code did max(volume, 0.01), placing a trade
        larger than the budget allowed exactly when the account was smallest.
        """
        self.assertEqual(position_size("XAUUSD", 50, 0.01, 50.0), 0.0)

    def test_rounds_down_to_volume_step(self):
        volume = position_size("XAUUSD", 10_000, 0.01, 7.0)
        self.assertEqual(volume, round(volume, 2))
        self.assertLessEqual(money_risk("XAUUSD", volume, 7.0), 100.0)

    def test_zero_stop_is_rejected(self):
        with self.assertRaises(ValueError):
            position_size("XAUUSD", 10_000, 0.01, 0.0)

    def test_non_positive_balance_returns_zero(self):
        self.assertEqual(position_size("XAUUSD", 0, 0.01, 5.0), 0.0)
        self.assertEqual(position_size("XAUUSD", -100, 0.01, 5.0), 0.0)

    def test_respects_broker_max_volume(self):
        register_spec(ContractSpec(
            symbol="TESTCAP", contract_size=100.0, point=0.01, pip=0.1,
            min_volume=0.01, max_volume=0.50, volume_step=0.01, digits=2,
        ))
        self.assertEqual(position_size("TESTCAP", 10_000_000, 0.5, 1.0), 0.50)


class TestVolumeAndPips(unittest.TestCase):
    def test_normalize_rounds_down(self):
        self.assertAlmostEqual(normalize_volume("XAUUSD", 0.1749), 0.17)

    def test_normalize_below_minimum_is_zero(self):
        self.assertEqual(normalize_volume("XAUUSD", 0.004), 0.0)

    def test_pip_conversions_round_trip(self):
        self.assertAlmostEqual(pips_to_price("XAUUSD", 50), 5.0)
        self.assertAlmostEqual(price_to_pips("XAUUSD", 5.0), 50.0)


if __name__ == "__main__":
    unittest.main()
