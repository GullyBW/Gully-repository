"""
Trading Orchestrator (deprecated — delegates to trading_graph)
==============================================================

ClawGold used to ship two independent autonomous engines: this threaded
worker pool with an event bus, and the LangGraph pipeline in
``trading_graph.py``. They overlapped, drifted apart, and disagreed about
where the human sits — the threaded version asked for permission once, up
front, by *mode*, and in AUTO never asked again; the graph asks per trade by
suspending itself.

The graph is now the single engine. Everything this module owned that the
graph lacked has been ported across:

  * the economic-calendar trading pause  -> ``calendar_gate`` node
  * the adaptive-learning feedback loop  -> ``learn`` node

This module remains so ``claw.py orch ...`` keeps working. It runs the graph
on a loop, mapping the old modes onto the graph's approval gate:

    MANUAL     -> nothing runs automatically
    SEMI_AUTO  -> the graph pauses at human_review for approval
    AUTO       -> the graph auto-approves

Prefer ``claw.py graph run`` for new work.
"""

from __future__ import annotations

import threading
import time
import warnings
from dataclasses import dataclass
from datetime import datetime
from enum import Enum, auto
from typing import Any, Dict, List, Optional

from logger import get_logger

logger = get_logger(__name__)

_DEPRECATION = (
    "orchestrator.TradingOrchestrator is deprecated and now delegates to "
    "trading_graph.run_pipeline(). Use 'claw.py graph run' directly."
)


class SystemMode(Enum):
    """System operation modes (retained for CLI compatibility)."""

    MANUAL = auto()      # Nothing runs automatically
    SEMI_AUTO = auto()   # Graph pauses for human approval
    AUTO = auto()        # Graph auto-approves
    PAUSED = auto()


@dataclass
class SystemStatus:
    """Current system status."""

    mode: SystemMode
    is_running: bool
    last_update: datetime
    active_modules: List[str]
    errors: List[str]
    performance_score: float


class TradingOrchestrator:
    """
    Compatibility wrapper that runs the LangGraph pipeline on an interval.

    Args:
        mode: Operation mode, mapped onto the graph's approval gate.
        symbol: Instrument to trade.
        interval_seconds: Delay between pipeline runs.
    """

    def __init__(self, mode: SystemMode = SystemMode.SEMI_AUTO,
                 symbol: str = "XAUUSD", interval_seconds: int = 300):
        warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
        logger.warning(_DEPRECATION)

        self.mode = mode
        self.symbol = symbol
        self.interval_seconds = interval_seconds

        self.status = SystemStatus(
            mode=mode,
            is_running=False,
            last_update=datetime.now(),
            active_modules=["trading_graph"],
            errors=[],
            performance_score=0.5,
        )

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._runs = 0
        self._last_result: Dict[str, Any] = {}

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        """Start running the pipeline on a loop."""
        if self.mode is SystemMode.MANUAL:
            logger.info("MANUAL mode — nothing will run automatically.")
            self.status.is_running = False
            return

        if self._thread and self._thread.is_alive():
            logger.warning("Orchestrator already running")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop, name="clawgold-graph-loop", daemon=True
        )
        self._thread.start()
        self.status.is_running = True
        logger.info(
            "Orchestrator started in %s mode — running the graph every %ss",
            self.mode.name, self.interval_seconds,
        )

    def stop(self) -> None:
        """Stop the loop and wait for the current run to finish."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=30)
        self.status.is_running = False
        logger.info("Orchestrator stopped after %s run(s)", self._runs)

    def _loop(self) -> None:
        from trading_graph import run_pipeline

        while not self._stop_event.is_set():
            try:
                self._last_result = run_pipeline(
                    symbol=self.symbol,
                    auto_approve=(self.mode is SystemMode.AUTO),
                )
                self._runs += 1
                self.status.last_update = datetime.now()
                for message in self._last_result.get("messages", []):
                    logger.info("  %s", message)
            except Exception as exc:
                self.status.errors.append(str(exc))
                logger.error("Pipeline run failed: %s", exc)

            # Wait in one interruptible sleep so stop() is responsive.
            self._stop_event.wait(self.interval_seconds)

    # -- introspection ------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        """Status dict, in the shape claw.py's orch commands expect."""
        return {
            "mode": self.mode.name,
            "is_running": self.status.is_running,
            "last_update": self.status.last_update.isoformat(),
            "active_modules": self.status.active_modules,
            "errors": self.status.errors[-5:],
            "performance_score": self.status.performance_score,
            "runs_completed": self._runs,
            "engine": "trading_graph (LangGraph)",
            "deprecated": True,
        }

    def set_mode(self, mode: SystemMode) -> None:
        """Change the operation mode; takes effect on the next run."""
        self.mode = mode
        self.status.mode = mode
        logger.info("Mode changed to %s", mode.name)

    def get_decision_stats(self) -> Dict[str, Any]:
        """Summary of the most recent pipeline run."""
        signal = self._last_result.get("signal", {})
        risk = self._last_result.get("risk", {})
        execution = self._last_result.get("execution", {})
        return {
            "runs_completed": self._runs,
            "last_direction": signal.get("direction"),
            "last_confidence": signal.get("confidence"),
            "last_approved": risk.get("approved"),
            "last_reason": risk.get("reason"),
            "last_executed": bool(execution.get("success")),
        }
