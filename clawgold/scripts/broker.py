"""
Broker abstraction
==================
One interface in front of order execution, with three backends:

    PaperBroker      — an in-process simulator that fills against a
                       synthetic price series, so the system runs and can
                       be tested on any platform, in CI, and in Docker
    MT5Broker        — a MetaTrader 5 terminal on this machine (Windows)
    RemoteMT5Broker  — a terminal on ANOTHER machine, via mt5_bridge_server

The backend is chosen by ``trading.mode`` in config.yaml:

    mode: simulation   -> PaperBroker      (default)
    mode: paper        -> PaperBroker
    mode: real         -> MT5Broker        (Windows only)
    mode: remote       -> RemoteMT5Broker  (live, from anywhere)

**On macOS and Linux.** The MetaTrader5 package publishes only
``win_amd64`` wheels: it is a closed-source binary that talks to the
Windows terminal over local IPC, so no macOS or Linux build exists and
none can be produced from outside MetaQuotes. ``mode: remote`` is the
supported route — run the terminal where it works (a Windows VM or VPS,
or macOS under Wine/CrossOver), expose it with
``scripts/mt5_bridge_server.py``, and point this at the bridge. Nothing
upstream of the Broker interface knows the difference. See docs/MACOS.md.

The MetaTrader5 package is imported lazily, inside MT5Broker.connect(), so
importing this module never fails on a platform where MT5 does not exist.

Usage:
    from broker import get_broker

    with get_broker(config) as broker:
        tick = broker.get_tick("XAUUSD")
        broker.execute_trade("BUY", 0.10)
"""

from __future__ import annotations

import os
import random
import sys
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

try:
    from .config_loader import load_config, DEFAULT_MT5_TERMINAL_PATH
    from .instrument import get_spec, normalize_volume, refresh_from_broker
except ImportError:  # running from inside scripts/
    from config_loader import load_config, DEFAULT_MT5_TERMINAL_PATH
    from instrument import get_spec, normalize_volume, refresh_from_broker

from logger import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Timeframes — platform-independent, mapped to MT5 constants only when needed
# ─────────────────────────────────────────────────────────────────────────────

class Timeframe:
    """
    Timeframe identifiers as minute counts.

    Using minutes rather than MetaTrader5's opaque integer constants means
    every module can name a timeframe without importing MT5. MT5Broker
    translates these to the platform constants at the boundary.
    """

    M1 = 1
    M5 = 5
    M15 = 15
    M30 = 30
    H1 = 60
    H4 = 240
    D1 = 1440

    _NAMES = {1: "M1", 5: "M5", 15: "M15", 30: "M30", 60: "H1", 240: "H4", 1440: "D1"}

    @classmethod
    def name(cls, minutes: int) -> str:
        return cls._NAMES.get(minutes, f"{minutes}m")

    @classmethod
    def all_named(cls) -> List[tuple]:
        """The four timeframes the confluence analysis uses, in order."""
        return [(cls.M15, "M15"), (cls.H1, "H1"), (cls.H4, "H4"), (cls.D1, "D1")]


# Back-compat aliases so modules can drop `import MetaTrader5 as mt5_lib`.
TIMEFRAME_M1 = Timeframe.M1
TIMEFRAME_M5 = Timeframe.M5
TIMEFRAME_M15 = Timeframe.M15
TIMEFRAME_M30 = Timeframe.M30
TIMEFRAME_H1 = Timeframe.H1
TIMEFRAME_H4 = Timeframe.H4
TIMEFRAME_D1 = Timeframe.D1


class BrokerError(RuntimeError):
    """Raised when a broker cannot be reached or refuses an operation."""


# ─────────────────────────────────────────────────────────────────────────────
# The MT5 API, per platform
# ─────────────────────────────────────────────────────────────────────────────
#
# MetaQuotes publishes win_amd64 wheels only. On macOS the `mt5-mac` package
# fills the gap, and it does so honestly: it runs the *official* MetaTrader5
# package under the Wine runtime already bundled inside MetaTrader 5.app, and
# talks to it as a JSON-over-stdio subprocess. So the terminal, the broker
# connection and the order semantics are the real ones.
#
# It is close to a drop-in, but not one. Three differences bite, and every one
# of them lands somewhere that costs money, so they are normalised below rather
# than left for a caller to trip over:
#
#   1. The success retcode is `RES_E_SUCCESS`, not `TRADE_RETCODE_DONE`
#      (both 10009). Unnormalised this is an AttributeError raised *after* an
#      order has been sent, while deciding whether it worked.
#   2. `copy_rates_*` returns MqlRates NamedTuples; MetaTrader5 returns numpy
#      structured rows. `row["close"]` raises TypeError on the former.
#   3. Symbol specs expose `contract_size`, not `trade_contract_size`. This one
#      fails silently — a getattr miss falls back to a hard-coded default, so
#      position sizing would quietly use the wrong contract size.


def import_mt5_module():
    """
    Import the MT5 API appropriate to this platform.

    Deliberately not done at module scope: importing MetaTrader5 eagerly is
    what made this system unimportable on Linux and in the container, and CI
    asserts that it stays lazy.
    """
    if sys.platform == "darwin":
        import mt5_mac as mt5          # macOS: official MT5 under bundled Wine
    else:
        import MetaTrader5 as mt5      # noqa: N813  (vendor's own casing)
    return mt5


def mt5_flavour() -> str:
    """Which package `import_mt5_module` will reach for on this host."""
    return "mt5-mac" if sys.platform == "darwin" else "MetaTrader5"


def retcode_done(mt5) -> int:
    """
    The 'order completed' retcode, under whichever name this package uses.

    Never guessed: a wrong constant here reads a rejected order as filled.
    """
    for name in ("TRADE_RETCODE_DONE", "RES_E_SUCCESS"):
        code = getattr(mt5, name, None)
        if code is not None:
            return int(code)
    raise BrokerError(
        f"{mt5_flavour()} exposes neither TRADE_RETCODE_DONE nor RES_E_SUCCESS, "
        "so an order result cannot be interpreted. Refusing to trade against an "
        "API this code does not understand."
    )


def rate_field(row, name: str):
    """
    Read one field from a rate row, whichever shape the package returns.

    MetaTrader5 gives numpy structured rows (``row["close"]``); mt5-mac gives
    MqlRates NamedTuples (``row.close``).
    """
    try:
        return row[name]
    except (TypeError, IndexError, KeyError):
        try:
            return getattr(row, name)
        except AttributeError as exc:
            raise BrokerError(
                f"Rate row from {mt5_flavour()} has no field {name!r}."
            ) from exc


def spec_field(symbol_info, names, default):
    """First present attribute among ``names``, else ``default``."""
    for name in names:
        value = getattr(symbol_info, name, None)
        if value:
            return value
    return default


# ─────────────────────────────────────────────────────────────────────────────
# Interface
# ─────────────────────────────────────────────────────────────────────────────

class Broker(ABC):
    """
    Everything the trading system needs from an execution venue.

    Implementations are context managers: ``with get_broker(cfg) as b:``
    connects on entry and disconnects on exit. Every method returns plain
    dicts and lists so callers never depend on a platform's own types.
    """

    #: Set by subclasses. True when orders reach a real venue with real money.
    is_live: bool = False

    def __enter__(self) -> "Broker":
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.disconnect()

    @abstractmethod
    def connect(self) -> None:
        """Open the connection. Raises BrokerError on failure."""

    @abstractmethod
    def disconnect(self) -> None:
        """Close the connection. Must be safe to call when not connected."""

    @abstractmethod
    def get_account_info(self) -> Optional[Dict[str, Any]]:
        """balance, equity, margin, margin_free, profit, margin_level, currency."""

    @abstractmethod
    def get_positions(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Open positions as dicts: ticket, symbol, type, volume, price_open, ..."""

    @abstractmethod
    def get_tick(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Current bid/ask/last/time."""

    @abstractmethod
    def get_rates(self, symbol: str, timeframe: int, count: int) -> Optional[List[Dict[str, Any]]]:
        """`count` most recent bars, oldest first, as dicts with OHLC keys."""

    @abstractmethod
    def execute_trade(self, action: str, volume: float, symbol: Optional[str] = None,
                      sl: Optional[float] = None, tp: Optional[float] = None,
                      deviation: int = 10) -> Dict[str, Any]:
        """Send a market order. Returns {'success': bool, ...}."""

    @abstractmethod
    def close_position(self, ticket: int) -> Dict[str, Any]:
        """Close one position by ticket."""

    @abstractmethod
    def modify_position(self, ticket: int, sl: Optional[float] = None,
                        tp: Optional[float] = None) -> Dict[str, Any]:
        """Move the stop-loss and/or take-profit of an open position."""

    def close_all_positions(self) -> List[Dict[str, Any]]:
        """Close every open position. Default: loop over close_position."""
        return [self.close_position(p["ticket"]) for p in self.get_positions()]

    @property
    def name(self) -> str:
        return type(self).__name__


# ─────────────────────────────────────────────────────────────────────────────
# MetaTrader 5 backend
# ─────────────────────────────────────────────────────────────────────────────

class MT5Broker(Broker):
    """
    The real thing. Requires a running MetaTrader 5 terminal on Windows.

    The MetaTrader5 package is imported inside connect() rather than at
    module scope: it is Windows-only, and importing this module must not
    fail on Linux where the rest of the system still works.
    """

    is_live = True

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.connected = False
        self._mt5 = None
        self._tf_map: Dict[int, int] = {}
        # Resolved against the live package in connect(); 10009 is the
        # MQL5-documented value both packages agree on.
        self._retcode_done = 10009

    # -- lifecycle ----------------------------------------------------------

    def connect(self) -> None:
        try:
            mt5 = import_mt5_module()
        except ImportError as exc:
            if sys.platform == "darwin":
                raise BrokerError(
                    "mt5-mac is not installed, so MetaTrader 5 cannot be "
                    "reached on this Mac.\n\n"
                    "  pip install mt5-mac\n\n"
                    "It also needs MetaTrader 5.app in /Applications; on first "
                    "connect it provisions a Windows Python inside that app's "
                    "bundled Wine (~8 MB, once).\n\n"
                    "Alternatives: trading.mode = 'remote' to reach a terminal "
                    "on another host, or 'simulation' for the paper broker. "
                    "See docs/MACOS.md."
                ) from exc
            raise BrokerError(
                f"MetaTrader5 is not installed and cannot be, on this platform "
                f"({sys.platform}): MetaQuotes publishes Windows-only wheels.\n\n"
                "Two ways forward:\n"
                "  * trading.mode = 'remote' — run the terminal on a Windows "
                "host (or under Wine) with scripts/mt5_bridge_server.py and "
                "trade it from here. See docs/MACOS.md.\n"
                "  * trading.mode = 'simulation' — use the paper broker."
            ) from exc

        self._mt5 = mt5
        self._retcode_done = retcode_done(mt5)
        self._tf_map = {
            Timeframe.M1: mt5.TIMEFRAME_M1,
            Timeframe.M5: mt5.TIMEFRAME_M5,
            Timeframe.M15: mt5.TIMEFRAME_M15,
            Timeframe.M30: mt5.TIMEFRAME_M30,
            Timeframe.H1: mt5.TIMEFRAME_H1,
            Timeframe.H4: mt5.TIMEFRAME_H4,
            Timeframe.D1: mt5.TIMEFRAME_D1,
        }

        mt5_cfg = self.config.get("mt5", {})
        ok = mt5.initialize(
            path=mt5_cfg.get("terminal_path", DEFAULT_MT5_TERMINAL_PATH),
            login=mt5_cfg.get("login", 0),
            server=mt5_cfg.get("server", ""),
            password=mt5_cfg.get("password", ""),
        )
        if not ok:
            raise BrokerError(f"Failed to connect to MT5: {mt5.last_error()}")

        self.connected = True
        logger.info("Connected to MT5 — server: %s", mt5_cfg.get("server", "?"))

        # The broker is authoritative about contract size and volume steps.
        symbol = self.config.get("trading", {}).get("symbol", "XAUUSD")
        info = mt5.symbol_info(symbol)
        if info is not None:
            refresh_from_broker(symbol, info)
        else:
            logger.warning(
                "symbol_info(%s) returned nothing — risk sizing will use the "
                "built-in contract spec, which may not match this broker.", symbol,
            )

    def disconnect(self) -> None:
        if self.connected and self._mt5 is not None:
            self._mt5.shutdown()
            self.connected = False
            logger.info("MT5 connection closed")

    def _require(self):
        if not self.connected or self._mt5 is None:
            raise BrokerError("Not connected to MT5 — use the broker as a context manager")
        return self._mt5

    # -- reads --------------------------------------------------------------

    def get_account_info(self) -> Optional[Dict[str, Any]]:
        info = self._require().account_info()
        if info is None:
            logger.error("Failed to get account info")
            return None
        return {
            "balance": info.balance,
            "equity": info.equity,
            "margin": info.margin,
            "margin_free": info.margin_free,
            "profit": info.profit,
            "margin_level": info.margin_level or 0.0,
            "currency": info.currency,
        }

    def get_positions(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        mt5 = self._require()
        positions = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
        if positions is None:
            return []
        return [
            {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": p.type,  # 0 = BUY, 1 = SELL
                "volume": p.volume,
                "price_open": p.price_open,
                "price_current": p.price_current,
                "sl": p.sl,
                "tp": p.tp,
                "profit": p.profit,
                "swap": p.swap,
                "comment": p.comment,
                "time": p.time,
            }
            for p in positions
        ]

    def get_tick(self, symbol: str) -> Optional[Dict[str, Any]]:
        tick = self._require().symbol_info_tick(symbol)
        if tick is None:
            logger.error("Failed to get tick for %s", symbol)
            return None
        return {
            "bid": tick.bid,
            "ask": tick.ask,
            "last": tick.last,
            "time": tick.time,
            "volume": tick.volume,
            "flags": tick.flags,
        }

    def get_rates(self, symbol: str, timeframe: int, count: int) -> Optional[List[Dict[str, Any]]]:
        mt5 = self._require()
        native_tf = self._tf_map.get(timeframe, timeframe)
        rates = mt5.copy_rates_from_pos(symbol, native_tf, 0, count)
        if rates is None:
            logger.error("Failed to get rates for %s", symbol)
            return None
        return [
            {
                "time": int(rate_field(r, "time")),
                "open": float(rate_field(r, "open")),
                "high": float(rate_field(r, "high")),
                "low": float(rate_field(r, "low")),
                "close": float(rate_field(r, "close")),
                "tick_volume": int(rate_field(r, "tick_volume")),
            }
            for r in rates
        ]

    # -- writes -------------------------------------------------------------

    def execute_trade(self, action: str, volume: float, symbol: Optional[str] = None,
                      sl: Optional[float] = None, tp: Optional[float] = None,
                      deviation: int = 10) -> Dict[str, Any]:
        mt5 = self._require()
        symbol = symbol or self.config.get("trading", {}).get("symbol", "XAUUSD")

        tick = self.get_tick(symbol)
        if tick is None:
            return {"success": False, "error": "Failed to get price"}

        action = action.upper()
        if action == "BUY":
            order_type, price = mt5.ORDER_TYPE_BUY, tick["ask"]
        elif action == "SELL":
            order_type, price = mt5.ORDER_TYPE_SELL, tick["bid"]
        else:
            return {"success": False, "error": f"Invalid action: {action}"}

        volume = normalize_volume(symbol, volume)
        if volume <= 0:
            return {"success": False, "error": "Volume below the broker minimum"}

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": price,
            "deviation": deviation,
            "magic": 123456,
            "comment": "ClawGold",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        if sl is not None:
            request["sl"] = sl
        if tp is not None:
            request["tp"] = tp

        result = mt5.order_send(request)
        if result is None:
            error = mt5.last_error()
            logger.error("Order failed: %s", error)
            return {"success": False, "error": str(error)}
        if result.retcode != self._retcode_done:
            logger.error("Order rejected with retcode %s", result.retcode)
            return {"success": False, "error": f"Retcode: {result.retcode}"}

        logger.info("Order executed: %s %s lots at %s", action, volume, price)
        return {
            "success": True,
            "order": result.order,
            "ticket": result.order,
            "volume": result.volume,
            "price": result.price,
            "symbol": symbol,
            "action": action,
        }

    def close_position(self, ticket: int) -> Dict[str, Any]:
        mt5 = self._require()
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            return {"success": False, "error": f"Position {ticket} not found"}

        position = positions[0]
        tick = self.get_tick(position.symbol)
        if tick is None:
            return {"success": False, "error": "Failed to get price"}

        # Closing a BUY means selling at the bid, and vice versa.
        if position.type == mt5.ORDER_TYPE_BUY:
            close_type, price = mt5.ORDER_TYPE_SELL, tick["bid"]
        else:
            close_type, price = mt5.ORDER_TYPE_BUY, tick["ask"]

        result = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": position.symbol,
            "volume": position.volume,
            "type": close_type,
            "position": ticket,
            "price": price,
            "deviation": 10,
            "magic": 123456,
            "comment": "ClawGold close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        })

        if result is None or result.retcode != self._retcode_done:
            code = result.retcode if result else mt5.last_error()
            return {"success": False, "error": f"Close failed: {code}", "ticket": ticket}
        return {"success": True, "ticket": ticket, "price": price, "profit": position.profit}

    def modify_position(self, ticket: int, sl: Optional[float] = None,
                        tp: Optional[float] = None) -> Dict[str, Any]:
        mt5 = self._require()
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            return {"success": False, "error": f"Position {ticket} not found"}
        position = positions[0]

        result = mt5.order_send({
            "action": mt5.TRADE_ACTION_SLTP,
            "symbol": position.symbol,
            "position": ticket,
            "sl": sl if sl is not None else position.sl,
            "tp": tp if tp is not None else position.tp,
        })
        if result is None or result.retcode != self._retcode_done:
            code = result.retcode if result else mt5.last_error()
            return {"success": False, "error": f"Modify failed: {code}", "ticket": ticket}
        return {"success": True, "ticket": ticket, "sl": sl, "tp": tp}


# ─────────────────────────────────────────────────────────────────────────────
# Remote backend — live MT5 from a host that cannot run MetaTrader5
# ─────────────────────────────────────────────────────────────────────────────

class RemoteMT5Broker(Broker):
    """
    Live trading through an ``mt5_bridge_server`` running elsewhere.

    The MetaTrader5 package ships only ``win_amd64`` wheels — it is a
    closed-source binary talking to the Windows terminal over local IPC, so
    there is no macOS or Linux build and none can be produced. This backend
    is how a Mac trades live: the terminal runs where it works (a Windows
    VM or VPS, or macOS under Wine), the bridge exposes it over HTTP, and
    this speaks to the bridge.

    It implements the same ``Broker`` interface as the local backends, so
    nothing upstream of it knows the difference.

    Config:
        mt5:
          bridge:
            url: http://127.0.0.1:8760
            token: ...            # or MT5_BRIDGE_TOKEN
            timeout: 30
    """

    is_live = True

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        bridge = (config.get("mt5", {}) or {}).get("bridge", {}) or {}

        self.url: str = str(
            bridge.get("url") or os.environ.get("MT5_BRIDGE_URL", "")
        ).rstrip("/")
        self.token: str = str(
            bridge.get("token") or os.environ.get("MT5_BRIDGE_TOKEN", "")
        )
        self.timeout: float = float(bridge.get("timeout", 30))
        self.connected = False

    # -- transport ----------------------------------------------------------

    def _request(self, method: str, path: str,
                 params: Optional[Dict[str, Any]] = None,
                 body: Optional[Dict[str, Any]] = None) -> Any:
        """One JSON round trip to the bridge, with errors mapped to BrokerError."""
        import json as _json
        import urllib.error
        import urllib.parse
        import urllib.request

        url = f"{self.url}{path}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url = f"{url}?{urllib.parse.urlencode(clean)}"

        data = _json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            request.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = _json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = _json.loads(exc.read().decode("utf-8")).get("error", "")
            except Exception:
                pass
            if exc.code == 401:
                raise BrokerError(
                    "Bridge rejected the token. Check mt5.bridge.token matches "
                    "the --token the server was started with."
                ) from exc
            if exc.code == 403:
                raise BrokerError(f"Bridge refused the operation: {detail}") from exc
            raise BrokerError(f"Bridge returned HTTP {exc.code}: {detail or exc.reason}") from exc
        except urllib.error.URLError as exc:
            raise BrokerError(
                f"Cannot reach the MT5 bridge at {self.url}: {exc.reason}. "
                "Is mt5_bridge_server.py running on the MT5 host, and is the "
                "SSH tunnel up?"
            ) from exc
        except TimeoutError as exc:
            raise BrokerError(f"Bridge timed out after {self.timeout}s") from exc

        if not payload.get("ok"):
            raise BrokerError(payload.get("error", "Bridge reported failure"))
        return payload

    # -- lifecycle ----------------------------------------------------------

    def connect(self) -> None:
        if not self.url:
            raise BrokerError(
                "trading.mode is 'remote' but no bridge URL is configured. "
                "Set mt5.bridge.url in config.yaml or MT5_BRIDGE_URL in .env."
            )
        if not self.token:
            raise BrokerError(
                "No bridge token configured. Set mt5.bridge.token or "
                "MT5_BRIDGE_TOKEN — the bridge can place real trades and "
                "will not accept unauthenticated requests."
            )

        # /health needs no token, so this separates "cannot reach it" from
        # "reached it but the token is wrong" — two very different fixes.
        import json as _json
        import urllib.error
        import urllib.request

        try:
            with urllib.request.urlopen(f"{self.url}/health", timeout=self.timeout) as response:
                health = _json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise BrokerError(
                f"Cannot reach the MT5 bridge at {self.url}: {exc}. "
                "Start it on the MT5 host with "
                "'python scripts/mt5_bridge_server.py --token ...'."
            ) from exc

        if not health.get("connected"):
            raise BrokerError(
                "The bridge is running but not connected to MetaTrader 5. "
                "Check the terminal is open and logged in on that host."
            )

        # Prove the token before anything depends on it.
        self._request("GET", "/account")

        self.connected = True
        logger.warning(
            "LIVE TRADING via MT5 bridge at %s — orders reach a real terminal%s",
            self.url, " (bridge is READ-ONLY)" if health.get("read_only") else "",
        )

    def disconnect(self) -> None:
        self.connected = False

    # -- reads --------------------------------------------------------------

    def get_account_info(self) -> Optional[Dict[str, Any]]:
        return self._request("GET", "/account").get("account")

    def get_positions(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._request("GET", "/positions", {"symbol": symbol}).get("positions") or []

    def get_tick(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self._request("GET", "/tick", {"symbol": symbol}).get("tick")

    def get_rates(self, symbol: str, timeframe: int,
                  count: int) -> Optional[List[Dict[str, Any]]]:
        name = Timeframe.name(timeframe)
        return self._request("GET", "/rates", {
            "symbol": symbol, "timeframe": name, "count": count,
        }).get("rates")

    # -- writes -------------------------------------------------------------

    def execute_trade(self, action: str, volume: float, symbol: Optional[str] = None,
                      sl: Optional[float] = None, tp: Optional[float] = None,
                      deviation: int = 10) -> Dict[str, Any]:
        try:
            return self._request("POST", "/trade", body={
                "action": action, "volume": volume, "symbol": symbol,
                "sl": sl, "tp": tp, "deviation": deviation,
            }).get("result", {})
        except BrokerError as exc:
            # An order is the one call where a transport failure must not
            # look like a clean rejection: the trade may have been placed.
            return {"success": False, "error": str(exc), "uncertain": True}

    def close_position(self, ticket: int) -> Dict[str, Any]:
        try:
            return self._request("POST", "/close", body={"ticket": ticket}).get("result", {})
        except BrokerError as exc:
            return {"success": False, "error": str(exc), "uncertain": True}

    def close_all_positions(self) -> List[Dict[str, Any]]:
        try:
            return self._request("POST", "/close_all").get("result") or []
        except BrokerError as exc:
            return [{"success": False, "error": str(exc), "uncertain": True}]

    def modify_position(self, ticket: int, sl: Optional[float] = None,
                        tp: Optional[float] = None) -> Dict[str, Any]:
        try:
            return self._request("POST", "/modify", body={
                "ticket": ticket, "sl": sl, "tp": tp,
            }).get("result", {})
        except BrokerError as exc:
            return {"success": False, "error": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# Paper backend
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class _PaperPosition:
    ticket: int
    symbol: str
    type: int          # 0 = BUY, 1 = SELL
    volume: float
    price_open: float
    sl: Optional[float] = None
    tp: Optional[float] = None
    opened_at: datetime = field(default_factory=datetime.now)
    comment: str = "ClawGold paper"


class PaperBroker(Broker):
    """
    An in-process simulator. No network, no terminal, no money.

    Prices come from a seeded random walk, so a given seed always produces
    the same series — that is what makes the test suite deterministic. The
    walk is a geometric random walk around a configurable starting price
    with a configurable daily volatility; it is a plausible price series,
    not a forecast of anything.

    Fills are immediate at bid/ask with a fixed spread. Equity is marked to
    market on every read, and stop-loss / take-profit levels are checked
    whenever prices are observed.
    """

    is_live = False

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        trading = config.get("trading", {})
        paper = config.get("paper", {}) or {}

        self.symbol: str = trading.get("symbol", "XAUUSD")
        self.balance: float = float(trading.get("initial_balance", 10_000))
        self.start_price: float = float(paper.get("start_price", 2_650.0))
        self.spread: float = float(paper.get("spread", 0.30))
        self.daily_volatility: float = float(paper.get("daily_volatility", 0.011))
        # Fall back to the account leverage rather than a separate default:
        # a paper broker simulating 1:100 while sizing assumes 1:500 would
        # reject exactly the small entries the config was set up to allow.
        self.leverage: float = float(
            paper.get("leverage") or trading.get("leverage") or 100.0
        )
        self.currency: str = paper.get("currency", "USD")

        seed = paper.get("seed", 20260101)
        self._rng = random.Random(seed)
        self._seed = seed

        self.connected = False
        self._positions: Dict[int, _PaperPosition] = {}
        self._next_ticket = 1
        self._realized_pnl = 0.0
        self._closed: List[Dict[str, Any]] = []
        self._lock = threading.RLock()

        self._price = self.start_price
        self._bar_cache: Dict[tuple, List[Dict[str, Any]]] = {}

    # -- lifecycle ----------------------------------------------------------

    def connect(self) -> None:
        self.connected = True
        logger.info(
            "PaperBroker ready — %s, balance $%.2f, seed %s. No real orders will be sent.",
            self.symbol, self.balance, self._seed,
        )

    def disconnect(self) -> None:
        self.connected = False

    def reset(self) -> None:
        """Return to the opening state. Used by tests."""
        with self._lock:
            self._positions.clear()
            self._closed.clear()
            self._next_ticket = 1
            self._realized_pnl = 0.0
            self._price = self.start_price
            self._bar_cache.clear()
            self._rng = random.Random(self._seed)

    # -- synthetic price series --------------------------------------------

    def _step_price(self) -> float:
        """Advance the walk one minute and return the new mid price."""
        per_minute_sigma = self.daily_volatility / (1440 ** 0.5)
        shock = self._rng.gauss(0.0, per_minute_sigma)
        self._price = max(1.0, self._price * (1.0 + shock))
        return self._price

    def get_tick(self, symbol: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            mid = self._step_price()
            spec = get_spec(symbol)
            half = self.spread / 2.0
            self._check_exits(mid)
            return {
                "bid": round(mid - half, spec.digits),
                "ask": round(mid + half, spec.digits),
                "last": round(mid, spec.digits),
                "time": int(time.time()),
                "volume": 1,
                "flags": 0,
            }

    def get_rates(self, symbol: str, timeframe: int, count: int) -> Optional[List[Dict[str, Any]]]:
        """
        Generate `count` bars ending now, oldest first.

        Bars for a (symbol, timeframe, count) request are cached so repeated
        reads inside one run see a stable history — a caller comparing two
        timeframes must not get two unrelated random walks.
        """
        key = (symbol.upper(), timeframe, count)
        with self._lock:
            if key in self._bar_cache:
                return [dict(bar) for bar in self._bar_cache[key]]

            spec = get_spec(symbol)
            minutes = max(1, int(timeframe))
            # Walk backwards from the current price so every timeframe ends
            # at the same place, then reverse into chronological order.
            rng = random.Random(f"{self._seed}:{symbol}:{timeframe}:{count}")
            sigma = self.daily_volatility * ((minutes / 1440.0) ** 0.5)

            closes: List[float] = [self._price]
            for _ in range(count):
                closes.append(max(1.0, closes[-1] * (1.0 - rng.gauss(0.0, sigma))))
            closes.reverse()

            now = int(time.time())
            bars: List[Dict[str, Any]] = []
            for i in range(1, len(closes)):
                open_, close = closes[i - 1], closes[i]
                wick = abs(rng.gauss(0.0, sigma)) * close
                bars.append({
                    "time": now - (len(closes) - 1 - i) * minutes * 60,
                    "open": round(open_, spec.digits),
                    "high": round(max(open_, close) + wick, spec.digits),
                    "low": round(min(open_, close) - wick, spec.digits),
                    "close": round(close, spec.digits),
                    "tick_volume": rng.randint(50, 500),
                })

            self._bar_cache[key] = bars
            return [dict(bar) for bar in bars]

    # -- account ------------------------------------------------------------

    def _position_pnl(self, position: _PaperPosition, mid: float) -> float:
        spec = get_spec(position.symbol)
        direction = 1.0 if position.type == 0 else -1.0
        return direction * (mid - position.price_open) * position.volume * spec.contract_size

    def _used_margin(self, mid: float) -> float:
        total = 0.0
        for position in self._positions.values():
            spec = get_spec(position.symbol)
            total += (position.volume * spec.contract_size * mid) / max(self.leverage, 1.0)
        return total

    def get_account_info(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            mid = self._price
            unrealized = sum(self._position_pnl(p, mid) for p in self._positions.values())
            balance = self.balance + self._realized_pnl
            equity = balance + unrealized
            margin = self._used_margin(mid)
            return {
                "balance": round(balance, 2),
                "equity": round(equity, 2),
                "margin": round(margin, 2),
                "margin_free": round(equity - margin, 2),
                "profit": round(unrealized, 2),
                # No open positions means no margin call is possible. MT5
                # reports 0 here; a large sentinel would read as "healthy"
                # to the risk manager, so mirror MT5 and let callers treat
                # "no positions" as a special case.
                "margin_level": round((equity / margin) * 100, 2) if margin > 0 else 0.0,
                "currency": self.currency,
            }

    def get_positions(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._lock:
            mid = self._price
            out = []
            for position in self._positions.values():
                if symbol and position.symbol.upper() != symbol.upper():
                    continue
                out.append({
                    "ticket": position.ticket,
                    "symbol": position.symbol,
                    "type": position.type,
                    "volume": position.volume,
                    "price_open": position.price_open,
                    "price_current": round(mid, get_spec(position.symbol).digits),
                    "sl": position.sl,
                    "tp": position.tp,
                    "profit": round(self._position_pnl(position, mid), 2),
                    "swap": 0.0,
                    "comment": position.comment,
                    "time": int(position.opened_at.timestamp()),
                })
            return out

    # -- orders -------------------------------------------------------------

    def execute_trade(self, action: str, volume: float, symbol: Optional[str] = None,
                      sl: Optional[float] = None, tp: Optional[float] = None,
                      deviation: int = 10) -> Dict[str, Any]:
        symbol = symbol or self.symbol
        action = action.upper()
        if action not in ("BUY", "SELL"):
            return {"success": False, "error": f"Invalid action: {action}"}

        volume = normalize_volume(symbol, volume)
        if volume <= 0:
            return {"success": False, "error": "Volume below the broker minimum"}

        tick = self.get_tick(symbol)
        with self._lock:
            price = tick["ask"] if action == "BUY" else tick["bid"]

            account = self.get_account_info()
            spec = get_spec(symbol)
            required_margin = (volume * spec.contract_size * price) / max(self.leverage, 1.0)
            if required_margin > account["margin_free"]:
                return {
                    "success": False,
                    "error": (
                        f"Insufficient margin: need ${required_margin:.2f}, "
                        f"free ${account['margin_free']:.2f}"
                    ),
                }

            ticket = self._next_ticket
            self._next_ticket += 1
            self._positions[ticket] = _PaperPosition(
                ticket=ticket,
                symbol=symbol,
                type=0 if action == "BUY" else 1,
                volume=volume,
                price_open=price,
                sl=sl,
                tp=tp,
            )

        logger.info("[paper] %s %s lots %s at %s (ticket %s)", action, volume, symbol, price, ticket)
        return {
            "success": True,
            "order": ticket,
            "ticket": ticket,
            "volume": volume,
            "price": price,
            "symbol": symbol,
            "action": action,
            "paper": True,
        }

    def close_position(self, ticket: int) -> Dict[str, Any]:
        with self._lock:
            position = self._positions.get(ticket)
            if position is None:
                return {"success": False, "error": f"Position {ticket} not found"}
        tick = self.get_tick(position.symbol)
        with self._lock:
            # Re-check: _check_exits may have closed it on the tick above.
            position = self._positions.get(ticket)
            if position is None:
                closed = next((c for c in self._closed if c["ticket"] == ticket), None)
                return {"success": True, "ticket": ticket, "profit": closed["profit"] if closed else 0.0}
            price = tick["bid"] if position.type == 0 else tick["ask"]
            return self._settle(position, price, reason="manual")

    def _settle(self, position: _PaperPosition, price: float, reason: str) -> Dict[str, Any]:
        """Realise a position at `price`. Caller must hold the lock."""
        profit = self._position_pnl(position, price)
        self._realized_pnl += profit
        self._positions.pop(position.ticket, None)
        record = {
            "success": True,
            "ticket": position.ticket,
            "symbol": position.symbol,
            "volume": position.volume,
            "price_open": position.price_open,
            "price": round(price, get_spec(position.symbol).digits),
            "profit": round(profit, 2),
            "reason": reason,
        }
        self._closed.append(record)
        logger.info("[paper] closed #%s at %s (%s) — P&L $%.2f", position.ticket, price, reason, profit)
        return record

    def _check_exits(self, mid: float) -> None:
        """Trigger any stop-loss or take-profit the new price has reached."""
        for position in list(self._positions.values()):
            hit = None
            if position.type == 0:  # long
                if position.sl is not None and mid <= position.sl:
                    hit = ("sl", position.sl)
                elif position.tp is not None and mid >= position.tp:
                    hit = ("tp", position.tp)
            else:  # short
                if position.sl is not None and mid >= position.sl:
                    hit = ("sl", position.sl)
                elif position.tp is not None and mid <= position.tp:
                    hit = ("tp", position.tp)
            if hit:
                self._settle(position, hit[1], reason=hit[0])

    def modify_position(self, ticket: int, sl: Optional[float] = None,
                        tp: Optional[float] = None) -> Dict[str, Any]:
        with self._lock:
            position = self._positions.get(ticket)
            if position is None:
                return {"success": False, "error": f"Position {ticket} not found"}
            if sl is not None:
                position.sl = sl
            if tp is not None:
                position.tp = tp
            return {"success": True, "ticket": ticket, "sl": position.sl, "tp": position.tp}

    # -- introspection ------------------------------------------------------

    @property
    def closed_trades(self) -> List[Dict[str, Any]]:
        return list(self._closed)


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────

PAPER_MODES = {"simulation", "sim", "paper", "demo", "backtest"}
LIVE_MODES = {"real", "live"}
REMOTE_MODES = {"remote", "bridge"}


def resolve_mode(config: Optional[Dict[str, Any]] = None) -> str:
    """
    Normalise ``trading.mode`` to 'paper', 'real' or 'remote'.

    Anything not explicitly a live mode resolves to paper. An unrecognised
    value is a configuration mistake, and the safe reading of a mistake is
    "do not send real orders".
    """
    cfg = config or {}
    raw = str(cfg.get("trading", {}).get("mode", "simulation")).strip().lower()
    if raw in LIVE_MODES:
        return "real"
    if raw in REMOTE_MODES:
        return "remote"
    if raw not in PAPER_MODES:
        logger.warning("Unrecognised trading.mode %r — defaulting to paper trading", raw)
    return "paper"


def is_live_mode(mode: str) -> bool:
    """Both 'real' and 'remote' reach a live terminal with real money."""
    return mode in ("real", "remote")


def metatrader5_available() -> bool:
    """
    Whether an MT5 API can be imported on this host.

    On macOS that means mt5-mac, which drives the official package inside
    MetaTrader 5.app's bundled Wine; everywhere else, MetaTrader5 itself.
    """
    try:
        import_mt5_module()
        return True
    except ImportError:
        return False


def get_broker(config: Optional[Dict[str, Any]] = None,
               config_path: Optional[str] = None) -> Broker:
    """
    Build the broker named by ``trading.mode``.

    Live mode additionally requires ``mt5.login`` to be set, so an
    incomplete real-money configuration fails loudly at construction
    instead of silently attempting to connect with login 0.

    On a host where the MetaTrader5 package cannot be installed — macOS or
    Linux, where MetaQuotes publishes no wheel — 'real' mode explains the
    remote-bridge route rather than failing with a bare ImportError.
    """
    cfg = config if config is not None else load_config(config_path)
    mode = resolve_mode(cfg)

    if mode == "remote":
        logger.warning("LIVE TRADING via bridge — orders reach a real terminal")
        return RemoteMT5Broker(cfg)

    if mode == "real":
        if not metatrader5_available():
            if sys.platform == "darwin":
                raise BrokerError(
                    "trading.mode is 'real' but mt5-mac is not installed, so "
                    "MetaTrader 5 cannot be reached on this Mac.\n\n"
                    "  pip install mt5-mac\n\n"
                    "It needs MetaTrader 5.app installed in /Applications and "
                    "drives it through that app's bundled Wine runtime.\n\n"
                    "Or set trading.mode to 'remote' to reach a terminal on "
                    "another host, or 'simulation' for the paper broker. "
                    "See docs/MACOS.md."
                )
            raise BrokerError(
                f"trading.mode is 'real' but the MetaTrader5 package is not "
                f"available on this platform ({sys.platform}). MetaQuotes "
                "publishes Windows-only wheels, so there is nothing to install "
                "here.\n\n"
                "To trade live from Linux, run the terminal where it works and "
                "set trading.mode to 'remote':\n"
                "  1. On a Windows host (or macOS under Wine), start:\n"
                "       python scripts/mt5_bridge_server.py --token <secret>\n"
                "  2. Here, set mt5.bridge.url and mt5.bridge.token.\n"
                "See docs/MACOS.md. Or use 'simulation' for the paper broker."
            )

        login = cfg.get("mt5", {}).get("login", 0)
        if not login:
            raise BrokerError(
                "trading.mode is 'real' but no MT5 login is configured. Set "
                "MT5_LOGIN, MT5_PASSWORD and MT5_SERVER in .env, or switch "
                "trading.mode to 'simulation'."
            )
        logger.warning("LIVE TRADING — orders will be sent to %s with real money",
                       cfg.get("mt5", {}).get("server", "?"))
        return MT5Broker(cfg)

    return PaperBroker(cfg)
