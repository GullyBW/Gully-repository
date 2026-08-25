'use strict';
// Phase 5 — Performance, soak, and chaos harness. Runs the REAL workflow under load and
// reports throughput + latency percentiles (operational evidence; timing is not hashed),
// then runs deterministic SOAK (integrity holds over many iterations) and CHAOS (inject
// adapter failures → verify graceful degradation + recovery) checks whose PASS/FAIL is
// deterministic. Zero dependencies.
//
// Usage: node scripts/perf.js [iterations]   (default 2000)
// Exit non-zero if any resilience assertion fails. Evidence ≠ authorization.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Workflow } = require('../src/workflow');
const { MessageBroker } = require('../src/adapters/broker');
const { MemorySqlDriver } = require('../src/adapters/drivers/sql-driver');
const { SqlStore } = require('../src/adapters/sql-store');
const { UnitOfWork } = require('../src/adapters/uow');

function pctl(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0; }

function loadTest(iterations) {
  const ledgerFile = path.join(os.tmpdir(), `njtip-perf-${process.pid}.json`);
  let t = 1_700_000_000_000;
  const wf = new Workflow({ clock: () => (t += 1000), seed: 1, ledgerFile });
  const cats = ['police', 'courts', 'prosecution', 'prison', 'official', 'regulatory', 'other'];
  const lat = [];
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const s0 = process.hrtime.bigint();
    const r = wf.submitReport({ category: cats[i % cats.length], content: 'synthetic ' + i });
    wf.attachEvidence({ case_code: r.case_code, content: 'e' + i });
    wf.investigatorReview({ principal: 'inv-001', case_code: r.case_code, disposition: i % 2 ? 'escalate' : 'reviewed' });
    lat.push(Number(process.hrtime.bigint() - s0) / 1e6);
  }
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
  const sorted = [...lat].sort((a, b) => a - b);
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
  return {
    iterations, totalMs: +totalMs.toFixed(1),
    throughputPerSec: +((iterations / totalMs) * 1000).toFixed(1),
    latencyMs: { p50: +pctl(sorted, 50).toFixed(3), p95: +pctl(sorted, 95).toFixed(3), p99: +pctl(sorted, 99).toFixed(3), max: +sorted[sorted.length - 1].toFixed(3) },
    integrityHeld: wf.audit.verifyIntegrity().ok && wf.evidence.verifyCustodyChain().ok,
  };
}

// SOAK: integrity must hold continuously (no drift) across a sustained run.
function soakCheck(rounds = 500) {
  const problems = [];
  const ledgerFile = path.join(os.tmpdir(), `njtip-soak-${process.pid}.json`);
  let t = 1_700_000_000_000;
  const wf = new Workflow({ clock: () => (t += 1000), seed: 2, ledgerFile });
  for (let i = 0; i < rounds; i++) {
    const r = wf.submitReport({ category: 'police', content: 'x' });
    wf.attachEvidence({ case_code: r.case_code, content: 'e' });
    if (i % 50 === 0 && !(wf.audit.verifyIntegrity().ok && wf.evidence.verifyCustodyChain().ok)) { problems.push(`integrity drift at round ${i}`); break; }
  }
  if (!wf.audit.verifyIntegrity().ok) problems.push('final audit integrity failed');
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
  return { rounds, pass: problems.length === 0, problems };
}

// CHAOS: inject adapter failures and verify graceful degradation + recovery.
function chaosCheck() {
  const problems = [];
  // 1) Broker consumer down → messages retried then dead-lettered (not lost), then replayed.
  let now = 0; const b = new MessageBroker({ clock: () => now, retry: { maxAttempts: 2, baseBackoffMs: 1 } });
  let down = true; let delivered = 0;
  b.subscribe('t', () => { if (down) throw new Error('down'); delivered++; });
  b.publish('t', { caseCode: 'NJ-1' });
  b.drain(); now += 1; b.drain(); // exhaust attempts → DLQ
  if (b.deadLetters().length !== 1) problems.push('chaos: message lost instead of dead-lettered');
  down = false; b.replayDeadLetters(); b.drain();
  if (delivered !== 1) problems.push('chaos: DLQ replay did not recover the message');

  // 2) Transaction failure mid-write → full rollback (no partial state).
  const d = new MemorySqlDriver(); const s = new SqlStore('independent', 'reports', d); s.put('K', { n: 1 });
  try { new UnitOfWork(d).run(() => { s.put('K', { n: 2 }); throw new Error('crash'); }); } catch (_) {}
  if (JSON.stringify(s.get('K')) !== JSON.stringify({ n: 1 })) problems.push('chaos: transaction did not roll back');

  return { pass: problems.length === 0, problems };
}

function main() {
  const iterations = Number(process.argv[2] || 2000);
  const load = loadTest(iterations);
  const soak = soakCheck();
  const chaos = chaosCheck();
  const resilient = load.integrityHeld && soak.pass && chaos.pass;
  const report = { platform: 'NJTIP', kind: 'performance-resilience', load, soak, chaos, resilient, note: 'Latency/throughput are operational measurements (not hashed). Resilience checks are deterministic. Evidence ≠ authorization.' };
  console.log(JSON.stringify(report, null, 2));
  console.log(resilient ? '\n✅ Performance run complete; resilience checks PASS.' : '\n❌ Resilience checks FAILED.');
  process.exitCode = resilient ? 0 : 1;
}
if (require.main === module) main();

module.exports = { loadTest, soakCheck, chaosCheck };
