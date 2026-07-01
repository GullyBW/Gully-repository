'use strict';

const BaseStrategy = require('./baseStrategy');

/**
 * Trend-following / momentum strategy. Goes with a confirmed trend: price above
 * its moving averages, MACD supportive, ADX showing the trend has strength, and
 * RSI with room to run (not yet exhausted). This is the classic CTA/managed-
 * futures edge, adapted for intraday bars.
 */
class MomentumStrategy extends BaseStrategy {
  get name() {
    return 'momentum';
  }

  evaluate({ snapshot }) {
    if (!snapshot || !snapshot.ok) return this.hold(['insufficient data']);
    const { rsi, macd, movingAverages: ma, adx, price, trend } = snapshot;
    let score = 0;
    const reasons = [];

    // Moving-average alignment.
    if (ma.ema9 != null && ma.ema21 != null) {
      if (price > ma.ema9 && ma.ema9 > ma.ema21) {
        score += 0.7;
        reasons.push('price above rising EMA9 > EMA21 (bullish stack)');
      } else if (price < ma.ema9 && ma.ema9 < ma.ema21) {
        score -= 0.7;
        reasons.push('price below falling EMA9 < EMA21 (bearish stack)');
      }
    }
    if (ma.emaCross === 'bullish') {
      score += 0.4;
      reasons.push('EMA9 crossed above EMA21');
    } else if (ma.emaCross === 'bearish') {
      score -= 0.4;
      reasons.push('EMA9 crossed below EMA21');
    }

    // MACD momentum.
    if (macd.histogram != null) {
      if (macd.histogram > 0) {
        score += 0.4;
        reasons.push('MACD histogram positive');
      } else if (macd.histogram < 0) {
        score -= 0.4;
        reasons.push('MACD histogram negative');
      }
    }
    if (macd.cross === 'bullish') {
      score += 0.4;
      reasons.push('MACD bullish crossover');
    } else if (macd.cross === 'bearish') {
      score -= 0.4;
      reasons.push('MACD bearish crossover');
    }

    // RSI: momentum but avoid chasing into exhaustion.
    if (rsi != null) {
      if (rsi > 55 && rsi < 75) {
        score += 0.3;
        reasons.push(`RSI ${rsi} confirms upside momentum`);
      } else if (rsi >= 80) {
        score -= 0.3;
        reasons.push(`RSI ${rsi} overbought — momentum stretched`);
      } else if (rsi < 45 && rsi > 25) {
        score -= 0.3;
        reasons.push(`RSI ${rsi} confirms downside momentum`);
      } else if (rsi <= 20) {
        score += 0.3;
        reasons.push(`RSI ${rsi} oversold — downtrend stretched`);
      }
    }

    // Trend strength gate: momentum only pays when a trend actually exists.
    let confidence = 0.4;
    if (adx.adx != null) {
      if (adx.adx >= 25) {
        confidence = 0.75;
        score *= 1.15;
        reasons.push(`ADX ${adx.adx} — strong trend`);
      } else if (adx.adx < 18) {
        confidence = 0.3;
        score *= 0.6;
        reasons.push(`ADX ${adx.adx} — weak/no trend, momentum discounted`);
      }
    }
    if (trend && trend.startsWith('strong')) confidence = Math.min(1, confidence + 0.1);

    if (reasons.length === 0) return this.hold();
    return this.vote(score, confidence, reasons);
  }
}

module.exports = MomentumStrategy;
