'use strict';

const BaseStrategy = require('./baseStrategy');

/**
 * Mean-reversion strategy. Fades stretched moves back toward a fair value:
 * price piercing a Bollinger band with an over-extended RSI/Stochastic, but
 * *only* when there is no strong trend (fading a strong trend is how mean
 * reverters blow up). The ADX gate is the risk-control that most naive
 * implementations omit.
 */
class MeanReversionStrategy extends BaseStrategy {
  get name() {
    return 'mean_reversion';
  }

  evaluate({ snapshot }) {
    if (!snapshot || !snapshot.ok) return this.hold(['insufficient data']);
    const { rsi, bollinger: bb, stochastic: st, adx, price } = snapshot;

    // Do not fight a strong trend.
    if (adx.adx != null && adx.adx >= 30) {
      return this.hold([`ADX ${adx.adx} — trend too strong to fade`]);
    }

    let score = 0;
    const reasons = [];

    if (bb.percentB != null) {
      if (bb.percentB <= 0.05) {
        score += 1;
        reasons.push('price at/below lower Bollinger band (stretched down)');
      } else if (bb.percentB >= 0.95) {
        score -= 1;
        reasons.push('price at/above upper Bollinger band (stretched up)');
      }
    }
    if (price != null && bb.lower != null && price < bb.lower) {
      score += 0.4;
      reasons.push('close pierced below lower band');
    } else if (price != null && bb.upper != null && price > bb.upper) {
      score -= 0.4;
      reasons.push('close pierced above upper band');
    }

    if (rsi != null) {
      if (rsi <= 30) {
        score += 0.6;
        reasons.push(`RSI ${rsi} oversold`);
      } else if (rsi >= 70) {
        score -= 0.6;
        reasons.push(`RSI ${rsi} overbought`);
      }
    }

    if (st.k != null) {
      if (st.k <= 20) {
        score += 0.3;
        reasons.push(`Stochastic %K ${st.k} oversold`);
      } else if (st.k >= 80) {
        score -= 0.3;
        reasons.push(`Stochastic %K ${st.k} overbought`);
      }
    }

    // Confidence is higher in a calm, rangebound tape.
    let confidence = 0.5;
    if (adx.adx != null && adx.adx < 20) {
      confidence = 0.7;
      reasons.push(`ADX ${adx.adx} — rangebound, reversion favoured`);
    }

    if (reasons.length === 0) return this.hold();
    return this.vote(score, confidence, reasons);
  }
}

module.exports = MeanReversionStrategy;
