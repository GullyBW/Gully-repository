'use strict';

/**
 * Unit tests for the benchmark harness libraries. These are pure (no database,
 * no network) so they run inside the normal `npm test` suite and protect the
 * two properties the benchmark depends on: correct statistics and deterministic,
 * reproducible dataset generation.
 */
const { summarize, percentile, measure } = require('../benchmark/lib/stats');
const { Rng } = require('../benchmark/lib/random');
const { buildDataset } = require('../benchmark/lib/seed');
const { Report } = require('../benchmark/lib/reporter');

describe('benchmark/lib/stats', () => {
  test('summarize computes percentiles with nearest-rank', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const s = summarize(data);
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
  });

  test('percentile handles empty input', () => {
    expect(percentile([], 95)).toBe(0);
    expect(summarize([]).p95).toBe(0);
  });

  test('measure returns latency stats and throughput', async () => {
    const stat = await measure('noop', async () => 1, { samples: 50, warmup: 5 });
    expect(stat.samples).toBe(50);
    expect(stat.count).toBe(50);
    expect(stat.throughput).toBeGreaterThan(0);
    expect(stat.p95).toBeGreaterThanOrEqual(stat.p50);
  });
});

describe('benchmark/lib/random', () => {
  test('same seed yields identical sequences', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds diverge', () => {
    const a = Array.from({ length: 5 }, ((r) => () => r.next())(new Rng(1)));
    const b = Array.from({ length: 5 }, ((r) => () => r.next())(new Rng(2)));
    expect(a).not.toEqual(b);
  });
});

describe('benchmark/lib/seed', () => {
  const size = { users: 40, providers: 15, bookings: 60 };

  test('dataset generation is deterministic for a fixed seed', () => {
    const d1 = buildDataset(size, 1337);
    const d2 = buildDataset(size, 1337);
    expect(d1.counts).toEqual(d2.counts);
    expect(d1.users[0].email).toBe(d2.users[0].email);
    expect(d1.bookings[0].reference).toBe(d2.bookings[0].reference);
  });

  test('produces a coherent relational graph', () => {
    const d = buildDataset(size, 7);
    expect(d.providers.length).toBe(15);
    expect(d.bookings.length).toBe(60);
    const providerIds = new Set(d.providers.map((p) => p.userId));
    // every booking references a real provider and a customer
    for (const b of d.bookings) {
      expect(providerIds.has(b.providerId)).toBe(true);
      expect(b.customerId.startsWith('cust-')).toBe(true);
      expect(b.currency).toBe('BWP');
    }
    // reviews only reference completed-booking providers
    for (const r of d.reviews) {
      expect(providerIds.has(r.providerId)).toBe(true);
    }
  });

  test('locations fall within Botswana bounds', () => {
    const d = buildDataset(size, 99);
    for (const p of d.providers) {
      expect(p.location.lat).toBeLessThan(-17);
      expect(p.location.lat).toBeGreaterThan(-27);
      expect(p.location.lng).toBeGreaterThan(19);
      expect(p.location.lng).toBeLessThan(30);
    }
  });
});

describe('benchmark/lib/reporter', () => {
  test('renders Markdown tables', () => {
    const report = new Report({ datasetSize: 'unit' });
    report.section({
      title: 'Sample',
      tables: [{ title: 'T', columns: ['A', 'B'], rows: [[1, 2], [3, 4]] }],
      notes: ['a note'],
    });
    const md = report.toMarkdown();
    expect(md).toContain('## Sample');
    expect(md).toContain('| A | B |');
    expect(md).toContain('| 1 | 2 |');
    expect(md).toContain('- a note');
  });
});
