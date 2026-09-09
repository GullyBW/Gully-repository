"""Print account balance and margin for the configured broker."""

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
    with MT5Manager(config=config) as broker:
        account = broker.get_account_info()
        if not account:
            print("Failed to retrieve account information.")
            return 1

        if not broker.is_live:
            print("[simulation — paper broker, no real funds]")
        print(f"Account Balance: {account['balance']:.2f} {account['currency']}")
        print(f"Account Equity:  {account['equity']:.2f} {account['currency']}")
        print(f"Used Margin:     {account['margin']:.2f} {account['currency']}")
        print(f"Free Margin:     {account['margin_free']:.2f} {account['currency']}")
        print(f"Profit/Loss:     {account['profit']:.2f} {account['currency']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
