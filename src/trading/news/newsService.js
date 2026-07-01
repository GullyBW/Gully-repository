'use strict';

const sentiment = require('../analysis/sentiment');
const { NEWS_CATEGORIES } = require('../constants');

/**
 * News + sentiment aggregation. Pulls the latest market and company news from
 * the active data provider and scores it with the finance sentiment engine,
 * producing a single, explainable sentiment reading per symbol that the
 * news-driven strategy and the REST layer consume.
 *
 * Weighting reflects how tradable each category is intraday: an earnings
 * surprise or analyst action moves a stock harder than a generic company blurb.
 */
const CATEGORY_WEIGHT = {
  [NEWS_CATEGORIES.EARNINGS]: 1.5,
  [NEWS_CATEGORIES.ANALYST]: 1.3,
  [NEWS_CATEGORIES.COMPANY]: 1.0,
  [NEWS_CATEGORIES.MARKET]: 0.7,
};

class NewsService {
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Fetch and score company-specific news for a symbol.
   * @returns {Promise<{ symbol, score, label, count, items }>}
   */
  async analyzeSymbol(symbol, { limit = 8 } = {}) {
    const items = (await safe(() => this.provider.getNews(symbol, { limit }))) || [];
    const weighted = items.map((it) => ({ ...it, weight: CATEGORY_WEIGHT[it.category] || 1 }));
    const agg = sentiment.aggregate(weighted);
    return { symbol: String(symbol).toUpperCase(), ...agg };
  }

  /** Fetch and score broad-market news (no symbol). */
  async analyzeMarket({ limit = 8 } = {}) {
    const items = (await safe(() => this.provider.getNews(null, { limit }))) || [];
    const agg = sentiment.aggregate(items);
    return { scope: 'market', ...agg };
  }

  /**
   * Combined view: a symbol's own news blended with the market backdrop. The
   * market tone is a lighter overlay (a rising tide) on the stock-specific
   * signal.
   */
  async sentimentFor(symbol, { limit = 8, marketWeight = 0.3 } = {}) {
    const [own, market] = await Promise.all([
      this.analyzeSymbol(symbol, { limit }),
      this.analyzeMarket({ limit }),
    ]);
    const blended =
      own.count === 0 && market.count === 0
        ? 0
        : own.score * (1 - marketWeight) + market.score * marketWeight;
    return {
      symbol: String(symbol).toUpperCase(),
      score: Number(blended.toFixed(4)),
      label: sentiment.labelFor(blended),
      count: own.count + market.count,
      company: own,
      market,
    };
  }
}

async function safe(fn) {
  try {
    return await fn();
  } catch (_err) {
    return [];
  }
}

module.exports = NewsService;
