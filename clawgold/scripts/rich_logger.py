"""
Enhanced Rich-based Logging
===========================

Replaces standard logging with Rich for:
- Colored, formatted console output
- Better progress tracking
- Structured log display
- Live progress bars

Phase 1: High Impact / Quick Wins
"""

import logging
import logging.handlers
import sys
from pathlib import Path
from typing import Optional

# Rich is presentation only — colours, panels, progress bars. Raising here
# took down every module that logs, which is all of them, so a machine
# without rich could not run the system at all. Fall back to plain stderr
# logging instead and keep the same RichLogger surface.
try:
    from rich.console import Console
    from rich.logging import RichHandler
    from rich.table import Table
    from rich.panel import Panel
    from rich.progress import Progress, SpinnerColumn, BarColumn, TaskProgressColumn
    RICH_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the environment
    RICH_AVAILABLE = False
    Console = RichHandler = Table = Panel = None
    Progress = SpinnerColumn = BarColumn = TaskProgressColumn = None


class _PlainConsole:
    """Minimal stand-in for rich.Console that strips markup tags."""

    _TAG = __import__("re").compile(r"\[/?[a-zA-Z0-9_ #]+\]")

    def print(self, *args, **kwargs) -> None:
        text = " ".join(str(a) for a in args)
        print(self._TAG.sub("", text), file=sys.stderr)


class RichLogger:
    """
    Enhanced logger using Rich for better output formatting.
    
    Features:
    - Colored log levels
    - Structured console output
    - Progress bars
    - Tables
    - Panels for important messages
    """
    
    def __init__(self, name: str = "ClawGold", log_file: Optional[str] = None):
        self.name = name
        self.console = Console() if RICH_AVAILABLE else _PlainConsole()

        # Configure logger
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.DEBUG)

        # Remove existing handlers
        self.logger.handlers = []

        if RICH_AVAILABLE:
            handler = RichHandler(
                console=self.console,
                show_time=True,
                show_level=True,
                show_path=True,
                markup=True,
                rich_tracebacks=True,
            )
            handler.setFormatter(logging.Formatter(fmt="%(name)s", datefmt="[%X]"))
        else:
            handler = logging.StreamHandler(sys.stderr)
            handler.setFormatter(logging.Formatter(
                '%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S',
            ))
        self.logger.addHandler(handler)

        # Optional file handler for persistence
        if log_file:
            Path(log_file).parent.mkdir(parents=True, exist_ok=True)
            # Rotating, not plain: this file is written by long-running
            # workers, and an unbounded handler fills the disk. Limits come
            # from the same config.yaml block as scripts/logger.py.
            from logger import DEFAULTS as _LOG_DEFAULTS, _CONFIG as _LOG_CONFIG
            file_handler = logging.handlers.RotatingFileHandler(
                log_file,
                maxBytes=int(_LOG_CONFIG.get("max_bytes") or _LOG_DEFAULTS["max_bytes"]),
                backupCount=int(_LOG_CONFIG.get("backup_count") or _LOG_DEFAULTS["backup_count"]),
                encoding="utf-8",
            )
            file_formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            file_handler.setFormatter(file_formatter)
            self.logger.addHandler(file_handler)
    
    def debug(self, message: str):
        """Log debug message."""
        self.logger.debug(f"[DEBUG] {message}")
    
    def info(self, message: str):
        """Log info message."""
        self.logger.info(f"[INFO] {message}")
    
    def warning(self, message: str):
        """Log warning message."""
        self.logger.warning(f"[WARN] {message}")
    
    def error(self, message: str):
        """Log error message."""
        self.logger.error(f"[ERROR] {message}")
    
    def critical(self, message: str):
        """Log critical message."""
        self.logger.critical(f"[CRITICAL] {message}")
    
    def success(self, message: str):
        """Log success message (green)."""
        self.console.print(f"[green][OK] {message}[/green]")
    
    def failure(self, message: str):
        """Log failure message (red)."""
        self.console.print(f"[red][FAIL] {message}[/red]")
    
    def panel(self, message: str, title: str = "", style: str = "blue"):
        """Display a panel with message."""
        if not RICH_AVAILABLE:
            if title:
                self.console.print(f"--- {title} ---")
            self.console.print(message)
            return
        self.console.print(Panel(message, title=title, style=style))

    def table(self, data: list, columns: list, title: str = ""):
        """Display a table."""
        if not RICH_AVAILABLE:
            if title:
                self.console.print(title)
            self.console.print(" | ".join(str(c) for c in columns))
            for row in data:
                self.console.print(" | ".join(str(v) for v in row))
            return

        table = Table(title=title)
        for col in columns:
            table.add_column(col, style="cyan")
        for row in data:
            table.add_row(*[str(v) for v in row])
        self.console.print(table)

    def progress(self, total: int, description: str = "", transient: bool = True):
        """Create a progress bar context manager, or None when unavailable."""
        if not RICH_AVAILABLE or total <= 0:
            return None
        return Progress(
            SpinnerColumn(),
            BarColumn(),
            TaskProgressColumn(),
            console=self.console,
            transient=transient,
        )


# Global logger instance
_logger: Optional[RichLogger] = None


def get_logger(name: str = __name__) -> logging.Logger:
    """Get or create a Rich logger."""
    global _logger
    if _logger is None:
        _logger = RichLogger(name="ClawGold", log_file="logs/clawgold.log")
    return _logger.logger


def get_rich_logger(name: str = __name__) -> RichLogger:
    """Get the Rich logger instance for advanced features."""
    global _logger
    if _logger is None:
        _logger = RichLogger(name=name, log_file="logs/clawgold.log")
    return _logger
