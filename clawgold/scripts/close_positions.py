"""Close every open position for the configured symbol."""

import os
import sys

try:
    from .config_loader import load_config
    from .mt5_manager import MT5Manager
except ImportError:
    from config_loader import load_config
    from mt5_manager import MT5Manager

CONFIG_FILE = os.path.join(os.path.dirname(__file__), '..', 'config.yaml')


def main() -> int:
    config = load_config(CONFIG_FILE)
    symbol = config['trading']['symbol']

    with MT5Manager(config=config) as broker:
        positions = broker.get_positions(symbol)

        if not broker.is_live:
            print("[simulation — paper broker, no real funds]")

        if not positions:
            print(f"No open positions for {symbol} to close.")
            return 0

        print(f"Closing {len(positions)} position(s) for {symbol}...")
        failures = 0
        for pos in positions:
            # Closing goes through the broker, which sends an opposing
            # TRADE_ACTION_DEAL. The previous version sent a
            # TRADE_ACTION_CLOSE_POSITION constant that MetaTrader5 does not
            # define, so this path could never have worked.
            result = broker.close_position(pos['ticket'])
            if result.get('success'):
                print(f"  Closed #{pos['ticket']} — P/L {result.get('profit', 0):.2f}")
            else:
                failures += 1
                print(f"  Failed to close #{pos['ticket']}: {result.get('error')}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
