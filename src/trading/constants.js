'use strict';

/**
 * Shared enums for the day-trading subsystem. Kept separate from the
 * marketplace constants so the two domains never collide, but following the
 * same `Object.freeze` convention used across the codebase.
 */

// Which side of the market an order takes.
const ORDER_SIDES = Object.freeze({
  BUY: 'buy',
  SELL: 'sell',
});

const ORDER_TYPES = Object.freeze({
  MARKET: 'market',
  LIMIT: 'limit',
  STOP: 'stop',
  STOP_LIMIT: 'stop_limit',
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pending', // created locally, not yet acknowledged
  SUBMITTED: 'submitted', // sent to broker
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
});

// The directional call a strategy / the engine makes for a symbol.
const SIGNAL_ACTIONS = Object.freeze({
  STRONG_BUY: 'strong_buy',
  BUY: 'buy',
  HOLD: 'hold',
  SELL: 'sell',
  STRONG_SELL: 'strong_sell',
});

// Ordered from most bearish (-2) to most bullish (+2) so signals can be
// averaged and compared numerically by the ensemble.
const SIGNAL_SCORE = Object.freeze({
  [SIGNAL_ACTIONS.STRONG_SELL]: -2,
  [SIGNAL_ACTIONS.SELL]: -1,
  [SIGNAL_ACTIONS.HOLD]: 0,
  [SIGNAL_ACTIONS.BUY]: 1,
  [SIGNAL_ACTIONS.STRONG_BUY]: 2,
});

// Bar sizes the data layer understands, mapped to their length in seconds.
const TIMEFRAMES = Object.freeze({
  '1min': 60,
  '5min': 300,
  '15min': 900,
  '30min': 1800,
  '1hour': 3600,
  '1day': 86400,
});

const STRATEGIES = Object.freeze({
  MOMENTUM: 'momentum',
  MEAN_REVERSION: 'mean_reversion',
  BREAKOUT: 'breakout',
  NEWS_SENTIMENT: 'news_sentiment',
});

// The engine only ever routes real orders when the run mode is LIVE *and* the
// operator has separately opted in via config. PAPER is the safe default.
const RUN_MODES = Object.freeze({
  PAPER: 'paper', // simulated fills, no money at risk
  LIVE: 'live', // real orders routed to the broker (guarded)
});

const NEWS_CATEGORIES = Object.freeze({
  MARKET: 'market', // macro / index / broad-market
  COMPANY: 'company', // single-issuer financial news
  EARNINGS: 'earnings',
  ANALYST: 'analyst', // upgrades / downgrades / price targets
});

/** Turn a numeric score in [-2, 2] into the nearest signal action. */
function actionFromScore(score) {
  if (score >= 1.5) return SIGNAL_ACTIONS.STRONG_BUY;
  if (score >= 0.5) return SIGNAL_ACTIONS.BUY;
  if (score <= -1.5) return SIGNAL_ACTIONS.STRONG_SELL;
  if (score <= -0.5) return SIGNAL_ACTIONS.SELL;
  return SIGNAL_ACTIONS.HOLD;
}

module.exports = {
  ORDER_SIDES,
  ORDER_TYPES,
  ORDER_STATUS,
  SIGNAL_ACTIONS,
  SIGNAL_SCORE,
  TIMEFRAMES,
  STRATEGIES,
  RUN_MODES,
  NEWS_CATEGORIES,
  actionFromScore,
};
