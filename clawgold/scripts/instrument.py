"""
Instrument contract specifications
==================================
Single source of truth for how a price movement converts into money.

The original risk code carried two contradictory rules of thumb
("1% move = $10 per 0.01 lot", "$10 per pip for 1 lot") and a placeholder
``estimated_risk = volume * 100``. Both are replaced by one explicit
contract spec per symbol, so every risk calculation derives from the same
numbers instead of a comment.

For XAUUSD a lot is 100 troy ounces, so a $1.00 move in the gold price is
worth $100 per lot. Everything below follows from that.

Usage:
    from instrument import get_spec, money_risk, position_size

    spec = get_spec("XAUUSD")
    money_risk("XAUUSD", volume=0.10, price_distance=8.50)   # -> 85.0 USD
    position_size("XAUUSD", balance=10_000, risk_fraction=0.01,
                  stop_distance=5.00)                        # -> 0.20 lots
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

from logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class ContractSpec:
    """
    How one lot of an instrument converts price movement into money.

    Attributes:
        symbol: Broker symbol.
        contract_size: Units of the underlying per 1.00 lot.
            XAUUSD = 100 troy ounces.
        point: Smallest quoted price increment (the broker's "point").
        pip: The conventional "pip" for this instrument. For gold most
            brokers call 0.10 a pip; this is recorded explicitly rather
            than assumed, because it is the number people get wrong.
        min_volume / max_volume / volume_step: Broker volume constraints.
        digits: Price decimal places, used for rounding quotes.
        quote_currency: Currency the P&L lands in.
    """

    symbol: str
    contract_size: float
    point: float
    pip: float
    min_volume: float
    max_volume: float
    volume_step: float
    digits: int
    quote_currency: str = "USD"

    @property
    def value_per_price_unit(self) -> float:
        """Money per 1.00 of price movement, per 1.00 lot."""
        return self.contract_size

    @property
    def value_per_pip(self) -> float:
        """Money per pip, per 1.00 lot."""
        return self.contract_size * self.pip

    @property
    def value_per_point(self) -> float:
        """Money per point, per 1.00 lot."""
        return self.contract_size * self.point


# Specs are deliberately conservative defaults. A broker can quote gold with
# 2 or 3 digits and can set its own volume step, so `refresh_from_broker`
# below overwrites these from live symbol_info when a real connection exists.
_SPECS: Dict[str, ContractSpec] = {
    "XAUUSD": ContractSpec(
        symbol="XAUUSD",
        contract_size=100.0,   # 100 troy ounces per lot
        point=0.01,
        pip=0.10,
        min_volume=0.01,
        max_volume=100.0,
        volume_step=0.01,
        digits=2,
    ),
    "XAGUSD": ContractSpec(
        symbol="XAGUSD",
        contract_size=5000.0,  # 5,000 troy ounces per lot
        point=0.001,
        pip=0.01,
        min_volume=0.01,
        max_volume=100.0,
        volume_step=0.01,
        digits=3,
    ),
    "EURUSD": ContractSpec(
        symbol="EURUSD",
        contract_size=100_000.0,
        point=0.00001,
        pip=0.0001,
        min_volume=0.01,
        max_volume=100.0,
        volume_step=0.01,
        digits=5,
    ),
}

_DEFAULT_SYMBOL = "XAUUSD"


def get_spec(symbol: Optional[str] = None) -> ContractSpec:
    """
    Look up a contract spec, falling back to XAUUSD.

    Unknown symbols fall back rather than raising, because the caller is
    usually deep inside a trading loop. The fallback is logged so it is
    visible rather than silent.
    """
    key = (symbol or _DEFAULT_SYMBOL).upper()
    spec = _SPECS.get(key)
    if spec is None:
        logger.warning(
            "No contract spec for %s — falling back to %s. "
            "Add one to instrument.py before trading it.",
            key, _DEFAULT_SYMBOL,
        )
        return _SPECS[_DEFAULT_SYMBOL]
    return spec


def register_spec(spec: ContractSpec) -> None:
    """Add or replace a spec at runtime."""
    _SPECS[spec.symbol.upper()] = spec


def apply_config_overrides(config: Dict[str, Any]) -> None:
    """
    Override contract specs from ``instruments:`` in config.yaml.

    Brokers differ on the two numbers that decide whether a small account
    can trade at all: the minimum volume and the volume step. A standard
    account will not go below 0.01 lots; cent and micro accounts often
    accept 0.001. Because that is a per-broker fact, it belongs in config
    rather than hard-coded here.

        instruments:
          XAUUSD:
            min_volume: 0.001
            volume_step: 0.001
    """
    overrides = (config or {}).get("instruments") or {}
    for symbol, values in overrides.items():
        if not isinstance(values, dict):
            continue
        base = get_spec(symbol)
        register_spec(ContractSpec(
            symbol=symbol.upper(),
            contract_size=float(values.get("contract_size", base.contract_size)),
            point=float(values.get("point", base.point)),
            pip=float(values.get("pip", base.pip)),
            min_volume=float(values.get("min_volume", base.min_volume)),
            max_volume=float(values.get("max_volume", base.max_volume)),
            volume_step=float(values.get("volume_step", base.volume_step)),
            digits=int(values.get("digits", base.digits)),
            quote_currency=values.get("quote_currency", base.quote_currency),
        ))
        logger.info(
            "Contract spec for %s overridden from config: min_volume=%s step=%s",
            symbol.upper(), values.get("min_volume", base.min_volume),
            values.get("volume_step", base.volume_step),
        )


def refresh_from_broker(symbol: str, symbol_info: object) -> ContractSpec:
    """
    Overwrite a spec from a broker's live symbol_info.

    The broker is authoritative about contract size, digits and volume
    steps. Called by MT5Broker on connect so live trading never relies on
    the hard-coded defaults above.
    """
    base = get_spec(symbol)

    def pick(attr: str, default: float) -> float:
        value = getattr(symbol_info, attr, None)
        return float(value) if value else default

    digits = int(pick("digits", base.digits))
    point = pick("point", base.point)
    spec = ContractSpec(
        symbol=symbol.upper(),
        contract_size=pick("trade_contract_size", base.contract_size),
        point=point,
        # A 3-digit gold quote makes a pip 10 points; a 2-digit quote makes
        # the point and the pip the same thing.
        pip=point * 10 if digits in (3, 5) else point,
        min_volume=pick("volume_min", base.min_volume),
        max_volume=pick("volume_max", base.max_volume),
        volume_step=pick("volume_step", base.volume_step),
        digits=digits,
        quote_currency=getattr(symbol_info, "currency_profit", base.quote_currency),
    )
    register_spec(spec)
    logger.info(
        "Contract spec for %s refreshed from broker: contract_size=%s digits=%s step=%s",
        spec.symbol, spec.contract_size, spec.digits, spec.volume_step,
    )
    return spec


# ─────────────────────────────────────────────────────────────────────────────
# Money conversions — the only place price movement becomes USD
# ─────────────────────────────────────────────────────────────────────────────

def money_risk(symbol: str, volume: float, price_distance: float) -> float:
    """
    Money at stake if price moves `price_distance` against `volume` lots.

    Args:
        symbol: Broker symbol.
        volume: Position size in lots.
        price_distance: Distance in price units (for gold, dollars per ounce).

    Returns:
        Absolute exposure in the quote currency.
    """
    spec = get_spec(symbol)
    return abs(volume) * spec.contract_size * abs(price_distance)


def position_size(symbol: str, balance: float, risk_fraction: float,
                  stop_distance: float) -> float:
    """
    Largest volume whose loss at the stop stays within the risk budget.

    Args:
        symbol: Broker symbol.
        balance: Account balance in the quote currency.
        risk_fraction: Fraction of balance to risk, e.g. 0.01 for 1%.
        stop_distance: Stop distance in price units. Must be > 0.

    Returns:
        Volume in lots, rounded down to the broker's volume step and
        clamped to its min/max. Returns 0.0 when the budget cannot even
        cover the minimum volume — a caller must treat 0.0 as "do not
        trade", never as "use the minimum".
    """
    spec = get_spec(symbol)

    if stop_distance <= 0:
        raise ValueError("stop_distance must be greater than zero")
    if balance <= 0 or risk_fraction <= 0:
        return 0.0

    risk_budget = balance * risk_fraction
    loss_per_lot = spec.contract_size * stop_distance
    raw = risk_budget / loss_per_lot

    # Round DOWN to the volume step: rounding up would exceed the budget.
    steps = int(raw / spec.volume_step)
    volume = round(steps * spec.volume_step, 8)

    if volume < spec.min_volume:
        return 0.0
    return min(volume, spec.max_volume)


def required_margin(symbol: str, volume: float, price: float,
                    leverage: float) -> float:
    """
    Margin a broker will hold to open `volume` lots at `price`.

    Args:
        symbol: Broker symbol.
        volume: Position size in lots.
        price: Entry price.
        leverage: Account leverage, e.g. 500 for 1:500.

    Returns:
        Margin required in the quote currency.
    """
    spec = get_spec(symbol)
    return (abs(volume) * spec.contract_size * price) / max(leverage, 1.0)


def max_volume_for_margin(symbol: str, margin_budget: float, price: float,
                          leverage: float) -> float:
    """
    Largest volume whose margin fits inside `margin_budget`.

    This is the constraint that decides whether a small account can open a
    position at all. It is separate from — and often tighter than — the
    risk budget: risk asks "how much can I lose", margin asks "can I open
    it in the first place".

    Returns:
        Volume in lots, rounded down to the volume step. 0.0 when the
        budget cannot cover the broker's minimum volume.
    """
    spec = get_spec(symbol)
    if margin_budget <= 0 or price <= 0:
        return 0.0

    raw = (margin_budget * max(leverage, 1.0)) / (spec.contract_size * price)
    steps = int(raw / spec.volume_step)
    volume = round(steps * spec.volume_step, 8)

    if volume < spec.min_volume:
        return 0.0
    return min(volume, spec.max_volume)


def min_margin_to_trade(symbol: str, price: float, leverage: float) -> float:
    """Margin needed for the smallest position this broker will accept."""
    return required_margin(symbol, get_spec(symbol).min_volume, price, leverage)


def normalize_volume(symbol: str, volume: float) -> float:
    """Clamp a volume to the broker's step and bounds, rounding down."""
    spec = get_spec(symbol)
    if volume <= 0:
        return 0.0
    steps = int(volume / spec.volume_step)
    normalized = round(steps * spec.volume_step, 8)
    if normalized < spec.min_volume:
        return 0.0
    return min(normalized, spec.max_volume)


def pips_to_price(symbol: str, pips: float) -> float:
    """Convert a pip distance into a price distance."""
    return pips * get_spec(symbol).pip


def price_to_pips(symbol: str, price_distance: float) -> float:
    """Convert a price distance into pips."""
    return price_distance / get_spec(symbol).pip
