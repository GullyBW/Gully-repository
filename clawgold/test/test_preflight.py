"""
Preflight checks and the config validator.

The validator tests include a regression for the bug that made
`claw.py validate` reject the configuration the repository ships.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import yaml  # noqa: E402

from config_validator import ConfigValidator  # noqa: E402
from preflight import (  # noqa: E402
    FAIL, PASS, WARN, Check, PreflightReport, run_preflight,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def write_config(**overrides):
    """A minimal valid config, with overrides merged in per-section."""
    config = {
        "trading": {
            "mode": "simulation", "symbol": "XAUUSD", "risk_per_trade": 0.01,
            "default_stop_distance": 5.0, "entry_budget": 10.0, "leverage": 500,
        },
        "risk": {
            "max_positions": 5, "max_daily_loss": 500.0, "max_position_size": 1.0,
            "max_total_risk": 0.05, "min_margin_level": 100.0,
        },
        "mt5": {"login": 0, "password": "", "server": ""},
        "api": {"provider": "yfinance", "ticker": "GC=F"},
        "logging": {"enable": True, "log_file": "logs/trades.log"},
        "telegram": {"enabled": False, "bot_token": "", "chat_id": ""},
        "free_mode": {"enabled": True, "allow_paid_llm_fallback": False},
    }
    for section, values in overrides.items():
        if isinstance(values, dict) and section in config:
            config[section] = {**config[section], **values}
        else:
            config[section] = values

    handle = tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False)
    yaml.safe_dump(config, handle)
    handle.close()
    return handle.name


class ValidatorTestCase(unittest.TestCase):
    def setUp(self):
        self._saved = dict(os.environ)
        # Env overrides would otherwise leak into the temp configs.
        for key in ("TRADING_MODE", "ENTRY_BUDGET", "LEVERAGE", "RISK_PER_TRADE",
                    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
            os.environ.pop(key, None)
        self._temp_files = []

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)
        for path in self._temp_files:
            try:
                os.unlink(path)
            except OSError:
                pass

    def validate(self, **overrides):
        path = write_config(**overrides)
        self._temp_files.append(path)
        return ConfigValidator(path).validate_all()


class TestShippedConfigValidates(unittest.TestCase):
    def test_the_committed_config_passes(self):
        """
        Regression: VALID_MODES was ['real'], so `claw.py validate` rejected
        the simulation config the repository ships — the safe default was
        the one setting validation refused.
        """
        errors, _ = ConfigValidator(str(REPO_ROOT / "config.yaml")).validate_all()
        self.assertEqual(errors, [], f"the shipped config does not validate: {errors}")


class TestModeValidation(ValidatorTestCase):
    def test_simulation_is_valid(self):
        errors, _ = self.validate(trading={"mode": "simulation"})
        self.assertEqual(errors, [])

    def test_paper_and_demo_are_valid(self):
        for mode in ("paper", "demo", "sim", "backtest"):
            errors, _ = self.validate(trading={"mode": mode})
            self.assertEqual(errors, [], f"mode {mode} was rejected")

    def test_real_is_valid_with_credentials(self):
        errors, _ = self.validate(
            trading={"mode": "real"},
            mt5={"login": 123456, "password": "x", "server": "Demo"})
        self.assertEqual(errors, [])

    def test_nonsense_mode_is_rejected(self):
        errors, _ = self.validate(trading={"mode": "yolo"})
        self.assertTrue(any("Invalid trading.mode" in e for e in errors))

    def test_live_without_credentials_is_rejected(self):
        errors, _ = self.validate(trading={"mode": "real"})
        self.assertTrue(any("login" in e.lower() for e in errors))

    def test_live_mode_warns_loudly(self):
        _, warnings = self.validate(
            trading={"mode": "real"},
            mt5={"login": 1, "password": "x", "server": "s"})
        self.assertTrue(any("LIVE" in w for w in warnings))


class TestRiskValidation(ValidatorTestCase):
    def test_risk_above_one_is_rejected(self):
        errors, _ = self.validate(trading={"risk_per_trade": 1.5})
        self.assertTrue(errors)

    def test_zero_risk_is_rejected(self):
        errors, _ = self.validate(trading={"risk_per_trade": 0})
        self.assertTrue(errors)

    def test_aggressive_risk_warns(self):
        _, warnings = self.validate(trading={"risk_per_trade": 0.10},
                                    risk={"max_total_risk": 0.5})
        self.assertTrue(any("aggressive" in w for w in warnings))

    def test_per_trade_risk_above_total_cap_is_rejected(self):
        errors, _ = self.validate(trading={"risk_per_trade": 0.10},
                                  risk={"max_total_risk": 0.05})
        self.assertTrue(any("max_total_risk" in e for e in errors))

    def test_negative_stop_distance_is_rejected(self):
        errors, _ = self.validate(trading={"default_stop_distance": -1})
        self.assertTrue(errors)


class TestEntryBudgetValidation(ValidatorTestCase):
    def test_infeasible_budget_is_rejected(self):
        """$10 cannot open 0.01 lots of gold at 1:100 — catch it early."""
        errors, _ = self.validate(
            trading={"entry_budget": 10.0, "leverage": 100},
            instruments={"XAUUSD": {"min_volume": 0.01, "volume_step": 0.01}})
        self.assertTrue(any("entry_budget" in e for e in errors), errors)

    def test_feasible_budget_passes(self):
        errors, _ = self.validate(
            trading={"entry_budget": 10.0, "leverage": 500},
            instruments={"XAUUSD": {"min_volume": 0.01, "volume_step": 0.01}})
        self.assertEqual(errors, [])

    def test_zero_budget_is_not_checked(self):
        errors, _ = self.validate(trading={"entry_budget": 0, "leverage": 100})
        self.assertEqual(errors, [])

    def test_negative_budget_is_rejected(self):
        errors, _ = self.validate(trading={"entry_budget": -5})
        self.assertTrue(errors)


class TestOtherValidation(ValidatorTestCase):
    def test_telegram_enabled_without_a_token_is_rejected(self):
        errors, _ = self.validate(telegram={"enabled": True, "bot_token": "", "chat_id": ""})
        self.assertTrue(any("bot_token" in e for e in errors))

    def test_free_mode_permitting_paid_calls_warns(self):
        _, warnings = self.validate(
            free_mode={"enabled": True, "allow_paid_llm_fallback": True})
        self.assertTrue(any("not free" in w for w in warnings))

    def test_unknown_symbol_warns_rather_than_failing(self):
        errors, warnings = self.validate(trading={"symbol": "BTCUSD"})
        self.assertEqual(errors, [])
        self.assertTrue(any("BTCUSD" in w for w in warnings))

    def test_bad_instrument_override_is_rejected(self):
        errors, _ = self.validate(instruments={"XAUUSD": {"min_volume": -1}})
        self.assertTrue(any("min_volume" in e for e in errors))

    def test_a_bad_override_never_reaches_the_spec_registry(self):
        """
        apply_config_overrides runs from load_config, before validation, so
        it must reject nonsense itself rather than corrupting sizing for
        every later calculation.
        """
        from instrument import apply_config_overrides, get_spec

        before = get_spec("XAUUSD").min_volume
        apply_config_overrides({"instruments": {"XAUUSD": {"min_volume": -1}}})
        self.assertEqual(get_spec("XAUUSD").min_volume, before)

    def test_missing_section_is_reported(self):
        path = write_config()
        self._temp_files.append(path)
        config = yaml.safe_load(open(path))
        del config["logging"]
        yaml.safe_dump(config, open(path, "w"))
        errors, _ = ConfigValidator(path).validate_all()
        self.assertTrue(any("logging" in e for e in errors))


class TestPreflightReport(unittest.TestCase):
    def test_empty_report_is_ok(self):
        self.assertTrue(PreflightReport().ok)

    def test_a_failure_makes_it_not_ok(self):
        report = PreflightReport()
        report.add("thing", FAIL, "broken")
        self.assertFalse(report.ok)

    def test_a_warning_alone_is_still_ok(self):
        report = PreflightReport()
        report.add("thing", WARN, "degraded")
        self.assertTrue(report.ok)

    def test_strict_mode_fails_on_warnings(self):
        report = PreflightReport(strict=True)
        report.add("thing", WARN, "degraded")
        self.assertFalse(report.ok)

    def test_render_includes_status_and_remedies(self):
        report = PreflightReport()
        report.add("Broker", FAIL, "no connection", "check config.yaml")
        text = report.render()
        self.assertIn("Broker", text)
        self.assertIn("no connection", text)
        self.assertIn("check config.yaml", text)
        self.assertIn("NOT ready", text)

    def test_render_reports_readiness_when_clean(self):
        report = PreflightReport()
        report.add("Everything", PASS, "fine")
        self.assertIn("ready to run", report.render())

    def test_check_ok_property(self):
        self.assertTrue(Check("a", PASS).ok)
        self.assertTrue(Check("a", WARN).ok)
        self.assertFalse(Check("a", FAIL).ok)


class TestPreflightRun(unittest.TestCase):
    """Against the real repository, which should be deployable."""

    @classmethod
    def setUpClass(cls):
        cls.report = run_preflight()

    def test_the_repository_passes_preflight(self):
        self.assertTrue(
            self.report.ok,
            "preflight failed: " + "; ".join(
                f"{c.name}: {c.detail}" for c in self.report.failures))

    def test_it_checks_the_things_that_matter(self):
        names = {c.name for c in self.report.checks}
        for expected in ("Python version", "Core dependencies", "Config loads",
                         "Config valid", "Trading mode", "Broker", "Entry budget",
                         "Free mode", "Writable paths", "No committed secrets",
                         "Kill switch"):
            self.assertIn(expected, names)

    def test_it_reports_paper_mode(self):
        mode_check = next(c for c in self.report.checks if c.name == "Trading mode")
        self.assertEqual(mode_check.status, PASS)
        self.assertIn("simulation", mode_check.detail)

    def test_it_verifies_the_broker_by_reading_a_price(self):
        broker_check = next(c for c in self.report.checks if c.name == "Broker")
        self.assertEqual(broker_check.status, PASS)
        self.assertIn("balance", broker_check.detail)

    def test_it_confirms_no_committed_secrets(self):
        secrets = next(c for c in self.report.checks if c.name == "No committed secrets")
        self.assertEqual(secrets.status, PASS, secrets.detail)


if __name__ == "__main__":
    unittest.main()
