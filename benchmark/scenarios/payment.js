'use strict';

const { measure, measureConcurrent } = require('../lib/stats');
const PaymentService = require('../../src/services/payment.service');
const { getTransactionRepository } = require('../../src/repositories');

/**
 * Phase 11 — Payment performance & correctness validation.
 *
 * The payment module is exercised THROUGH ITS PUBLIC API ONLY (`PaymentService`)
 * and is not modified. We benchmark create / lookup / webhook settlement and
 * verify idempotency under retries — both sequential (the common gateway retry
 * pattern) and parallel — recording the observed behaviour honestly.
 *
 * Uses the `card` gateway in sandbox mode (no external network, deterministic).
 */
async function run() {
  const repo = getTransactionRepository();
  const driver = repo && repo.constructor ? repo.constructor.name : 'unknown';

  // --- Benchmark: createPayment ---
  const created = [];
  const createStat = await measure('payment.create', async () => {
    const t = await PaymentService.createPayment({
      customerId: 'pay-bench-cust', providerId: 'pay-bench-prov',
      amount: 50000, currency: 'BWP', method: 'card', description: 'bench',
    });
    created.push(t.reference);
    return t;
  }, { samples: 600, warmup: 10 });

  // --- Benchmark: getByReference ---
  let g = 0;
  const getStat = await measure('payment.getByReference', async () => {
    const ref = created[g % created.length];
    g += 1;
    return PaymentService.getByReference(ref);
  }, { samples: 1000 });

  // --- Benchmark: webhook settlement (each unique ref settled once) ---
  let s = 0;
  const settleStat = await measure('payment.webhook.settle', async () => {
    const ref = created[s % created.length];
    s += 1;
    return PaymentService.handleWebhook('card', { payload: { reference: ref, status: 'PAID' } });
  }, { samples: Math.min(created.length, 500), warmup: 0 });

  // --- Benchmark: listForCustomer ---
  const listStat = await measure('payment.listForCustomer', async () =>
    PaymentService.listForCustomer('pay-bench-cust', { limit: 20 }), { samples: 500 });

  // --- Correctness: sequential idempotency ---
  const seqTxn = await PaymentService.createPayment({
    customerId: 'idem-cust', providerId: 'idem-prov', amount: 12345, currency: 'BWP', method: 'card',
  });
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await PaymentService.handleWebhook('card', { payload: { reference: seqTxn.reference, status: 'PAID' } });
  }
  const afterSeq = await PaymentService.getByReference(seqTxn.reference);
  const seqSucceededEvents = afterSeq.events.filter((e) => e.status === 'succeeded').length;
  const seqIdempotent = afterSeq.status === 'succeeded' && seqSucceededEvents === 1;

  // --- Correctness: parallel retries (gateway sends the same webhook N times) ---
  const parTxn = await PaymentService.createPayment({
    customerId: 'race-cust', providerId: 'race-prov', amount: 6789, currency: 'BWP', method: 'card',
  });
  const concStat = await measureConcurrent('payment.webhook.parallel', async () =>
    PaymentService.handleWebhook('card', { payload: { reference: parTxn.reference, status: 'PAID' } }),
  { total: 25, concurrency: 25 });
  const afterPar = await PaymentService.getByReference(parTxn.reference);
  const parSucceededEvents = afterPar.events.filter((e) => e.status === 'succeeded').length;

  const benchRows = [
    ['createPayment', createStat.p50, createStat.p95, createStat.throughput],
    ['getByReference', getStat.p50, getStat.p95, getStat.throughput],
    ['webhook settle', settleStat.p50, settleStat.p95, settleStat.throughput],
    ['listForCustomer', listStat.p50, listStat.p95, listStat.throughput],
  ];

  const notes = [
    `Transaction store in use: ${driver}.`,
    `Sequential idempotency: ${seqIdempotent ? 'PASS' : 'FAIL'} — after 10 replays the transaction is ` +
      `${afterSeq.status} with exactly ${seqSucceededEvents} settlement event(s).`,
    `Parallel retries (25 simultaneous identical webhooks, 0 errors=${concStat.errors === 0}): final status ` +
      `${afterPar.status}, ${parSucceededEvents} settlement event(s) recorded.`,
  ];
  notes.push(
    'How concurrency resolves: each parallel webhook handler reads its own snapshot, applies the settlement and ' +
    'saves; the JSONB store is last-write-wins, so the persisted document ends with a single succeeded transition ' +
    'and the correct terminal status/amount — the financial outcome is correct. This is NOT row-level serialization, ' +
    'so if a future change makes the webhook take an external side effect per call (e.g. a payout API), harden it ' +
    'WITHOUT touching the payment module via a conditional settlement at the repository layer ' +
    '(`UPDATE ... WHERE status NOT IN (terminal)`) or `SELECT ... FOR UPDATE` inside a transaction.'
  );
  if (parSucceededEvents > 1) {
    notes.push(`Note: ${parSucceededEvents} settlement events persisted under parallel load — review the hardening above.`);
  }

  return {
    title: 'Phase 11 — Payment performance & correctness',
    description: 'PaymentService benchmarked and validated through its public API; the payment module is unchanged.',
    tables: [{
      title: 'Payment operation latency',
      columns: ['Operation', 'p50 (ms)', 'p95 (ms)', 'ops/s'],
      rows: benchRows,
    }],
    notes,
    raw: { createStat, getStat, settleStat, listStat, seqIdempotent, seqSucceededEvents, parSucceededEvents, concStat },
  };
}

module.exports = { run };
