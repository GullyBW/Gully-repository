"""
Configuration Validator
=======================
Validates config.yaml for required fields and sane values.

Two severities, because they mean different things at deploy time:

    ERROR   — the system will not work. Blocks startup.
    WARNING — the system will work, but the setting is risky or unusual.
              Live trading with no stop distance, say, or a 20% risk per
              trade. Surfaced loudly, never silently.
"""

from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    from .config_loader import load_config
except ImportError:
    from config_loader import load_config


class ConfigValidator:
    """Validates ClawGold configuration."""

    REQUIRED_SECTIONS = ['trading', 'mt5', 'api', 'logging']
    TRADING_FIELDS = ['mode', 'symbol', 'risk_per_trade']
    MT5_FIELDS = ['login', 'password', 'server']

    # Simulation is the default and the safe mode; rejecting it made
    # `claw.py validate` fail on the config the repository ships.
    VALID_MODES = ['simulation', 'sim', 'paper', 'demo', 'backtest',
                   'real', 'live', 'remote', 'bridge']
    #: Modes that reach a real terminal with real money.
    LIVE_MODES = ['real', 'live', 'remote', 'bridge']
    #: Live via a bridge on another host, rather than a local terminal.
    REMOTE_MODES = ['remote', 'bridge']

    # Symbols the system has a contract spec for. Anything else can still
    # be traded, but sizing would fall back to the XAUUSD spec, which is
    # wrong for a different instrument — hence a warning, not an error.
    KNOWN_SYMBOLS = ['XAUUSD', 'XAGUSD', 'EURUSD', 'GOLD']

    def __init__(self, config_path: str = None):
        self.config_path = config_path or Path(__file__).parent.parent / "config.yaml"
        self.errors: List[str] = []
        self.warnings: List[str] = []

    # -- entry points -------------------------------------------------------

    def validate(self) -> List[str]:
        """Validate the config. Returns error messages (empty if valid)."""
        self.validate_all()
        return self.errors

    def validate_all(self) -> Tuple[List[str], List[str]]:
        """
        Validate and return (errors, warnings).

        Warnings are things a deployer should see but that do not stop the
        system running.
        """
        self.errors = []
        self.warnings = []

        try:
            config = load_config(str(self.config_path))
        except Exception as e:
            self.errors.append(f"Failed to load config: {e}")
            return self.errors, self.warnings

        if not config:
            self.errors.append("Config file is empty")
            return self.errors, self.warnings

        for section in self.REQUIRED_SECTIONS:
            if section not in config:
                self.errors.append(f"Missing required section: {section}")

        if self.errors:
            return self.errors, self.warnings

        trading = config.get('trading', {}) or {}
        self._validate_trading(trading)
        self._validate_risk(config.get('risk', {}) or {}, trading)
        self._validate_entry_budget(trading, config)
        self._validate_instruments(config.get('instruments', {}) or {})
        self._validate_free_mode(config.get('free_mode', {}) or {})
        self._validate_api(config.get('api', {}) or {})
        self._validate_logging(config.get('logging', {}) or {})
        self._validate_notifications(config)

        mode = str(trading.get('mode', '')).lower()
        if mode in self.REMOTE_MODES:
            self._validate_bridge((config.get('mt5', {}) or {}).get('bridge', {}) or {})
            self._validate_live_safety(trading, config)
        elif mode in self.LIVE_MODES:
            self._validate_mt5(config.get('mt5', {}) or {})
            self._validate_live_safety(trading, config)

        return self.errors, self.warnings

    def is_valid(self) -> bool:
        """True when there are no errors. Warnings do not block."""
        return len(self.validate()) == 0

    # -- sections -----------------------------------------------------------

    def _validate_trading(self, trading: Dict[str, Any]) -> None:
        for field in self.TRADING_FIELDS:
            if field not in trading:
                self.errors.append(f"Missing trading.{field}")

        mode = str(trading.get('mode', '')).lower()
        if mode and mode not in self.VALID_MODES:
            self.errors.append(
                f"Invalid trading.mode: {trading.get('mode')}. "
                f"Must be one of {self.VALID_MODES}"
            )

        risk = trading.get('risk_per_trade')
        if risk is not None:
            if not isinstance(risk, (int, float)):
                self.errors.append("trading.risk_per_trade must be a number")
            elif not 0 < risk <= 1:
                self.errors.append(
                    "trading.risk_per_trade must be greater than 0 and at most 1")
            elif risk > 0.05:
                self.warnings.append(
                    f"trading.risk_per_trade is {risk:.1%} per trade — "
                    "above 5% is aggressive; 1-2% is conventional")

        symbol = trading.get('symbol')
        if symbol and symbol not in self.KNOWN_SYMBOLS:
            self.warnings.append(
                f"trading.symbol '{symbol}' has no contract spec in "
                "scripts/instrument.py, so sizing will fall back to XAUUSD's "
                "(100 units per lot), which is wrong for most instruments. "
                "Add a spec or an instruments: override.")

        stop = trading.get('default_stop_distance')
        if stop is None:
            self.warnings.append(
                "trading.default_stop_distance is not set — sizing will assume "
                "5.0 price units, which may not suit your instrument")
        elif not isinstance(stop, (int, float)) or stop <= 0:
            self.errors.append("trading.default_stop_distance must be a positive number")

        leverage = trading.get('leverage')
        if leverage is not None and (not isinstance(leverage, (int, float)) or leverage < 1):
            self.errors.append("trading.leverage must be a number of at least 1")

    def _validate_risk(self, risk: Dict[str, Any], trading: Dict[str, Any]) -> None:
        numeric = {
            'max_positions': (1, 100),
            'max_daily_loss': (0, None),
            'max_position_size': (0, None),
            'max_total_risk': (0, 1),
            'min_margin_level': (0, None),
        }
        for field, (low, high) in numeric.items():
            if field not in risk:
                self.warnings.append(f"Missing risk.{field} — a built-in default will be used")
                continue
            value = risk[field]
            if not isinstance(value, (int, float)):
                self.errors.append(f"risk.{field} must be a number")
            elif value < low or (high is not None and value > high):
                self.errors.append(
                    f"risk.{field} must be between {low} and {high if high is not None else 'unbounded'}")

        per_trade = trading.get('risk_per_trade')
        total = risk.get('max_total_risk')
        if isinstance(per_trade, (int, float)) and isinstance(total, (int, float)):
            if per_trade > total:
                self.errors.append(
                    f"trading.risk_per_trade ({per_trade:.1%}) exceeds "
                    f"risk.max_total_risk ({total:.1%}) — a single trade would "
                    "breach the total exposure cap")

    def _validate_entry_budget(self, trading: Dict[str, Any], config: Dict[str, Any]) -> None:
        """Check that an entry budget, if set, can actually open a position."""
        budget = trading.get('entry_budget')
        if budget is None:
            return
        if not isinstance(budget, (int, float)) or budget < 0:
            self.errors.append("trading.entry_budget must be a non-negative number")
            return
        if budget == 0:
            return

        try:
            try:
                from .instrument import get_spec, min_margin_to_trade
            except ImportError:
                from instrument import get_spec, min_margin_to_trade

            symbol = trading.get('symbol', 'XAUUSD')
            leverage = float(trading.get('leverage', 100))
            # Use a representative price. The point is to catch an
            # impossible configuration at validation time, not to be exact.
            price = float(config.get('paper', {}).get('start_price') or 2650.0)
            needed = min_margin_to_trade(symbol, price, leverage)

            if budget < needed:
                spec = get_spec(symbol)
                self.errors.append(
                    f"trading.entry_budget of ${budget:,.2f} cannot open the "
                    f"smallest {symbol} position: {spec.min_volume} lots needs "
                    f"${needed:,.2f} margin at 1:{leverage:.0f} (price ~{price:,.0f}). "
                    f"Raise the budget, raise leverage, or lower "
                    f"instruments.{symbol}.min_volume. "
                    f"Run 'claw.py entry-check' for the full picture.")
        except Exception as exc:  # pragma: no cover - defensive
            self.warnings.append(f"Could not check entry budget feasibility: {exc}")

    def _validate_instruments(self, instruments: Dict[str, Any]) -> None:
        for symbol, values in instruments.items():
            if not isinstance(values, dict):
                self.errors.append(f"instruments.{symbol} must be a mapping")
                continue
            min_vol = values.get('min_volume')
            step = values.get('volume_step')
            for name, value in (('min_volume', min_vol), ('volume_step', step)):
                if value is not None and (not isinstance(value, (int, float)) or value <= 0):
                    self.errors.append(f"instruments.{symbol}.{name} must be a positive number")
            if isinstance(min_vol, (int, float)) and isinstance(step, (int, float)):
                if step > min_vol:
                    self.warnings.append(
                        f"instruments.{symbol}.volume_step ({step}) is larger than "
                        f"min_volume ({min_vol}) — the minimum may be unreachable")

    def _validate_free_mode(self, free_mode: Dict[str, Any]) -> None:
        if not free_mode:
            return
        for field in ('enabled', 'allow_paid_llm_fallback', 'skip_ai_research', 'strict'):
            if field in free_mode and not isinstance(free_mode[field], bool):
                self.errors.append(f"free_mode.{field} must be true or false")

        if free_mode.get('enabled') and free_mode.get('allow_paid_llm_fallback'):
            self.warnings.append(
                "free_mode.enabled is true but allow_paid_llm_fallback is also "
                "true — billed API calls are permitted, so this is not free")

    def _validate_mt5(self, mt5: Dict[str, Any]) -> None:
        for field in self.MT5_FIELDS:
            if field not in mt5:
                self.errors.append(
                    f"Missing MT5 credential '{field}' (set in .env as MT5_{field.upper()})")

        login = mt5.get('login')
        if login is not None and not isinstance(login, int):
            self.errors.append("mt5.login must be an integer")
        elif not login:
            self.errors.append(
                "trading.mode is live but mt5.login is 0 or empty — "
                "set MT5_LOGIN in .env")

        if not mt5.get('password'):
            self.errors.append("trading.mode is live but no MT5 password is set")
        if not mt5.get('server'):
            self.errors.append("trading.mode is live but no MT5 server is set")

    def _validate_bridge(self, bridge: Dict[str, Any]) -> None:
        """
        Check the remote-bridge settings.

        This path exists because MetaTrader5 has no macOS or Linux build, so
        a Mac reaches a live terminal through a bridge. The bridge can place
        real trades, so an unauthenticated or misconfigured one is an error
        rather than a warning.
        """
        url = str(bridge.get('url', '') or '').strip()
        token = str(bridge.get('token', '') or '')

        if not url:
            self.errors.append(
                "trading.mode is 'remote' but mt5.bridge.url is not set "
                "(or MT5_BRIDGE_URL in .env). Start the bridge on the MT5 host "
                "with scripts/mt5_bridge_server.py — see docs/MACOS.md.")
        elif not url.startswith(("http://", "https://")):
            self.errors.append(
                f"mt5.bridge.url must start with http:// or https:// — got {url!r}")

        if not token:
            self.errors.append(
                "trading.mode is 'remote' but no mt5.bridge.token is set "
                "(or MT5_BRIDGE_TOKEN in .env). The bridge can place real "
                "trades and rejects unauthenticated requests.")
        elif len(token) < 16:
            self.warnings.append(
                f"mt5.bridge.token is only {len(token)} characters — generate a "
                "strong one with: python -c \"import secrets; "
                "print(secrets.token_urlsafe(32))\"")

        # Plain HTTP to a remote host means the token, and every order,
        # crosses the network in the clear.
        if url.startswith("http://") and not any(
                host in url for host in ("127.0.0.1", "localhost", "::1")):
            self.warnings.append(
                f"mt5.bridge.url uses plain HTTP to a non-local host ({url}). "
                "The token and your orders would cross the network unencrypted. "
                "Prefer an SSH tunnel: ssh -N -L 8760:127.0.0.1:8760 user@host")

        timeout = bridge.get('timeout')
        if timeout is not None and (not isinstance(timeout, (int, float)) or timeout <= 0):
            self.errors.append("mt5.bridge.timeout must be a positive number")

    def _validate_live_safety(self, trading: Dict[str, Any], config: Dict[str, Any]) -> None:
        """Extra scrutiny that only applies when real money is at stake."""
        self.warnings.append(
            "trading.mode is LIVE — orders will be sent with real money")

        risk = trading.get('risk_per_trade')
        if isinstance(risk, (int, float)) and risk > 0.02:
            self.warnings.append(
                f"Live trading with {risk:.1%} risk per trade — consider 1-2%")

        if not (config.get('telegram', {}) or {}).get('enabled'):
            self.warnings.append(
                "Live trading with Telegram notifications disabled — "
                "you will not be alerted when trades execute or limits trip")

        scheduler = ((config.get('agent', {}) or {}).get('scheduler', {}) or {})
        if scheduler.get('enabled'):
            self.warnings.append(
                "Live trading with the scheduler enabled — automated routines "
                "will run unattended")

    def _validate_api(self, api: Dict[str, Any]) -> None:
        if 'provider' not in api:
            self.errors.append("Missing api.provider")
        if 'ticker' not in api:
            self.errors.append("Missing api.ticker")

    def _validate_logging(self, logging_cfg: Dict[str, Any]) -> None:
        if 'enable' not in logging_cfg:
            self.errors.append("Missing logging.enable")
        if 'log_file' not in logging_cfg:
            self.errors.append("Missing logging.log_file")

    def _validate_notifications(self, config: Dict[str, Any]) -> None:
        telegram = config.get('telegram', {}) or {}
        if telegram.get('enabled'):
            if not telegram.get('bot_token'):
                self.errors.append(
                    "telegram.enabled is true but no bot_token is set "
                    "(set TELEGRAM_BOT_TOKEN in .env)")
            if not telegram.get('chat_id'):
                self.errors.append(
                    "telegram.enabled is true but no chat_id is set "
                    "(set TELEGRAM_CHAT_ID in .env)")

        channels = ((config.get('signal_service', {}) or {}).get('channels', {}) or {})
        configured = {k: v for k, v in channels.items() if v}
        if configured and not telegram.get('bot_token'):
            self.warnings.append(
                "Signal channels are configured but no Telegram bot token is "
                "set — broadcasts will fail")
