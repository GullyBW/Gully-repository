'use strict';

/**
 * Deterministic pseudo-random helpers so generated datasets are byte-for-byte
 * reproducible given the same seed (Phase 2 reproducibility requirement).
 * Uses mulberry32 — small, fast, good enough for synthetic data.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }

  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick: items = [[value, weight], ...]. */
  weighted(items) {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, w] of items) {
      r -= w;
      if (r <= 0) return value;
    }
    return items[items.length - 1][0];
  }

  bool(pTrue = 0.5) {
    return this.next() < pTrue;
  }
}

module.exports = { Rng, mulberry32 };
