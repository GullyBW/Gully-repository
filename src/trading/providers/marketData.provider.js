'use strict';

/**
 * Contract every market-data adapter implements. The trading engine and
 * services talk only to this interface, so adding a venue (Interactive Brokers,
 * Alpaca, Polygon, a crypto exchange) means dropping in one more subclass and
 * registering it — mirroring the payment-provider pattern used elsewhere in the
 * codebase.
 */
class MarketDataProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /** Machine name, e.g. 'ibkr'. */
  get name() {
    throw new Error('provider.name not implemented');
  }

  /** True when the adapter can reach its upstream (used by health checks). */
  async isConnected() {
    return false;
  }

  /**
   * Latest quote for a symbol.
   * @returns {Promise<{symbol,last,bid,ask,volume,time}>}
   */
  async getQuote() {
    throw new Error('provider.getQuote not implemented');
  }

  /**
   * Historical OHLCV bars, oldest → newest.
   * @param {string} symbol
   * @param {{ timeframe?: string, limit?: number }} [opts]
   * @returns {Promise<Array<{time,open,high,low,close,volume}>>}
   */
  async getBars() {
    throw new Error('provider.getBars not implemented');
  }

  /**
   * Recent news for a symbol (or the broad market when symbol is omitted).
   * @returns {Promise<Array<{id,symbol,headline,summary,source,category,publishedAt}>>}
   */
  async getNews() {
    throw new Error('provider.getNews not implemented');
  }

  /**
   * Fundamental snapshot (valuation / financial ratios) for a symbol.
   * @returns {Promise<object>}
   */
  async getFundamentals() {
    return {};
  }

  /**
   * Route an order to the venue. Only ever called by the OMS in LIVE mode with
   * live orders explicitly enabled; paper mode never reaches here.
   */
  async placeOrder() {
    throw new Error('provider.placeOrder not implemented');
  }
}

module.exports = MarketDataProvider;
