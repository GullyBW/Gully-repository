"""
Trading pipeline nodes and routing.

Nodes are exercised directly with hand-built state, so these run fast and
without LangGraph. Several are regressions for nodes that raised into their
own except blocks and reported success-shaped nothing.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import trading_graph as tg  # noqa: E402


class TestPlainCoercion(unittest.TestCase):
    """Graph state is msgpack-checkpointed and cannot hold numpy scalars."""

    def test_passes_through_plain_values(self):
        self.assertEqual(tg._plain({"a": 1, "b": "x"}), {"a": 1, "b": "x"})

    def test_converts_numpy_scalars(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy not installed")
        result = tg._plain({"score": np.float64(0.25), "n": np.int64(3)})
        self.assertIsInstance(result["score"], float)
        self.assertIsInstance(result["n"], int)

    def test_recurses_into_nested_containers(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy not installed")
        result = tg._plain({"tf": [{"ema": np.float64(1.5)}]})
        self.assertIsInstance(result["tf"][0]["ema"], float)


class TestAnalyzeNode(unittest.TestCase):
    """The blend of news sentiment and technical confluence."""

    def _analyze(self, sentiment_score, confluence):
        """
        Run analyze_node against stubbed sources.

        analyze_node imports `scripts.x` first and falls back to bare `x`, so
        both module paths must be stubbed — patching only the bare name lets
        the real analyzer through, which makes the test slow, networked and
        non-deterministic.
        """
        sentiment = mock.Mock()
        sentiment.score = sentiment_score
        sentiment.label = "bullish" if sentiment_score > 0 else "bearish"

        analyzer = mock.Mock()
        analyzer.analyze_text.return_value = sentiment

        trader = mock.Mock()
        trader.multi_timeframe_analysis.return_value = {
            "confluence_score": confluence, "overall_signal": "buy",
        }

        sentiment_module = mock.Mock(SentimentAnalyzer=lambda *a, **kw: analyzer)
        trader_module = mock.Mock(AdvancedTrader=lambda *a, **kw: trader)

        with mock.patch.dict(sys.modules, {
            "sentiment_analyzer": sentiment_module,
            "scripts.sentiment_analyzer": sentiment_module,
            "advanced_trader": trader_module,
            "scripts.advanced_trader": trader_module,
        }), mock.patch.object(tg, "_load_config", return_value={}):
            return tg.analyze_node({
                "symbol": "XAUUSD",
                "research": {"summary": "gold rallies on rate cut hopes"},
                "messages": [],
            })

    def test_two_bullish_sources_produce_a_buy(self):
        signal = self._analyze(0.7, 0.75)["signal"]
        self.assertEqual(signal["direction"], "BUY")
        self.assertEqual(signal["sources"], 2)

    def test_two_bearish_sources_produce_a_sell(self):
        self.assertEqual(self._analyze(-0.7, -0.75)["signal"]["direction"], "SELL")

    def test_disagreement_pulls_toward_hold(self):
        signal = self._analyze(0.7, -0.7)["signal"]
        self.assertEqual(signal["direction"], "HOLD")

    def test_agreeing_sources_beat_a_single_source(self):
        """Two sources pointing the same way earn an agreement bonus."""
        both = self._analyze(0.7, 0.7)["signal"]["confidence"]
        self.assertGreater(both, 0.7)

    def test_confidence_is_capped(self):
        self.assertLessEqual(self._analyze(1.0, 1.0)["signal"]["confidence"], 0.95)

    def test_signal_reason_names_its_inputs(self):
        self.assertIn("confluence", self._analyze(0.7, 0.75)["signal"]["reason"])


class TestValidateNode(unittest.TestCase):
    def test_hold_is_not_sized(self):
        result = tg.validate_node({
            "symbol": "XAUUSD",
            "signal": {"direction": "HOLD", "confidence": 0.1},
            "messages": [],
        })
        self.assertFalse(result["risk"]["approved"])
        self.assertEqual(result["risk"]["volume"], 0.0)

    def test_confidence_below_the_floor_is_rejected(self):
        result = tg.validate_node({
            "symbol": "XAUUSD",
            "signal": {"direction": "BUY", "confidence": 0.45},
            "messages": [],
        })
        self.assertFalse(result["risk"]["approved"])

    def test_a_validation_error_never_approves(self):
        """Regression: failing open here would place unvalidated trades."""
        with mock.patch.object(tg, "_load_config", side_effect=RuntimeError("boom")):
            result = tg.validate_node({
                "symbol": "XAUUSD",
                "signal": {"direction": "BUY", "confidence": 0.9},
                "messages": [],
            })
        self.assertFalse(result["risk"]["approved"])
        self.assertIn("failed", result["risk"]["reason"].lower())


class TestExecuteNode(unittest.TestCase):
    """
    Regression: execute_node called mt5.connect() and mt5.place_order(),
    neither of which existed, so no trade was ever placed.
    """

    def test_places_an_order_through_the_broker(self):
        result = tg.execute_node({
            "symbol": "XAUUSD",
            "signal": {"direction": "BUY", "sl": 2645.0, "tp": 2660.0},
            "risk": {"volume": 0.10, "approved": True},
            "messages": [],
        })
        execution = result["execution"]
        self.assertTrue(execution.get("success"), execution.get("error"))
        self.assertIsNotNone(execution.get("ticket"))
        self.assertAlmostEqual(execution.get("volume"), 0.10)
        self.assertFalse(execution.get("live"))

    def test_zero_volume_is_not_executed(self):
        result = tg.execute_node({
            "symbol": "XAUUSD",
            "signal": {"direction": "BUY"},
            "risk": {"volume": 0.0},
            "messages": [],
        })
        self.assertIn("Nothing to execute", result["execution"]["error"])

    def test_hold_is_not_executed(self):
        result = tg.execute_node({
            "symbol": "XAUUSD",
            "signal": {"direction": "HOLD"},
            "risk": {"volume": 0.10},
            "messages": [],
        })
        self.assertIn("Nothing to execute", result["execution"]["error"])


class TestMonitorNode(unittest.TestCase):
    def test_unexecuted_run_sends_nothing(self):
        result = tg.monitor_node({
            "symbol": "XAUUSD", "execution": {"success": False}, "messages": [],
        })
        self.assertIn("nothing executed", " ".join(result["messages"]).lower())

    def test_reads_symbol_from_state(self):
        """Regression: `symbol` was an undefined local, raising NameError."""
        result = tg.monitor_node({
            "symbol": "XAUUSD",
            "signal": {"direction": "BUY", "confidence": 0.8},
            "execution": {"success": True, "ticket": 1, "price": 2650.0, "volume": 0.1},
            "messages": [],
        })
        joined = " ".join(result["messages"])
        self.assertNotIn("NameError", joined)
        self.assertNotIn("not defined", joined)


class TestRouting(unittest.TestCase):
    def test_calendar_pause_ends_the_run(self):
        self.assertEqual(
            tg.route_after_calendar({"calendar": {"paused": True}}), "__end__")

    def test_clear_calendar_proceeds_to_research(self):
        self.assertEqual(
            tg.route_after_calendar({"calendar": {"paused": False}}), "research")

    def test_hold_ends_the_run(self):
        state = {"signal": {"direction": "HOLD", "confidence": 0.9}, "risk": {"approved": True}}
        self.assertEqual(tg.route_after_validate(state), "__end__")

    def test_low_confidence_retries_research(self):
        state = {"signal": {"direction": "BUY", "confidence": 0.4}, "iteration": 1, "risk": {}}
        self.assertEqual(tg.route_after_validate(state), "research")

    def test_retries_are_bounded(self):
        state = {"signal": {"direction": "BUY", "confidence": 0.4}, "iteration": 3, "risk": {}}
        self.assertEqual(tg.route_after_validate(state), "__end__")

    def test_risk_rejection_is_final_not_a_retry(self):
        """More research cannot change the balance that caused the rejection."""
        state = {
            "signal": {"direction": "BUY", "confidence": 0.9},
            "risk": {"approved": False, "reason": "Max positions reached"},
            "iteration": 1,
        }
        self.assertEqual(tg.route_after_validate(state), "__end__")

    def test_approved_high_confidence_goes_to_review(self):
        state = {
            "signal": {"direction": "BUY", "confidence": 0.8},
            "risk": {"approved": True}, "iteration": 1,
        }
        self.assertEqual(tg.route_after_validate(state), "human_review")

    def test_human_approval_routes_to_execute(self):
        self.assertEqual(tg.route_after_human({"approved": True}), "execute")

    def test_human_rejection_ends_the_run(self):
        self.assertEqual(tg.route_after_human({"approved": False}), "__end__")


@unittest.skipUnless(tg.LANGGRAPH_AVAILABLE, "langgraph not installed")
class TestGraphAssembly(unittest.TestCase):
    def test_graph_compiles_with_every_node(self):
        nodes = set(tg.build_graph().get_graph().nodes)
        for name in ("calendar_gate", "research", "analyze", "validate",
                     "human_review", "execute", "monitor", "learn"):
            self.assertIn(name, nodes)


if __name__ == "__main__":
    unittest.main()
