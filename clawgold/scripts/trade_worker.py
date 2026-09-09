"""
Trading worker
==============
The long-running service that runs the trading pipeline on an interval.

This is the deployable trading entrypoint. It differs from
``claw.py graph run`` in the ways a service has to:

  * it loops rather than running once,
  * it refuses to start unless preflight passes,
  * it honours the kill switch on every cycle, not just at startup,
  * it stops cleanly on SIGTERM instead of being killed mid-order,
  * it writes a heartbeat file that a container healthcheck can read.

Environment:
    TRADE_SYMBOL              instrument (default: config trading.symbol)
    TRADE_INTERVAL_SECONDS    seconds between cycles (default: 300)
    TRADE_AUTO_APPROVE        skip the human gate (default: true in paper,
                              false in live — auto-approving live orders
                              must be a deliberate choice)
    TRADE_MAX_CYCLES          stop after N cycles; 0 means run forever
    HEARTBEAT_PATH            where to write the heartbeat

Usage:
    python scripts/trade_worker.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from broker import resolve_mode
from config_loader import load_config
from lifecycle import GracefulShutdown, KillSwitch
from logger import get_logger

logger = get_logger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HEARTBEAT = ROOT / "data" / "heartbeat.json"


def _as_bool(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def write_heartbeat(path: Path, payload: Dict[str, Any]) -> None:
    """
    Record liveness for the container healthcheck.

    Written atomically via a temporary file and a rename, so a healthcheck
    reading concurrently never sees a half-written file and restarts a
    perfectly healthy container.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**payload, "updated_at": datetime.now(timezone.utc).isoformat()}
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        temp.replace(path)
    except Exception as exc:
        logger.warning("Could not write heartbeat: %s", exc)


def main() -> int:
    config = load_config()
    mode = resolve_mode(config)
    is_live = mode == "real"

    symbol = os.getenv("TRADE_SYMBOL") or config.get("trading", {}).get("symbol", "XAUUSD")
    interval = int(os.getenv("TRADE_INTERVAL_SECONDS", "300"))
    max_cycles = int(os.getenv("TRADE_MAX_CYCLES", "0"))
    auto_approve = _as_bool(os.getenv("TRADE_AUTO_APPROVE"), default=not is_live)
    heartbeat_path = Path(os.getenv("HEARTBEAT_PATH", str(DEFAULT_HEARTBEAT)))

    # Refuse to start on a broken deployment rather than looping on errors.
    from preflight import run_preflight

    report = run_preflight(live_check=is_live)
    if not report.ok:
        logger.error("Preflight failed — not starting:\n%s", report.render())
        return 1
    logger.info("Preflight passed (%d checks, %d warning(s))",
                len(report.checks), len(report.warnings))

    if is_live and auto_approve:
        logger.warning(
            "LIVE mode with TRADE_AUTO_APPROVE — orders will be placed "
            "unattended, with no human gate")

    logger.info(
        "Trading worker starting | symbol=%s mode=%s interval=%ss auto_approve=%s",
        symbol, "LIVE" if is_live else "paper", interval, auto_approve,
    )

    switch = KillSwitch.from_config(config)
    cycles = 0
    executions = 0
    last_error: Optional[str] = None

    from trading_graph import run_pipeline

    with GracefulShutdown() as shutdown:

        @shutdown.on_shutdown
        def final_heartbeat() -> None:
            write_heartbeat(heartbeat_path, {
                "status": "stopped", "symbol": symbol, "mode": mode,
                "cycles": cycles, "executions": executions,
                "last_error": last_error,
            })
            logger.info("Trading worker stopped after %s cycle(s), %s execution(s)",
                        cycles, executions)

        while not shutdown.requested:
            # Re-read the switch every cycle: engaging it must take effect
            # without a restart, which is the whole point of it.
            if switch.engaged:
                logger.warning("%s — skipping this cycle", switch.describe())
                write_heartbeat(heartbeat_path, {
                    "status": "halted", "symbol": symbol, "mode": mode,
                    "cycles": cycles, "executions": executions,
                    "reason": "kill switch engaged",
                })
                if shutdown.wait(interval):
                    break
                continue

            try:
                result = run_pipeline(symbol=symbol, auto_approve=auto_approve)
                cycles += 1

                execution = result.get("execution", {}) or {}
                signal = result.get("signal", {}) or {}
                if execution.get("success"):
                    executions += 1

                logger.info(
                    "Cycle %s complete | signal=%s confidence=%.2f executed=%s",
                    cycles, signal.get("direction", "?"),
                    signal.get("confidence", 0.0) or 0.0,
                    bool(execution.get("success")),
                )
                for message in result.get("messages", []):
                    logger.debug("  %s", message)

                last_error = None
                write_heartbeat(heartbeat_path, {
                    "status": "running", "symbol": symbol, "mode": mode,
                    "cycles": cycles, "executions": executions,
                    "last_signal": signal.get("direction"),
                    "last_confidence": signal.get("confidence"),
                    "last_executed": bool(execution.get("success")),
                })
            except Exception as exc:
                last_error = str(exc)
                logger.exception("Trading cycle failed")
                write_heartbeat(heartbeat_path, {
                    "status": "error", "symbol": symbol, "mode": mode,
                    "cycles": cycles, "executions": executions,
                    "last_error": last_error,
                })

            if max_cycles and cycles >= max_cycles:
                logger.info("Reached TRADE_MAX_CYCLES=%s — stopping", max_cycles)
                break

            if shutdown.wait(interval):
                break

    return 0


if __name__ == "__main__":
    sys.exit(main())
