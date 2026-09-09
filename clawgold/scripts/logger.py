"""
Unified Logging System
======================
Provides consistent logging across all ClawGold modules.

Everything here is driven by the ``logging`` block in config.yaml:

    logging:
      level: "INFO"
      format: "json"            # or "text"
      file_path: logs/clawgold.log
      max_bytes: 10485760       # 10 MB
      backup_count: 5
      log_trades_only: false

The file handler is a RotatingFileHandler, so a chatty failure loop cannot
fill the disk: the logs occupy at most max_bytes x (backup_count + 1). The
previous implementation used a plain FileHandler against a date-stamped
path, which grew without bound and left a new file behind every day.

Config is read directly with yaml rather than through config_loader, so
this module stays importable by anything without a circular import.
"""

import json
import logging
import logging.handlers
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parent.parent

# Defaults used when config.yaml is missing, unreadable, or incomplete.
DEFAULTS: Dict[str, Any] = {
    "enable": True,
    "level": "INFO",
    "format": "text",
    "file_path": "logs/clawgold.log",
    "max_bytes": 10 * 1024 * 1024,
    "backup_count": 5,
    "log_trades_only": False,
}

LOG_FORMAT = "%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Attributes present on every LogRecord; anything else was passed via
# `extra=` and is worth carrying into the JSON output.
_STANDARD_RECORD_KEYS = frozenset(logging.LogRecord(
    name="", level=0, pathname="", lineno=0, msg="", args=(), exc_info=None
).__dict__) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line, so a log shipper can parse it."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, DATE_FORMAT),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # Anything the caller attached with extra={...}.
        for key, value in record.__dict__.items():
            if key not in _STANDARD_RECORD_KEYS:
                try:
                    json.dumps(value)
                    payload[key] = value
                except (TypeError, ValueError):
                    payload[key] = repr(value)
        return json.dumps(payload, default=str)


class TradesOnlyFilter(logging.Filter):
    """
    Passes only trade-related records.

    A record qualifies if it was logged with ``extra={"trade": True}`` or by
    a logger whose name mentions trades. Applied to the file handler alone,
    so the console keeps showing everything.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(record, "trade", False):
            return True
        name = record.name.lower()
        return "trade" in name or "order" in name


def _load_logging_config() -> Dict[str, Any]:
    """Read the logging block from config.yaml, falling back to DEFAULTS."""
    settings = dict(DEFAULTS)
    try:
        import yaml
        with open(ROOT / "config.yaml", encoding="utf-8") as handle:
            block = (yaml.safe_load(handle) or {}).get("logging") or {}
    except Exception:
        # Logging must never be the reason the process cannot start.
        return settings

    settings.update({k: v for k, v in block.items() if v is not None})
    # file_path is the documented key; log_file is the deprecated alias.
    if not block.get("file_path") and block.get("log_file"):
        settings["file_path"] = block["log_file"]
    return settings


def _resolve_level(value: Any, fallback: int = logging.INFO) -> int:
    """Accept either a name ('INFO') or a numeric level."""
    if isinstance(value, int):
        return value
    try:
        resolved = logging.getLevelName(str(value).upper())
        return resolved if isinstance(resolved, int) else fallback
    except Exception:
        return fallback


def _positive_int(value: Any, fallback: int) -> int:
    """A non-positive rotation setting would disable rotation entirely."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


_CONFIG = _load_logging_config()

# Kept as module-level names because other modules import them.
LOGS_DIR = (ROOT / Path(_CONFIG["file_path"]).parent)
LOG_FILE = ROOT / _CONFIG["file_path"]


def _build_file_handler(level: int) -> Optional[logging.Handler]:
    """A rotating file handler, or None if the path is not writable."""
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(
            LOG_FILE,
            maxBytes=_positive_int(_CONFIG["max_bytes"], DEFAULTS["max_bytes"]),
            backupCount=_positive_int(_CONFIG["backup_count"], DEFAULTS["backup_count"]),
            encoding="utf-8",
        )
    except OSError:
        # A read-only mount must not stop the process; console still works.
        return None

    handler.setLevel(level)
    if str(_CONFIG["format"]).lower() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    if _CONFIG["log_trades_only"]:
        handler.addFilter(TradesOnlyFilter())
    return handler


def get_logger(name: str, level: Optional[int] = None) -> logging.Logger:
    """
    Get a logger instance with consistent configuration.

    Args:
        name: Logger name (usually __name__).
        level: Override the configured level for this logger.

    Returns:
        Configured logger instance.
    """
    logger = logging.getLogger(name)

    # Prevent duplicate handlers
    if logger.handlers:
        return logger

    effective = level if level is not None else _resolve_level(_CONFIG["level"])
    logger.setLevel(effective)

    # Console handler — always plain text; JSON is for the file.
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(effective)
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    logger.addHandler(console_handler)

    # File handler — rotating, and only when logging is enabled.
    if _CONFIG["enable"] and os.environ.get("CLAWGOLD_DISABLE_FILE_LOG") != "1":
        file_handler = _build_file_handler(effective)
        if file_handler is not None:
            logger.addHandler(file_handler)

    return logger


def set_global_level(level: int):
    """Set logging level for all clawgold loggers."""
    logging.getLogger("clawgold").setLevel(level)


def rotation_summary() -> Dict[str, Any]:
    """What the file handler is configured to do — used by preflight."""
    return {
        "path": str(LOG_FILE),
        "max_bytes": _positive_int(_CONFIG["max_bytes"], DEFAULTS["max_bytes"]),
        "backup_count": _positive_int(_CONFIG["backup_count"], DEFAULTS["backup_count"]),
        "format": str(_CONFIG["format"]).lower(),
        "level": logging.getLevelName(_resolve_level(_CONFIG["level"])),
        "trades_only": bool(_CONFIG["log_trades_only"]),
        "max_total_bytes": (
            _positive_int(_CONFIG["max_bytes"], DEFAULTS["max_bytes"])
            * (_positive_int(_CONFIG["backup_count"], DEFAULTS["backup_count"]) + 1)
        ),
    }
