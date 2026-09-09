"""
Disk-space management: log rotation, JSON logging, and runtime cleanup.

A long-running trader fills disks two ways — an unbounded log file, and
artifacts nothing prunes. Both were true here before: logger.py used a
plain FileHandler against a date-stamped path, so it grew without bound
*and* left a new file behind every day.

The cleanup tests care most about what must NOT be deleted. data/clawgold.db
is the trade journal; losing it loses the trade history.
"""

import json
import logging
import logging.handlers
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import logger as logger_module  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


class TestConfiguredRotation(unittest.TestCase):
    """The shipped config must actually bound the log."""

    def setUp(self):
        self.summary = logger_module.rotation_summary()

    def test_file_handler_is_rotating(self):
        handler = logger_module._build_file_handler(logging.INFO)
        self.addCleanup(handler.close)
        self.assertIsInstance(handler, logging.handlers.RotatingFileHandler)

    def test_limits_come_from_config_yaml(self):
        import yaml
        block = yaml.safe_load((ROOT / "config.yaml").read_text())["logging"]
        handler = logger_module._build_file_handler(logging.INFO)
        self.addCleanup(handler.close)
        self.assertEqual(handler.maxBytes, block["max_bytes"])
        self.assertEqual(handler.backupCount, block["backup_count"])

    def test_shipped_config_is_ten_megabytes_and_five_backups(self):
        self.assertEqual(self.summary["max_bytes"], 10485760)
        self.assertEqual(self.summary["backup_count"], 5)

    def test_total_disk_footprint_is_bounded(self):
        # current + backups; the point of the whole exercise.
        self.assertEqual(self.summary["max_total_bytes"], 10485760 * 6)

    def test_shipped_config_is_json_at_info(self):
        self.assertEqual(self.summary["format"], "json")
        self.assertEqual(self.summary["level"], "INFO")
        self.assertFalse(self.summary["trades_only"])


class TestRotationActuallyRotates(unittest.TestCase):
    """Configuration is a claim; this is the behaviour."""

    def test_writing_past_the_limit_creates_a_backup(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rotate.log"
            handler = logging.handlers.RotatingFileHandler(
                path, maxBytes=512, backupCount=2, encoding="utf-8")
            self.addCleanup(handler.close)
            log = logging.getLogger("rotation-probe")
            log.handlers = []
            log.addHandler(handler)
            log.setLevel(logging.INFO)

            for i in range(200):
                log.info("filling the log with entry number %d", i)

            self.assertTrue(path.exists())
            self.assertTrue((Path(tmp) / "rotate.log.1").exists())
            # backupCount=2 caps the archives, so .3 must never appear.
            self.assertFalse((Path(tmp) / "rotate.log.3").exists())


class TestJsonFormatter(unittest.TestCase):
    def _format(self, record):
        return json.loads(logger_module.JsonFormatter().format(record))

    def _record(self, **kwargs):
        record = logging.LogRecord(
            name="clawgold.test", level=logging.INFO, pathname=__file__,
            lineno=1, msg=kwargs.pop("msg", "hello %s"),
            args=kwargs.pop("args", ("world",)), exc_info=None)
        for key, value in kwargs.items():
            setattr(record, key, value)
        return record

    def test_emits_one_parseable_object(self):
        payload = self._format(self._record())
        self.assertEqual(payload["message"], "hello world")
        self.assertEqual(payload["level"], "INFO")
        self.assertEqual(payload["logger"], "clawgold.test")
        self.assertIn("timestamp", payload)

    def test_extra_fields_are_carried_through(self):
        payload = self._format(self._record(ticket=12345, symbol="XAUUSD"))
        self.assertEqual(payload["ticket"], 12345)
        self.assertEqual(payload["symbol"], "XAUUSD")

    def test_unserialisable_extra_does_not_break_logging(self):
        payload = self._format(self._record(broker=object()))
        self.assertIn("object", payload["broker"])

    def test_output_is_a_single_line(self):
        line = logger_module.JsonFormatter().format(
            self._record(msg="multi\nline", args=()))
        self.assertNotIn("\n", line)


class TestTradesOnlyFilter(unittest.TestCase):
    def setUp(self):
        self.filter = logger_module.TradesOnlyFilter()

    def _record(self, name, **extra):
        record = logging.LogRecord(name=name, level=logging.INFO, pathname="",
                                   lineno=0, msg="m", args=(), exc_info=None)
        for k, v in extra.items():
            setattr(record, k, v)
        return record

    def test_explicit_trade_records_pass(self):
        self.assertTrue(self.filter.filter(self._record("anything", trade=True)))

    def test_trade_loggers_pass(self):
        self.assertTrue(self.filter.filter(self._record("clawgold.trade_journal")))

    def test_unrelated_records_are_dropped(self):
        self.assertFalse(self.filter.filter(self._record("clawgold.news_aggregator")))


class TestConfigFallbacks(unittest.TestCase):
    """Bad settings must not silently disable rotation."""

    def test_non_positive_limits_fall_back_to_defaults(self):
        self.assertEqual(logger_module._positive_int(0, 99), 99)
        self.assertEqual(logger_module._positive_int(-5, 99), 99)
        self.assertEqual(logger_module._positive_int("nonsense", 99), 99)
        self.assertEqual(logger_module._positive_int(4096, 99), 4096)

    def test_level_accepts_names_and_numbers(self):
        self.assertEqual(logger_module._resolve_level("DEBUG"), logging.DEBUG)
        self.assertEqual(logger_module._resolve_level("info"), logging.INFO)
        self.assertEqual(logger_module._resolve_level(logging.WARNING), logging.WARNING)
        self.assertEqual(logger_module._resolve_level("not-a-level"), logging.INFO)


class TestValidatorRejectsUnboundedLogging(unittest.TestCase):
    def _errors(self, block):
        from config_validator import ConfigValidator
        validator = ConfigValidator.__new__(ConfigValidator)
        validator.errors = []
        validator.warnings = []
        validator._validate_logging(block)
        return validator.errors

    def test_valid_block_passes(self):
        self.assertEqual(self._errors({
            "enable": True, "file_path": "logs/clawgold.log",
            "max_bytes": 10485760, "backup_count": 5, "format": "json"}), [])

    def test_zero_max_bytes_is_an_error(self):
        errors = self._errors({"enable": True, "file_path": "x.log", "max_bytes": 0})
        self.assertTrue(any("without bound" in e for e in errors), errors)

    def test_deprecated_log_file_key_still_accepted(self):
        self.assertEqual(
            self._errors({"enable": True, "log_file": "logs/trades.log"}), [])

    def test_unknown_format_is_rejected(self):
        errors = self._errors({"enable": True, "file_path": "x.log", "format": "xml"})
        self.assertTrue(any("expected 'json' or 'text'" in e for e in errors), errors)


class TestCleanupScript(unittest.TestCase):
    """What the cleaner must refuse to delete matters more than what it deletes."""

    SCRIPT = ROOT / "scripts" / "clean_runtime_data.py"

    def _run(self, *args):
        return subprocess.run(
            [sys.executable, str(self.SCRIPT), *args],
            capture_output=True, text=True, cwd=str(ROOT))

    def test_runs_cleanly(self):
        result = self._run("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dry_run_deletes_nothing(self):
        probe = ROOT / "logs" / "dryrun_probe.log.9"
        probe.parent.mkdir(parents=True, exist_ok=True)
        probe.write_text("x")
        old = time.time() - 90 * 86400
        os.utime(probe, (old, old))
        self.addCleanup(lambda: probe.unlink(missing_ok=True))

        self._run("--dry-run")
        self.assertTrue(probe.exists(), "dry run deleted a file")

    def test_protected_databases_are_refused(self):
        """
        The trade journal must survive --databases.

        The fixture is created here rather than assumed: depending on
        whether data/clawgold.db happens to exist makes the test pass or
        fail on ambient state, which is how it silently stops testing
        anything.
        """
        journal = ROOT / "data" / "clawgold.db"
        pre_existing = journal.exists()
        if not pre_existing:
            journal.parent.mkdir(parents=True, exist_ok=True)
            journal.write_bytes(b"SQLite format 3\x00")
            self.addCleanup(lambda: journal.unlink(missing_ok=True))

        result = self._run("--dry-run", "--databases")
        self.assertIn("clawgold.db", result.stdout)
        self.assertIn("refused", result.stdout)
        self.assertNotIn("would remove  data/clawgold.db", result.stdout)
        # And it is still there afterwards, dry run or not.
        self._run("--databases")
        self.assertTrue(journal.exists(), "the trade journal was deleted")

    def test_active_log_is_never_a_candidate(self):
        result = self._run("--dry-run")
        self.assertNotIn("would remove  logs/clawgold.log ", result.stdout)

    def test_recent_archives_are_kept(self):
        recent = ROOT / "logs" / "recent_probe.log.1"
        recent.parent.mkdir(parents=True, exist_ok=True)
        recent.write_text("x")
        self.addCleanup(lambda: recent.unlink(missing_ok=True))
        result = self._run("--dry-run", "--days", "14")
        self.assertNotIn("recent_probe", result.stdout)

    def test_old_archives_are_pruned(self):
        stale = ROOT / "logs" / "stale_probe.log.7"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text("x")
        old = time.time() - 90 * 86400
        os.utime(stale, (old, old))
        self.addCleanup(lambda: stale.unlink(missing_ok=True))
        result = self._run("--dry-run")
        self.assertIn("stale_probe.log.7", result.stdout)

    def test_negative_days_is_rejected(self):
        self.assertEqual(self._run("--days", "-1").returncode, 2)


if __name__ == "__main__":
    unittest.main()
