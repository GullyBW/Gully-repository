'use strict';

const PaperBroker = require('./paperBroker');
const { RUN_MODES, ORDER_STATUS } = require('../constants');

/**
 * Order Management System. The single choke point through which every order
 * flows, and the safety boundary for real money:
 *
 *   • PAPER mode (default) always routes to the simulated PaperBroker.
 *   • LIVE routing to the real broker requires BOTH runMode === 'live' AND the
 *     operator's explicit `liveOrdersEnabled` opt-in. Either switch off ⇒ paper.
 *
 * Two independent flags mean a stray config value can never, on its own, send a
 * real order. The OMS also records every order for the audit trail.
 */
class OrderManager {
  constructor(provider, { runMode = RUN_MODES.PAPER, liveOrdersEnabled = false, paperOptions } = {}) {
    this.provider = provider;
    this.runMode = runMode;
    this.liveOrdersEnabled = liveOrdersEnabled;
    this.paperBroker = new PaperBroker(provider, paperOptions);
    this.orders = [];
  }

  /** True only when a real order may be routed — both switches must be on. */
  get isLive() {
    return this.runMode === RUN_MODES.LIVE && this.liveOrdersEnabled === true;
  }

  /**
   * Submit an order. Returns the fill/receipt. Falls back to paper on any live
   * routing error so a broker outage can never crash the engine.
   */
  async submit(order, ctx = {}) {
    if (!this.isLive) {
      const fill = await this.paperBroker.execute(order, ctx);
      this._record(order, fill, 'paper');
      return fill;
    }
    try {
      const receipt = await this.provider.placeOrder(order);
      const fill = {
        ...receipt,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        mode: 'live',
        status: receipt.status || ORDER_STATUS.SUBMITTED,
        time: new Date().toISOString(),
      };
      this._record(order, fill, 'live');
      return fill;
    } catch (err) {
      // Never let a broker failure take down the loop; degrade to paper.
      const fill = await this.paperBroker.execute(order, ctx);
      fill.degradedFromLive = true;
      fill.liveError = err.message;
      this._record(order, fill, 'paper');
      return fill;
    }
  }

  _record(order, fill, mode) {
    this.orders.push({
      at: new Date().toISOString(),
      mode,
      request: { symbol: order.symbol, side: order.side, quantity: order.quantity, type: order.type },
      result: { status: fill.status, price: fill.price, commission: fill.commission },
    });
    if (this.orders.length > 2000) this.orders.shift();
  }

  history({ limit = 100 } = {}) {
    return this.orders.slice(-limit).reverse();
  }
}

module.exports = OrderManager;
