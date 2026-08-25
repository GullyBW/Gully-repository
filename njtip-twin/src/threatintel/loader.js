'use strict';
// Threat Intelligence integration — EXTENSION POINTS ONLY, offline by design.
// Loads local feed files (no network) describing new attack models / emerging
// techniques as metadata. Feeds can (a) flag coverage gaps against the existing
// simulation library and (b) declare desired new scenarios for engineers to
// implement. Feeds never inject executable code — attack *models*, not attack code.
const fs = require('node:fs');
const path = require('node:path');

function loadFeeds(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  return files.map((f) => {
    const feed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { file: f, ...feed };
  });
}

// Compare feed-declared techniques to the current simulation coverage.
function coverageGaps(feeds, existingSimIds) {
  const have = new Set(existingSimIds);
  const gaps = [];
  for (const feed of feeds) {
    for (const tech of feed.techniques || []) {
      const covered = (tech.mapsToSim && have.has(tech.mapsToSim));
      if (!covered) gaps.push({ feed: feed.file, id: tech.id, name: tech.name, suggestedSim: tech.suggestedSim || null });
    }
  }
  return gaps;
}

module.exports = { loadFeeds, coverageGaps };
