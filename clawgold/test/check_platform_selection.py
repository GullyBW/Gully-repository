#!/usr/bin/env python3
"""
Assert the platform-aware MT5 import picks the right package.

macOS reaches for mt5-mac, which drives the official MetaTrader5 package
inside MetaTrader 5.app's bundled Wine. Every other platform reaches for
MetaTrader5 itself. Getting this backwards would have Linux import a
macOS-only package, or a Mac fail on a wheel that cannot exist for it.

Run directly (CI does): python test/check_platform_selection.py
"""

import os
import sys
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from broker import import_mt5_module, mt5_flavour  # noqa: E402


def main() -> int:
    with mock.patch.object(sys, "platform", "darwin"):
        assert mt5_flavour() == "mt5-mac", mt5_flavour()
        sentinel = mock.MagicMock()
        with mock.patch.dict(sys.modules, {"mt5_mac": sentinel}):
            assert import_mt5_module() is sentinel, "darwin did not select mt5_mac"

    for platform in ("linux", "win32"):
        with mock.patch.object(sys, "platform", platform):
            assert mt5_flavour() == "MetaTrader5", (platform, mt5_flavour())
            # Must not pick up mt5_mac even when it happens to be importable.
            with mock.patch.dict(sys.modules, {"mt5_mac": mock.MagicMock()}):
                try:
                    import_mt5_module()
                except ImportError:
                    pass
                else:
                    print(f"FAIL: {platform} imported an MT5 module it should not have")
                    return 1

    print("platform selection is correct: darwin -> mt5-mac, otherwise MetaTrader5")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
