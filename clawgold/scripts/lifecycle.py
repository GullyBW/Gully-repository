"""
Process lifecycle: graceful shutdown and the kill switch
========================================================

Two separate safety mechanisms that a deployed trading process needs and
this system did not have.

**Graceful shutdown.** A container stop sends SIGTERM and then, after a
grace period, SIGKILL. A trading loop killed between "order sent" and
"result recorded" leaves a position the journal does not know about.
``GracefulShutdown`` catches the signal, lets the current iteration finish,
and runs registered cleanup handlers before exiting.

**Kill switch.** Sometimes you need trading to stop *now*, without a
restart and without hunting for the process — news broke, the strategy is
behaving oddly, you are about to deploy. ``KillSwitch`` is a file on disk:
if it exists, no new entries are taken. Existing positions are untouched,
because closing them is a trading decision, not a safety default.

The file is the interface deliberately. It works when the process is
unresponsive, over SSH, from a cron job, from another container sharing
the volume, and it survives a restart.

Usage:
    from lifecycle import GracefulShutdown, KillSwitch

    switch = KillSwitch.from_config(config)
    if switch.engaged:
        return  # take no new entries

    with GracefulShutdown() as shutdown:
        while not shutdown.requested:
            do_one_iteration()
"""

from __future__ import annotations

import os
import signal
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from logger import get_logger

logger = get_logger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KILL_SWITCH_PATH = ROOT / "data" / "KILL_SWITCH"


# ─────────────────────────────────────────────────────────────────────────────
# Kill switch
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class KillSwitch:
    """
    A file whose presence halts new entries.

    Attributes:
        path: The file to watch. Its existence is the whole signal, so it
            works even if the process is wedged.
    """

    path: Path = DEFAULT_KILL_SWITCH_PATH

    @classmethod
    def from_config(cls, config: Optional[Dict[str, Any]] = None) -> "KillSwitch":
        configured = ((config or {}).get("safety", {}) or {}).get("kill_switch_path")
        if configured:
            path = Path(configured)
            if not path.is_absolute():
                path = ROOT / path
            return cls(path=path)
        return cls()

    @property
    def engaged(self) -> bool:
        """True when trading should not open new positions."""
        return self.path.exists()

    def engage(self, reason: str = "") -> None:
        """
        Stop new entries.

        The reason and timestamp are written into the file so that whoever
        finds it later knows why it is there.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).isoformat()
        body = f"engaged_at: {stamp}\nreason: {reason or 'not given'}\npid: {os.getpid()}\n"
        self.path.write_text(body, encoding="utf-8")
        logger.warning("KILL SWITCH ENGAGED — no new entries. Reason: %s",
                       reason or "not given")

    def release(self) -> bool:
        """Allow new entries again. Returns True if a switch was cleared."""
        if not self.path.exists():
            return False
        self.path.unlink()
        logger.warning("Kill switch released — new entries permitted again")
        return True

    def describe(self) -> str:
        """Human-readable state, including why it was engaged."""
        if not self.engaged:
            return f"Kill switch clear ({self.path})"
        try:
            detail = self.path.read_text(encoding="utf-8").strip().replace("\n", " | ")
        except Exception:
            detail = "unreadable"
        return f"KILL SWITCH ENGAGED ({self.path}) — {detail}"


# ─────────────────────────────────────────────────────────────────────────────
# Graceful shutdown
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class GracefulShutdown:
    """
    Catch termination signals and unwind in an orderly way.

    Handlers registered with ``on_shutdown`` run once, in registration
    order, when a signal arrives or the context exits. A handler that
    raises is logged and does not stop the others — a failure closing one
    resource must not prevent closing the rest.

    Attributes:
        signals: Signals to trap. SIGTERM is what a container stop sends;
            SIGINT is Ctrl-C.
    """

    signals: tuple = (signal.SIGTERM, signal.SIGINT)
    _requested: threading.Event = field(default_factory=threading.Event, repr=False)
    _handlers: List[Callable[[], None]] = field(default_factory=list, repr=False)
    _previous: Dict[int, Any] = field(default_factory=dict, repr=False)
    _ran_cleanup: bool = field(default=False, repr=False)

    # -- context manager ----------------------------------------------------

    def __enter__(self) -> "GracefulShutdown":
        self.install()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.run_handlers()
        self.restore()

    # -- signal wiring ------------------------------------------------------

    def install(self) -> None:
        """
        Trap the signals.

        Signal handlers can only be installed from the main thread; when
        called from a worker this logs and carries on rather than raising,
        so a background task never dies for want of a signal handler.
        """
        for sig in self.signals:
            try:
                self._previous[sig] = signal.getsignal(sig)
                signal.signal(sig, self._handle)
            except (ValueError, OSError) as exc:
                logger.debug("Could not trap %s: %s", sig, exc)

    def restore(self) -> None:
        """Put the original handlers back."""
        for sig, previous in self._previous.items():
            try:
                signal.signal(sig, previous)
            except (ValueError, OSError):
                pass
        self._previous.clear()

    def _handle(self, signum, frame) -> None:
        name = signal.Signals(signum).name
        if self._requested.is_set():
            # A second signal means "stop arguing". Honour it.
            logger.warning("%s received again — exiting immediately", name)
            self.run_handlers()
            os._exit(1)

        logger.warning("%s received — finishing the current iteration, then stopping", name)
        self._requested.set()

    # -- state --------------------------------------------------------------

    @property
    def requested(self) -> bool:
        """True once a shutdown signal has arrived."""
        return self._requested.is_set()

    def wait(self, timeout: float) -> bool:
        """
        Sleep, but wake immediately on shutdown.

        Returns True if shutdown was requested during the wait. Use this
        instead of time.sleep in a service loop, so a container stop does
        not have to wait out the full interval.
        """
        return self._requested.wait(timeout)

    def request(self) -> None:
        """Ask for shutdown programmatically."""
        self._requested.set()

    # -- handlers -----------------------------------------------------------

    def on_shutdown(self, handler: Callable[[], None]) -> Callable[[], None]:
        """
        Register a cleanup handler. Usable as a decorator.

            @shutdown.on_shutdown
            def close_broker():
                broker.disconnect()
        """
        self._handlers.append(handler)
        return handler

    def run_handlers(self) -> None:
        """Run every handler once, logging and continuing past failures."""
        if self._ran_cleanup:
            return
        self._ran_cleanup = True

        for handler in self._handlers:
            name = getattr(handler, "__name__", repr(handler))
            try:
                handler()
                logger.info("Shutdown handler ran: %s", name)
            except Exception as exc:
                logger.error("Shutdown handler %s failed: %s", name, exc)


# ─────────────────────────────────────────────────────────────────────────────
# Combined gate
# ─────────────────────────────────────────────────────────────────────────────

def entries_permitted(config: Optional[Dict[str, Any]] = None,
                      shutdown: Optional[GracefulShutdown] = None) -> tuple:
    """
    May the system open a new position right now?

    Returns:
        (permitted, reason) — reason is empty when permitted.
    """
    switch = KillSwitch.from_config(config)
    if switch.engaged:
        return False, switch.describe()

    if shutdown is not None and shutdown.requested:
        return False, "Shutdown requested — not opening new positions"

    return True, ""
