"""
Free mode: the policy that stops the system spending money.

The gating test matters most — it is the only code path in ClawGold that
can incur a bill.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from free_mode import (  # noqa: E402
    PAID_LLM_KEYS, FreeMode, PaidServiceError, get_free_mode,
)


class EnvIsolated(unittest.TestCase):
    """Free mode reads the environment, so each test gets a clean one."""

    def setUp(self):
        self._saved = dict(os.environ)
        for key in PAID_LLM_KEYS + ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"):
            os.environ.pop(key, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)


class TestPolicy(EnvIsolated):
    def test_defaults_to_enabled(self):
        self.assertTrue(FreeMode.from_config({}).enabled)

    def test_reads_config(self):
        free = FreeMode.from_config({"free_mode": {
            "enabled": True, "allow_paid_llm_fallback": True,
            "skip_ai_research": True, "strict": False,
        }})
        self.assertTrue(free.allow_paid_llm_fallback)
        self.assertTrue(free.skip_ai_research)
        self.assertFalse(free.strict)

    def test_paid_llm_blocked_when_free(self):
        self.assertFalse(FreeMode(enabled=True, allow_paid_llm_fallback=False).permits_paid_llm())

    def test_paid_llm_allowed_when_explicitly_permitted(self):
        self.assertTrue(FreeMode(enabled=True, allow_paid_llm_fallback=True).permits_paid_llm())

    def test_paid_llm_allowed_when_free_mode_is_off(self):
        self.assertTrue(FreeMode(enabled=False).permits_paid_llm())

    def test_cloud_observability_blocked_when_free(self):
        self.assertFalse(FreeMode(enabled=True).permits_cloud_observability())
        self.assertTrue(FreeMode(enabled=False).permits_cloud_observability())

    def test_accessor_matches_constructor(self):
        self.assertEqual(get_free_mode({}).enabled, FreeMode.from_config({}).enabled)


class TestPaidServiceDetection(EnvIsolated):
    def test_clean_environment_detects_nothing(self):
        self.assertEqual(FreeMode().detect_paid_services(), [])

    def test_detects_a_billed_llm_key(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"
        found = FreeMode().detect_paid_services()
        self.assertTrue(any("OPENAI_API_KEY" in f for f in found))

    def test_detects_langfuse_cloud(self):
        os.environ["LANGFUSE_SECRET_KEY"] = "sk-lf-test"
        self.assertTrue(any("LANGFUSE" in f for f in FreeMode().detect_paid_services()))

    def test_empty_value_is_not_a_configured_service(self):
        os.environ["OPENAI_API_KEY"] = ""
        self.assertEqual(FreeMode().detect_paid_services(), [])

    def test_strict_mode_refuses_to_start(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"
        with self.assertRaises(PaidServiceError) as ctx:
            FreeMode(enabled=True, strict=True).assert_no_paid_services()
        self.assertIn("OPENAI_API_KEY", str(ctx.exception))

    def test_strict_error_names_the_ways_out(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"
        with self.assertRaises(PaidServiceError) as ctx:
            FreeMode(enabled=True, strict=True).assert_no_paid_services()
        message = str(ctx.exception)
        self.assertIn("allow_paid_llm_fallback", message)
        self.assertIn("strict", message)

    def test_non_strict_mode_permits_startup(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"
        FreeMode(enabled=True, strict=False).assert_no_paid_services()

    def test_disabled_free_mode_permits_startup(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"
        FreeMode(enabled=False, strict=True).assert_no_paid_services()


class TestExecutorGating(EnvIsolated):
    """The gate sits in front of the one call that can be billed."""

    def _executor(self, free_mode_config):
        import tempfile
        from agent_executor import AgentExecutor
        tmp = tempfile.mkdtemp()
        return AgentExecutor(
            cache_dir=os.path.join(tmp, "cache"),
            db_path=os.path.join(tmp, "history.db"),
            config={"free_mode": free_mode_config},
        )

    def test_fallback_refused_in_free_mode(self):
        import time
        from agent_executor import AgentTool

        executor = self._executor({"enabled": True, "allow_paid_llm_fallback": False})
        result = executor._run_litellm_fallback(
            AgentTool.GEMINI, "prompt", "task", 10, time.time())
        self.assertFalse(result.success)
        self.assertIn("Free mode", result.error)

    def test_fallback_attempted_when_permitted(self):
        """
        With the gate open the call is attempted. It still fails here
        because litellm is absent or unkeyed — the point is that the
        refusal is no longer free mode's.
        """
        import time
        from agent_executor import AgentTool

        executor = self._executor({"enabled": True, "allow_paid_llm_fallback": True})
        result = executor._run_litellm_fallback(
            AgentTool.GEMINI, "prompt", "task", 10, time.time())
        self.assertNotIn("Free mode", result.error or "")


class TestDescribe(EnvIsolated):
    def test_describes_enabled(self):
        self.assertIn("Free mode ON", FreeMode(enabled=True).describe())

    def test_describes_disabled(self):
        self.assertIn("OFF", FreeMode(enabled=False).describe())

    def test_mentions_skipped_research(self):
        text = FreeMode(enabled=True, skip_ai_research=True).describe()
        self.assertIn("technical signal only", text)


class TestShippedConfig(unittest.TestCase):
    def test_repository_ships_free_mode_on(self):
        import yaml
        from pathlib import Path

        path = Path(__file__).resolve().parent.parent / "config.yaml"
        cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
        free = FreeMode.from_config(cfg)
        self.assertTrue(free.enabled)
        self.assertFalse(free.allow_paid_llm_fallback,
                         "the shipped config would permit billed API calls")


if __name__ == "__main__":
    unittest.main()
