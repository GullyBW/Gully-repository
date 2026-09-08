"""
Risk Manager
============
Manages trading risk limits and validates trades against risk rules.
"""

from typing import Tuple, Optional, Any, Dict
from dataclasses import dataclass
from logger import get_logger

# Every price-to-money conversion comes from the instrument contract spec,
# so risk numbers here match what the broker will actually charge.
try:
    from .instrument import money_risk, normalize_volume, pips_to_price, position_size
except ImportError:
    from instrument import money_risk, normalize_volume, pips_to_price, position_size

try:
    from agent_executor import AgentExecutor
    AGENT_AVAILABLE = True
except ImportError:
    AGENT_AVAILABLE = False

logger = get_logger(__name__)


@dataclass
class RiskLimits:
    """Risk limit configuration."""
    max_positions: int = 5
    max_daily_loss: float = 500.0  # USD
    max_position_size: float = 1.0  # lots
    max_total_risk: float = 0.05  # 5% of account
    min_margin_level: float = 100.0  # %


class RiskManager:
    """
    Manages trading risk and validates trades.
    
    Usage:
        rm = RiskManager(config)
        can_trade, reason = rm.can_trade('XAUUSD', 'BUY', 0.1)
        if not can_trade:
            print(f"Trade rejected: {reason}")
    """
    
    def __init__(self, config: dict):
        self.config = config
        self.limits = RiskLimits()
        self._load_limits()
        
        # Initialize AI Agent support for dynamic risk adjustment
        self.agent_executor = None
        if AGENT_AVAILABLE:
            try:
                self.agent_executor = AgentExecutor(config)
            except Exception:
                pass

    def get_dynamic_risk_recommendation(self, market_context: str) -> Dict[str, Any]:
        """
        Ask AI to recommend risk parameters based on market context (macro/volatility).
        """
        if not self.agent_executor:
            return {"multiplier": 1.0, "reason": "AI not available"}
            
        prompt = f"""
        Analyze current XAUUSD market context and recommend a risk multiplier (0.5 to 1.5).
        If the market is high-risk (macro events, extreme volatility), reduce risk (< 1.0).
        If the market is stable/trending with clear signals, maintain or slightly increase risk.
        
        Market Context: {market_context}
        
        Respond ONLY with a JSON object:
        - "risk_multiplier": float (e.g. 0.8)
        - "max_position_size_override": float or null
        - "daily_loss_limit_adjustment": float (USD)
        - "reasoning": string
        """
        
        try:
            result = self.agent_executor.run_best(prompt, task_name="risk_optimization")
            if result.get('success'):
                # Extract JSON logic simplified for brevity here, mirroring sentiment_analyzer pattern
                import json
                content = result.get('output', '')
                if "```json" in content: content = content.split("```json")[1].split("```")[0].strip()
                data = json.loads(content)
                return data
        except Exception as e:
            logger.error(f"Failed to get AI risk recommendation: {e}")
            
        return {"multiplier": 1.0, "reason": "Fallback to static limits"}
    
    def _load_limits(self):
        """Load risk limits from config."""
        risk_config = self.config.get('risk', {})
        self.limits.max_positions = risk_config.get('max_positions', 5)
        self.limits.max_daily_loss = risk_config.get('max_daily_loss', 500.0)
        self.limits.max_position_size = risk_config.get('max_position_size', 1.0)
        self.limits.max_total_risk = risk_config.get('max_total_risk', 0.05)
        self.limits.min_margin_level = risk_config.get('min_margin_level', 100.0)
    
    def can_trade(self, symbol: str, action: str, volume: float,
                  account_info: dict = None, positions: list = None,
                  stop_distance: Optional[float] = None,
                  daily_pnl: Optional[float] = None) -> Tuple[bool, str]:
        """
        Check whether a trade is allowed under the configured risk limits.

        Args:
            symbol: Trading symbol.
            action: BUY or SELL.
            volume: Trade volume in lots.
            account_info: Current account information.
            positions: Currently open positions.
            stop_distance: Distance to the stop in price units (USD/oz for
                gold). Defaults to ``trading.default_stop_distance``. This
                is what makes the risk figure real: money at risk is a
                function of the stop, not of the volume alone.
            daily_pnl: Realised P&L so far today, if the caller tracks it.
                When supplied, the daily loss limit is enforced here rather
                than only in a separate call the execution path could skip.

        Returns:
            (allowed, reason)
        """
        if volume <= 0:
            return False, "Volume must be greater than zero"

        # Position size limit
        if volume > self.limits.max_position_size:
            return False, f"Volume {volume} exceeds max position size {self.limits.max_position_size}"

        # Concurrent position count
        if positions and len(positions) >= self.limits.max_positions:
            return False, f"Max positions ({self.limits.max_positions}) reached"

        # Daily loss limit — checked here so no execution path can bypass it
        if daily_pnl is not None:
            allowed, reason = self.check_daily_loss(daily_pnl)
            if not allowed:
                return False, reason

        if account_info:
            # Margin level of 0 means "no open positions" in MT5 (and in the
            # paper broker), which is healthy, not a margin call. Only apply
            # the floor when margin is actually in use.
            margin_level = account_info.get('margin_level', 0)
            if account_info.get('margin', 0) > 0 and margin_level < self.limits.min_margin_level:
                return False, (f"Margin level {margin_level:.2f}% below minimum "
                               f"{self.limits.min_margin_level}%")

            balance = account_info.get('balance', 0)
            risk_per_trade = self.config.get('trading', {}).get('risk_per_trade', 0.01)
            max_risk_amount = balance * risk_per_trade

            stop = stop_distance if stop_distance is not None else self._default_stop_distance()
            # Money at risk = volume x contract size x stop distance, from the
            # instrument's contract spec. The previous `volume * 100`
            # placeholder ignored the stop entirely, so it under-reported risk
            # for wide stops and over-reported it for tight ones.
            estimated_risk = money_risk(symbol, volume, stop)

            if estimated_risk > max_risk_amount:
                return False, (
                    f"Risk ${estimated_risk:.2f} at a ${stop:.2f} stop exceeds the "
                    f"${max_risk_amount:.2f} budget ({risk_per_trade:.1%} of ${balance:,.2f})"
                )

            # Total exposure across all open positions plus this one
            if positions:
                open_risk = sum(
                    money_risk(p.get('symbol', symbol), p.get('volume', 0), stop)
                    for p in positions
                )
                total_risk_cap = balance * self.limits.max_total_risk
                if open_risk + estimated_risk > total_risk_cap:
                    return False, (
                        f"Total risk ${open_risk + estimated_risk:.2f} would exceed the "
                        f"${total_risk_cap:.2f} cap ({self.limits.max_total_risk:.1%} of balance)"
                    )

        logger.info(f"Trade validated: {action} {volume} lots {symbol}")
        return True, "OK"

    def _default_stop_distance(self) -> float:
        """Stop distance in price units to assume when a caller gives none."""
        return float(self.config.get('trading', {}).get('default_stop_distance', 5.0))

    def calculate_position_size(self, account_balance: float,
                                stop_distance: Optional[float] = None,
                                symbol: Optional[str] = None,
                                stop_loss_pips: Optional[float] = None) -> float:
        """
        Largest volume whose loss at the stop stays inside the risk budget.

        Args:
            account_balance: Current account balance.
            stop_distance: Stop distance in price units (USD/oz for gold).
            symbol: Instrument; defaults to the configured trading symbol.
            stop_loss_pips: Deprecated alternative to `stop_distance`,
                converted using the instrument's pip size. Kept so existing
                callers keep working.

        Returns:
            Volume in lots, rounded down to the broker's volume step.

            Returns **0.0** when the budget cannot fund even the minimum
            volume. Callers must treat 0.0 as "do not trade" — the previous
            implementation clamped up to 0.01 lots with `max(volume, 0.01)`,
            which silently placed a trade larger than the risk budget
            allowed, exactly when the account could least afford it.
        """
        symbol = symbol or self.config.get('trading', {}).get('symbol', 'XAUUSD')
        risk_per_trade = self.config.get('trading', {}).get('risk_per_trade', 0.01)

        if stop_distance is None:
            if stop_loss_pips is not None:
                stop_distance = pips_to_price(symbol, stop_loss_pips)
            else:
                stop_distance = self._default_stop_distance()

        if stop_distance <= 0:
            logger.error("Stop distance must be positive; refusing to size a position")
            return 0.0

        volume = position_size(symbol, account_balance, risk_per_trade, stop_distance)

        # Never exceed the configured hard cap, whatever the budget allows.
        if volume > self.limits.max_position_size:
            volume = normalize_volume(symbol, self.limits.max_position_size)

        if volume <= 0:
            logger.warning(
                "Risk budget $%.2f cannot fund the minimum volume at a $%.2f stop — no trade",
                account_balance * risk_per_trade, stop_distance,
            )
        return volume
    
    def check_daily_loss(self, daily_pnl: float) -> Tuple[bool, str]:
        """
        Check if daily loss limit has been reached.
        
        Args:
            daily_pnl: Current daily profit/loss
        
        Returns:
            Tuple of (can_continue: bool, reason: str)
        """
        if daily_pnl < -self.limits.max_daily_loss:
            return False, f"Daily loss limit reached: ${abs(daily_pnl):.2f}"
        
        return True, "OK"
    
    def get_risk_summary(self, account_info: dict, positions: list) -> dict:
        """
        Generate risk summary for display.
        
        Args:
            account_info: Current account information
            positions: List of current positions
        
        Returns:
            Dictionary with risk metrics
        """
        balance = account_info.get('balance', 0)
        equity = account_info.get('equity', 0)
        margin = account_info.get('margin', 0)
        profit = account_info.get('profit', 0)
        margin_level = account_info.get('margin_level', 0)
        
        total_exposure = sum(p.get('volume', 0) for p in positions)
        
        return {
            'balance': balance,
            'equity': equity,
            'margin_used': margin,
            'margin_level': margin_level,
            'unrealized_pnl': profit,
            'total_positions': len(positions),
            'total_exposure': total_exposure,
            'risk_per_trade_pct': self.config['trading'].get('risk_per_trade', 0.01) * 100,
            'daily_loss_limit': self.limits.max_daily_loss,
            'max_position_size': self.limits.max_position_size,
            'margin_status': 'SAFE' if margin_level > 150 else 'WARNING' if margin_level > 100 else 'DANGER'
        }
