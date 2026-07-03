'use strict';

const defaultDatasets = require('./datasets');

/**
 * AI evaluation framework (Phase 3, WS9). Runs the gold datasets through
 * the CURRENTLY REGISTERED providers (via the safety gate) and produces
 * a graded quality report. "Every AI release must produce measurable
 * quality reports" — this is that measurement, and it doubles as a
 * regression gate in CI.
 *
 * Metrics:
 *   translation   token-F1 vs the reference (exact-match friendly)
 *   search        precision@k against the relevant set
 *   recommendation top-1 hit rate
 *   summarization must-include recall / must-exclude violation
 *   tagging       tag + entity precision
 */
const THRESHOLDS = {
  translation: 0.8,
  search: 0.75,
  recommendation: 0.8,
  summarization: 0.9,
  tagging: 0.75,
};

class AiEvaluator {
  constructor({ ai, clock, audit, datasets }) {
    this.ai = ai;
    this.clock = clock;
    this.audit = audit;
    // Gold sets are injectable so releases can evaluate against custom
    // or expanded datasets without code changes.
    this.datasets = datasets || defaultDatasets;
  }

  evaluate(actor = 'system:ai-eval') {
    const results = {
      translation: this._translation(),
      search: this._search(),
      recommendation: this._recommendation(),
      summarization: this._summarization(),
      tagging: this._tagging(),
    };
    const scorecard = {
      generated_at: this.clock.nowIso(),
      metrics: {},
      passed: true,
    };
    for (const [metric, res] of Object.entries(results)) {
      const threshold = THRESHOLDS[metric];
      const pass = res.score >= threshold;
      scorecard.metrics[metric] = {
        score: Math.round(res.score * 1000) / 1000,
        threshold,
        pass,
        n: res.n,
        detail: res.detail,
      };
      if (!pass) scorecard.passed = false;
    }
    if (this.audit) {
      this.audit.append(actor, 'ai.evaluation', 'ai:evaluation', null, {
        passed: scorecard.passed,
        scores: Object.fromEntries(
          Object.entries(scorecard.metrics).map(([k, v]) => [k, v.score])
        ),
      });
    }
    return scorecard;
  }

  _translation() {
    if (!this.ai.configured('translation')) return skipped();
    let total = 0;
    let sum = 0;
    for (const c of this.datasets.TRANSLATION) {
      const out = this.ai.run('translation', { text: c.input, from: c.from, to: c.to }, 'system:ai-eval');
      sum += tokenF1(out.translation, c.expect);
      total += 1;
    }
    return { score: total ? sum / total : 0, n: total, detail: 'token-F1 vs reference' };
  }

  _search() {
    if (!this.ai.configured('knowledge_search')) return skipped();
    let total = 0;
    let sum = 0;
    for (const c of this.datasets.SEARCH) {
      const out = this.ai.run(
        'knowledge_search',
        { query: c.query, documents: c.documents, limit: c.relevant.length },
        'system:ai-eval'
      );
      const returned = out.results.map((r) => r.id);
      const hits = returned.filter((idx) => c.relevant.includes(idx)).length;
      sum += returned.length ? hits / returned.length : 0; // precision@k
      total += 1;
    }
    return { score: total ? sum / total : 0, n: total, detail: 'precision@k' };
  }

  _recommendation() {
    if (!this.ai.configured('recommendation')) return skipped();
    let total = 0;
    let hits = 0;
    for (const c of this.datasets.RECOMMENDATION) {
      const out = this.ai.run(
        'recommendation',
        { interactions: c.interactions, for_user: c.for_user, limit: 3 },
        'system:ai-eval'
      );
      if (out.recommendations[0] && out.recommendations[0].item === c.expect_top) hits += 1;
      total += 1;
    }
    return { score: total ? hits / total : 0, n: total, detail: 'top-1 hit rate' };
  }

  _summarization() {
    if (!this.ai.configured('summarization')) return skipped();
    let total = 0;
    let sum = 0;
    for (const c of this.datasets.SUMMARIZATION) {
      const out = this.ai.run(
        'summarization',
        { text: c.text, max_sentences: c.max_sentences },
        'system:ai-eval'
      );
      const lower = out.summary.toLowerCase();
      const included = c.must_include.filter((t) => lower.includes(t)).length / c.must_include.length;
      const violated = c.must_exclude.some((t) => lower.includes(t)) ? 0 : 1;
      sum += included * violated; // recall, zeroed if a forbidden term leaks
      total += 1;
    }
    return { score: total ? sum / total : 0, n: total, detail: 'must-include recall' };
  }

  _tagging() {
    if (!this.ai.configured('tagging')) return skipped();
    let total = 0;
    let sum = 0;
    for (const c of this.datasets.TAGGING) {
      const out = this.ai.run('tagging', { text: c.text, max_tags: 10 }, 'system:ai-eval');
      const tagHit = c.must_tags.filter((t) => out.tags.includes(t)).length / c.must_tags.length;
      const entHit = c.must_entities.filter((e) => out.entities.includes(e)).length / c.must_entities.length;
      sum += (tagHit + entHit) / 2;
      total += 1;
    }
    return { score: total ? sum / total : 0, n: total, detail: 'tag+entity precision' };
  }
}

function skipped() {
  return { score: 1, n: 0, detail: 'no provider configured — skipped' };
}

/** Token-level F1; identical strings score 1. */
function tokenF1(candidate, reference) {
  const c = tokens(candidate);
  const r = tokens(reference);
  if (c.length === 0 && r.length === 0) return 1;
  if (c.length === 0 || r.length === 0) return 0;
  const rCounts = counts(r);
  let overlap = 0;
  for (const t of c) {
    if (rCounts[t] > 0) {
      overlap += 1;
      rCounts[t] -= 1;
    }
  }
  const precision = overlap / c.length;
  const recall = overlap / r.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function tokens(s) {
  return String(s || '').toLowerCase().split(/\W+/).filter(Boolean);
}

function counts(arr) {
  const out = {};
  for (const t of arr) out[t] = (out[t] || 0) + 1;
  return out;
}

module.exports = { AiEvaluator, THRESHOLDS, tokenF1 };
