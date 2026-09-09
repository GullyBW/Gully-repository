#!/usr/bin/env bash
#
# Container entrypoint.
#
# Runs preflight before handing over to the real command, so a container
# with a broken configuration fails fast and visibly at startup instead of
# looping on errors, or worse, appearing healthy while silently trading
# nothing.
#
# Skip with PREFLIGHT_SKIP=true (useful for one-shot maintenance commands).
# Escalate with PREFLIGHT_STRICT=true to fail on warnings too.

set -euo pipefail

if [[ "${PREFLIGHT_SKIP:-false}" == "true" ]]; then
    echo "[entrypoint] PREFLIGHT_SKIP=true — skipping readiness checks"
else
    echo "[entrypoint] Running preflight checks..."
    preflight_args=()
    [[ "${PREFLIGHT_STRICT:-false}" == "true" ]] && preflight_args+=("--strict")

    if ! python claw.py preflight "${preflight_args[@]}"; then
        echo "[entrypoint] Preflight FAILED — refusing to start." >&2
        echo "[entrypoint] Fix the failures above, or set PREFLIGHT_SKIP=true" >&2
        echo "[entrypoint] to start anyway (not recommended for live trading)." >&2
        exit 1
    fi
fi

echo "[entrypoint] Starting: $*"
# exec so the real process becomes PID 1 and receives SIGTERM directly.
# Without it, signals stop at the shell and the container is SIGKILLed
# after the grace period, mid-trade.
exec "$@"
