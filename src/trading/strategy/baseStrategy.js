'use strict';

const { SIGNAL_ACTIONS, actionFromScore } = require('../constants');

/**
 * Base class for a trading strategy. A strategy is a pure function of a
 * "context" (technical snapshot + news sentiment + bars) that returns a
 * directional vote with an explanation. Keeping strategies stateless and
 * explainable is a deliberate improvement over the opaque black-box models many
 * desks run: every vote lists the reasons that produced it.
 *
 * @typedef {Object} StrategyVote
 * @property {string} strategy
 * @property {string} action     one of SIGNAL_ACTIONS
 * @property {number} score      numeric score in [-2, 2]
 * @property {number} confidence 0..1
 * @property {string[]} reasons  human-readable justifications
 */
class BaseStrategy {
  get name() {
    throw new Error('strategy.name not implemented');
  }

  /** @returns {StrategyVote} */
  evaluate() {
    throw new Error('strategy.evaluate not implemented');
  }

  /** Helper to build a well-formed, clamped vote. */
  vote(score, confidence, reasons) {
    const clamped = Math.max(-2, Math.min(2, score));
    return {
      strategy: this.name,
      action: actionFromScore(clamped),
      score: Number(clamped.toFixed(3)),
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
      reasons: reasons.filter(Boolean),
    };
  }

  hold(reasons = ['no edge detected']) {
    return {
      strategy: this.name,
      action: SIGNAL_ACTIONS.HOLD,
      score: 0,
      confidence: 0.1,
      reasons,
    };
  }
}

module.exports = BaseStrategy;
