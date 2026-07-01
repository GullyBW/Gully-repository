'use strict';

const { v4: uuidv4 } = require('uuid');
const { ORDER_SIDES, ORDER_STATUS } = require('../constants');

/**
 * Paper-trading broker. Simulates realistic fills against live quotes so a
 * strategy can be validated with zero capital at risk — the default execution
 * path. Models the two costs that quietly kill naive backtests:
 *
 *   • Spread + slippage — buys fill at/above the ask, sells at/below the bid,
 *     with extra slippage scaled by order size vs. available volume.
 *   • Commission        — IBKR-style $0.005/share, $1.00 minimum.
 */
class PaperBroker {
  constructor(provider, { commissionPerShare = 0.005, minCommission = 1.0, slippageBps = 2 } = {}) {
    this.provider = provider;
    this.commissionPerShare = commissionPerShare;
    this.minCommission = minCommission;
    this.slippageBps = slippageBps;
  }

  /**
   * Execute an order and return a fill.
   * @param {{symbol,side,quantity,type?,limitPrice?}} order
   * @param {{quote?:object}} [ctx] optional pre-fetched quote
   */
  async execute(order, ctx = {}) {
    const quote = ctx.quote || (await this.provider.getQuote(order.symbol));
    const ref = quote.last || quote.ask || quote.bid;
    if (!ref) {
      return { status: ORDER_STATUS.REJECTED, reason: 'no market price', order };
    }

    const isBuy = order.side === ORDER_SIDES.BUY;
    // Cross the spread, then add size-aware slippage.
    let price = isBuy ? quote.ask || ref : quote.bid || ref;
    const sizeImpact = quote.volume ? Math.min(0.01, order.quantity / quote.volume) : 0;
    const slip = ref * (this.slippageBps / 10000 + sizeImpact);
    price += isBuy ? slip : -slip;

    // Respect a limit price if provided.
    if (order.type === 'limit' && order.limitPrice != null) {
      if (isBuy && price > order.limitPrice) {
        return { status: ORDER_STATUS.CANCELLED, reason: 'limit not marketable', order };
      }
      if (!isBuy && price < order.limitPrice) {
        return { status: ORDER_STATUS.CANCELLED, reason: 'limit not marketable', order };
      }
      price = order.limitPrice;
    }

    price = round(price);
    const commission = round(Math.max(this.minCommission, order.quantity * this.commissionPerShare));
    return {
      id: uuidv4(),
      status: ORDER_STATUS.FILLED,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price,
      referencePrice: round(ref),
      slippage: round(Math.abs(price - ref)),
      commission,
      mode: 'paper',
      time: new Date().toISOString(),
    };
  }
}

function round(v, dp = 4) {
  return Number(Number(v).toFixed(dp));
}

module.exports = PaperBroker;
