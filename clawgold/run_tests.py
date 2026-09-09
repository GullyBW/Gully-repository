#!/usr/bin/env python3
"""
Test runner for ClawGold.

Use this rather than `python -m unittest discover -s test`. The test
directory is named ``test``, which collides with CPython's own stdlib
``test`` package: depending on how sys.path happens to be ordered,
discovery silently runs the standard library's test suite instead of this
project's, reporting a cheerful pass for tests that never ran.

This runner loads the repository's test modules by absolute file path, so
which suite runs is never in question.

Usage:
    python run_tests.py                  # everything
    python run_tests.py broker risk      # only matching modules
    python run_tests.py -v               # verbose
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEST_DIR = ROOT / "test"
SCRIPTS_DIR = ROOT / "scripts"


def _load_module(path: Path):
    """Import a test module from its path under a collision-proof name."""
    module_name = f"clawgold_tests_{path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def build_suite(patterns: list[str]) -> unittest.TestSuite:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    paths = sorted(TEST_DIR.glob("test_*.py"))
    if patterns:
        paths = [p for p in paths if any(pat in p.stem for pat in patterns)]

    if not paths:
        raise SystemExit(f"No test modules matched {patterns!r} in {TEST_DIR}")

    for path in paths:
        try:
            suite.addTests(loader.loadTestsFromModule(_load_module(path)))
        except Exception as exc:
            # Surface the import failure as a failing test rather than
            # letting the module vanish silently from the run.
            print(f"ERROR: could not import {path.name}: {exc}", file=sys.stderr)
            suite.addTest(_ImportFailure(path.name, exc))

    return suite


class _ImportFailure(unittest.TestCase):
    def __init__(self, name: str, error: Exception):
        super().__init__("runTest")
        self._name = name
        self._error = error

    def runTest(self):  # noqa: N802 - unittest naming
        self.fail(f"{self._name} failed to import: {self._error}")

    def __str__(self):
        return f"import {self._name}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the ClawGold test suite.")
    parser.add_argument("patterns", nargs="*", help="Only run modules whose name contains these")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("-f", "--failfast", action="store_true")
    args = parser.parse_args()

    # Tests import modules by their bare names (`from broker import ...`).
    sys.path.insert(0, str(SCRIPTS_DIR))
    sys.path.insert(0, str(ROOT))

    result = unittest.TextTestRunner(
        verbosity=2 if args.verbose else 1,
        failfast=args.failfast,
    ).run(build_suite(args.patterns))

    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
