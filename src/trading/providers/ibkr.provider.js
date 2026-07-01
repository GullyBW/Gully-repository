'use strict';

const https = require('https');
const axios = require('axios');
const MarketDataProvider = require('./marketData.provider');
const { TIMEFRAMES, NEWS_CATEGORIES, ORDER_SIDES, ORDER_TYPES } = require('../constants');

/**
 * Interactive Brokers adapter over the Client Portal Web API (the REST gateway
 * you run locally and authenticate once). Talks to the documented endpoints:
 *
 *   GET  /iserver/auth/status                     — session check
 *   GET  /iserver/secdef/search?symbol=AAPL       — resolve symbol → conid
 *   GET  /iserver/marketdata/snapshot             — live quote fields
 *   GET  /iserver/marketdata/history              — historical OHLCV bars
 *   GET  /iserver/fundamentals/{conid}/summary    — valuation ratios
 *   GET  /iserver/news/portfolio (+ contract news)— headlines
 *   POST /iserver/account/{id}/orders             — route an order (LIVE only)
 *   POST /iserver/reply/{id}                       — confirm order warnings
 *
 * The gateway uses a self-signed cert on localhost, so TLS verification is
 * configurable. Every method surfaces a clear error when the gateway is
 * unreachable or the session is not authenticated; the trading service decides
 * whether to fall back to the simulator.
 */
class IbkrProvider extends MarketDataProvider {
  constructor(config = {}) {
    super(config);
    this._conidCache = new Map();
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs || 8000,
      httpsAgent: new https.Agent({ rejectUnauthorized: config.rejectUnauthorized !== false }),
      headers: { 'User-Agent': 'tirelo-trading/1.0', Accept: 'application/json' },
    });
  }

  get name() {
    return 'ibkr';
  }

  async isConnected() {
    try {
      const { data } = await this.http.get('/iserver/auth/status');
      return Boolean(data && data.authenticated);
    } catch (_err) {
      return false;
    }
  }

  /** Resolve (and cache) an IBKR contract id for a stock symbol. */
  async resolveConid(symbol) {
    const sym = String(symbol).toUpperCase();
    if (this._conidCache.has(sym)) return this._conidCache.get(sym);
    const { data } = await this.http.get('/iserver/secdef/search', { params: { symbol: sym } });
    const match = Array.isArray(data)
      ? data.find((d) => d.conid && (d.symbol === sym || (d.description || '').includes(sym)))
      : null;
    if (!match) throw new Error(`IBKR: no contract found for ${sym}`);
    const conid = String(match.conid);
    this._conidCache.set(sym, conid);
    return conid;
  }

  async getQuote(symbol) {
    const conid = await this.resolveConid(symbol);
    // 31=Last, 84=Bid, 86=Ask, 87=Volume. The first call may return an empty
    // shell while the subscription warms up; the gateway fills it on repoll.
    const params = { conids: conid, fields: '31,84,86,87' };
    let row = {};
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data } = await this.http.get('/iserver/marketdata/snapshot', { params });
      row = Array.isArray(data) ? data[0] || {} : {};
      if (row['31'] != null) break;
    }
    return {
      symbol: String(symbol).toUpperCase(),
      last: num(row['31']),
      bid: num(row['84']),
      ask: num(row['86']),
      volume: parseVolume(row['87']),
      time: new Date().toISOString(),
    };
  }

  async getBars(symbol, { timeframe = '5min', limit = 200 } = {}) {
    const conid = await this.resolveConid(symbol);
    const bar = mapTimeframe(timeframe);
    const period = derivePeriod(timeframe, limit);
    const { data } = await this.http.get('/iserver/marketdata/history', {
      params: { conid, period, bar, outsideRth: false },
    });
    const rows = (data && data.data) || [];
    return rows.slice(-limit).map((r) => ({
      time: new Date(r.t).toISOString(),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));
  }

  async getNews(symbol, { limit = 5 } = {}) {
    // Contract-level news headlines. The gateway groups them under the conid.
    try {
      const conid = symbol ? await this.resolveConid(symbol) : null;
      const path = conid ? `/iserver/news/${conid}` : '/iserver/news/portfolio';
      const { data } = await this.http.get(path, { params: { pageSize: limit } });
      const items = Array.isArray(data) ? data : data.items || [];
      return items.slice(0, limit).map((n, i) => ({
        id: n.id || n.articleId || `ibkr-${i}`,
        symbol: symbol ? String(symbol).toUpperCase() : null,
        headline: n.headline || n.title || '',
        summary: n.summary || n.headline || n.title || '',
        source: n.source || n.provider || 'IBKR',
        category: NEWS_CATEGORIES.COMPANY,
        publishedAt: n.date || n.time || new Date().toISOString(),
      }));
    } catch (_err) {
      return []; // news is best-effort; never fail a trading cycle over it
    }
  }

  async getFundamentals(symbol) {
    const conid = await this.resolveConid(symbol);
    const { data } = await this.http.get(`/iserver/fundamentals/${conid}/summary`);
    return { symbol: String(symbol).toUpperCase(), ...data };
  }

  /**
   * Route a live order. Only invoked by the OMS when the operator has enabled
   * live trading. Handles the gateway's confirmation-reply handshake.
   */
  async placeOrder(order) {
    const accountId = this.config.accountId;
    if (!accountId) throw new Error('IBKR: IBKR_ACCOUNT_ID is required for live orders');
    const conid = await this.resolveConid(order.symbol);
    const payload = {
      orders: [
        {
          conid: Number(conid),
          orderType: order.type === ORDER_TYPES.LIMIT ? 'LMT' : 'MKT',
          side: order.side === ORDER_SIDES.BUY ? 'BUY' : 'SELL',
          quantity: order.quantity,
          tif: order.tif || 'DAY',
          ...(order.limitPrice ? { price: order.limitPrice } : {}),
        },
      ],
    };
    let { data } = await this.http.post(`/iserver/account/${accountId}/orders`, payload);
    // The gateway may return a chain of confirmation prompts; auto-confirm them.
    let guard = 0;
    while (Array.isArray(data) && data[0] && data[0].id && data[0].message && guard < 5) {
      // eslint-disable-next-line no-await-in-loop
      ({ data } = await this.http.post(`/iserver/reply/${data[0].id}`, { confirmed: true }));
      guard += 1;
    }
    const result = Array.isArray(data) ? data[0] : data;
    return {
      brokerOrderId: result && (result.order_id || result.orderId),
      status: (result && (result.order_status || result.status)) || 'submitted',
      raw: result,
    };
  }
}

function num(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

// IBKR encodes volume like "1.2M" / "850K"; expand to a number.
function parseVolume(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const mult = /m$/i.test(s) ? 1e6 : /k$/i.test(s) ? 1e3 : 1;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? null : Math.round(n * mult);
}

function mapTimeframe(tf) {
  const map = { '1min': '1min', '5min': '5min', '15min': '15min', '30min': '30min', '1hour': '1h', '1day': '1d' };
  return map[tf] || '5min';
}

// Choose a history window wide enough to contain `limit` bars.
function derivePeriod(tf, limit) {
  const seconds = (TIMEFRAMES[tf] || 300) * limit;
  const days = Math.ceil(seconds / (6.5 * 3600)); // trading-day hours
  if (tf === '1day') return `${Math.max(1, limit)}d`;
  if (days <= 1) return '1d';
  if (days <= 7) return `${days}d`;
  return `${Math.ceil(days / 7)}w`;
}

module.exports = IbkrProvider;
