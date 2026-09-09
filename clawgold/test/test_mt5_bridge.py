"""
MT5 bridge: server, auth, and the RemoteMT5Broker client.

The round-trip tests run a real bridge server in a thread, backed by a
PaperBroker, and drive it with a real RemoteMT5Broker over real HTTP. That
exercises the whole path — routing, auth, JSON encoding, error mapping —
without needing MetaTrader5, which cannot be installed on this platform.
"""

import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from broker import (  # noqa: E402
    Broker, BrokerError, PaperBroker, RemoteMT5Broker, Timeframe,
    is_live_mode, metatrader5_available, resolve_mode,
)
from mt5_bridge_server import TIMEFRAMES, build_server  # noqa: E402

TOKEN = "test-token-not-a-real-secret-0123456789"


def paper_config():
    return {
        "trading": {"mode": "simulation", "symbol": "XAUUSD",
                    "initial_balance": 10_000, "leverage": 500},
        "paper": {"start_price": 2650.0, "spread": 0.30,
                  "daily_volatility": 0.011, "seed": 7},
    }


class BridgeFixture(unittest.TestCase):
    """Runs a bridge on an ephemeral port, backed by a paper broker."""

    read_only = False

    def setUp(self):
        self.backend = PaperBroker(paper_config())
        self.backend.connect()

        self.server = build_server("127.0.0.1", 0, TOKEN, self.backend,
                                   read_only=self.read_only)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        self.url = f"http://127.0.0.1:{self.port}"
        self.client = RemoteMT5Broker({
            "mt5": {"bridge": {"url": self.url, "token": TOKEN, "timeout": 10}}
        })

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.backend.disconnect()

    def raw(self, path, token=TOKEN, method="GET", body=None):
        """A request bypassing the client, for auth and protocol checks."""
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"{self.url}{path}", data=data, method=method)
        if token is not None:
            request.add_header("Authorization", f"Bearer {token}")
        if data:
            request.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode())


class TestPlatformFacts(unittest.TestCase):
    """The premise the bridge exists for."""

    def test_metatrader5_is_not_importable_here(self):
        if sys.platform.startswith("win"):
            self.skipTest("Windows can install MetaTrader5")
        self.assertFalse(
            metatrader5_available(),
            "MetaTrader5 imported on a non-Windows platform — unexpected")

    def test_remote_is_a_recognised_mode(self):
        self.assertEqual(resolve_mode({"trading": {"mode": "remote"}}), "remote")
        self.assertEqual(resolve_mode({"trading": {"mode": "bridge"}}), "remote")

    def test_remote_counts_as_live(self):
        """Remote reaches a real terminal, so safety rules must apply to it."""
        self.assertTrue(is_live_mode("remote"))
        self.assertTrue(is_live_mode("real"))
        self.assertFalse(is_live_mode("paper"))

    def test_real_mode_here_explains_the_remote_route(self):
        from broker import get_broker

        if sys.platform.startswith("win"):
            self.skipTest("Windows can run MT5 locally")

        with self.assertRaises(BrokerError) as ctx:
            get_broker({"trading": {"mode": "real"}, "mt5": {"login": 123}})
        message = str(ctx.exception)
        self.assertIn("remote", message)
        self.assertIn("MACOS.md", message)


class TestAuthentication(BridgeFixture):
    def test_health_needs_no_token(self):
        status, payload = self.raw("/health", token=None)
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["connected"])

    def test_missing_token_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/account", token=None)
        self.assertEqual(ctx.exception.code, 401)

    def test_wrong_token_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/account", token="wrong")
        self.assertEqual(ctx.exception.code, 401)

    def test_a_token_prefix_is_not_enough(self):
        """Guards against a comparison that stops at the first difference."""
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/account", token=TOKEN[:-1])
        self.assertEqual(ctx.exception.code, 401)

    def test_orders_also_require_a_token(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/trade", token=None, method="POST",
                     body={"action": "BUY", "volume": 0.1})
        self.assertEqual(ctx.exception.code, 401)

    def test_correct_token_is_accepted(self):
        status, payload = self.raw("/account")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])


class TestReads(BridgeFixture):
    def test_client_connects(self):
        self.client.connect()
        self.assertTrue(self.client.connected)

    def test_account_round_trip(self):
        account = self.client.get_account_info()
        self.assertAlmostEqual(account["balance"], 10_000)
        self.assertIn("currency", account)

    def test_tick_round_trip(self):
        tick = self.client.get_tick("XAUUSD")
        self.assertGreater(tick["ask"], tick["bid"])

    def test_rates_round_trip(self):
        bars = self.client.get_rates("XAUUSD", Timeframe.H1, 25)
        self.assertEqual(len(bars), 25)
        self.assertIn("close", bars[0])

    def test_every_timeframe_name_is_accepted(self):
        for minutes in TIMEFRAMES.values():
            bars = self.client.get_rates("XAUUSD", minutes, 3)
            self.assertEqual(len(bars), 3, f"timeframe {minutes} failed")

    def test_positions_start_empty(self):
        self.assertEqual(self.client.get_positions(), [])

    def test_missing_symbol_is_a_client_error(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/tick")
        self.assertEqual(ctx.exception.code, 400)

    def test_unknown_endpoint_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/nonsense")
        self.assertEqual(ctx.exception.code, 404)


class TestOrders(BridgeFixture):
    def test_buy_reaches_the_backend(self):
        result = self.client.execute_trade("BUY", 0.10, symbol="XAUUSD")
        self.assertTrue(result.get("success"), result.get("error"))
        self.assertEqual(len(self.backend.get_positions()), 1)

    def test_position_is_visible_through_the_client(self):
        self.client.execute_trade("BUY", 0.10, symbol="XAUUSD")
        positions = self.client.get_positions()
        self.assertEqual(len(positions), 1)
        self.assertAlmostEqual(positions[0]["volume"], 0.10)

    def test_stops_are_carried_across(self):
        opened = self.client.execute_trade(
            "BUY", 0.10, symbol="XAUUSD", sl=2600.0, tp=2700.0)
        position = self.backend.get_positions()[0]
        self.assertEqual(position["sl"], 2600.0)
        self.assertEqual(position["tp"], 2700.0)
        self.assertTrue(opened["success"])

    def test_close_round_trip(self):
        opened = self.client.execute_trade("BUY", 0.10, symbol="XAUUSD")
        closed = self.client.close_position(opened["ticket"])
        self.assertTrue(closed["success"])
        self.assertEqual(self.backend.get_positions(), [])

    def test_modify_round_trip(self):
        opened = self.client.execute_trade("BUY", 0.10, symbol="XAUUSD")
        result = self.client.modify_position(opened["ticket"], sl=2610.0)
        self.assertTrue(result["success"])
        self.assertEqual(self.backend.get_positions()[0]["sl"], 2610.0)

    def test_close_all_round_trip(self):
        self.client.execute_trade("BUY", 0.05, symbol="XAUUSD")
        self.client.execute_trade("SELL", 0.05, symbol="XAUUSD")
        self.client.close_all_positions()
        self.assertEqual(self.backend.get_positions(), [])

    def test_invalid_action_is_a_client_error(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.raw("/trade", method="POST", body={"action": "SIDEWAYS", "volume": 0.1})
        self.assertEqual(ctx.exception.code, 400)

    def test_broker_rejection_is_reported_not_raised(self):
        result = self.client.execute_trade("BUY", 0.00001, symbol="XAUUSD")
        self.assertFalse(result["success"])
        self.assertIn("minimum", result["error"])


class TestReadOnlyBridge(BridgeFixture):
    read_only = True

    def test_reads_still_work(self):
        self.assertIsNotNone(self.client.get_account_info())

    def test_health_advertises_read_only(self):
        _, payload = self.raw("/health", token=None)
        self.assertTrue(payload["read_only"])

    def test_orders_are_refused(self):
        result = self.client.execute_trade("BUY", 0.10, symbol="XAUUSD")
        self.assertFalse(result["success"])
        self.assertEqual(self.backend.get_positions(), [])

    def test_connect_still_succeeds(self):
        self.client.connect()
        self.assertTrue(self.client.connected)


class TestClientErrorHandling(unittest.TestCase):
    """Failure modes that do not need a running server."""

    def test_no_url_is_a_clear_error(self):
        client = RemoteMT5Broker({"mt5": {"bridge": {"token": "x"}}})
        with self.assertRaises(BrokerError) as ctx:
            client.connect()
        self.assertIn("bridge URL", str(ctx.exception))

    def test_no_token_is_a_clear_error(self):
        client = RemoteMT5Broker({"mt5": {"bridge": {"url": "http://127.0.0.1:1"}}})
        with self.assertRaises(BrokerError) as ctx:
            client.connect()
        self.assertIn("token", str(ctx.exception))

    def test_unreachable_bridge_names_the_remedy(self):
        client = RemoteMT5Broker({
            "mt5": {"bridge": {"url": "http://127.0.0.1:1", "token": "x", "timeout": 2}}
        })
        with self.assertRaises(BrokerError) as ctx:
            client.connect()
        self.assertIn("mt5_bridge_server", str(ctx.exception))

    def test_an_order_that_cannot_be_sent_is_marked_uncertain(self):
        """
        A transport failure on an order must not look like a clean
        rejection: the trade may in fact have been placed.
        """
        client = RemoteMT5Broker({
            "mt5": {"bridge": {"url": "http://127.0.0.1:1", "token": "x", "timeout": 2}}
        })
        result = client.execute_trade("BUY", 0.1)
        self.assertFalse(result["success"])
        self.assertTrue(result["uncertain"])

    def test_env_vars_configure_the_client(self):
        saved = dict(os.environ)
        try:
            os.environ["MT5_BRIDGE_URL"] = "http://example.invalid:8760"
            os.environ["MT5_BRIDGE_TOKEN"] = "from-env"
            client = RemoteMT5Broker({})
            self.assertEqual(client.url, "http://example.invalid:8760")
            self.assertEqual(client.token, "from-env")
        finally:
            os.environ.clear()
            os.environ.update(saved)

    def test_it_is_a_broker(self):
        self.assertTrue(issubclass(RemoteMT5Broker, Broker))
        self.assertTrue(RemoteMT5Broker.is_live)


if __name__ == "__main__":
    unittest.main()
