"""
MT5 bridge server
=================
Exposes a MetaTrader 5 terminal over HTTP so a machine that cannot run the
MetaTrader5 package — a Mac, a Linux box, a container — can still trade.

**Why this exists.** The `MetaTrader5` PyPI package ships only
`win_amd64` wheels. It is a closed-source binary that talks to the Windows
terminal over local IPC, so there is nothing to port: no macOS or Linux
build exists and one cannot be produced from outside MetaQuotes. The way
to trade from a Mac is therefore to run the terminal where it works and
talk to it across a boundary. This is that boundary.

Run this on a host where MT5 works:
  * a Windows PC, VM or VPS, or
  * macOS with the terminal under Wine/CrossOver, using Wine's Python.

Then point ClawGold's `RemoteMT5Broker` at it from anywhere.

    # On the MT5 host
    python scripts/mt5_bridge_server.py --token "$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"

    # On the Mac
    export MT5_BRIDGE_URL=http://127.0.0.1:8760
    export MT5_BRIDGE_TOKEN=...same token...
    # config.yaml: trading.mode = remote

Security
--------
This endpoint can place real trades with real money, so:

  * a token is REQUIRED; the server refuses to start without one,
  * the token is compared with `hmac.compare_digest`,
  * it binds 127.0.0.1 by default — reaching it from another machine is
    meant to go through an SSH tunnel, not an open port,
  * binding to a public interface needs an explicit `--allow-remote` and a
    token of at least 32 characters,
  * there is no TLS here on purpose. Terminating TLS correctly is a job
    for a tunnel or a reverse proxy; pretending to do it in this file
    would be worse than declining to.

Stdlib only, so the MT5 host needs no extra packages beyond MetaTrader5.
"""

from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from broker import Broker, BrokerError, MT5Broker, Timeframe  # noqa: E402
from config_loader import load_config  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | mt5-bridge | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("mt5_bridge")

PROTOCOL_VERSION = "1"

#: Named timeframes accepted on the wire, so a client never has to know
#: MetaTrader5's own integer constants.
TIMEFRAMES = {
    "M1": Timeframe.M1, "M5": Timeframe.M5, "M15": Timeframe.M15,
    "M30": Timeframe.M30, "H1": Timeframe.H1, "H4": Timeframe.H4,
    "D1": Timeframe.D1,
}


class BridgeState:
    """Holds the broker connection, serialised across request threads."""

    def __init__(self, broker: Broker, read_only: bool = False):
        self.broker = broker
        self.read_only = read_only
        # MT5's API is not thread-safe; the HTTP server is threaded, so
        # every call into the terminal is serialised here.
        self.lock = threading.Lock()


class BridgeHandler(BaseHTTPRequestHandler):
    """Routes HTTP requests onto the Broker interface."""

    server_version = "ClawGoldMT5Bridge/1.0"
    state: BridgeState = None      # type: ignore[assignment]
    token: str = ""

    # -- plumbing -----------------------------------------------------------

    def log_message(self, fmt: str, *args) -> None:
        logger.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Bridge-Protocol", PROTOCOL_VERSION)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send(status, {"ok": False, "error": message})

    def _authorised(self) -> bool:
        """Constant-time bearer check, so the token cannot be timed out."""
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        supplied = header[len(prefix):] if header.startswith(prefix) else ""
        return hmac.compare_digest(supplied, self.token)

    def _body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError(f"Invalid JSON body: {exc}") from exc

    # -- routing ------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        route = urlparse(self.path)
        query = parse_qs(route.query)

        # /health answers without a token so a monitor can poll liveness
        # without holding a credential. It reveals no account data.
        if route.path == "/health":
            self._send(200, {
                "ok": True, "service": "clawgold-mt5-bridge",
                "protocol": PROTOCOL_VERSION,
                "connected": bool(self.state and self.state.broker.connected),
                "read_only": bool(self.state and self.state.read_only),
            })
            return

        if not self._authorised():
            self._error(401, "Missing or invalid bearer token")
            return

        handlers: Dict[str, Callable[[], Dict[str, Any]]] = {
            "/account": lambda: {"account": self._call(
                lambda b: b.get_account_info())},
            "/positions": lambda: {"positions": self._call(
                lambda b: b.get_positions(self._one(query, "symbol")))},
            "/tick": lambda: {"tick": self._call(
                lambda b: b.get_tick(self._require(query, "symbol")))},
            "/rates": lambda: {"rates": self._call(
                lambda b: b.get_rates(
                    self._require(query, "symbol"),
                    self._timeframe(self._one(query, "timeframe") or "H1"),
                    int(self._one(query, "count") or 100),
                ))},
        }

        handler = handlers.get(route.path)
        if handler is None:
            self._error(404, f"Unknown endpoint: {route.path}")
            return

        try:
            self._send(200, {"ok": True, **handler()})
        except ValueError as exc:
            self._error(400, str(exc))
        except BrokerError as exc:
            self._error(502, f"Broker error: {exc}")
        except Exception as exc:
            logger.exception("Request failed")
            self._error(500, str(exc))

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path)

        if not self._authorised():
            self._error(401, "Missing or invalid bearer token")
            return

        # A read-only bridge is the right default for a monitoring host:
        # it can answer every question and place no orders.
        if self.state.read_only:
            self._error(403, "Bridge is running read-only; no orders accepted")
            return

        try:
            body = self._body()

            if route.path == "/trade":
                action = str(body.get("action", "")).upper()
                if action not in ("BUY", "SELL"):
                    raise ValueError(f"action must be BUY or SELL, got {action!r}")
                volume = float(body.get("volume", 0))
                result = self._call(lambda b: b.execute_trade(
                    action, volume,
                    symbol=body.get("symbol"),
                    sl=body.get("sl"), tp=body.get("tp"),
                    deviation=int(body.get("deviation", 10)),
                ))

            elif route.path == "/close":
                ticket = int(body["ticket"])
                result = self._call(lambda b: b.close_position(ticket))

            elif route.path == "/close_all":
                result = self._call(lambda b: b.close_all_positions())

            elif route.path == "/modify":
                ticket = int(body["ticket"])
                result = self._call(lambda b: b.modify_position(
                    ticket, sl=body.get("sl"), tp=body.get("tp")))

            else:
                self._error(404, f"Unknown endpoint: {route.path}")
                return

            self._send(200, {"ok": True, "result": result})

        except (KeyError, ValueError, TypeError) as exc:
            self._error(400, str(exc))
        except BrokerError as exc:
            self._error(502, f"Broker error: {exc}")
        except Exception as exc:
            logger.exception("Request failed")
            self._error(500, str(exc))

    # -- helpers ------------------------------------------------------------

    def _call(self, operation: Callable[[Broker], Any]) -> Any:
        with self.state.lock:
            return operation(self.state.broker)

    @staticmethod
    def _one(query: Dict[str, list], key: str) -> Optional[str]:
        values = query.get(key)
        return values[0] if values else None

    @classmethod
    def _require(cls, query: Dict[str, list], key: str) -> str:
        value = cls._one(query, key)
        if not value:
            raise ValueError(f"Missing required parameter: {key}")
        return value

    @staticmethod
    def _timeframe(name: str) -> int:
        key = str(name).upper()
        if key in TIMEFRAMES:
            return TIMEFRAMES[key]
        try:
            return int(name)  # raw minutes are also accepted
        except (TypeError, ValueError):
            raise ValueError(
                f"Unknown timeframe {name!r}. Use one of {sorted(TIMEFRAMES)}"
            ) from None


def build_server(host: str, port: int, token: str, broker: Broker,
                 read_only: bool = False) -> ThreadingHTTPServer:
    """Wire the handler to a broker and return an unstarted server."""
    handler = type("BoundBridgeHandler", (BridgeHandler,), {
        "state": BridgeState(broker, read_only=read_only),
        "token": token,
    })
    return ThreadingHTTPServer((host, port), handler)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Expose a MetaTrader 5 terminal over HTTP for remote clients.")
    parser.add_argument("--host", default="127.0.0.1",
                        help="bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8760)
    parser.add_argument("--token", default=os.getenv("MT5_BRIDGE_TOKEN", ""),
                        help="shared secret; also read from MT5_BRIDGE_TOKEN")
    parser.add_argument("--allow-remote", action="store_true",
                        help="permit binding to a non-loopback address")
    parser.add_argument("--read-only", action="store_true",
                        help="answer queries but refuse all orders")
    parser.add_argument("--config", default=None, help="path to config.yaml")
    args = parser.parse_args()

    token = args.token.strip()
    if not token:
        parser.error(
            "A token is required — this endpoint can place real trades.\n"
            "Generate one with:\n"
            "  python -c \"import secrets; print(secrets.token_urlsafe(32))\"\n"
            "then pass --token or set MT5_BRIDGE_TOKEN."
        )

    loopback = args.host in ("127.0.0.1", "::1", "localhost")
    if not loopback:
        if not args.allow_remote:
            parser.error(
                f"Refusing to bind {args.host}: that exposes trade execution to "
                "the network. Prefer an SSH tunnel:\n"
                f"  ssh -N -L {args.port}:127.0.0.1:{args.port} user@mt5-host\n"
                "If you really mean it, pass --allow-remote."
            )
        if len(token) < 32:
            parser.error(
                "A network-exposed bridge needs a token of at least 32 "
                "characters. Generate one with:\n"
                "  python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )

    config = load_config(args.config)
    # Force live mode: a bridge exists to reach a real terminal. Serving a
    # paper broker over it would look identical to the client and quietly
    # simulate trades it believed were real.
    config.setdefault("trading", {})["mode"] = "real"

    broker = MT5Broker(config)
    try:
        broker.connect()
    except BrokerError as exc:
        logger.error("Could not connect to MetaTrader 5: %s", exc)
        return 1

    server = build_server(args.host, args.port, token, broker,
                          read_only=args.read_only)

    logger.warning(
        "MT5 bridge listening on http://%s:%d — %s%s",
        args.host, args.port,
        "READ-ONLY" if args.read_only else "ORDERS ENABLED (real money)",
        "" if loopback else "  [EXPOSED TO THE NETWORK]",
    )
    logger.info("Health (no token needed): http://%s:%d/health", args.host, args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        server.server_close()
        broker.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
