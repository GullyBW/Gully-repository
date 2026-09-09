"""
macOS compatibility: the mt5-mac backend.

MetaQuotes ships win_amd64 wheels only. On macOS `mt5-mac` fills the gap by
running the *official* MetaTrader5 package inside the Wine runtime bundled in
MetaTrader 5.app, spoken to over JSON/stdio.

It is close to a drop-in but not one, and each difference lands somewhere that
costs money. These tests pin the three that matter, using rate rows and symbol
specs shaped exactly like the real package's (verified against mt5-mac 0.3.0).
"""

import os
import sys
import unittest
from typing import NamedTuple
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import instrument  # noqa: E402
from broker import (  # noqa: E402
    BrokerError, MT5Broker, Timeframe,
    import_mt5_module, mt5_flavour, rate_field, retcode_done, spec_field,
)


class MqlRates(NamedTuple):
    """mt5-mac's rate row: a NamedTuple, not a numpy structured row."""
    time: int
    open: float
    high: float
    low: float
    close: float
    tick_volume: int
    spread: int
    real_volume: int


class NumpyLikeRow(dict):
    """MetaTrader5's rate row behaves like a mapping keyed by field name."""


class TestPlatformSelection(unittest.TestCase):
    def test_darwin_selects_mt5_mac(self):
        sentinel = mock.MagicMock(name="mt5_mac")
        with mock.patch.object(sys, "platform", "darwin"), \
             mock.patch.dict(sys.modules, {"mt5_mac": sentinel}):
            self.assertIs(import_mt5_module(), sentinel)

    def test_other_platforms_select_metatrader5(self):
        sentinel = mock.MagicMock(name="MetaTrader5")
        with mock.patch.object(sys, "platform", "win32"), \
             mock.patch.dict(sys.modules, {"MetaTrader5": sentinel}):
            self.assertIs(import_mt5_module(), sentinel)

    def test_linux_does_not_reach_for_mt5_mac(self):
        """mt5-mac is macOS-only; Linux must not silently pick it up."""
        with mock.patch.object(sys, "platform", "linux"), \
             mock.patch.dict(sys.modules, {"mt5_mac": mock.MagicMock()}):
            with self.assertRaises(ImportError):
                import_mt5_module()

    def test_flavour_names_the_package(self):
        with mock.patch.object(sys, "platform", "darwin"):
            self.assertEqual(mt5_flavour(), "mt5-mac")
        with mock.patch.object(sys, "platform", "linux"):
            self.assertEqual(mt5_flavour(), "MetaTrader5")


class TestRetcodeDone(unittest.TestCase):
    """
    mt5-mac calls the success code RES_E_SUCCESS; MetaTrader5 calls it
    TRADE_RETCODE_DONE. Both are 10009. Reading the wrong one would report a
    rejected order as filled.
    """

    def test_metatrader5_name(self):
        self.assertEqual(retcode_done(mock.Mock(TRADE_RETCODE_DONE=10009)), 10009)

    def test_mt5_mac_name(self):
        api = mock.Mock(spec=["RES_E_SUCCESS"])
        api.RES_E_SUCCESS = 10009
        self.assertEqual(retcode_done(api), 10009)

    def test_both_packages_agree_on_the_value(self):
        mt5mac = mock.Mock(spec=["RES_E_SUCCESS"]); mt5mac.RES_E_SUCCESS = 10009
        official = mock.Mock(spec=["TRADE_RETCODE_DONE"]); official.TRADE_RETCODE_DONE = 10009
        self.assertEqual(retcode_done(mt5mac), retcode_done(official))

    def test_unknown_api_is_refused_rather_than_guessed(self):
        """Refusing to trade beats assuming a constant we cannot see."""
        with self.assertRaises(BrokerError) as ctx:
            retcode_done(mock.Mock(spec=[]))
        self.assertIn("cannot be interpreted", str(ctx.exception))


class TestRateField(unittest.TestCase):
    def setUp(self):
        self.tuple_row = MqlRates(1700000000, 2650.0, 2655.0, 2649.0, 2652.5, 120, 30, 0)
        self.mapping_row = NumpyLikeRow(
            time=1700000000, open=2650.0, high=2655.0,
            low=2649.0, close=2652.5, tick_volume=120,
        )

    def test_reads_mt5_mac_namedtuple(self):
        self.assertEqual(rate_field(self.tuple_row, "close"), 2652.5)

    def test_reads_metatrader5_mapping_row(self):
        self.assertEqual(rate_field(self.mapping_row, "close"), 2652.5)

    def test_both_shapes_yield_the_same_value(self):
        for field in ("time", "open", "high", "low", "close", "tick_volume"):
            self.assertEqual(rate_field(self.tuple_row, field),
                             rate_field(self.mapping_row, field), field)

    def test_subscripting_a_namedtuple_by_name_is_what_this_exists_to_fix(self):
        with self.assertRaises(TypeError):
            self.tuple_row["close"]

    def test_missing_field_is_named(self):
        with self.assertRaises(BrokerError) as ctx:
            rate_field(self.tuple_row, "nonexistent")
        self.assertIn("nonexistent", str(ctx.exception))


class TestGetRatesAcrossBackends(unittest.TestCase):
    """The end-to-end shape: rates from either package reach the pipeline."""

    def _broker_returning(self, rows):
        broker = MT5Broker({"trading": {"symbol": "XAUUSD"}})
        api = mock.Mock()
        api.copy_rates_from_pos.return_value = rows
        broker._mt5 = api
        broker._tf_map = {Timeframe.H1: 60}
        broker.connected = True
        return broker

    def test_mt5_mac_rows_convert(self):
        rows = [MqlRates(1700000000 + i * 3600, 2650.0, 2655.0, 2649.0,
                         2652.5 + i, 120, 30, 0) for i in range(3)]
        bars = self._broker_returning(rows).get_rates("XAUUSD", Timeframe.H1, 3)
        self.assertEqual(len(bars), 3)
        self.assertEqual(bars[0]["close"], 2652.5)
        self.assertIsInstance(bars[0]["time"], int)

    def test_metatrader5_rows_convert_identically(self):
        tuples = [MqlRates(1700000000 + i * 3600, 2650.0, 2655.0, 2649.0,
                           2652.5 + i, 120, 30, 0) for i in range(3)]
        mappings = [NumpyLikeRow(r._asdict()) for r in tuples]
        self.assertEqual(
            self._broker_returning(tuples).get_rates("XAUUSD", Timeframe.H1, 3),
            self._broker_returning(mappings).get_rates("XAUUSD", Timeframe.H1, 3),
        )


class TestContractSpecNaming(unittest.TestCase):
    """
    MetaTrader5 exposes trade_contract_size; mt5-mac exposes contract_size.
    A getattr miss here is silent — sizing would fall back to the default.
    """

    class MacSpec(NamedTuple):
        contract_size: float = 100.0
        volume_min: float = 0.01
        volume_max: float = 50.0
        volume_step: float = 0.01
        digits: int = 2
        point: float = 0.01
        currency_profit: str = "USD"

    class OfficialSpec(NamedTuple):
        trade_contract_size: float = 100.0
        volume_min: float = 0.01
        volume_max: float = 50.0
        volume_step: float = 0.01
        digits: int = 2
        point: float = 0.01
        currency_profit: str = "USD"

    def test_spec_field_accepts_either_name(self):
        self.assertEqual(spec_field(self.MacSpec(), ("trade_contract_size", "contract_size"), 1.0), 100.0)
        self.assertEqual(spec_field(self.OfficialSpec(), ("trade_contract_size", "contract_size"), 1.0), 100.0)

    def test_refresh_reads_contract_size_from_mt5_mac(self):
        spec = instrument.refresh_from_broker("XAUUSD", self.MacSpec(contract_size=50.0))
        self.assertEqual(spec.contract_size, 50.0)

    def test_both_shapes_produce_the_same_spec(self):
        mac = instrument.refresh_from_broker("XAUUSD", self.MacSpec())
        official = instrument.refresh_from_broker("XAUUSD", self.OfficialSpec())
        self.assertEqual(mac.contract_size, official.contract_size)
        self.assertEqual(mac.min_volume, official.min_volume)

    # refresh_from_broker registers into a process-global spec registry, so
    # these tests must hand back exactly what they found. Restoring a
    # *plausible* spec instead of the real one silently changes the volume
    # step other suites size against.
    def setUp(self):
        self._original_spec = instrument.get_spec("XAUUSD")

    def tearDown(self):
        instrument.register_spec(self._original_spec)


class TestMacOSGuidance(unittest.TestCase):
    def test_connect_without_mt5_mac_names_the_install(self):
        broker = MT5Broker({"mt5": {"login": 123}})
        with mock.patch("broker.import_mt5_module", side_effect=ImportError("no module")), \
             mock.patch.object(sys, "platform", "darwin"):
            with self.assertRaises(BrokerError) as ctx:
                broker.connect()
        message = str(ctx.exception)
        self.assertIn("pip install mt5-mac", message)
        self.assertIn("MetaTrader 5.app", message)

    def test_linux_guidance_still_points_at_the_bridge(self):
        broker = MT5Broker({"mt5": {"login": 123}})
        with mock.patch("broker.import_mt5_module", side_effect=ImportError("no module")), \
             mock.patch.object(sys, "platform", "linux"):
            with self.assertRaises(BrokerError) as ctx:
                broker.connect()
        self.assertIn("remote", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
