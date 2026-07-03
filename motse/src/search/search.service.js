'use strict';

const { err } = require('../kernel/errors');

/**
 * Search service (doc §6.1 "search index"): an inverted index over the
 * public read models of every module, kept current by domain events and
 * rebuildable with reindex().
 *
 * Cultural-safety contract (§6.4, fail closed):
 *  - only PUBLIC, live heritage enters the index — the source of truth
 *    is heritage.publicSearchIndex(), the same fail-closed filter that
 *    guards packs and exports;
 *  - lessons inherit their source item's visibility: only lessons whose
 *    source is publicly indexable are searchable;
 *  - family circles are searchable ONLY by their own members;
 *  - restricted anything simply does not exist in the index — there is
 *    no "admin bypass" flag on the query path.
 *
 * Production swaps the in-memory index for a managed engine behind this
 * same surface; the indexing filters run BEFORE documents leave Motse,
 * so a misconfigured engine can still never see restricted data.
 */
const PUBLIC_TYPES = ['heritage', 'village', 'council', 'tourism', 'music', 'lesson', 'trust'];

class SearchService {
  constructor({ store, clock, bus, platform }) {
    this.clock = clock;
    this.bus = bus;
    this.platform = platform;
    this.documents = new Map(); // docKey -> { type, id, text, payload, members_only_circle }
    this.index = new Map(); // token -> Set(docKey)

    // Event-driven index maintenance.
    const resync = () => this.reindex();
    for (const type of [
      'heritage.item.published',
      'heritage.item.validated',
      'heritage.item.withdrawn',
    ]) {
      bus.subscribe(type, 'search-indexer', resync);
    }
  }

  // ── Indexing ───────────────────────────────────────────────────────

  static tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // diacritics (Ikalanga orthography)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
  }

  reindex() {
    this.documents.clear();
    this.index.clear();
    const p = this.platform;

    // Heritage: the fail-closed public filter is the ONLY source.
    for (const item of p.heritage.publicSearchIndex()) {
      this._add('heritage', item.id, `${item.title || ''} ${item.type} ${item.morafe_ref}`, {
        title: item.title,
        morafe_ref: item.morafe_ref,
        state: item.state,
      });
    }
    // Villages / places: public layers only (sacred flags ride along as
    // metadata; restricted narration was never in this read model).
    for (const place of p.mafelo.places.find()) {
      this._add('village', place.id, `${place.name} ${place.district}`, {
        name: place.name,
        district: place.district,
      });
    }
    // Councils.
    for (const council of p.governance.councils.find()) {
      this._add('council', council.id, `council ${council.morafe_ref}`, {
        morafe_ref: council.morafe_ref,
      });
    }
    // Tourism experiences.
    for (const experience of p.loeto.experiences.find((e) => e.state === 'active')) {
      this._add('tourism', experience.id, experience.title, { title: experience.title });
    }
    // Music.
    for (const track of p.mmino.tracks.find()) {
      this._add('music', track.id, track.title, { title: track.title });
    }
    // Lessons: ONLY when the source heritage item is publicly indexable.
    const publicHeritage = new Set(p.heritage.publicSearchIndex().map((i) => i.id));
    for (const lesson of p.puo.lessons.find()) {
      if (!publicHeritage.has(lesson.source_item_ref)) continue; // fail closed
      this._add('lesson', lesson.id, `lesson ${lesson.level} ${lesson.morafe_ref}`, {
        level: lesson.level,
        course_ref: lesson.course_ref,
      });
    }
    // Trusts: public metadata (name) only.
    for (const trust of p.letlole.trusts.find()) {
      this._add('trust', trust.id, trust.name, { name: trust.name });
    }
    // Family circles: indexed, but query-scoped to members (see search()).
    for (const circle of p.lelapa.circles.find()) {
      this._add('family', circle.id, circle.name, { name: circle.name }, circle.id);
    }
    return { documents: this.documents.size };
  }

  _add(type, docId, text, payload, membersOnlyCircle = null) {
    const key = `${type}:${docId}`;
    this.documents.set(key, { type, id: docId, payload, members_only_circle: membersOnlyCircle });
    for (const token of SearchService.tokenize(text)) {
      if (!this.index.has(token)) this.index.set(token, new Set());
      this.index.get(token).add(key);
    }
  }

  // ── Query ──────────────────────────────────────────────────────────

  search(query, { types = null, readerRef = null, limit = 20 } = {}) {
    if (!query || String(query).trim().length < 2) {
      throw err('INVALID_ARGUMENT', 'Query must be at least 2 characters');
    }
    const tokens = SearchService.tokenize(query);
    const scores = new Map();
    for (const token of tokens) {
      // Prefix match: "tsodi" finds "tsodilo".
      for (const [indexedToken, docKeys] of this.index) {
        if (indexedToken === token || indexedToken.startsWith(token)) {
          const weight = indexedToken === token ? 2 : 1;
          for (const key of docKeys) scores.set(key, (scores.get(key) || 0) + weight);
        }
      }
    }
    const results = [];
    for (const [key, score] of [...scores.entries()].sort((a, b) => b[1] - a[1])) {
      const doc = this.documents.get(key);
      if (types && !types.includes(doc.type)) continue;
      // Family circles: members only — everyone else gets nothing, not
      // an error (their existence is not disclosed).
      if (doc.members_only_circle) {
        if (!readerRef) continue;
        const circle = this.platform.lelapa.circles.get(doc.members_only_circle);
        if (!circle || !circle.members.includes(readerRef)) continue;
      }
      results.push({ type: doc.type, id: doc.id, score, ...doc.payload });
      if (results.length >= limit) break;
    }
    return { query, results };
  }
}

module.exports = { SearchService, PUBLIC_TYPES };
