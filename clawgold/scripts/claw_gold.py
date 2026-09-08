"""
ClawGold plugin tools
=====================
The tool surface declared in plugin.json: price, moving average, signal,
trade execution and portfolio status.

All market access goes through the Broker interface, so these tools work
against the paper broker in simulation mode as well as a live MT5 terminal.
Previously every function refused to run unless trading.mode was 'real',
which made the plugin untestable without a funded account.
"""

import pandas as pd
from pathlib import Path

try:
    from .config_loader import load_config
    from .broker import get_broker, Timeframe
    from .instrument import get_spec
except ImportError:
    from config_loader import load_config
    from broker import get_broker, Timeframe
    from instrument import get_spec

CONFIG_FILE = 'config.yaml'
ROOT_DIR = Path(__file__).resolve().parent.parent

config = None
_broker = None


def initialize_plugin():
    """Load config and connect to whichever broker trading.mode selects."""
    global config, _broker
    if config is None:
        try:
            config = load_config(str(ROOT_DIR / CONFIG_FILE))
        except Exception as e:
            return f"Error loading config: {str(e)}"

    if _broker is None:
        try:
            _broker = get_broker(config)
            _broker.connect()
        except Exception as e:
            _broker = None
            return f"Broker connection failed: {e}"

    venue = "live MT5" if _broker.is_live else "paper broker (simulation)"
    return f"ClawGold initialized against {venue}."


def _require_broker():
    """Return the connected broker, connecting on first use."""
    if _broker is None:
        message = initialize_plugin()
        if _broker is None:
            raise RuntimeError(message)
    return _broker


def _symbol():
    return config['trading']['symbol']


def get_xauusd_price():
    """Fetch the current price."""
    try:
        broker = _require_broker()
    except RuntimeError as e:
        return f"Error: {e}"

    symbol = _symbol()
    tick = broker.get_tick(symbol)
    if tick is None:
        return "Error: Unable to fetch price."
    return f"Current {symbol} price: {tick['bid']:.2f} USD (bid), {tick['ask']:.2f} USD (ask)"


def calculate_moving_average(period=20):
    """Simple moving average of the last `period` daily closes."""
    try:
        broker = _require_broker()
    except RuntimeError as e:
        return f"Error: {e}"

    bars = broker.get_rates(_symbol(), Timeframe.D1, period + 10)
    if bars is None or len(bars) < period:
        return f"Not enough data for MA({period})."

    # Bars are dicts; the previous version used attribute access on a numpy
    # structured array, which raises AttributeError.
    closes = [bar['close'] for bar in bars[-period:]]
    return f"SMA({period}): {sum(closes) / len(closes):.2f}"


def _macd(closes: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD line and signal line, computed with pandas alone."""
    ema_fast = closes.ewm(span=fast, adjust=False).mean()
    ema_slow = closes.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line


def generate_trading_signal(short_period=12, long_period=26):
    """BUY/SELL/HOLD from a MACD crossover on daily bars."""
    try:
        broker = _require_broker()
    except RuntimeError as e:
        return f"Error: {e}"

    bars = broker.get_rates(_symbol(), Timeframe.D1, 100)
    if bars is None or len(bars) < long_period:
        return "Not enough data for signal."

    closes = pd.DataFrame(bars)['close']
    macd_line, signal_line = _macd(closes, fast=short_period, slow=long_period)
    if len(macd_line) < 2:
        return "Insufficient data for signal."

    crossed_up = (macd_line.iloc[-1] > signal_line.iloc[-1]
                  and macd_line.iloc[-2] <= signal_line.iloc[-2])
    crossed_down = (macd_line.iloc[-1] < signal_line.iloc[-1]
                    and macd_line.iloc[-2] >= signal_line.iloc[-2])

    if crossed_up:
        return "BUY signal"
    if crossed_down:
        return "SELL signal"
    return "HOLD"


def execute_trade(action, amount):
    """
    Buy or sell `amount` units of the underlying (ounces, for gold).

    The unit-to-lot conversion uses the instrument's contract size rather
    than a hard-coded 100.
    """
    try:
        broker = _require_broker()
    except RuntimeError as e:
        return f"Error: {e}"

    symbol = _symbol()
    action = str(action).upper()
    if action not in ('BUY', 'SELL'):
        return "Invalid action. Use BUY or SELL."

    volume = amount / get_spec(symbol).contract_size
    result = broker.execute_trade(action, volume, symbol=symbol)
    if not result.get('success'):
        return f"Order failed: {result.get('error')}"

    prefix = "" if broker.is_live else "[paper] "
    return f"{prefix}{action}: {amount} units at {result['price']:.2f} USD"


def get_portfolio_status():
    """Account balance plus open positions."""
    try:
        broker = _require_broker()
    except RuntimeError as e:
        return f"Error: {e}"

    account = broker.get_account_info()
    if account is None:
        return "Error: Unable to get account info."

    symbol = _symbol()
    spec = get_spec(symbol)
    positions = broker.get_positions(symbol)

    status = ""
    if not broker.is_live:
        status += "[simulation — paper broker, no real funds]\n"
    status += f"Balance: {account['balance']:.2f} {account['currency']}\n"
    status += f"Equity:  {account['equity']:.2f} {account['currency']}\n"

    if positions:
        status += "Positions:\n"
        for pos in positions:
            side = "BUY" if pos['type'] == 0 else "SELL"
            units = pos['volume'] * spec.contract_size
            status += (f"  #{pos['ticket']} {side} {units:.0f} units at "
                       f"{pos['price_open']:.2f} USD, P/L {pos['profit']:.2f}\n")
    else:
        status += "No open positions.\n"
    return status


def interactive():
    """Interactive mode for standalone use."""
    print("Welcome to ClawGold - XAUUSD Real Trading")
    print("Initializing...")
    print(initialize_plugin())
    print()

    while True:
        print("\nMenu:")
        print("1. Get current XAUUSD price")
        print("2. Calculate moving average")
        print("3. Generate trading signal")
        print("4. Execute trade")
        print("5. Get portfolio status")
        print("6. Exit")
        choice = input("Choose an option (1-6): ").strip()

        if choice == '1':
            print("Fetching price...")
            print(get_xauusd_price())
        elif choice == '2':
            period = input("Enter period (default 20): ").strip()
            period = int(period) if period else 20
            print(f"Calculating MA({period})...")
            print(calculate_moving_average(period))
        elif choice == '3':
            short = input("Enter short period (default 10): ").strip()
            short = int(short) if short else 10
            long_p = input("Enter long period (default 20): ").strip()
            long_p = int(long_p) if long_p else 20
            print("Generating signal...")
            print(generate_trading_signal(short, long_p))
        elif choice == '4':
            action = input("Enter action (BUY/SELL): ").strip().upper()
            if action not in ['BUY', 'SELL']:
                print("Invalid action.")
                continue
            amount = input("Enter amount in ounces: ").strip()
            try:
                amount = float(amount)
                print("Executing trade...")
                print(execute_trade(action, amount))
            except ValueError:
                print("Invalid amount.")
        elif choice == '5':
            print("Portfolio status:")
            print(get_portfolio_status())
        elif choice == '6':
            print("Exiting ClawGold. Goodbye!")
            break
        else:
            print("Invalid choice. Please select 1-6.")

        input("\nPress Enter to continue...")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        # Interactive mode
        interactive()
    else:
        # CLI mode for OpenClaw
        func = sys.argv[1]
        if func == 'initialize_plugin':
            print(initialize_plugin())
        elif func == 'get_xauusd_price':
            print(get_xauusd_price())
        elif func == 'calculate_moving_average':
            period = int(sys.argv[2]) if len(sys.argv) > 2 else 20
            print(calculate_moving_average(period))
        elif func == 'generate_trading_signal':
            short = int(sys.argv[2]) if len(sys.argv) > 2 else 10
            long_p = int(sys.argv[3]) if len(sys.argv) > 3 else 20
            print(generate_trading_signal(short, long_p))
        elif func == 'execute_trade':
            if len(sys.argv) < 4:
                print("Usage: execute_trade <action> <amount>")
                sys.exit(1)
            action = sys.argv[2]
            amount = float(sys.argv[3])
            print(execute_trade(action, amount))
        elif func == 'get_portfolio_status':
            print(get_portfolio_status())
        else:
            print(f"Unknown function: {func}")
