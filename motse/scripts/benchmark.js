'use strict';

/**
 * Performance benchmarking (Phase 2, WS10): in-process throughput of
 * the hot domain paths, run against the same code that serves prod.
 *   node motse/scripts/benchmark.js [iterations]
 */
process.env.MOTSE_LOG_LEVEL = 'silent';
const { createPlatform } = require('../src/container');

const iterations = Number(process.argv[2]) || 5000;
const p = createPlatform();

function bench(name, setup, op) {
  const ctx = setup ? setup() : null;
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) op(i, ctx);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const rate = Math.round((iterations / ms) * 1000);
  // eslint-disable-next-line no-console
  console.log(`${name.padEnd(34)} ${String(rate).padStart(9)} ops/s   (${ms.toFixed(0)}ms for ${iterations})`);
  return rate;
}

// Ledger postings — the SLO-critical path (§15.1: p95 commit < 500ms).
const clearing = p.ledger.openAccount('bench:provider', 'provider_clearing');
const a = p.ledger.openAccount('bench:a', 'user_wallet');
const b = p.ledger.openAccount('bench:b', 'user_wallet');
p.ledger.providerDeposit({
  providerAccountId: clearing.id, destAccountId: a.id,
  amountMinor: 1000000000, providerTxRef: 'bench', idempotencyKey: 'bench-seed',
});

bench('ledger.transfer', null, (i) =>
  p.ledger.transfer({
    source: a.id, dest: b.id, amountMinor: 1, purpose: 'bench',
    ref: `bench:${i}`, idempotencyKey: `bench:${i}`,
  })
);
bench('ledger.balance', null, () => p.ledger.balance(a.id));
bench('idempotent replay', null, (i) =>
  p.ledger.transfer({
    source: a.id, dest: b.id, amountMinor: 1, purpose: 'bench',
    ref: `bench:${i % 100}`, idempotencyKey: `bench:${i % 100}`,
  })
);
bench('flags.evaluate', () => {
  p.flags.set('module.kgetsi', 'global', true, 'bench');
  return null;
}, () => p.flags.evaluate('module.kgetsi', { userRef: 'x', wardRef: 'w', morafeRefs: [] }));
bench('audit.append + chain', null, (i) =>
  p.audit.append('bench', 'bench.event', `bench:${i % 50}`, null, { i })
);
bench('search.tokenize+query', () => {
  for (let i = 0; i < 200; i += 1) {
    p.search._add('heritage', `doc${i}`, `story number ${i} about tsodilo and pula`, {});
  }
  return null;
}, () => p.search.search('tsodilo story'));

const trial = p.ledger.trialBalance();
// eslint-disable-next-line no-console
console.log(`\ntrial balance after benchmark: ${trial.balanced ? 'BALANCED' : `OFF BY ${trial.total_minor}`}`);
process.exit(trial.balanced ? 0 : 1);
