'use strict';
// Performance runner (informational; not gated). Writes a trend file.
const fs = require('node:fs');
const path = require('node:path');
const bench = require('../src/perf/bench');

function main() {
  const res = bench.run({ iterations: Number(process.env.BENCH_ITER || 20000) });
  const OUT = path.join(__dirname, '..', 'evidence-out');
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'perf.json');
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  hist.push(res); hist = hist.slice(-50);
  fs.writeFileSync(file, JSON.stringify(hist, null, 2));
  console.log('=== Performance (informational) ===');
  for (const [k, v] of Object.entries(res.results)) console.log(`${k}: ${v.opsPerSec.toLocaleString()} ops/s (${v.perOpUs} µs/op)`);
}

if (require.main === module) main();
