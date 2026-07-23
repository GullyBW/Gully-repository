'use strict';
// Synthetic Data Platform (blueprint phase8/02). FULLY GENERATIVE — no real seed
// data, no real identifiers. Deterministic (seeded). Reports carry NO identity by
// construction (that is the point). Everything is labelled SYNTHETIC.
const { mulberry32 } = require('../util/rng');

const CATEGORIES = ['police', 'courts', 'prosecution', 'prison', 'official', 'regulatory', 'other'];
const LANGS = ['en', 'tn']; // English, Setswana
// Fictitious content fragments — describe generic, non-identifying concerns only.
const FRAGMENTS = [
  'observed irregular handling of a case file',
  'a request for improper payment was implied',
  'evidence appeared to be mishandled',
  'a scheduled hearing was delayed without reason',
  'access to records was refused without basis',
];

function makeReports(seed, n) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const cat = CATEGORIES[Math.floor(rnd() * CATEGORIES.length)];
    const lang = LANGS[Math.floor(rnd() * LANGS.length)];
    const frag = FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)];
    // case_code is high-entropy + SYNTHETIC-labelled; NO identity anywhere.
    const code = 'SYN-' + Math.floor(rnd() * 1e9).toString(36).toUpperCase().padStart(6, '0');
    out.push({ synthetic: true, case_code: code, category: cat, lang, content: `[${lang}] ${frag}` });
  }
  return out;
}

function makeEvidence(seed, n) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ synthetic: true, id: 'EV-' + i, content: `synthetic-evidence-blob-${Math.floor(rnd() * 1e6)}` });
  }
  return out;
}

module.exports = { makeReports, makeEvidence, CATEGORIES };
