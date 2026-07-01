'use strict';

const MarketDataProvider = require('./marketData.provider');
const { TIMEFRAMES, NEWS_CATEGORIES } = require('../constants');

/**
 * Fully-offline market simulator. Generates reproducible OHLCV series with a
 * geometric-Brownian-motion walk and synthetic-but-realistic news, so the
 * entire trading stack — engine, strategies, risk, backtester, REST API — runs
 * and is testable with zero external dependencies. This is the trading
 * counterpart of the marketplace's built-in "Botswana sandbox" fallback.
 *
 * Values are deterministic per (symbol, timeframe): the price walk is seeded
 * from the symbol so indicator/strategy tests are stable across runs, while bar
 * timestamps still advance with wall-clock time to mimic a live feed.
 */

// Deterministic 32-bit hash for seeding.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG — small, fast, good enough for simulation.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Anchor prices so symbols look familiar; unknown symbols derive one from hash.
const BASE_PRICES = {
  AAPL: 195, MSFT: 420, NVDA: 120, TSLA: 250, AMZN: 185, SPY: 550,
  GOOGL: 175, META: 500, AMD: 160, NFLX: 640,
};

const NEWS_TEMPLATES = [
  { category: NEWS_CATEGORIES.EARNINGS, headline: '{S} beats quarterly earnings expectations, revenue tops estimates', source: 'MarketWire' },
  { category: NEWS_CATEGORIES.EARNINGS, headline: '{S} misses earnings forecast, shares slump in after-hours trading', source: 'MarketWire' },
  { category: NEWS_CATEGORIES.ANALYST, headline: 'Analysts upgrade {S} to Buy on strong growth momentum', source: 'StreetResearch' },
  { category: NEWS_CATEGORIES.ANALYST, headline: '{S} downgraded amid concerns over weak guidance', source: 'StreetResearch' },
  { category: NEWS_CATEGORIES.COMPANY, headline: '{S} announces record buyback and dividend increase', source: 'CompanyNews' },
  { category: NEWS_CATEGORIES.COMPANY, headline: '{S} faces regulatory probe, lawsuit filed over disclosures', source: 'CompanyNews' },
  { category: NEWS_CATEGORIES.COMPANY, headline: '{S} unveils breakthrough product, orders surge', source: 'CompanyNews' },
  { category: NEWS_CATEGORIES.MARKET, headline: 'Markets rally as inflation cools, {S} climbs with broad tape', source: 'MacroDaily' },
  { category: NEWS_CATEGORIES.MARKET, headline: 'Selloff deepens on recession fears, {S} falls with equities', source: 'MacroDaily' },
];

class SimulatedProvider extends MarketDataProvider {
  get name() {
    return 'simulated';
  }

  async isConnected() {
    return true;
  }

  _basePrice(symbol) {
    if (BASE_PRICES[symbol]) return BASE_PRICES[symbol];
    return 20 + (hashSeed(symbol) % 480); // stable pseudo-price in [20, 500)
  }

  async getBars(symbol, { timeframe = '5min', limit = 200 } = {}) {
    const sym = String(symbol).toUpperCase();
    const tfSeconds = TIMEFRAMES[timeframe] || TIMEFRAMES['5min'];
    const rng = mulberry32(hashSeed(`${sym}|${timeframe}`));

    // Per-symbol drift/vol drawn once so each name has its own character.
    const annualDrift = (rng() - 0.45) * 0.3; // roughly -13%..+16%
    const annualVol = 0.15 + rng() * 0.45; // 15%..60%
    const barsPerYear = (252 * 6.5 * 3600) / tfSeconds;
    const dt = 1 / barsPerYear;
    const mu = annualDrift * dt;
    const sigma = annualVol * Math.sqrt(dt);

    let price = this._basePrice(sym);
    const now = Date.now();
    const bars = [];
    for (let i = 0; i < limit; i += 1) {
      const open = price;
      const ret = mu + sigma * gaussian(rng);
      const close = Math.max(0.01, open * Math.exp(ret));
      const intrabar = Math.abs(sigma) * open * (0.5 + rng());
      const high = Math.max(open, close) + intrabar * rng();
      const low = Math.min(open, close) - intrabar * rng();
      const volume = Math.round(500000 * (0.6 + rng() * 1.2));
      bars.push({
        time: new Date(now - (limit - 1 - i) * tfSeconds * 1000).toISOString(),
        open: round(open),
        high: round(high),
        low: round(Math.max(0.01, low)),
        close: round(close),
        volume,
      });
      price = close;
    }
    return bars;
  }

  async getQuote(symbol) {
    const bars = await this.getBars(symbol, { timeframe: '1min', limit: 2 });
    const last = bars.at(-1);
    const spread = Math.max(0.01, last.close * 0.0005);
    return {
      symbol: String(symbol).toUpperCase(),
      last: last.close,
      bid: round(last.close - spread / 2),
      ask: round(last.close + spread / 2),
      volume: last.volume,
      time: last.time,
    };
  }

  async getNews(symbol, { limit = 5 } = {}) {
    const sym = symbol ? String(symbol).toUpperCase() : 'MARKET';
    // Seed by symbol + calendar day so the feed is stable within a day.
    const day = Math.floor(Date.now() / 86400000);
    const rng = mulberry32(hashSeed(`${sym}|news|${day}`));
    const now = Date.now();
    const count = Math.min(limit, 3 + Math.floor(rng() * 3));
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const tpl = NEWS_TEMPLATES[Math.floor(rng() * NEWS_TEMPLATES.length)];
      const displaySym = symbol ? sym : ['SPY', 'the S&P 500', 'megacaps'][Math.floor(rng() * 3)];
      items.push({
        id: `sim-${sym}-${day}-${i}`,
        symbol: symbol ? sym : null,
        headline: tpl.headline.replace('{S}', displaySym),
        summary: tpl.headline.replace('{S}', displaySym),
        source: tpl.source,
        category: tpl.category,
        publishedAt: new Date(now - Math.floor(rng() * 6 * 3600 * 1000)).toISOString(),
      });
    }
    return items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  async getFundamentals(symbol) {
    const sym = String(symbol).toUpperCase();
    const rng = mulberry32(hashSeed(`${sym}|fund`));
    return {
      symbol: sym,
      peRatio: round(10 + rng() * 40, 2),
      pegRatio: round(0.8 + rng() * 2, 2),
      marketCap: Math.round((50 + rng() * 2500) * 1e9),
      dividendYield: round(rng() * 3, 2),
      beta: round(0.5 + rng() * 1.5, 2),
      profitMargin: round(rng() * 0.35, 3),
    };
  }

  async placeOrder() {
    throw new Error('Simulated provider does not route live orders; use paper mode.');
  }
}

function round(v, dp = 2) {
  return Number(v.toFixed(dp));
}

module.exports = SimulatedProvider;
