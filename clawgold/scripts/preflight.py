"""
Preflight checks
================
One command that answers "is this system ready to run?".

Deployment failures in a trading system are expensive and often silent —
a missing dependency degrades a signal to neutral, an unwritable data
directory loses the trade journal, a config that cannot open a position
looks like "no signals today". Preflight turns each of those into a
visible line before anything trades.

Every check returns one of:

    PASS  — verified working
    WARN  — works, but degraded or risky; deployment can proceed
    FAIL  — will not work; deployment should stop

Usage:
    python claw.py preflight
    python claw.py preflight --strict   # warnings become failures
    python claw.py preflight --live     # also check live-trading readiness
"""

from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"


@dataclass
class Check:
    """One preflight result."""

    name: str
    status: str
    detail: str = ""
    remedy: str = ""

    @property
    def ok(self) -> bool:
        return self.status != FAIL


@dataclass
class PreflightReport:
    """The collected results."""

    checks: List[Check] = field(default_factory=list)
    strict: bool = False

    def add(self, name: str, status: str, detail: str = "", remedy: str = "") -> Check:
        check = Check(name, status, detail, remedy)
        self.checks.append(check)
        return check

    @property
    def failures(self) -> List[Check]:
        return [c for c in self.checks if c.status == FAIL]

    @property
    def warnings(self) -> List[Check]:
        return [c for c in self.checks if c.status == WARN]

    @property
    def ok(self) -> bool:
        """Ready to run. In strict mode a warning is also disqualifying."""
        if self.failures:
            return False
        return not (self.strict and self.warnings)

    def render(self) -> str:
        width = max((len(c.name) for c in self.checks), default=20) + 2
        lines = ["", "[PREFLIGHT] ClawGold readiness", "=" * 72]

        for check in self.checks:
            lines.append(f"  {check.status:<5} {check.name:<{width}} {check.detail}")

        lines.append("-" * 72)

        actionable = [c for c in self.checks if c.status in (FAIL, WARN) and c.remedy]
        if actionable:
            lines.append("  What to do:")
            for check in actionable:
                lines.append(f"    [{check.status}] {check.name}")
                lines.append(f"           {check.remedy}")
            lines.append("-" * 72)

        passed = sum(1 for c in self.checks if c.status == PASS)
        summary = (f"  {passed} passed, {len(self.warnings)} warning(s), "
                   f"{len(self.failures)} failure(s)")
        lines.append(summary)

        if self.ok:
            lines.append("  RESULT: ready to run.")
        elif self.failures:
            lines.append("  RESULT: NOT ready — resolve the failures above.")
        else:
            lines.append("  RESULT: NOT ready — strict mode, warnings count as failures.")
        lines.append("")
        return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Individual checks
# ─────────────────────────────────────────────────────────────────────────────

def _check_python(report: PreflightReport) -> None:
    version = sys.version_info
    text = f"{version.major}.{version.minor}.{version.micro}"
    if version < (3, 10):
        report.add("Python version", FAIL, text,
                   "ClawGold needs Python 3.10 or newer.")
    else:
        report.add("Python version", PASS, text)


def _check_core_imports(report: PreflightReport) -> None:
    """Required packages. Without these nothing runs."""
    required = {
        "yaml": "PyYAML",
        "pandas": "pandas",
        "numpy": "numpy",
    }
    missing = []
    for module, package in required.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)

    if missing:
        report.add("Core dependencies", FAIL, f"missing: {', '.join(missing)}",
                   f"pip install {' '.join(missing)}  (or: pip install -r requirements-dev.txt)")
    else:
        report.add("Core dependencies", PASS, "yaml, pandas, numpy")


def _check_optional_imports(report: PreflightReport) -> None:
    """
    Optional packages. Each degrades a feature rather than stopping the run,
    so each is a warning naming what is lost.
    """
    optional = {
        "langgraph": "the trading pipeline (claw.py graph run) will not start",
        "apscheduler": "background scheduling is unavailable",
        "rich": "console output falls back to plain logging",
    }
    missing = {}
    for module, consequence in optional.items():
        try:
            __import__(module)
        except ImportError:
            missing[module] = consequence

    if missing:
        detail = ", ".join(missing)
        remedy = "pip install " + " ".join(missing) + "  — without them: " + \
                 "; ".join(missing.values())
        report.add("Optional dependencies", WARN, f"missing: {detail}", remedy)
    else:
        report.add("Optional dependencies", PASS, "langgraph, apscheduler, rich")


def _check_config(report: PreflightReport) -> Optional[Dict[str, Any]]:
    try:
        try:
            from .config_loader import load_config
        except ImportError:
            from config_loader import load_config
        config = load_config()
    except Exception as exc:
        report.add("Config loads", FAIL, str(exc),
                   "Fix config.yaml, or check the file exists at the repository root.")
        return None

    report.add("Config loads", PASS, "config.yaml")
    return config


def _check_config_valid(report: PreflightReport) -> None:
    try:
        try:
            from .config_validator import ConfigValidator
        except ImportError:
            from config_validator import ConfigValidator
        errors, warnings = ConfigValidator().validate_all()
    except Exception as exc:
        report.add("Config valid", FAIL, str(exc), "Run 'claw.py validate' for detail.")
        return

    if errors:
        report.add("Config valid", FAIL, f"{len(errors)} error(s): {errors[0]}",
                   "Run 'claw.py validate' for the full list.")
    elif warnings:
        report.add("Config valid", WARN, f"{len(warnings)} warning(s): {warnings[0]}",
                   "Run 'claw.py validate' for the full list.")
    else:
        report.add("Config valid", PASS, "no errors or warnings")


def _check_trading_mode(report: PreflightReport, config: Dict[str, Any]) -> str:
    try:
        try:
            from .broker import resolve_mode
        except ImportError:
            from broker import resolve_mode
        mode = resolve_mode(config)
    except Exception as exc:
        report.add("Trading mode", FAIL, str(exc), "Check trading.mode in config.yaml.")
        return "paper"

    if mode == "real":
        report.add("Trading mode", WARN, "LIVE — real orders, real money",
                   "Set trading.mode to 'simulation' if this is not intended.")
    elif mode == "remote":
        report.add("Trading mode", WARN, "LIVE via bridge — real orders, real money",
                   "Set trading.mode to 'simulation' if this is not intended.")
    else:
        report.add("Trading mode", PASS, "simulation (paper broker, no real orders)")
    return mode


def _check_broker(report: PreflightReport, config: Dict[str, Any], mode: str) -> None:
    """Actually connect and read a price — the strongest signal it works."""
    try:
        try:
            from .broker import get_broker
        except ImportError:
            from broker import get_broker

        broker = get_broker(config)
        symbol = config.get("trading", {}).get("symbol", "XAUUSD")

        if mode == "real":
            # Do not open a live terminal session during preflight; report
            # that the live path is configured and leave connecting to the run.
            report.add("Broker", WARN, f"{broker.name} configured (not connected in preflight)",
                       "Run 'claw.py balance' to verify the live connection.")
            return

        with broker:
            tick = broker.get_tick(symbol)
            account = broker.get_account_info()

        if not tick or not account:
            report.add("Broker", FAIL, "connected but returned no price or account",
                       "Check the paper broker settings under 'paper:' in config.yaml.")
        else:
            report.add("Broker", PASS,
                       f"{broker.name} — {symbol} {tick['bid']:.2f}/{tick['ask']:.2f}, "
                       f"balance ${account['balance']:,.2f}")
    except Exception as exc:
        report.add("Broker", FAIL, str(exc),
                   "Check trading.mode and the mt5/paper sections of config.yaml.")


def _check_bridge(report: PreflightReport, broker) -> None:
    """
    Reach the MT5 bridge without placing anything.

    /health needs no token, so a failure here separates "cannot reach the
    bridge" from "reached it but the token is wrong" — two different fixes.
    """
    import json as _json
    import urllib.request

    if not broker.url:
        report.add("Bridge", FAIL, "no URL configured",
                   "Set mt5.bridge.url, or MT5_BRIDGE_URL in .env. See docs/MACOS.md.")
        return
    if not broker.token:
        report.add("Bridge", FAIL, "no token configured",
                   "Set mt5.bridge.token, or MT5_BRIDGE_TOKEN in .env.")
        return

    try:
        with urllib.request.urlopen(f"{broker.url}/health", timeout=8) as response:
            health = _json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        report.add("Bridge", FAIL, f"unreachable at {broker.url}: {exc}",
                   "Start scripts/mt5_bridge_server.py on the MT5 host, and "
                   "check the SSH tunnel is up.")
        return

    if not health.get("connected"):
        report.add("Bridge", FAIL, "reachable, but not connected to MetaTrader 5",
                   "Open and log in to the MT5 terminal on the bridge host.")
        return

    # Prove the token works, using a read that changes nothing.
    try:
        account = broker.get_account_info()
    except Exception as exc:
        report.add("Bridge", FAIL, f"token rejected or read failed: {exc}",
                   "Check mt5.bridge.token matches the bridge's --token.")
        return

    detail = f"connected via {broker.url}"
    if account:
        detail += f", balance {account.get('balance', 0):,.2f} {account.get('currency', '')}"
    if health.get("read_only"):
        report.add("Bridge", WARN, detail + " (READ-ONLY)",
                   "The bridge was started with --read-only; it will refuse orders.")
    else:
        report.add("Bridge", PASS, detail)


def _check_entry_budget(report: PreflightReport, config: Dict[str, Any]) -> None:
    """The check that decides whether a small account can trade at all."""
    try:
        try:
            from .risk_manager import RiskManager
        except ImportError:
            from risk_manager import RiskManager

        rm = RiskManager(config)
        if rm.entry_budget <= 0:
            report.add("Entry budget", PASS, "no cap — sizing on risk alone")
            return

        price = float(config.get("paper", {}).get("start_price") or 2650.0)
        check = rm.entry_feasibility(price)

        if check["feasible"]:
            report.add("Entry budget", PASS,
                       f"${check['budget']:,.2f} affords {check['volume']} lots "
                       f"at 1:{check['leverage']:.0f}")
        else:
            report.add("Entry budget", FAIL,
                       f"${check['budget']:,.2f} cannot open the minimum position "
                       f"(needs ${check['min_margin']:,.2f})",
                       "Run 'claw.py entry-check' — it names the options.")
    except Exception as exc:
        report.add("Entry budget", WARN, str(exc), "Run 'claw.py entry-check'.")


def _check_free_mode(report: PreflightReport, config: Dict[str, Any]) -> None:
    try:
        try:
            from .free_mode import FreeMode
        except ImportError:
            from free_mode import FreeMode

        free = FreeMode.from_config(config)
        paid = free.detect_paid_services()

        if not free.enabled:
            report.add("Free mode", WARN, "off — paid services may be called",
                       "Set free_mode.enabled to true to guarantee zero cost.")
        elif paid and free.strict:
            report.add("Free mode", FAIL,
                       f"strict, but paid keys present: {', '.join(paid)}",
                       "Unset those variables, or set free_mode.strict to false.")
        elif paid:
            report.add("Free mode", WARN, f"paid keys present: {', '.join(paid)}",
                       "They will not be used while allow_paid_llm_fallback is false.")
        else:
            report.add("Free mode", PASS, "on — no paid service configured")
    except Exception as exc:
        report.add("Free mode", WARN, str(exc))


def _check_ai_tools(report: PreflightReport, config: Dict[str, Any]) -> None:
    """AI is optional: its absence is a warning naming what degrades."""
    found = [name for name in ("opencode", "gemini", "codex", "claude")
             if shutil.which(name)]

    if found:
        report.add("AI CLI tools", PASS, ", ".join(found))
        return

    try:
        try:
            from .free_mode import FreeMode
        except ImportError:
            from free_mode import FreeMode
        skip = FreeMode.from_config(config).skip_ai_research
    except Exception:
        skip = False

    if skip:
        report.add("AI CLI tools", PASS, "none installed; AI research disabled by config")
    else:
        report.add("AI CLI tools", WARN, "none installed",
                   "The news/sentiment half of the signal will be unavailable and the "
                   "technical path will carry it alone. Install a free one, e.g. "
                   "npm install -g @google/gemini-cli")


def _check_writable_paths(report: PreflightReport, config: Dict[str, Any]) -> None:
    """Data and logs must be writable or the journal silently disappears."""
    targets = [ROOT / "data", ROOT / "logs"]

    logging_cfg = config.get("logging", {}) or {}
    log_file = logging_cfg.get("file_path") or logging_cfg.get("log_file")
    if log_file:
        targets.append((ROOT / log_file).parent)

    problems = []
    for path in dict.fromkeys(targets):
        try:
            path.mkdir(parents=True, exist_ok=True)
            probe = path / ".preflight-write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        except Exception as exc:
            problems.append(f"{path.name}: {exc}")

    if problems:
        report.add("Writable paths", FAIL, "; ".join(problems),
                   "Fix directory permissions, or mount a writable volume there.")
    else:
        report.add("Writable paths", PASS, "data/, logs/")


def _check_disk_space(report: PreflightReport) -> None:
    try:
        usage = shutil.disk_usage(ROOT)
        free_mb = usage.free / (1024 * 1024)
    except Exception as exc:
        report.add("Disk space", WARN, str(exc))
        return

    detail = f"{free_mb:,.0f} MB free"
    if free_mb < 50:
        report.add("Disk space", FAIL, detail,
                   "SQLite writes will fail. Free space before starting.")
    elif free_mb < 500:
        report.add("Disk space", WARN, detail, "Consider freeing space.")
    else:
        report.add("Disk space", PASS, detail)


def _check_secrets_not_committed(report: PreflightReport) -> None:
    """A committed credential is a deployment blocker, not a style issue."""
    problems = []
    config_path = ROOT / "config.yaml"

    try:
        import yaml
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}

        if (raw.get("mt5", {}) or {}).get("login"):
            problems.append("mt5.login is committed in config.yaml")
        if (raw.get("mt5", {}) or {}).get("password"):
            problems.append("mt5.password is committed in config.yaml")
        if (raw.get("telegram", {}) or {}).get("bot_token"):
            problems.append("telegram.bot_token is committed in config.yaml")
    except Exception as exc:
        report.add("No committed secrets", WARN, str(exc))
        return

    if problems:
        report.add("No committed secrets", FAIL, "; ".join(problems),
                   "Move them to .env, which is gitignored, and blank them in config.yaml.")
    else:
        report.add("No committed secrets", PASS, "config.yaml carries no credentials")


def _check_kill_switch(report: PreflightReport, config: Dict[str, Any]) -> None:
    try:
        try:
            from .lifecycle import KillSwitch
        except ImportError:
            from lifecycle import KillSwitch

        switch = KillSwitch.from_config(config)
        if switch.engaged:
            report.add("Kill switch", WARN, f"ENGAGED ({switch.path})",
                       f"No new entries will be taken. Clear it with: "
                       f"claw.py kill-switch off")
        else:
            report.add("Kill switch", PASS, f"clear ({switch.path})")
    except Exception as exc:
        report.add("Kill switch", WARN, str(exc))


def _check_live_readiness(report: PreflightReport, config: Dict[str, Any],
                          mode: str = "real") -> None:
    """Only run with --live. Things that matter solely for real money."""
    mt5 = config.get("mt5", {}) or {}
    telegram = config.get("telegram", {}) or {}

    if mode == "remote":
        # Credentials live on the bridge host, not here — that is the point
        # of the bridge, and demanding them locally would be wrong.
        report.add("Live: MT5 credentials", PASS,
                   "held by the bridge host, not this machine")
    elif not mt5.get("login"):
        report.add("Live: MT5 credentials", FAIL, "no login configured",
                   "Set MT5_LOGIN, MT5_PASSWORD and MT5_SERVER in .env.")
    else:
        report.add("Live: MT5 credentials", PASS, f"login {mt5['login']}")

    if telegram.get("enabled") and telegram.get("bot_token"):
        report.add("Live: alerting", PASS, "Telegram configured")
    else:
        report.add("Live: alerting", WARN, "Telegram not configured",
                   "You will not be notified when trades execute or limits trip.")

    if mode == "remote":
        report.add("Live: MetaTrader5 package", PASS,
                   "not needed here — the bridge host runs it")
        return

    from broker import import_mt5_module, mt5_flavour

    flavour = mt5_flavour()
    try:
        import_mt5_module()
        detail = "importable"
        if sys.platform == "darwin":
            detail += " — drives MetaTrader 5.app's bundled Wine runtime"
        report.add(f"Live: {flavour} package", PASS, detail)
    except ImportError:
        if sys.platform == "darwin":
            report.add(
                f"Live: {flavour} package", FAIL,
                "not installed",
                "pip install mt5-mac, and install MetaTrader 5.app in "
                "/Applications. First connect provisions a Windows Python "
                "inside its bundled Wine (~8 MB). See docs/MACOS.md.")
        else:
            report.add(
                f"Live: {flavour} package", FAIL,
                f"not installable on {sys.platform} — MetaQuotes ships Windows-only wheels",
                "Use trading.mode = 'remote' with scripts/mt5_bridge_server.py on a "
                "Windows host or macOS under Wine. See docs/MACOS.md.")


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

def run_preflight(strict: bool = False, live_check: bool = False) -> PreflightReport:
    """
    Run every check and return the report.

    Args:
        strict: Treat warnings as failures.
        live_check: Also run the live-trading readiness checks.
    """
    report = PreflightReport(strict=strict)

    _check_python(report)
    _check_core_imports(report)
    _check_optional_imports(report)

    config = _check_config(report)
    if config is None:
        return report

    _check_config_valid(report)
    mode = _check_trading_mode(report, config)
    _check_broker(report, config, mode)
    _check_entry_budget(report, config)
    _check_free_mode(report, config)
    _check_ai_tools(report, config)
    _check_writable_paths(report, config)
    _check_disk_space(report)
    _check_secrets_not_committed(report)
    _check_kill_switch(report, config)

    if live_check or mode in ("real", "remote"):
        _check_live_readiness(report, config, mode)

    return report


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ClawGold preflight checks")
    parser.add_argument("--strict", action="store_true", help="warnings become failures")
    parser.add_argument("--live", action="store_true", help="also check live readiness")
    args = parser.parse_args()

    result = run_preflight(strict=args.strict, live_check=args.live)
    print(result.render())
    sys.exit(0 if result.ok else 1)
