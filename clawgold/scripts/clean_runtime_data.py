#!/usr/bin/env python3
"""
Prune ClawGold's runtime artifacts: bytecode, stale databases, old logs.

Disk is a real constraint for a long-running trader. Rotation (see
scripts/logger.py) bounds the *active* log, but three things still
accumulate: compiled bytecode, rotated log archives, and databases left
behind by test runs.

Safety is the whole design here, because one file in data/ is the trade
journal and losing it loses your trade history:

  * Bytecode is always safe, so it is cleaned by default.
  * Only *archived* logs are pruned, never the log being written to, and
    only past an age threshold.
  * Databases are opt-in beyond obvious test artifacts, and the known
    production databases are refused outright without --force.

Nothing is deleted outside the clawgold/ directory.

Usage:
    python scripts/clean_runtime_data.py                 # bytecode + old logs
    python scripts/clean_runtime_data.py --dry-run       # show, change nothing
    python scripts/clean_runtime_data.py --databases     # also stale test DBs
    python scripts/clean_runtime_data.py --days 30       # keep archives longer
"""

import argparse
import shutil
import sys
import time
from pathlib import Path
from typing import List, Tuple

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
LOGS_DIR = ROOT / "logs"

DEFAULT_LOG_AGE_DAYS = 14

# Databases holding real state. Never removed without --force, whatever
# else is asked for. clawgold.db is the trade journal.
PROTECTED_DATABASES = {
    "clawgold.db",           # trade journal — real money history
    "news.db",               # collected news and sentiment
    "agent_history.db",      # AI execution history
    "agent_scheduler.db",    # scheduled task state
    "economic_calendar.db",
    "llm_costs.db",
    "signal_service.db",
}

# Databases that are unambiguously test residue.
TEST_DB_PATTERNS = ("test_*.db", "*_test.db", "*.db.bak", "*.db.tmp")


def human(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} GB"


class Cleaner:
    def __init__(self, dry_run: bool = False, quiet: bool = False):
        self.dry_run = dry_run
        self.quiet = quiet
        self.removed = 0
        self.freed = 0
        self.skipped: List[str] = []
        # A path can match more than one rule (a test database is also
        # caught by the --databases sweep). Without this it is reported and
        # counted twice, and the second unlink fails on an absent file.
        self._handled: set = set()

    def say(self, message: str) -> None:
        if not self.quiet:
            print(message)

    def _remove(self, path: Path, why: str) -> None:
        resolved = path.resolve()
        if resolved in self._handled:
            return
        self._handled.add(resolved)
        try:
            size = self._size_of(path)
        except OSError:
            size = 0
        prefix = "  would remove" if self.dry_run else "  removed"
        self.say(f"{prefix}  {path.relative_to(ROOT)}  ({human(size)}, {why})")
        if self.dry_run:
            self.removed += 1
            self.freed += size
            return
        try:
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()
        except OSError as exc:
            self.skipped.append(f"{path.relative_to(ROOT)}: {exc}")
            return
        self.removed += 1
        self.freed += size

    @staticmethod
    def _size_of(path: Path) -> int:
        if path.is_dir() and not path.is_symlink():
            return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        return path.stat().st_size

    # -- bytecode -----------------------------------------------------------

    def clean_bytecode(self) -> None:
        self.say("\nBytecode")
        targets = sorted(
            (p for p in ROOT.rglob("__pycache__") if p.is_dir()),
            key=lambda p: len(p.parts), reverse=True,
        )
        for cache_dir in targets:
            self._remove(cache_dir, "__pycache__")

        # Loose .pyc/.pyo outside a __pycache__ directory.
        for pyc in ROOT.rglob("*.py[co]"):
            if pyc.is_file():
                self._remove(pyc, "compiled bytecode")

        if not targets:
            self.say("  nothing to clean")

    # -- databases ----------------------------------------------------------

    def clean_databases(self, include_databases: bool, force: bool) -> None:
        self.say("\nDatabases")
        if not DATA_DIR.is_dir():
            self.say("  data/ does not exist — nothing to clean")
            return

        found = False
        for pattern in TEST_DB_PATTERNS:
            for db in sorted(DATA_DIR.glob(pattern)):
                if db.name in PROTECTED_DATABASES and not force:
                    self.skipped.append(f"{db.name}: protected (use --force)")
                    continue
                found = True
                self._remove(db, "test database")

        # Orphaned SQLite sidecars: -journal/-wal/-shm whose main database is
        # gone. While the database exists these may hold uncommitted data, so
        # they are only removed once nothing can be lost.
        for suffix in ("-journal", "-wal", "-shm"):
            for sidecar in sorted(DATA_DIR.glob(f"*.db{suffix}")):
                main = sidecar.with_name(sidecar.name[: -len(suffix)])
                if main.exists():
                    continue
                found = True
                self._remove(sidecar, f"orphaned {suffix.lstrip('-')} file")

        if include_databases:
            for db in sorted(DATA_DIR.glob("*.db")):
                if db.name in PROTECTED_DATABASES and not force:
                    self.skipped.append(
                        f"{db.name}: holds real state, refused (use --force)")
                    continue
                found = True
                self._remove(db, "database (--databases)")

        if not found:
            self.say("  nothing to clean")

    # -- logs ---------------------------------------------------------------

    def clean_logs(self, days: int) -> None:
        self.say(f"\nArchived logs older than {days} days")
        if not LOGS_DIR.is_dir():
            self.say("  logs/ does not exist — nothing to clean")
            return

        cutoff = time.time() - days * 86400
        active = self._active_log_paths()
        candidates = set()

        for pattern in ("*.log.[0-9]*", "*.log.gz", "*.log.bz2"):
            candidates.update(LOGS_DIR.glob(pattern))
        # Date-stamped files left by the pre-rotation logger, e.g.
        # clawgold_20260101.log — one per day, never pruned before now.
        for dated in LOGS_DIR.glob("*_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].log"):
            candidates.add(dated)

        found = False
        for log in sorted(candidates):
            if not log.is_file():
                continue
            if log.resolve() in active:
                # Never delete the file a running handler holds open.
                continue
            try:
                age = log.stat().st_mtime
            except OSError:
                continue
            if age >= cutoff:
                continue
            found = True
            days_old = int((time.time() - age) / 86400)
            self._remove(log, f"{days_old} days old")

        if not found:
            self.say("  nothing to clean")

    @staticmethod
    def _active_log_paths() -> set:
        """
        The log file currently being written to, which must never be pruned.

        Only the configured path counts. Globbing "*.log" would also match
        the date-stamped archives left by the pre-rotation logger, so those
        would be protected forever and never cleaned.
        """
        paths = set()
        try:
            sys.path.insert(0, str(ROOT / "scripts"))
            from logger import LOG_FILE
            paths.add(Path(LOG_FILE).resolve())
        except Exception:
            paths.add((LOGS_DIR / "clawgold.log").resolve())
        return paths

    # -- report -------------------------------------------------------------

    def report(self) -> int:
        verb = "Would free" if self.dry_run else "Freed"
        self.say("\n" + "-" * 60)
        self.say(f"{verb} {human(self.freed)} across {self.removed} item(s)")
        if self.skipped:
            self.say(f"Skipped {len(self.skipped)}:")
            for note in self.skipped:
                self.say(f"  - {note}")
        return 0


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prune ClawGold runtime artifacts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be removed, change nothing")
    parser.add_argument("--days", type=int, default=DEFAULT_LOG_AGE_DAYS,
                        help=f"Archived-log age threshold (default {DEFAULT_LOG_AGE_DAYS})")
    parser.add_argument("--databases", action="store_true",
                        help="Also remove databases in data/ (protected ones still refused)")
    parser.add_argument("--force", action="store_true",
                        help="Permit removing protected databases, including the trade journal")
    parser.add_argument("--quiet", action="store_true", help="Only print the summary line")
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    if args.days < 0:
        print("--days must not be negative", file=sys.stderr)
        return 2

    cleaner = Cleaner(dry_run=args.dry_run, quiet=args.quiet)
    header = f"[CLEAN] {ROOT}"
    if args.dry_run:
        header += "  (dry run — nothing will be deleted)"
    cleaner.say(header)
    if args.force:
        cleaner.say("  --force: protected databases are eligible for deletion")

    cleaner.clean_bytecode()
    cleaner.clean_databases(include_databases=args.databases, force=args.force)
    cleaner.clean_logs(days=args.days)
    return cleaner.report()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
