#!/usr/bin/env python3
"""
Container healthcheck.

Exits 0 when the container is healthy, 1 otherwise.

A bare "is the process alive" check passes for a process that is running
but wedged — stuck on a network call, deadlocked, or looping on an
exception. This reads the worker's heartbeat file instead, so liveness
means "did useful work recently", not "has a PID".

Checks, in order:
  1. The Python package imports (catches a broken deploy).
  2. The heartbeat exists and is fresh, if the service writes one.
  3. The heartbeat does not report a fatal state.

Services that do not write a heartbeat (the dashboard, one-shot commands)
pass on the import check alone — a missing heartbeat is not evidence of
ill health, only an absence of evidence.

Environment:
    HEARTBEAT_PATH      heartbeat file (default: data/heartbeat.json)
    HEARTBEAT_MAX_AGE   seconds before a heartbeat is stale (default: 900)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HEARTBEAT = ROOT / "data" / "heartbeat.json"


def fail(message: str) -> None:
    print(f"UNHEALTHY: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    # 1. The application imports. A dependency that vanished or a syntax
    #    error in a hot-patched file shows up here.
    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import config_loader  # noqa: F401
        import broker  # noqa: F401
    except Exception as exc:
        fail(f"application does not import: {exc}")

    # 2. Heartbeat freshness, for services that publish one.
    path = Path(os.getenv("HEARTBEAT_PATH", str(DEFAULT_HEARTBEAT)))
    if not path.exists():
        print("OK: imports fine; no heartbeat published by this service")
        return 0

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"heartbeat unreadable: {exc}")

    updated_at = payload.get("updated_at")
    if not updated_at:
        fail("heartbeat has no updated_at")

    try:
        stamp = datetime.fromisoformat(updated_at)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
    except Exception as exc:
        fail(f"heartbeat timestamp unparseable: {exc}")

    age = (datetime.now(timezone.utc) - stamp).total_seconds()
    max_age = float(os.getenv("HEARTBEAT_MAX_AGE", "900"))

    status = payload.get("status", "unknown")

    # A stopped worker is a container that should be replaced.
    if status == "stopped":
        fail("worker reports it has stopped")

    if age > max_age:
        fail(f"heartbeat is {age:.0f}s old (limit {max_age:.0f}s), status={status}")

    # "halted" means the kill switch is engaged. That is a deliberate
    # operator action, not a fault — the container is working as asked, so
    # it stays healthy and is not restarted out from under them.
    if status == "halted":
        print(f"OK: halted by kill switch, heartbeat {age:.0f}s old")
        return 0

    if status == "error":
        fail(f"worker reports an error: {payload.get('last_error', 'unspecified')}")

    print(f"OK: status={status}, heartbeat {age:.0f}s old, "
          f"cycles={payload.get('cycles', '?')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
