"""
Kill switch and graceful shutdown.

These are the safety mechanisms that stand between a bad afternoon and a
worse one, so they are tested against real signals and real files rather
than mocks.
"""

import os
import signal
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from lifecycle import (  # noqa: E402
    GracefulShutdown, KillSwitch, entries_permitted,
)


class TestKillSwitch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "KILL_SWITCH"
        self.switch = KillSwitch(path=self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_starts_clear(self):
        self.assertFalse(self.switch.engaged)

    def test_engage_creates_the_file(self):
        self.switch.engage("market gapped")
        self.assertTrue(self.switch.engaged)
        self.assertTrue(self.path.exists())

    def test_engage_records_the_reason(self):
        self.switch.engage("deploying a fix")
        self.assertIn("deploying a fix", self.path.read_text(encoding="utf-8"))

    def test_engage_records_when_and_who(self):
        self.switch.engage()
        body = self.path.read_text(encoding="utf-8")
        self.assertIn("engaged_at", body)
        self.assertIn("pid", body)

    def test_release_clears_it(self):
        self.switch.engage("x")
        self.assertTrue(self.switch.release())
        self.assertFalse(self.switch.engaged)

    def test_release_when_clear_is_a_no_op(self):
        self.assertFalse(self.switch.release())

    def test_engage_creates_missing_parent_directories(self):
        nested = KillSwitch(path=Path(self.tmp.name) / "a" / "b" / "KILL")
        nested.engage("nested")
        self.assertTrue(nested.engaged)

    def test_survives_a_new_instance(self):
        """The file is the state, so a restarted process still sees it."""
        self.switch.engage("persists")
        self.assertTrue(KillSwitch(path=self.path).engaged)

    def test_describe_reports_state(self):
        self.assertIn("clear", self.switch.describe())
        self.switch.engage("because")
        self.assertIn("ENGAGED", self.switch.describe())
        self.assertIn("because", self.switch.describe())

    def test_from_config_honours_a_custom_path(self):
        switch = KillSwitch.from_config({"safety": {"kill_switch_path": str(self.path)}})
        self.assertEqual(switch.path, self.path)

    def test_from_config_defaults_without_config(self):
        self.assertEqual(KillSwitch.from_config({}).path.name, "KILL_SWITCH")


class TestEntriesPermitted(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "KILL_SWITCH"
        self.config = {"safety": {"kill_switch_path": str(self.path)}}

    def tearDown(self):
        self.tmp.cleanup()

    def test_permitted_when_clear(self):
        permitted, reason = entries_permitted(self.config)
        self.assertTrue(permitted)
        self.assertEqual(reason, "")

    def test_blocked_when_engaged(self):
        KillSwitch(path=self.path).engage("halt")
        permitted, reason = entries_permitted(self.config)
        self.assertFalse(permitted)
        self.assertIn("ENGAGED", reason)

    def test_blocked_during_shutdown(self):
        shutdown = GracefulShutdown()
        shutdown.request()
        permitted, reason = entries_permitted(self.config, shutdown)
        self.assertFalse(permitted)
        self.assertIn("Shutdown", reason)


class TestGracefulShutdown(unittest.TestCase):
    def test_starts_unrequested(self):
        self.assertFalse(GracefulShutdown().requested)

    def test_request_sets_the_flag(self):
        shutdown = GracefulShutdown()
        shutdown.request()
        self.assertTrue(shutdown.requested)

    def test_sigterm_requests_shutdown(self):
        """A container stop sends SIGTERM; the loop must notice."""
        with GracefulShutdown() as shutdown:
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(0.05)
            self.assertTrue(shutdown.requested)

    def test_sigint_requests_shutdown(self):
        with GracefulShutdown() as shutdown:
            os.kill(os.getpid(), signal.SIGINT)
            time.sleep(0.05)
            self.assertTrue(shutdown.requested)

    def test_handlers_run_on_exit(self):
        ran = []
        with GracefulShutdown() as shutdown:
            shutdown.on_shutdown(lambda: ran.append("first"))
            shutdown.on_shutdown(lambda: ran.append("second"))
        self.assertEqual(ran, ["first", "second"])

    def test_handlers_run_only_once(self):
        ran = []
        shutdown = GracefulShutdown()
        shutdown.on_shutdown(lambda: ran.append(1))
        shutdown.run_handlers()
        shutdown.run_handlers()
        self.assertEqual(len(ran), 1)

    def test_a_failing_handler_does_not_stop_the_others(self):
        """Failing to close one resource must not leak all the rest."""
        ran = []

        def explode():
            raise RuntimeError("boom")

        shutdown = GracefulShutdown()
        shutdown.on_shutdown(explode)
        shutdown.on_shutdown(lambda: ran.append("still ran"))
        shutdown.run_handlers()
        self.assertEqual(ran, ["still ran"])

    def test_on_shutdown_works_as_a_decorator(self):
        ran = []
        shutdown = GracefulShutdown()

        @shutdown.on_shutdown
        def cleanup():
            ran.append("decorated")

        shutdown.run_handlers()
        self.assertEqual(ran, ["decorated"])

    def test_wait_returns_false_on_timeout(self):
        self.assertFalse(GracefulShutdown().wait(0.01))

    def test_wait_returns_immediately_on_shutdown(self):
        """
        A service loop must not have to wait out its full interval before
        noticing a container stop.
        """
        shutdown = GracefulShutdown()
        threading.Timer(0.05, shutdown.request).start()

        started = time.monotonic()
        woke = shutdown.wait(30)
        elapsed = time.monotonic() - started

        self.assertTrue(woke)
        self.assertLess(elapsed, 5, "wait did not wake early on shutdown")

    def test_original_handlers_are_restored(self):
        original = signal.getsignal(signal.SIGTERM)
        with GracefulShutdown():
            pass
        self.assertEqual(signal.getsignal(signal.SIGTERM), original)

    def test_install_off_the_main_thread_does_not_raise(self):
        """Signals cannot be trapped from a worker; that must not be fatal."""
        errors = []

        def run():
            try:
                GracefulShutdown().install()
            except Exception as exc:
                errors.append(exc)

        thread = threading.Thread(target=run)
        thread.start()
        thread.join()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
