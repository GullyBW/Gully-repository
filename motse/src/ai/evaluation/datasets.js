'use strict';

/**
 * AI evaluation datasets (Phase 3, WS9). Curated gold sets across the
 * platform's domains — Setswana/English, heritage terminology, tourism,
 * genealogy, education. Small but real: enough to produce a measurable,
 * regression-catching quality signal for every AI release.
 *
 * Keep entries plain data so non-engineers can extend the gold sets.
 */
const TRANSLATION = [
  { from: 'tn', to: 'en', input: 'Dumela mma', expect: 'hello madam' },
  { from: 'tn', to: 'en', input: 'Ke a leboga', expect: 'thank you' },
  { from: 'tn', to: 'en', input: 'Tsamaya sentle', expect: 'go well' },
  { from: 'tn', to: 'en', input: 'pula', expect: 'rain' },
  { from: 'tn', to: 'en', input: 'kgosi', expect: 'chief' },
  { from: 'tn', to: 'en', input: 'lelapa', expect: 'family' },
  { from: 'en', to: 'tn', input: 'money', expect: 'madi' },
  { from: 'en', to: 'tn', input: 'water', expect: 'metsi' },
  { from: 'en', to: 'tn', input: 'village', expect: 'motse' },
  { from: 'en', to: 'tn', input: 'child', expect: 'ngwana' },
];

// Search precision: query → the doc ids that SHOULD rank in the top-k.
const SEARCH = [
  {
    query: 'rock paintings tsodilo',
    documents: [
      { id: 'h1', text: 'The rock paintings at Tsodilo hills, ancestral art of the San' },
      { id: 'h2', text: 'Sorghum harvest and threshing songs' },
      { id: 'h3', text: 'Tsodilo rock art and its painting traditions' },
      { id: 'h4', text: 'Cattle herding routes across the Kalahari' },
    ],
    relevant: ['h1', 'h3'],
  },
  {
    query: 'chief succession bogosi',
    documents: [
      { id: 'g1', text: 'Bogosi succession and the role of the kgotla' },
      { id: 'g2', text: 'Weaving baskets from mokola palm' },
      { id: 'g3', text: 'The chief and council in dispute resolution' },
    ],
    relevant: ['g1', 'g3'],
  },
];

// Tourism recommendation: seed interactions → items expected to surface.
const RECOMMENDATION = [
  {
    interactions: [
      { user: 'u1', item: 'tsodilo-tour' }, { user: 'u1', item: 'delta-mokoro' },
      { user: 'u2', item: 'tsodilo-tour' }, { user: 'u2', item: 'delta-mokoro' },
      { user: 'u2', item: 'makgadikgadi-walk' }, { user: 'u3', item: 'tsodilo-tour' },
    ],
    for_user: 'u3',
    expect_top: 'delta-mokoro',
  },
];

// Summarization: text → key terms the summary should retain (recall).
const SUMMARIZATION = [
  {
    text:
      'The kgotla met about the borehole. The borehole repair fund was discussed. ' +
      'The weather was mild. The borehole fund reached its target. The community thanked donors for the borehole.',
    must_include: ['borehole'],
    must_exclude: ['weather'],
    max_sentences: 2,
  },
];

// Tagging: text → tags that must appear, and entities to detect.
const TAGGING = [
  {
    text: 'A praise poem recorded at Tsodilo about cattle, rain and the bakalanga lineage',
    must_tags: ['cattle', 'rain'],
    must_entities: ['tsodilo', 'bakalanga'],
  },
];

module.exports = { TRANSLATION, SEARCH, RECOMMENDATION, SUMMARIZATION, TAGGING };
