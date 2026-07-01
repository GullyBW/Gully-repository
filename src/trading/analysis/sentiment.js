'use strict';

/**
 * Finance-tuned sentiment analysis for news headlines and bodies.
 *
 * Bank desks have historically been slow to fuse unstructured news into
 * signals — it sits in a separate silo from price. This is a fast, fully
 * transparent lexical scorer (inspired by the Loughran–McDonald financial
 * dictionary) with negation handling and domain phrases, so a headline can move
 * a signal within the same tick it arrives. Every score is explainable: the
 * matched terms are returned alongside the number.
 *
 * Scores are normalised to [-1, 1]. It is intentionally simple and dependency
 * free; swap in a hosted NLP model behind the same `analyze()` contract when
 * one is available.
 */

// Positive / negative financial lexicons with per-term weights.
const POSITIVE = {
  beat: 2, beats: 2, surge: 2, surged: 2, soar: 2, soared: 2, rally: 2, rallied: 2,
  jump: 1.5, jumped: 1.5, gain: 1.5, gains: 1.5, rose: 1.5, rise: 1.5, climb: 1.5,
  upgrade: 2, upgraded: 2, outperform: 2, bullish: 2, record: 1.5, profit: 1.5,
  profitable: 1.5, growth: 1.5, expand: 1, expansion: 1, strong: 1.5, robust: 1.5,
  exceeded: 2, exceed: 2, beat_expectations: 3, tops: 1.5, top: 1, boost: 1.5,
  boosted: 1.5, dividend: 1, buyback: 1.5, breakthrough: 2, approval: 1.5, approved: 1.5,
  win: 1.5, wins: 1.5, won: 1.5, optimistic: 1.5, momentum: 1, accelerate: 1.5,
  raise: 1, raised: 1, higher: 1, positive: 1.5, recovery: 1.5, rebound: 1.5,
};

const NEGATIVE = {
  miss: 2, missed: 2, misses: 2, plunge: 2, plunged: 2, plummet: 2, slump: 2,
  crash: 2.5, crashed: 2.5, tumble: 2, tumbled: 2, fall: 1.5, fell: 1.5, drop: 1.5,
  dropped: 1.5, decline: 1.5, declined: 1.5, downgrade: 2, downgraded: 2, bearish: 2,
  loss: 1.5, losses: 1.5, weak: 1.5, weakness: 1.5, warning: 2, warn: 2, warned: 2,
  cut: 1.5, cuts: 1.5, slash: 2, slashed: 2, lawsuit: 2, probe: 1.5, investigation: 1.5,
  fraud: 3, bankruptcy: 3, bankrupt: 3, default: 2.5, recall: 2, layoff: 2, layoffs: 2,
  underperform: 2, disappointing: 2, disappoint: 2, concern: 1, concerns: 1, risk: 1,
  fear: 1.5, fears: 1.5, selloff: 2, sell_off: 2, lower: 1, negative: 1.5, halt: 2,
  halted: 2, delay: 1.5, delayed: 1.5, subpoena: 2, sec_probe: 2.5, recession: 2,
};

// Words that flip the polarity of the term that follows.
const NEGATORS = new Set(['not', 'no', 'never', 'without', 'fails', 'fail', 'failed', "n't"]);
// Words that amplify or dampen the following term.
const INTENSIFIERS = { very: 1.5, sharply: 1.5, significantly: 1.5, slightly: 0.5, marginally: 0.5 };

// Multi-word phrases checked before tokenisation (mapped to underscore keys).
const PHRASES = [
  ['beat expectations', 'beat_expectations'],
  ['sell off', 'sell_off'],
  ['sec probe', 'sec_probe'],
];

function tokenize(text) {
  let t = ` ${String(text).toLowerCase()} `;
  for (const [phrase, key] of PHRASES) {
    t = t.split(phrase).join(` ${key} `);
  }
  return t
    .replace(/[^a-z0-9_'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Score a single piece of text.
 * @returns {{ score: number, label: string, magnitude: number, matches: object[] }}
 */
function analyze(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, label: 'neutral', magnitude: 0, matches: [] };
  }
  const tokens = tokenize(text);
  const matches = [];
  let total = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i];
    let weight = 0;
    let polarity = 0;
    if (POSITIVE[word] != null) {
      weight = POSITIVE[word];
      polarity = 1;
    } else if (NEGATIVE[word] != null) {
      weight = NEGATIVE[word];
      polarity = -1;
    } else {
      continue;
    }

    // Look back up to two tokens for negators / intensifiers.
    let multiplier = 1;
    let negated = false;
    for (let j = Math.max(0, i - 2); j < i; j += 1) {
      if (NEGATORS.has(tokens[j])) negated = true;
      if (INTENSIFIERS[tokens[j]] != null) multiplier *= INTENSIFIERS[tokens[j]];
    }
    const contribution = polarity * weight * multiplier * (negated ? -1 : 1);
    total += contribution;
    matches.push({ term: word, contribution: Number(contribution.toFixed(2)), negated });
  }

  // Squash the raw total into [-1, 1] so long articles do not dominate.
  const score = Math.tanh(total / 4);
  return {
    score: Number(score.toFixed(4)),
    label: labelFor(score),
    magnitude: Number(Math.abs(score).toFixed(4)),
    matches,
  };
}

function labelFor(score) {
  if (score >= 0.5) return 'very_positive';
  if (score >= 0.15) return 'positive';
  if (score <= -0.5) return 'very_negative';
  if (score <= -0.15) return 'negative';
  return 'neutral';
}

/**
 * Aggregate sentiment across many news items, weighting recent items more
 * heavily (exponential time decay) so stale news fades from the signal.
 * @param {Array<{ headline?: string, summary?: string, publishedAt?: Date|string, weight?: number }>} items
 * @param {{ halfLifeMinutes?: number, now?: number }} [opts]
 */
function aggregate(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { score: 0, label: 'neutral', count: 0, items: [] };
  }
  const halfLife = (opts.halfLifeMinutes || 120) * 60 * 1000;
  const now = opts.now || Date.now();
  let weightedSum = 0;
  let weightTotal = 0;
  const scored = items.map((item) => {
    const text = [item.headline, item.summary].filter(Boolean).join('. ');
    const s = analyze(text);
    const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : now;
    const ageMs = Math.max(0, now - publishedAt);
    const decay = Math.pow(0.5, ageMs / halfLife);
    const weight = (item.weight || 1) * decay;
    weightedSum += s.score * weight;
    weightTotal += weight;
    return { ...item, sentiment: s, decayWeight: Number(weight.toFixed(4)) };
  });
  const score = weightTotal === 0 ? 0 : weightedSum / weightTotal;
  return {
    score: Number(score.toFixed(4)),
    label: labelFor(score),
    count: items.length,
    items: scored,
  };
}

module.exports = { analyze, aggregate, labelFor };
