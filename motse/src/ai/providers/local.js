'use strict';

const { AiProvider } = require('../registry');
const { err } = require('../../kernel/errors');

/**
 * Production LOCAL AI providers (Phase 2, WS8). These are real,
 * deterministic implementations that run in-process — no data leaves
 * the platform, which is why they are safe defaults for culturally
 * sensitive content that has PASSED the safety gate. Cloud adapters
 * (./cloud.js) supersede them per capability when configured.
 */

const STOPWORDS = new Set(
  ('a an and are as at be by for from has he in is it its of on or that the to was were will with ' +
    'le la ka mo go ya wa ba se di tsa kwa ke e o a').split(' ')
);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** TF-IDF + cosine semantic search over caller-supplied documents. */
class TfIdfSemanticSearchProvider extends AiProvider {
  constructor() {
    super('local-tfidf', 'knowledge_search');
  }

  run(task) {
    const documents = task.documents || [];
    const query = task.query;
    if (!query || documents.length === 0) {
      throw err('INVALID_ARGUMENT', 'knowledge_search needs { query, documents[] }');
    }
    const docTokens = documents.map((d) => tokenize(d.text));
    const df = new Map();
    for (const tokens of docTokens) {
      for (const term of new Set(tokens)) df.set(term, (df.get(term) || 0) + 1);
    }
    const idf = (term) => Math.log((1 + documents.length) / (1 + (df.get(term) || 0))) + 1;
    const vector = (tokens) => {
      const tf = new Map();
      for (const term of tokens) tf.set(term, (tf.get(term) || 0) + 1);
      const v = new Map();
      for (const [term, count] of tf) v.set(term, (count / tokens.length) * idf(term));
      return v;
    };
    const cosine = (a, b) => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (const [term, weight] of a) {
        na += weight * weight;
        if (b.has(term)) dot += weight * b.get(term);
      }
      for (const weight of b.values()) nb += weight * weight;
      return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
    };
    const queryVector = vector(tokenize(query));
    const results = documents
      .map((doc, i) => ({ id: doc.id, score: cosine(queryVector, vector(docTokens[i])) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, task.limit || 10);
    return { query, results };
  }
}

/** Frequency-scored extractive summarizer. */
class ExtractiveSummarizerProvider extends AiProvider {
  constructor() {
    super('local-extractive', 'summarization');
  }

  run(task) {
    const text = String(task.text || '');
    if (!text.trim()) throw err('INVALID_ARGUMENT', 'summarization needs { text }');
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const freq = new Map();
    for (const term of tokenize(text)) freq.set(term, (freq.get(term) || 0) + 1);
    const scored = sentences.map((sentence, index) => ({
      sentence: sentence.trim(),
      index,
      score:
        tokenize(sentence).reduce((s, t) => s + (freq.get(t) || 0), 0) /
        Math.max(tokenize(sentence).length, 1),
    }));
    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, task.max_sentences || 3)
      .sort((a, b) => a.index - b.index);
    return { summary: top.map((s) => s.sentence).join(' '), sentences_used: top.length };
  }
}

/** Keyword/entity metadata tagger. */
class MetadataTaggerProvider extends AiProvider {
  constructor({ knownEntities = [] } = {}) {
    super('local-tagger', 'tagging');
    this.knownEntities = knownEntities.map((e) => e.toLowerCase());
  }

  run(task) {
    const text = String(task.text || '');
    if (!text.trim()) throw err('INVALID_ARGUMENT', 'tagging needs { text }');
    const freq = new Map();
    for (const term of tokenize(text)) freq.set(term, (freq.get(term) || 0) + 1);
    const tags = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, task.max_tags || 8)
      .map(([term]) => term);
    const entities = this.knownEntities.filter((e) => text.toLowerCase().includes(e));
    return { tags, entities };
  }
}

/** Item-item co-occurrence recommender over pseudonymous interactions. */
class CooccurrenceRecommenderProvider extends AiProvider {
  constructor() {
    super('local-cooccurrence', 'recommendation');
    this.byUser = new Map(); // userAnon -> Set(item)
    this.popularity = new Map(); // item -> count
  }

  record(userAnon, item) {
    if (!this.byUser.has(userAnon)) this.byUser.set(userAnon, new Set());
    this.byUser.get(userAnon).add(item);
    this.popularity.set(item, (this.popularity.get(item) || 0) + 1);
  }

  run(task) {
    for (const interaction of task.interactions || []) {
      this.record(interaction.user, interaction.item);
    }
    const limit = task.limit || 5;
    const seed = task.for_item
      ? new Set([task.for_item])
      : this.byUser.get(task.for_user) || new Set();
    const scores = new Map();
    for (const items of this.byUser.values()) {
      const overlap = [...seed].filter((item) => items.has(item)).length;
      if (overlap === 0) continue;
      for (const item of items) {
        if (seed.has(item)) continue;
        scores.set(item, (scores.get(item) || 0) + overlap);
      }
    }
    let recommendations = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([item, score]) => ({ item, score }));
    if (recommendations.length === 0) {
      // Cold start: popular items the seed user has not seen.
      recommendations = [...this.popularity.entries()]
        .filter(([item]) => !seed.has(item))
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([item, score]) => ({ item, score, cold_start: true }));
    }
    return { recommendations };
  }
}

/**
 * Baseline Setswana ↔ English phrase translator. Greedy longest-match
 * over a curated phrase table — honest about its limits (`quality:
 * "baseline"`); the cloud adapter replaces it when configured.
 */
const PHRASES_TN_EN = [
  ['dumela mma', 'hello madam'], ['dumela rra', 'hello sir'], ['dumelang', 'greetings'],
  ['ke a leboga', 'thank you'], ['re a leboga', 'we thank you'], ['tsamaya sentle', 'go well'],
  ['sala sentle', 'stay well'], ['o kae', 'how are you'], ['ke teng', 'i am fine'],
  ['pula', 'rain'], ['madi', 'money'], ['motse', 'village'], ['kgosi', 'chief'],
  ['kgotla', 'community assembly'], ['lelapa', 'family'], ['letsema', 'work party'],
  ['morafe', 'people'], ['ngwana', 'child'], ['bana', 'children'], ['metsi', 'water'],
  ['tiro', 'work'], ['thuto', 'education'], ['puo', 'language'], ['setso', 'culture'],
  ['ditso', 'heritage'], ['mmino', 'music'], ['loeto', 'journey'], ['mafelo', 'places'],
  ['letlole', 'fund'], ['kgetsi', 'bag'], ['bogosi', 'chieftaincy'], ['tsala', 'friend'],
  ['ntlo', 'house'], ['mosadi', 'woman'], ['monna', 'man'], ['ngaka', 'doctor'],
  ['sekolo', 'school'], ['tshimo', 'field'], ['kgomo', 'cow'], ['dikgomo', 'cattle'],
  ['ee', 'yes'], ['nnyaa', 'no'], ['gompieno', 'today'], ['kamoso', 'tomorrow'],
  ['maabane', 'yesterday'], ['bosigo', 'night'], ['motshegare', 'daytime'],
  ['dijo', 'food'], ['tlhapi', 'fish'], ['nama', 'meat'], ['mabele', 'sorghum'],
];

class PhraseTranslatorProvider extends AiProvider {
  constructor() {
    super('local-phrase-translator', 'translation');
    this.tnToEn = new Map(PHRASES_TN_EN);
    this.enToTn = new Map(PHRASES_TN_EN.map(([tn, en]) => [en, tn]));
  }

  run(task) {
    const { text, from = 'tn', to = 'en' } = task;
    if (!text) throw err('INVALID_ARGUMENT', 'translation needs { text, from, to }');
    if (!((from === 'tn' && to === 'en') || (from === 'en' && to === 'tn'))) {
      throw err('INVALID_ARGUMENT', 'Baseline translator supports tn↔en only');
    }
    const table = from === 'tn' ? this.tnToEn : this.enToTn;
    // Greedy longest-match: try trigrams, bigrams, then single words.
    const words = String(text).toLowerCase().replace(/[^a-z'\s]/g, '').split(/\s+/).filter(Boolean);
    const out = [];
    let translated = 0;
    let i = 0;
    while (i < words.length) {
      let matched = false;
      for (let n = 3; n >= 1; n -= 1) {
        const phrase = words.slice(i, i + n).join(' ');
        if (table.has(phrase)) {
          out.push(table.get(phrase));
          translated += n;
          i += n;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out.push(words[i]);
        i += 1;
      }
    }
    return {
      translation: out.join(' '),
      from,
      to,
      quality: 'baseline',
      coverage_pct: words.length ? Math.round((translated / words.length) * 100) : 0,
    };
  }
}

module.exports = {
  TfIdfSemanticSearchProvider,
  ExtractiveSummarizerProvider,
  MetadataTaggerProvider,
  CooccurrenceRecommenderProvider,
  PhraseTranslatorProvider,
  tokenize,
};
