"""List open positions for the configured symbol."""

import os
import sys

try:
    from .config_loader import load_config
    from .instrument import get_spec
    from .mt5_manager import MT5Manager
except ImportError:
    from config_loader import load_config
    from instrument import get_spec
    from mt5_manager import MT5Manager

CONFIG_FILE = os.path.join(os.path.dirname(__file__), '..', 'config.yaml')


def main() -> int:
    config = load_config(CONFIG_FILE)
    symbol = config['trading']['symbol']
    spec = get_spec(symbol)

    with MT5Manager(config=config) as broker:
        positions = broker.get_positions(symbol)

        if not broker.is_live:
            print("[simulation — paper broker, no real funds]")

        if not positions:
            print(f"No open positions for {symbol}.")
            return 0

        print(f"Open positions for {symbol}:")
        for pos in positions:
            side = "BUY" if pos['type'] == 0 else "SELL"
            # contract_size comes from the instrument spec rather than a
            # hard-coded 100, so this stays correct for other symbols.
            units = pos['volume'] * spec.contract_size
            print(
                f"  #{pos['ticket']} {side} {pos['volume']:.2f} lots "
                f"({units:,.0f} units) at {pos['price_open']:.2f}, "
                f"P/L: {pos['profit']:.2f}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
