'use strict';
// Semantic Search Platform (Phase 30). Extends the privacy-preserving inverted index with
// concept expansion, synonym recognition, intent parsing, context-aware ranking, EXPLAINABLE
// scoring, and hybrid keyword/semantic retrieval. Deterministic.
//
// PRIVACY: identity NEVER participates in semantic indexing. The synonym/concept space
// contains only non-identifying operational terms; the underlying index already refuses
// identity/content fields (adapters/search.js). No personal data is expanded or ranked.
const { SearchIndex } = require('../adapters/search');

// Concept → synonymous operational terms (NON-identifying only). Reviewable configuration.
const SYNONYMS = {
  corruption: ['bribery', 'graft', 'kickback', 'embezzlement'],
  police: ['officer', 'constabulary', 'law-enforcement'],
  courts: ['judiciary', 'tribunal', 'magistrate'],
  escalated: ['urgent', 'elevated', 'priority'],
  procurement: ['tender', 'contract', 'purchasing'],
};
// Reverse index: term → concept (for expansion in either direction).
const TERM_TO_CONCEPT = {};
for (const [concept, terms] of Object.entries(SYNONYMS)) for (const t of terms) TERM_TO_CONCEPT[t] = concept;

// Expand a query into its concept neighbourhood, with an explanation of every added term.
function expandQuery(query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = new Set(tokens); const explanation = [];
  for (const tok of tokens) {
    const concept = TERM_TO_CONCEPT[tok] || (SYNONYMS[tok] ? tok : null);
    if (concept) { for (const syn of SYNONYMS[concept] || []) if (!expanded.has(syn)) { expanded.add(syn); explanation.push(`'${syn}' added via concept '${concept}'`); } if (!expanded.has(concept)) { expanded.add(concept); explanation.push(`'${concept}' added as concept root`); } }
  }
  return { original: tokens, expanded: [...expanded], explanation };
}

// Simple intent parsing: recognise a status/category filter intent within a NL query.
const STATUSES = ['received', 'reviewed', 'escalated', 'resolved', 'closed'];
const CATEGORIES = ['police', 'courts', 'prosecution', 'prison', 'official', 'regulatory', 'other'];
function parseIntent(query) {
  const q = String(query || '').toLowerCase();
  const intent = {};
  for (const s of STATUSES) if (q.includes(s)) intent.status = s;
  for (const c of CATEGORIES) if (q.includes(c)) intent.category = c;
  return intent;
}

class SemanticSearch {
  // fieldWeights make ranking context-aware (e.g. status/category weigh more than recipient).
  constructor(index, { fieldWeights = { category: 3, status: 3, band: 2, recipient: 1, stage: 1 } } = {}) { this._idx = index || new SearchIndex(); this._w = fieldWeights; }
  index(doc) { return this._idx.index(doc); }

  // Hybrid search: exact keyword hits + concept-expanded (semantic) hits, ranked with an
  // EXPLAINABLE score. Never indexes/ranks identity (guaranteed by the underlying index).
  search(query, { limit = 20 } = {}) {
    const { expanded, explanation } = expandQuery(query);
    const intent = parseIntent(query);
    const scores = new Map(); const why = new Map();
    // Keyword layer (original tokens weigh full).
    for (const tok of String(query || '').toLowerCase().split(/\s+/).filter(Boolean)) this._score(tok, 1.0, scores, why, 'keyword');
    // Semantic layer (expanded terms weigh less).
    for (const tok of expanded) this._score(tok, 0.6, scores, why, 'semantic');
    let results = [...scores.entries()].map(([id, score]) => ({ case_code: id, score: +score.toFixed(2), matchedOn: [...(why.get(id) || [])] }));
    // Intent filter (context): keep only docs matching a recognised status/category intent.
    if (intent.status || intent.category) results = results.filter((r) => this._matchesIntent(r.case_code, intent));
    results.sort((a, b) => b.score - a.score || a.case_code.localeCompare(b.case_code));
    return { query, intent, expansion: explanation, results: results.slice(0, limit) };
  }
  _score(term, weight, scores, why, layer) {
    for (const hit of this._idx.search(term, { limit: 100 })) {
      const w = weight * (this._fieldWeightForTerm(hit, term));
      scores.set(hit.case_code, (scores.get(hit.case_code) || 0) + w);
      if (!why.has(hit.case_code)) why.set(hit.case_code, new Set());
      why.get(hit.case_code).add(`${layer}:${term}`);
    }
  }
  _fieldWeightForTerm(hit, term) { let w = 1; for (const [f, weight] of Object.entries(this._w)) if (String(hit[f] || '').toLowerCase().includes(term)) w = Math.max(w, weight); return w; }
  _matchesIntent(id, intent) { const doc = (this._idx.doc && this._idx.doc(id)) || {}; return (!intent.status || doc.status === intent.status) && (!intent.category || doc.category === intent.category); }
}

// Search quality metrics over a labelled (synthetic) relevance set.
function qualityMetrics(returnedIds, relevantIds) {
  const rel = new Set(relevantIds); const ret = new Set(returnedIds);
  const tp = [...ret].filter((id) => rel.has(id)).length;
  const precision = ret.size ? tp / ret.size : 0;
  const recall = rel.size ? tp / rel.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: +precision.toFixed(2), recall: +recall.toFixed(2), f1: +f1.toFixed(2) };
}

module.exports = { SemanticSearch, expandQuery, parseIntent, qualityMetrics, SYNONYMS };
