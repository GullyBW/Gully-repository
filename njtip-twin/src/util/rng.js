'use strict';
// Deterministic, seeded PRNG (mulberry32). NO Math.random anywhere in the twin,
// so every run is reproducible and evidence is bit-for-bit comparable.
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

// A deterministic logical clock (no Date.now in hashed content -> reproducible).
function logicalClock(start = 1_700_000_000_000) {
  let t = start;
  return () => (t += 1000); // +1s per tick
}

module.exports = { mulberry32, logicalClock };
