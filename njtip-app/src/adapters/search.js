'use strict';
// Full-text search PORT — an inverted index over NON-IDENTIFYING case metadata only.
// Reference implementation is an in-memory inverted index; production drivers are
// OpenSearch/Elasticsearch/Postgres FTS with the SAME index/search interface.
//
// PRIVACY INVARIANT (fail-closed): the index REFUSES any field that could identify a
// reporter or carry case content. Only an allow-list of operational fields is indexable
// (category, status, stage, band, recipient, case_code). Identity does not exist in the
// domain; content is never projected here. Independently checked by an app fitness function.
const ALLOWED_FIELDS = new Set(['case_code', 'category', 'status', 'stage', 'band', 'recipient']);
const DENIED_FIELDS = new Set(['omang', 'name', 'email', 'phone', 'ip', 'address', 'content', 'body', 'plaintext', 'nationalid', 'passport']);

function tokenize(v) { return String(v).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

class SearchIndex {
  constructor() { this._postings = new Map(); this._docs = new Map(); }

  // Index a document. Throws (fail-closed) if a denied field is present; ignores any field
  // not on the allow-list so nothing sensitive can be indexed even by accident.
  index(doc) {
    const id = doc.case_code; if (!id) throw new Error('search: case_code is required');
    for (const k of Object.keys(doc)) if (DENIED_FIELDS.has(k.toLowerCase())) throw new Error(`search refuses to index a sensitive field: ${k}`);
    this.remove(id);
    const fields = {};
    for (const [k, val] of Object.entries(doc)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      fields[k] = val;
      for (const tok of tokenize(val)) {
        const key = `${k}:${tok}`;
        if (!this._postings.has(key)) this._postings.set(key, new Set());
        this._postings.get(key).add(id);
        if (!this._postings.has(tok)) this._postings.set(tok, new Set()); // free-text (any field)
        this._postings.get(tok).add(id);
      }
    }
    this._docs.set(id, fields);
    return { indexed: id, terms: Object.keys(fields).length };
  }
  remove(id) { if (!this._docs.has(id)) return false; for (const set of this._postings.values()) set.delete(id); this._docs.delete(id); return true; }

  // Search: space-separated terms (AND). A `field:term` scopes to a field. Returns matching
  // case_codes ranked by number of term hits (deterministic tie-break by id).
  search(query, { limit = 50 } = {}) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const score = new Map();
    let candidates = null;
    for (const term of terms) {
      const set = this._postings.get(term) || new Set();
      candidates = candidates === null ? new Set(set) : new Set([...candidates].filter((id) => set.has(id)));
      for (const id of set) score.set(id, (score.get(id) || 0) + 1);
    }
    return [...(candidates || [])]
      .sort((a, b) => (score.get(b) - score.get(a)) || a.localeCompare(b))
      .slice(0, limit)
      .map((id) => ({ case_code: id, ...this._docs.get(id) }));
  }
  size() { return this._docs.size; }
}

function makeSearchIndex(cfg = {}) {
  if (cfg.search && cfg.search !== 'memory') {
    throw new Error(`search driver '${cfg.search}' is a documented drop-in (OpenSearch/ES/PG-FTS); not bundled in-repo`);
  }
  return new SearchIndex();
}

module.exports = { SearchIndex, makeSearchIndex, ALLOWED_FIELDS, DENIED_FIELDS };
