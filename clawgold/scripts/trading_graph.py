"""
trading_graph.py — the trading pipeline for ClawGold.

This is now the single orchestration engine. ``orchestrator.py`` remains as
a thin deprecation shim that delegates here, so the two competing engines no
longer drift apart.

    START
      -> calendar_gate : pause around high-impact economic events
      -> research      : AI-powered market research
      -> analyze       : sentiment + technical confluence -> signal
      -> validate      : risk gates (confidence, sizing, can_trade)
      |_ (low conf)   -> research  (retry loop, max 3x)
      -> human_review  : interrupt — wait for approval
      |_ (approved)   -> execute   : order via the Broker interface
      -> monitor       : notify + record
      -> learn         : feed the outcome to adaptive_learning
      -> END

Ported in from the retired threaded orchestrator:
  * the economic-calendar trading pause (calendar_gate)
  * the adaptive-learning feedback loop (learn node)

Usage:
    from scripts.trading_graph import run_pipeline
    result = run_pipeline("XAUUSD", "H1")
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from typing_extensions import TypedDict

logger = logging.getLogger(__name__)

# LangGraph is required for the pipeline but optional for importing this
# module, so `claw.py --help` and the test suite work without it installed.
try:
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt
    LANGGRAPH_AVAILABLE = True
    LANGGRAPH_IMPORT_ERROR = ""
except ImportError as exc:  # pragma: no cover - depends on the environment
    LANGGRAPH_AVAILABLE = False
    LANGGRAPH_IMPORT_ERROR = str(exc)
    MemorySaver = StateGraph = Command = None
    START = END = "__end__"

    def interrupt(value):  # type: ignore[misc]
        raise RuntimeError("LangGraph is not installed. Run: pip install langgraph")


#: Minimum blended confidence a signal needs before it can be executed.
#: Matches DecisionEngine.MIN_CONFIDENCE so the two gates cannot drift.
CONFIDENCE_FLOOR = 0.6


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_config():
    try:
        from scripts.config_loader import load_config
    except ImportError:
        from config_loader import load_config
    return load_config()


def _plain(value: Any) -> Any:
    """
    Coerce numpy scalars and containers into plain Python types.

    Graph state is checkpointed with msgpack, which cannot encode
    numpy.float64. Anything derived from pandas has to pass through here
    before it goes into the state dict.
    """
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if hasattr(value, "item") and hasattr(value, "dtype"):  # numpy scalar
        return value.item()
    return value


# ─── State ────────────────────────────────────────────────────────────────────


class TradingState(TypedDict, total=False):
    symbol: str
    timeframe: str
    # Pipeline outputs
    calendar: dict        # {paused, reason, resume_at}
    research: dict
    analysis: dict
    signal: dict          # {direction, confidence, entry, sl, tp, reason}
    risk: dict            # {approved, volume, multiplier, reason}
    execution: dict       # {ticket, price, volume, timestamp}
    # Control
    approved: bool        # human approval
    iteration: int        # research retry counter
    auto_approve: bool    # set by the runner; paper mode may auto-approve
    messages: list[str]   # audit trail


# ─── Nodes ────────────────────────────────────────────────────────────────────


def calendar_gate_node(state: TradingState) -> dict:
    """
    Pause trading around high-impact economic events.

    Ported from the threaded orchestrator's market-monitor worker, which was
    the only place this check lived. Without it the graph would happily open
    a position 30 seconds before a rate decision.
    """
    messages = list(state.get("messages", []))
    calendar: dict[str, Any] = {"paused": False, "reason": "", "resume_at": None}

    # The kill switch is checked first and costs nothing: it is the
    # mechanism for stopping trading without a restart, so it must take
    # effect before any research or broker work happens.
    try:
        try:
            from scripts.lifecycle import KillSwitch
        except ImportError:
            from lifecycle import KillSwitch

        switch = KillSwitch.from_config(_load_config())
        if switch.engaged:
            calendar["paused"] = True
            calendar["reason"] = switch.describe()
            messages.append(f"[safety] {switch.describe()}")
            return {"calendar": calendar, "messages": messages}
    except Exception as exc:
        messages.append(f"[safety] kill-switch check skipped ({exc})")

    try:
        try:
            from scripts.economic_calendar import EconomicCalendar
        except ImportError:
            from economic_calendar import EconomicCalendar

        cal = EconomicCalendar()
        if cal.should_pause_trading():
            calendar["paused"] = True
            calendar["reason"] = "High-impact economic event approaching"
            resume_at = getattr(cal, "pause_until", None)
            calendar["resume_at"] = resume_at.isoformat() if resume_at else None
            messages.append(
                f"[calendar] trading paused until {calendar['resume_at'] or 'event passes'}"
            )
        else:
            messages.append("[calendar] clear")
    except Exception as exc:
        # A calendar that cannot be read must not silently open the gate;
        # say so in the audit trail and continue, matching the old behaviour.
        messages.append(f"[calendar] check skipped ({exc})")

    return {"calendar": calendar, "messages": messages}


def research_node(state: TradingState) -> dict:
    """AI-powered market research: news + macro sentiment."""
    symbol = state.get("symbol", "XAUUSD")
    iteration = state.get("iteration", 0)
    messages = list(state.get("messages", []))
    messages.append(f"[research] iteration={iteration + 1}")

    research: dict[str, Any] = {"timestamp": _now()}
    try:
        try:
            from scripts.ai_researcher import AIResearcher
        except ImportError:
            from ai_researcher import AIResearcher

        researcher = AIResearcher(config=_load_config())
        sentiment = researcher.get_market_sentiment(symbol)
        research["sentiment"] = _plain(sentiment)
        research["summary"] = str(sentiment.get("summary", ""))
        messages.append(f"[research] sentiment={sentiment.get('overall', 'neutral')}")
    except Exception as exc:
        research["error"] = str(exc)
        research["sentiment"] = {"overall": "neutral", "score": 0.0}
        messages.append(f"[research] fallback (error: {exc})")

    return {"research": research, "iteration": iteration + 1, "messages": messages}


def analyze_node(state: TradingState) -> dict:
    """
    Turn research into a signal, blending news sentiment with the technical
    confluence read off the broker.

    The original version used sentiment alone. Technical confluence was
    computed elsewhere and never reached the graph, so the pipeline ignored
    half of the system's own signal machinery.
    """
    symbol = state.get("symbol", "XAUUSD")
    messages = list(state.get("messages", []))

    analysis: dict[str, Any] = {}
    sentiment_score = 0.0
    sentiment_label = "neutral"
    have_sentiment = False

    # --- news sentiment ---------------------------------------------------
    try:
        try:
            from scripts.sentiment_analyzer import SentimentAnalyzer
        except ImportError:
            from sentiment_analyzer import SentimentAnalyzer

        research = state.get("research", {})
        text = research.get("summary", "") or str(research.get("sentiment", ""))
        if text:
            result = SentimentAnalyzer().analyze_text(text, use_ai=True)
            if hasattr(result, "score"):
                sentiment_score = float(result.score)
                sentiment_label = getattr(result, "label", "neutral")
            elif isinstance(result, dict):
                sentiment_score = float(result.get("score", 0.0))
                sentiment_label = result.get("label", "neutral")
            have_sentiment = True
            analysis["sentiment"] = {"score": sentiment_score, "label": sentiment_label}
            messages.append(f"[analyze] sentiment={sentiment_label} ({sentiment_score:+.2f})")
    except Exception as exc:
        messages.append(f"[analyze] sentiment unavailable ({exc})")

    # --- technical confluence --------------------------------------------
    confluence = 0.0
    have_technical = False
    try:
        try:
            from scripts.advanced_trader import AdvancedTrader
        except ImportError:
            from advanced_trader import AdvancedTrader

        mtf = _plain(AdvancedTrader(config=_load_config()).multi_timeframe_analysis(symbol))
        confluence = float(mtf.get("confluence_score", 0.0))
        have_technical = True
        analysis["technical"] = mtf
        messages.append(
            f"[analyze] confluence={confluence:+.2f} ({mtf.get('overall_signal', 'neutral')})"
        )
    except Exception as exc:
        messages.append(f"[analyze] technical unavailable ({exc})")

    # --- blend ------------------------------------------------------------
    # Both inputs already sit on -1..+1. Average the ones we actually have,
    # rather than treating a missing input as a neutral vote, which would
    # halve the confidence of a perfectly good single-source signal.
    parts = []
    if have_sentiment:
        parts.append(sentiment_score)
    if have_technical:
        parts.append(confluence)
    blended = sum(parts) / len(parts) if parts else 0.0

    # Agreement bonus: two independent sources pointing the same way is
    # worth more than either alone.
    agreement = 1.0
    if len(parts) == 2 and (parts[0] > 0) == (parts[1] > 0) and parts[0] != 0:
        agreement = 1.15

    confidence = min(abs(blended) * agreement, 0.95)
    if blended > 0.15:
        direction = "BUY"
    elif blended < -0.15:
        direction = "SELL"
    else:
        direction = "HOLD"
        confidence = min(confidence, 0.3)

    signal = {
        "direction": direction,
        "confidence": round(confidence, 4),
        "entry": None,
        "sl": None,
        "tp": None,
        "sources": len(parts),
        "reason": (
            f"blend={blended:+.2f} from "
            + ", ".join(
                filter(None, [
                    f"sentiment {sentiment_score:+.2f}" if have_sentiment else "",
                    f"confluence {confluence:+.2f}" if have_technical else "",
                ])
            )
            or "no signal sources available"
        ),
    }
    analysis["blend"] = {"value": blended, "agreement": agreement, "sources": len(parts)}
    messages.append(f"[analyze] signal={direction} confidence={confidence:.2f}")

    return {"analysis": _plain(analysis), "signal": _plain(signal), "messages": messages}


def validate_node(state: TradingState) -> dict:
    """
    Risk validation: confidence gate, position sizing, and can_trade.

    The original implementation read ``risk_multiplier`` from a fallback dict
    that returns ``multiplier``, so with the AI unavailable the key was
    missing, the default 0 lost the comparison, and every trade was rejected.
    Sizing is now done by RiskManager rather than a hard-coded 0.01 lots.
    """
    messages = list(state.get("messages", []))
    signal = state.get("signal", {})
    symbol = state.get("symbol", "XAUUSD")
    confidence = float(signal.get("confidence", 0.0))

    risk: dict[str, Any] = {
        "approved": False, "multiplier": 1.0, "volume": 0.0, "reason": "",
    }

    if signal.get("direction") == "HOLD":
        risk["reason"] = "Signal is HOLD"
        messages.append("[validate] HOLD — nothing to size")
        return {"risk": risk, "messages": messages}

    # Check the cheap gate first. A signal under the confidence floor cannot
    # be approved no matter what the risk layer says, so spending an AI call
    # and a broker connection on it is pure waste.
    if confidence < CONFIDENCE_FLOOR:
        risk["reason"] = f"Confidence {confidence:.2f} below the {CONFIDENCE_FLOOR:.2f} floor"
        messages.append(f"[validate] rejected — {risk['reason']}")
        return {"risk": risk, "messages": messages}

    try:
        try:
            from scripts.risk_manager import RiskManager
            from scripts.mt5_manager import MT5Manager
        except ImportError:
            from risk_manager import RiskManager
            from mt5_manager import MT5Manager

        cfg = _load_config()
        rm = RiskManager(config=cfg)

        # Optional AI risk multiplier. Accept either key — the AI path
        # returns risk_multiplier, the static fallback returns multiplier.
        try:
            rec = rm.get_dynamic_risk_recommendation(str(signal))
            multiplier = float(rec.get("risk_multiplier", rec.get("multiplier", 1.0)))
        except Exception:
            multiplier = 1.0
        multiplier = max(0.1, min(multiplier, 1.5))
        risk["multiplier"] = multiplier

        stop_distance = float(cfg.get("trading", {}).get("default_stop_distance", 5.0))

        with MT5Manager(config=cfg) as broker:
            account = broker.get_account_info() or {}
            positions = broker.get_positions(symbol)
            balance = float(account.get("balance", 0.0))

            # Price is needed before sizing so the entry budget's margin cap
            # can be applied — margin depends on price, risk does not.
            tick = broker.get_tick(symbol)
            entry_price = None
            if tick:
                entry_price = tick["ask"] if signal["direction"] == "BUY" else tick["bid"]

            if rm.entry_budget > 0 and entry_price:
                check = rm.entry_feasibility(entry_price, symbol=symbol)
                risk["entry_budget"] = rm.entry_budget
                risk["margin_required"] = round(
                    check["min_margin"], 2) if not check["feasible"] else None
                if not check["feasible"]:
                    risk["reason"] = check["reason"]
                    messages.append(f"[validate] rejected — {check['reason']}")
                    return {"risk": risk, "messages": messages}

            # Scale the risk budget by the multiplier, then size once. A
            # multiplier below 1.0 shrinks the position; it can never make
            # the trade larger than the configured risk-per-trade allows,
            # because the multiplier is clamped to 1.5 and can_trade below
            # still enforces the hard caps.
            volume = rm.calculate_position_size(
                balance * multiplier, stop_distance=stop_distance, symbol=symbol,
                price=entry_price,
            )

            if volume <= 0:
                risk["reason"] = (
                    f"Risk budget cannot fund the minimum volume at a "
                    f"${stop_distance:.2f} stop"
                )
                messages.append(f"[validate] rejected — {risk['reason']}")
                return {"risk": risk, "messages": messages}

            allowed, reason = rm.can_trade(
                symbol, signal["direction"], volume,
                account_info=account, positions=positions,
                stop_distance=stop_distance,
            )
            risk["volume"] = volume
            risk["approved"] = bool(allowed)
            risk["reason"] = reason

            if entry_price and allowed:
                entry = entry_price
                sign = 1.0 if signal["direction"] == "BUY" else -1.0
                signal = {
                    **signal,
                    "entry": entry,
                    "sl": round(entry - sign * stop_distance, 2),
                    # 2R target
                    "tp": round(entry + sign * stop_distance * 2, 2),
                }

        messages.append(
            f"[validate] volume={risk['volume']} multiplier={multiplier:.2f} "
            f"approved={risk['approved']} ({reason})"
        )
    except Exception as exc:
        # Fall back to the confidence gate alone. Never approve on error.
        risk["approved"] = False
        risk["reason"] = f"Risk validation failed: {exc}"
        messages.append(f"[validate] error — refusing to trade ({exc})")

    return {"risk": risk, "signal": signal, "messages": messages}


def human_review_node(state: TradingState) -> dict:
    """Human-in-the-loop gate. Pauses the graph until the user responds."""
    signal = state.get("signal", {})
    risk = state.get("risk", {})
    symbol = state.get("symbol", "XAUUSD")

    summary = (
        f"\n{'=' * 52}\n"
        f"  ClawGold — Trade Approval Required\n"
        f"{'=' * 52}\n"
        f"  Symbol    : {symbol}\n"
        f"  Direction : {signal.get('direction')}\n"
        f"  Confidence: {signal.get('confidence', 0):.1%}\n"
        f"  Volume    : {risk.get('volume', 0)} lots\n"
        f"  Entry     : {signal.get('entry')}\n"
        f"  Stop      : {signal.get('sl')}\n"
        f"  Target    : {signal.get('tp')}\n"
        f"  Reason    : {signal.get('reason', '')}\n"
        f"  Risk Mult : {risk.get('multiplier', 1.0):.2f}x\n"
        f"{'=' * 52}\n"
    )

    approved: bool = interrupt(summary)

    messages = list(state.get("messages", []))
    messages.append(f"[human_review] approved={approved}")
    return {"approved": bool(approved), "messages": messages}


def execute_node(state: TradingState) -> dict:
    """
    Place the order through the Broker interface.

    The previous implementation called ``mt5.connect()`` and
    ``mt5.place_order()``, neither of which existed on MT5Manager, so every
    execution raised AttributeError into the except block and no trade was
    ever placed.
    """
    signal = state.get("signal", {})
    risk = state.get("risk", {})
    symbol = state.get("symbol", "XAUUSD")
    messages = list(state.get("messages", []))

    execution: dict[str, Any] = {"timestamp": _now()}

    try:
        try:
            from scripts.mt5_manager import MT5Manager
        except ImportError:
            from mt5_manager import MT5Manager

        volume = float(risk.get("volume", 0.0))
        direction = signal.get("direction", "HOLD")

        if volume <= 0 or direction not in ("BUY", "SELL"):
            execution["error"] = f"Nothing to execute (direction={direction}, volume={volume})"
            messages.append(f"[execute] skipped — {execution['error']}")
            return {"execution": execution, "messages": messages}

        with MT5Manager(config=_load_config()) as broker:
            result = broker.execute_trade(
                direction, volume, symbol=symbol,
                sl=signal.get("sl"), tp=signal.get("tp"),
            )
            execution.update(_plain(result))
            execution["live"] = broker.is_live

            if result.get("success"):
                messages.append(
                    f"[execute] {'LIVE' if broker.is_live else 'paper'} "
                    f"ticket={result.get('ticket')} vol={result.get('volume')} "
                    f"at {result.get('price')}"
                )
            else:
                messages.append(f"[execute] rejected — {result.get('error')}")
    except Exception as exc:
        execution["error"] = str(exc)
        execution["success"] = False
        messages.append(f"[execute] error: {exc}")

    return {"execution": execution, "messages": messages}


def monitor_node(state: TradingState) -> dict:
    """Notify, and broadcast to the signal service when configured."""
    messages = list(state.get("messages", []))
    execution = state.get("execution", {})
    signal = state.get("signal", {})
    # `symbol` was read from an undefined local here, raising NameError into
    # the except block and taking the whole business flow down with it.
    symbol = state.get("symbol", "XAUUSD")

    if not execution.get("success"):
        messages.append("[monitor] nothing executed — skipping notifications")
        return {"messages": messages}

    cfg = _load_config()

    # -- Telegram ----------------------------------------------------------
    try:
        try:
            from scripts.notifier import Notifier
        except ImportError:
            from notifier import Notifier

        tg = cfg.get("telegram", {})
        if tg.get("enabled") and tg.get("bot_token"):
            # Notifier takes bot_token/chat_id, not config, and exposes
            # send_trade_executed rather than a generic send().
            notifier = Notifier(bot_token=tg.get("bot_token"), chat_id=tg.get("chat_id"))
            notifier.send_trade_executed(
                symbol=symbol,
                action=signal.get("direction", "N/A"),
                volume=execution.get("volume", 0),
                price=execution.get("price", 0),
            )
            messages.append("[monitor] telegram notified")
        else:
            messages.append("[monitor] telegram disabled — not notifying")
    except Exception as exc:
        messages.append(f"[monitor] telegram skipped ({exc})")

    # -- Signal service broadcast -----------------------------------------
    try:
        try:
            from scripts.signal_service import SignalService
        except ImportError:
            from signal_service import SignalService

        service = SignalService(
            db_path=cfg.get("signal_service", {}).get("db_path", "data/signal_service.db"),
            config=cfg,
        )
        if any(service.TIER_CHANNELS.values()):
            # Keyword names must match broadcast_signal's signature: it takes
            # `action` and `entry_price`, not `direction` and `entry`.
            sent = service.broadcast_signal(
                symbol=symbol,
                action=signal.get("direction", "HOLD"),
                entry_price=execution.get("price", 0.0),
                stop_loss=signal.get("sl"),
                take_profit=signal.get("tp"),
                confidence=signal.get("confidence", 0.0),
                ai_reasoning=signal.get("reason"),
            )
            messages.append(f"[monitor] broadcast to {sent} subscriber(s)")
        else:
            messages.append("[monitor] no signal channels configured — no broadcast")
    except Exception as exc:
        messages.append(f"[monitor] broadcast skipped ({exc})")

    logger.info("Pipeline complete | execution=%s", execution)
    return {"messages": messages}


def learn_node(state: TradingState) -> dict:
    """
    Feed the run back into adaptive learning.

    Ported from the threaded orchestrator's learning worker, which was the
    only consumer of AdaptiveLearning. Without this the graph had no
    feedback loop at all.
    """
    messages = list(state.get("messages", []))
    execution = state.get("execution", {})

    if not execution.get("success"):
        return {"messages": messages}

    try:
        try:
            from scripts.adaptive_learning import AdaptiveLearning
        except ImportError:
            from adaptive_learning import AdaptiveLearning

        learner = AdaptiveLearning()
        insights = learner.analyze_performance(days=30)
        win_rate = insights.get("win_rate")
        if win_rate is not None:
            messages.append(f"[learn] 30d win rate {win_rate:.1%}")
        else:
            messages.append("[learn] performance recorded")
    except Exception as exc:
        messages.append(f"[learn] skipped ({exc})")

    return {"messages": messages}


# ─── Routing ──────────────────────────────────────────────────────────────────


def route_after_calendar(state: TradingState) -> Literal["research", "__end__"]:
    """Stop the run entirely while trading is paused for an event."""
    if state.get("calendar", {}).get("paused"):
        logger.info("Trading paused by the economic calendar — ending run")
        return "__end__"
    return "research"


def route_after_validate(state: TradingState) -> Literal["human_review", "research", "__end__"]:
    """Retry research on low confidence, end on HOLD or a risk rejection."""
    signal = state.get("signal", {})
    risk = state.get("risk", {})
    direction = signal.get("direction", "HOLD")
    confidence = float(signal.get("confidence", 0.0))
    iteration = int(state.get("iteration", 0))

    if direction == "HOLD":
        return "__end__"

    if confidence < CONFIDENCE_FLOOR:
        if iteration >= 3:
            logger.warning("Max research retries reached — skipping trade")
            return "__end__"
        return "research"

    # A risk rejection is final: more research will not change the account
    # balance or the position count that caused it.
    if not risk.get("approved"):
        logger.info("Risk layer rejected the trade: %s", risk.get("reason"))
        return "__end__"

    return "human_review"


def route_after_human(state: TradingState) -> Literal["execute", "__end__"]:
    return "execute" if state.get("approved") else "__end__"


# ─── Build Graph ──────────────────────────────────────────────────────────────


def build_graph(checkpointer=None):
    """Build and compile the trading pipeline graph."""
    if not LANGGRAPH_AVAILABLE:
        raise RuntimeError(
            f"LangGraph is not installed ({LANGGRAPH_IMPORT_ERROR}). "
            "Run: pip install langgraph"
        )

    builder = StateGraph(TradingState)

    builder.add_node("calendar_gate", calendar_gate_node)
    builder.add_node("research", research_node)
    builder.add_node("analyze", analyze_node)
    builder.add_node("validate", validate_node)
    builder.add_node("human_review", human_review_node)
    builder.add_node("execute", execute_node)
    builder.add_node("monitor", monitor_node)
    builder.add_node("learn", learn_node)

    builder.add_edge(START, "calendar_gate")
    builder.add_conditional_edges(
        "calendar_gate", route_after_calendar,
        {"research": "research", "__end__": END},
    )
    builder.add_edge("research", "analyze")
    builder.add_edge("analyze", "validate")
    builder.add_conditional_edges(
        "validate", route_after_validate,
        {"human_review": "human_review", "research": "research", "__end__": END},
    )
    builder.add_conditional_edges(
        "human_review", route_after_human,
        {"execute": "execute", "__end__": END},
    )
    builder.add_edge("execute", "monitor")
    builder.add_edge("monitor", "learn")
    builder.add_edge("learn", END)

    return builder.compile(
        checkpointer=checkpointer or MemorySaver(),
        interrupt_before=["human_review"],
    )


# ─── Runner ───────────────────────────────────────────────────────────────────


def run_pipeline(
    symbol: str = "XAUUSD",
    timeframe: str = "H1",
    auto_approve: Optional[bool] = None,
    thread_id: str | None = None,
) -> dict:
    """
    Run the full trading pipeline.

    Args:
        symbol: Trading symbol.
        timeframe: Chart timeframe label, carried through for reporting.
        auto_approve: Skip the human gate. Defaults to True in paper mode
            and False in live mode — auto-approving real orders has to be an
            explicit choice, never something inherited from a default.
        thread_id: LangGraph checkpoint thread ID.

    Returns:
        The final TradingState as a plain dict.
    """
    try:
        from scripts.broker import resolve_mode
    except ImportError:
        from broker import resolve_mode

    cfg = _load_config()
    is_live = resolve_mode(cfg) == "real"
    if auto_approve is None:
        auto_approve = not is_live

    if auto_approve and is_live:
        logger.warning("auto_approve is on in LIVE mode — orders will be placed unattended")

    graph = build_graph()
    run_config = {
        "configurable": {
            "thread_id": thread_id or f"{symbol}-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
        }
    }

    initial: TradingState = {
        "symbol": symbol,
        "timeframe": timeframe,
        "iteration": 0,
        "auto_approve": auto_approve,
        "messages": [f"Pipeline started {_now()} (mode={'live' if is_live else 'paper'})"],
    }

    snapshot = graph.invoke(initial, run_config)

    state = graph.get_state(run_config)
    if state.next == ("human_review",):
        if auto_approve:
            print("\n[auto_approve] Approving automatically (paper mode).")
            approved = True
        else:
            interrupts = snapshot.get("__interrupt__") or [{}]
            value = getattr(interrupts[0], "value", None) or "Approve trade?"
            print(value)
            approved = input("Approve? [yes/no]: ").strip().lower() in ("yes", "y")
        final = graph.invoke(Command(resume=approved), run_config)
    else:
        final = snapshot

    return dict(final)


# ─── CLI Entry ────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import sys

    sym = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "XAUUSD"
    tf = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("-") else "H1"
    auto = "--auto" in sys.argv

    result = run_pipeline(sym, tf, auto_approve=auto or None)

    print("\n=== Pipeline Result ===")
    print(json.dumps(
        {k: v for k, v in result.items() if k != "messages"},
        indent=2, default=str,
    ))
    print("\n=== Audit Trail ===")
    for msg in result.get("messages", []):
        print(" ", msg)
