'use strict';

const BaseStrategy = require('./baseStrategy');

/**
 * Volatility-breakout strategy. Looks for price breaking out of a recent range
 * on expanding volatility and volume — the Donchian/turtle idea. A breakout
 * from a *squeeze* (contracted Bollinger bandwidth) is the highest-quality
 * setup because energy has been building.
 */
class BreakoutStrategy extends BaseStrategy {
  get name() {
    return 'breakout';
  }

  evaluate({ snapshot, bars }) {
    if (!snapshot || !snapshot.ok || !Array.isArray(bars) || bars.length < 25) {
      return this.hold(['insufficient data']);
    }
    const { price, bollinger: bb, obv } = snapshot;
    const lookback = 20;
    const window = bars.slice(-lookback - 1, -1); // prior N bars, excluding the latest
    const priorHigh = Math.max(...window.map((b) => b.high));
    const priorLow = Math.min(...window.map((b) => b.low));

    let score = 0;
    const reasons = [];

    if (price > priorHigh) {
      score += 1.2;
      reasons.push(`price broke ${lookback}-bar high (${round(priorHigh)})`);
    } else if (price < priorLow) {
      score -= 1.2;
      reasons.push(`price broke ${lookback}-bar low (${round(priorLow)})`);
    } else {
      return this.hold(['inside prior range — no breakout']);
    }

    // Squeeze context: a breakout out of low bandwidth is higher conviction.
    let confidence = 0.5;
    const bandwidths = snapshot.series && snapshot.series.bb ? snapshot.series.bb.bandwidth : null;
    if (bandwidths) {
      const recent = bandwidths.filter((v) => v != null).slice(-lookback);
      if (recent.length) {
        const min = Math.min(...recent);
        if (bb.bandwidth != null && min > 0 && bb.bandwidth <= min * 1.15) {
          confidence = 0.75;
          reasons.push('breakout from a volatility squeeze (bandwidth at range low)');
        }
      }
    }

    // Volume/flow confirmation via OBV direction over the breakout.
    if (snapshot.series && snapshot.series.obv) {
      const obvSeries = snapshot.series.obv.filter((v) => v != null);
      if (obvSeries.length >= 3) {
        const rising = obvSeries.at(-1) > obvSeries.at(-3);
        if (score > 0 && rising) {
          confidence = Math.min(1, confidence + 0.15);
          reasons.push('OBV rising — volume confirms the upside break');
        } else if (score < 0 && !rising) {
          confidence = Math.min(1, confidence + 0.15);
          reasons.push('OBV falling — volume confirms the downside break');
        } else {
          confidence = Math.max(0.25, confidence - 0.15);
          reasons.push('volume does not confirm the break (fakeout risk)');
        }
      }
    }
    void obv;

    return this.vote(score, confidence, reasons);
  }
}

function round(v) {
  return Number(v.toFixed(2));
}

module.exports = BreakoutStrategy;
