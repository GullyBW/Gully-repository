"""
Free mode
=========
Run the whole system without paying for anything.

ClawGold has four places money can leak out:

  1. **LiteLLM** — the HTTP fallback bills a provider API key per token.
  2. **Langfuse cloud** — the observability backend has a paid tier.
  3. **AI CLI tools** — some require a paid subscription to be useful.
  4. **Market data** — a paid feed, if one is configured.

Free mode closes all four. What remains is genuinely capable: the technical
signal path (EMA confluence across four timeframes) and the local
keyword sentiment analyser both run offline with no account anywhere, and
the paper broker needs no funded account. A live MT5 demo account is also
free.

Free mode does **not** disable AI. If an AI CLI is already installed and
authenticated on the machine, it is still used — free mode only stops the
system from *requiring* anything paid, and from silently falling back to a
billed API call.

Usage:
    from free_mode import FreeMode

    free = FreeMode(config)
    if free.enabled:
        ...
    free.assert_no_paid_services()   # raises in strict mode
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List

from logger import get_logger

logger = get_logger(__name__)


#: Environment variables that indicate a billed LLM provider is configured.
PAID_LLM_KEYS = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "GROQ_API_KEY",
    "TOGETHER_API_KEY",
)

PAID_OBSERVABILITY_KEYS = (
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
)


class PaidServiceError(RuntimeError):
    """Raised in strict free mode when a billable service is configured."""


@dataclass
class FreeMode:
    """
    Free-mode policy, read from ``free_mode:`` in config.yaml.

    Attributes:
        enabled: Whether free mode is on at all.
        allow_paid_llm_fallback: Permit LiteLLM's billed HTTP fallback.
        skip_ai_research: Skip the AI research step entirely and let the
            technical path carry the signal.
        strict: Refuse to start when a paid service is configured, rather
            than starting and quietly spending money.
    """

    enabled: bool = True
    allow_paid_llm_fallback: bool = False
    skip_ai_research: bool = False
    strict: bool = True

    @classmethod
    def from_config(cls, config: Dict[str, Any] | None) -> "FreeMode":
        section = (config or {}).get("free_mode") or {}
        return cls(
            enabled=bool(section.get("enabled", True)),
            allow_paid_llm_fallback=bool(section.get("allow_paid_llm_fallback", False)),
            skip_ai_research=bool(section.get("skip_ai_research", False)),
            strict=bool(section.get("strict", True)),
        )

    # -- policy questions the rest of the system asks ----------------------

    def permits_paid_llm(self) -> bool:
        """Whether a billed LiteLLM call may be made."""
        if not self.enabled:
            return True
        return self.allow_paid_llm_fallback

    def permits_cloud_observability(self) -> bool:
        """Whether Langfuse cloud tracing may be enabled."""
        return not self.enabled

    # -- diagnostics --------------------------------------------------------

    def detect_paid_services(self) -> List[str]:
        """
        Report billable services that appear to be configured.

        Presence of a key is not proof of spending — the key may be for a
        free tier — so this reports rather than assumes.
        """
        found = []
        for key in PAID_LLM_KEYS:
            if os.environ.get(key):
                found.append(f"{key} (billed LLM provider)")
        for key in PAID_OBSERVABILITY_KEYS:
            if os.environ.get(key):
                found.append(f"{key} (Langfuse cloud)")
        return found

    def assert_no_paid_services(self) -> None:
        """
        In strict free mode, refuse to continue when a paid key is present.

        The point is to fail before a run rather than after a bill.
        """
        if not (self.enabled and self.strict):
            return

        found = self.detect_paid_services()
        if not found:
            return

        raise PaidServiceError(
            "free_mode.strict is on but billable services are configured: "
            + "; ".join(found)
            + ". Unset those variables, set free_mode.allow_paid_llm_fallback "
              "to true to permit them, or set free_mode.strict to false."
        )

    def describe(self) -> str:
        """One-line summary for startup logs."""
        if not self.enabled:
            return "Free mode OFF — paid services may be used."
        parts = ["Free mode ON — no paid service will be called"]
        if self.skip_ai_research:
            parts.append("AI research skipped (technical signal only)")
        if self.allow_paid_llm_fallback:
            parts.append("paid LLM fallback permitted")
        return "; ".join(parts) + "."


def get_free_mode(config: Dict[str, Any] | None = None) -> FreeMode:
    """Convenience accessor mirroring the other config helpers."""
    return FreeMode.from_config(config)
