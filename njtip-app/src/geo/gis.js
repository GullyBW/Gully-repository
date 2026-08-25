'use strict';
// Geographic Intelligence Platform (Phase 15). Spatial indexing (geohash), incident mapping,
// privacy-preserving heat maps, jurisdiction boundaries, and regional analytics. Deterministic.
//
// PRIVACY: precise coordinates are NEVER stored — points are COARSENED to a low-precision
// geohash on ingest (spatial k-anonymity), so an incident cannot be pinned to an individual
// location. Heat maps additionally SUPPRESS small cells. Synthetic coordinates only.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

// Encode lat/lon to a geohash of `precision` chars. Lower precision = coarser (more private).
function geohash(lat, lon, precision = 5) {
  let latR = [-90, 90], lonR = [-180, 180], hashStr = '', bit = 0, ch = 0, even = true;
  while (hashStr.length < precision) {
    const rng = even ? lonR : latR; const val = even ? lon : lat; const mid = (rng[0] + rng[1]) / 2;
    if (val >= mid) { ch = (ch << 1) | 1; rng[0] = mid; } else { ch = ch << 1; rng[1] = mid; }
    even = !even;
    if (++bit === 5) { hashStr += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hashStr;
}

class SpatialIndex {
  // precision is the STORED precision (privacy floor). Default 5 (~±2.4km cells).
  constructor({ precision = 5 } = {}) { this._precision = precision; this._cells = new Map(); }
  // Add an incident by opaque id at a coordinate — only the coarsened geohash is retained.
  add(id, lat, lon, attrs = {}) {
    const cell = geohash(lat, lon, this._precision);
    if (!this._cells.has(cell)) this._cells.set(cell, []);
    this._cells.get(cell).push({ id, cell, attrs }); // no raw lat/lon stored
    return cell;
  }
  cell(id, lat, lon) { return geohash(lat, lon, this._precision); }
  // Heat map: incident counts per cell, with SMALL-CELL SUPPRESSION (k-anonymity).
  heatmap({ k = 5 } = {}) {
    const out = {};
    for (const [cell, items] of this._cells) out[cell] = items.length < k ? { count: null, suppressed: true } : { count: items.length };
    return { precision: this._precision, cells: out };
  }
  // Incidents within a jurisdiction (a set of cell prefixes) — coarse containment.
  within(prefix) { return [...this._cells.keys()].filter((c) => c.startsWith(prefix)).reduce((n, c) => n + this._cells.get(c).length, 0); }
}

// Jurisdiction boundaries expressed as geohash prefixes (coarse regions). Synthetic.
const JURISDICTIONS = {
  'south-east': 'k3f', 'central': 'k3g', 'north-west': 'k3u',
};
function regionalAnalytics(index, jurisdictions = JURISDICTIONS) {
  const out = {};
  for (const [name, prefix] of Object.entries(jurisdictions)) out[name] = index.within(prefix);
  return out;
}

module.exports = { geohash, SpatialIndex, JURISDICTIONS, regionalAnalytics };
