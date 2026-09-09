#!/usr/bin/env python3
"""
Assert requirements.txt resolves to the right MT5 package per platform.

One requirements file serves Windows, macOS and Linux, and environment
markers are what make that work. A malformed marker would otherwise surface
only at install time, on someone else's machine.

Run directly (CI does): python test/check_requirement_markers.py
"""

import os
import sys

from packaging.requirements import Requirement

REQUIREMENTS = os.path.join(os.path.dirname(__file__), "..", "requirements.txt")

ENVIRONMENTS = {
    "win32": {"sys_platform": "win32"},
    "darwin": {"sys_platform": "darwin"},
    "linux": {"sys_platform": "linux"},
}

# package name -> the only platform that should install it
EXPECTED = {"MetaTrader5": {"win32"}, "mt5-mac": {"darwin"}}


def main() -> int:
    seen = {}
    with open(REQUIREMENTS) as handle:
        for line in handle:
            line = line.split("#")[0].strip()
            if not line:
                continue
            req = Requirement(line)
            if req.name in EXPECTED:
                if req.marker is None:
                    print(f"FAIL: {req.name} has no environment marker")
                    return 1
                seen[req.name] = {
                    name for name, env in ENVIRONMENTS.items() if req.marker.evaluate(env)
                }

    ok = True
    for name, platforms in EXPECTED.items():
        if seen.get(name) != platforms:
            print(f"FAIL: {name} installs on {seen.get(name)}, expected {platforms}")
            ok = False

    if not ok:
        return 1
    print("requirements.txt markers resolve per platform:",
          {k: sorted(v) for k, v in seen.items()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
