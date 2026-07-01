'use strict';

const MomentumStrategy = require('./momentum.strategy');
const MeanReversionStrategy = require('./meanReversion.strategy');
const BreakoutStrategy = require('./breakout.strategy');
const NewsSentimentStrategy = require('./newsSentiment.strategy');
const { actionFromScore } = require('../constants');

/**
 * The alpha blender. Runs every strategy over a shared context and combines
 * their votes into one signal, weighting each vote by (a) the operator's
 * configured trust in that strategy and (b) the strategy's own confidence in
 * this particular setup. The result is fully explainable — it carries every
 * contributing vote and reason — which is exactly where opaque institutional
 * models fall short.
 */
class StrategyEnsemble {
  /**
   * @param {object} weights  strategy-name → relative weight
   * @param {BaseStrategy[]} [strategies] override the default roster
   */
  constructor(weights = {}, strategies = null) {
    this.weights = weights;
    this.strategies =
      strategies || [
        new MomentumStrategy(),
        new MeanReversionStrategy(),
        new BreakoutStrategy(),
        new NewsSentimentStrategy(),
      ];
  }

  /**
   * @param {object} context { symbol, snapshot, news, bars, quote, fundamentals }
   * @returns {{ symbol, action, score, confidence, agreement, votes, reasons }}
   */
  evaluate(context) {
    const votes = this.strategies.map((s) => {
      try {
        return s.evaluate(context);
      } catch (err) {
        return { strategy: s.name, action: 'hold', score: 0, confidence: 0, reasons: [`error: ${err.message}`] };
      }
    });

    let weightedScore = 0;
    let weightTotal = 0;
    let confidenceAcc = 0;
    for (const v of votes) {
      const w = (this.weights[v.strategy] != null ? this.weights[v.strategy] : 1) * v.confidence;
      weightedScore += v.score * w;
      weightTotal += w;
      confidenceAcc += v.confidence;
    }
    const score = weightTotal === 0 ? 0 : weightedScore / weightTotal;

    // Agreement: share of the *directional* votes that point the same way as
    // the blended score. High agreement = higher-quality signal.
    const directional = votes.filter((v) => Math.abs(v.score) >= 0.5);
    const sameSide = directional.filter((v) => Math.sign(v.score) === Math.sign(score) && score !== 0);
    const agreement = directional.length === 0 ? 0 : sameSide.length / directional.length;

    const confidence = Number(
      Math.min(1, (confidenceAcc / (votes.length || 1)) * (0.5 + 0.5 * agreement)).toFixed(3)
    );

    return {
      symbol: context.symbol,
      action: actionFromScore(score),
      score: Number(score.toFixed(3)),
      confidence,
      agreement: Number(agreement.toFixed(3)),
      votes,
      reasons: votes.flatMap((v) => v.reasons.map((r) => `[${v.strategy}] ${r}`)),
    };
  }
}

module.exports = StrategyEnsemble;
