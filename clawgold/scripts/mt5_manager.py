"""
MT5 Connection Manager (compatibility layer)
============================================
Execution now lives behind the Broker interface in ``broker.py``. This
module stays as the seam the rest of the codebase already uses:

    with MT5Manager() as mt5:
        account = mt5.get_account_info()
        positions = mt5.get_positions()

What changed is what comes back. ``MT5Manager`` no longer talks to
MetaTrader 5 itself — it resolves ``trading.mode`` and hands you either an
``MT5Broker`` (mode: real) or a ``PaperBroker`` (mode: simulation). Every
method every caller already used is present on both, so existing code runs
unchanged and now also runs on Linux and in CI.

Two behaviours are deliberately different from the original:

- Entering the context in simulation mode no longer raises. It used to
  refuse anything but ``mode: real``, which meant the only way to run the
  system at all was to point it at a live account.
- The MetaTrader5 package is imported lazily, so importing this module on
  a non-Windows host succeeds.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from .broker import (  # noqa: F401  (re-exported for callers)
        Broker, BrokerError, MT5Broker, PaperBroker, Timeframe,
        TIMEFRAME_M1, TIMEFRAME_M5, TIMEFRAME_M15, TIMEFRAME_M30,
        TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1,
        get_broker, resolve_mode,
    )
    from .config_loader import load_config, DEFAULT_MT5_TERMINAL_PATH  # noqa: F401
except ImportError:  # running from inside scripts/
    from broker import (  # noqa: F401
        Broker, BrokerError, MT5Broker, PaperBroker, Timeframe,
        TIMEFRAME_M1, TIMEFRAME_M5, TIMEFRAME_M15, TIMEFRAME_M30,
        TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1,
        get_broker, resolve_mode,
    )
    from config_loader import load_config, DEFAULT_MT5_TERMINAL_PATH  # noqa: F401

from dataclasses import dataclass

from logger import get_logger

logger = get_logger(__name__)


@dataclass
class AccountInfo:
    """Account information data class (kept for backward compatibility)."""

    balance: float
    equity: float
    margin: float
    margin_free: float
    profit: float
    margin_level: float
    currency: str


class MT5Manager:
    """
    Context manager that yields the broker selected by ``trading.mode``.

    Usage:
        with MT5Manager() as broker:
            tick = broker.get_tick("XAUUSD")

    Args:
        config_path: Path to config.yaml. Ignored when `config` is given.
        config: An already-loaded config dict, to avoid re-reading the file.
    """

    def __init__(self, config_path: Optional[str] = None,
                 config: Optional[Dict[str, Any]] = None):
        self.config_path = config_path or str(Path(__file__).resolve().parent.parent / "config.yaml")
        self.config: Optional[Dict[str, Any]] = config
        self.broker: Optional[Broker] = None
        self.connected = False

    def __enter__(self) -> Broker:
        if self.config is None:
            self._load_config()
        self.broker = get_broker(self.config)
        self.broker.connect()
        self.connected = True
        return self.broker

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.broker is not None:
            self.broker.disconnect()
        self.connected = False

    def _load_config(self) -> None:
        try:
            self.config = load_config(self.config_path)
        except Exception as exc:
            logger.error("Failed to load config: %s", exc)
            raise

    # -- convenience for callers that never used the context manager --------

    @property
    def is_live(self) -> bool:
        """True when this manager would send real orders."""
        if self.config is None:
            self._load_config()
        return resolve_mode(self.config) == "real"

    def open(self) -> Broker:
        """Non-context-manager entry point. Caller must call close()."""
        return self.__enter__()

    def close(self) -> None:
        self.__exit__(None, None, None)


def get_account_info(config: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """One-shot account read, opening and closing a connection."""
    with MT5Manager(config=config) as broker:
        return broker.get_account_info()


def get_positions(symbol: Optional[str] = None,
                  config: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """One-shot positions read, opening and closing a connection."""
    with MT5Manager(config=config) as broker:
        return broker.get_positions(symbol)
