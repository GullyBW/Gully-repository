"""
Config loading, environment overrides, and the shipped defaults.

The defaults tests are deliberately strict: they are what stops a fresh
clone from trading real money or messaging somebody else's Telegram
channels.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import yaml  # noqa: E402

from broker import resolve_mode  # noqa: E402
from config_loader import load_config  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config.yaml"


class TestShippedDefaults(unittest.TestCase):
    """The config as committed, independent of any local .env."""

    @classmethod
    def setUpClass(cls):
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            cls.raw = yaml.safe_load(fh)

    def test_defaults_to_simulation_not_real(self):
        self.assertEqual(self.raw["trading"]["mode"], "simulation")

    def test_resolves_to_the_paper_broker(self):
        self.assertEqual(resolve_mode(self.raw), "paper")

    def test_no_mt5_login_is_committed(self):
        self.assertFalse(self.raw.get("mt5", {}).get("login"))
        self.assertEqual(self.raw.get("mt5", {}).get("password", ""), "")

    def test_no_telegram_chat_id_is_committed(self):
        """Regression: this shipped pointing at the upstream author's chat."""
        self.assertEqual(self.raw["telegram"]["chat_id"], "")
        self.assertEqual(self.raw["telegram"]["bot_token"], "")

    def test_no_signal_channel_ids_are_committed(self):
        """Regression: these shipped pointing at the upstream author's rooms."""
        for tier, channel in self.raw["signal_service"]["channels"].items():
            self.assertEqual(channel, "", f"tier {tier} has a committed channel ID")

    def test_telegram_is_disabled_by_default(self):
        self.assertFalse(self.raw["telegram"]["enabled"])

    def test_scheduler_is_disabled_by_default(self):
        self.assertFalse(self.raw["agent"]["scheduler"]["enabled"])

    def test_a_default_stop_distance_exists(self):
        self.assertGreater(self.raw["trading"]["default_stop_distance"], 0)

    def test_paper_broker_is_seeded_for_reproducibility(self):
        self.assertIn("seed", self.raw["paper"])


class TestEnvOverrides(unittest.TestCase):
    def setUp(self):
        self._saved = dict(os.environ)
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False)
        yaml.safe_dump({
            "trading": {"mode": "simulation", "symbol": "XAUUSD", "risk_per_trade": 0.01},
            "mt5": {"login": 0, "password": "", "server": ""},
            "telegram": {"bot_token": "", "chat_id": ""},
            "signal_service": {"channels": {"free": "", "basic": "", "pro": "", "vip": ""}},
        }, self.tmp)
        self.tmp.close()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)
        os.unlink(self.tmp.name)

    def test_trading_mode_override(self):
        os.environ["TRADING_MODE"] = "real"
        self.assertEqual(load_config(self.tmp.name)["trading"]["mode"], "real")

    def test_risk_per_trade_is_parsed_as_a_number(self):
        os.environ["RISK_PER_TRADE"] = "0.025"
        value = load_config(self.tmp.name)["trading"]["risk_per_trade"]
        self.assertIsInstance(value, float)
        self.assertAlmostEqual(value, 0.025)

    def test_default_stop_distance_override(self):
        os.environ["DEFAULT_STOP_DISTANCE"] = "12.5"
        self.assertAlmostEqual(
            load_config(self.tmp.name)["trading"]["default_stop_distance"], 12.5)

    def test_mt5_login_is_parsed_as_an_int(self):
        os.environ["MT5_LOGIN"] = "12345678"
        self.assertEqual(load_config(self.tmp.name)["mt5"]["login"], 12345678)

    def test_telegram_overrides(self):
        os.environ["TELEGRAM_BOT_TOKEN"] = "token-123"
        os.environ["TELEGRAM_CHAT_ID"] = "-100999"
        cfg = load_config(self.tmp.name)
        self.assertEqual(cfg["telegram"]["bot_token"], "token-123")
        self.assertEqual(cfg["telegram"]["chat_id"], "-100999")

    def test_signal_channel_overrides(self):
        os.environ["SIGNAL_CH_PRO"] = "-100555"
        cfg = load_config(self.tmp.name)
        self.assertEqual(cfg["signal_service"]["channels"]["pro"], "-100555")

    def test_unset_env_leaves_config_untouched(self):
        for key in ("TRADING_MODE", "RISK_PER_TRADE", "TELEGRAM_CHAT_ID"):
            os.environ.pop(key, None)
        cfg = load_config(self.tmp.name)
        self.assertEqual(cfg["trading"]["mode"], "simulation")
        self.assertEqual(cfg["telegram"]["chat_id"], "")


class TestSignalServiceChannels(unittest.TestCase):
    def setUp(self):
        self._saved = dict(os.environ)
        for key in ("SIGNAL_CH_FREE", "SIGNAL_CH_BASIC", "SIGNAL_CH_PRO", "SIGNAL_CH_VIP"):
            os.environ.pop(key, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)

    def test_unconfigured_channels_are_empty_not_upstream_defaults(self):
        """
        Regression: SignalService fell back to the upstream author's channel
        IDs via os.getenv defaults, so blanking config.yaml was not enough.
        """
        from signal_service import SignalService

        with tempfile.TemporaryDirectory() as tmpdir:
            service = SignalService(
                db_path=os.path.join(tmpdir, "signals.db"),
                config={"signal_service": {"channels": {}}},
            )
            for tier, channel in service.TIER_CHANNELS.items():
                self.assertEqual(channel, "", f"tier {tier} defaulted to {channel!r}")


if __name__ == "__main__":
    unittest.main()
