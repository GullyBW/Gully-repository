'use strict';

const { measure } = require('../lib/stats');

/**
 * Phase 12 — Provider discovery / search performance.
 *
 * Drives `providerRepository.query(filter)` — the method the discovery service
 * uses — across every driver with the filter combinations the marketplace
 * issues (category, text, price ceiling, min rating, availability, combined).
 * Sorting ("nearest / highest rated / lowest price / most jobs / fastest
 * response") is the service's in-process ranking, measured here on the result
 * set returned by the repository.
 */
const FILTERS = [
  ['category only', { category: 'plumber' }],
  ['verified + available', { verifiedOnly: true, availableOnly: true }],
  ['price ceiling', { maxPrice: 50000 }],
  ['min rating 4.0', { minRating: 4 }],
  ['text search', { q: 'plumb' }],
  ['category + price + rating', { category: 'electrician', maxPrice: 60000, minRating: 4 }],
];

const SORTS = {
  highestRated: (a, b) => (b.rating || 0) - (a.rating || 0),
  lowestPrice: (a, b) => (a.startingPrice || Infinity) - (b.startingPrice || Infinity),
  mostJobs: (a, b) => (b.completedJobs || 0) - (a.completedJobs || 0),
  fastestResponse: (a, b) => (a.responseTimeMinutes || Infinity) - (b.responseTimeMinutes || Infinity),
};

async function run(ctx) {
  const { drivers, config, size } = ctx;
  const samples = Math.min(config.samples, 1500);
  const driverNames = drivers.map((d) => d.name);

  // results[filterLabel][driver] = stat
  const results = {};
  const counts = {};
  for (const [label, filter] of FILTERS) {
    results[label] = {};
    counts[label] = {};
    for (const driver of drivers) {
      const repo = driver.repos.provider;
      // record a representative result count once
      const sample = await repo.query(filter);
      counts[label][driver.name] = sample.length;
      results[label][driver.name] = await measure(`${driver.name}:${label}`, async () =>
        repo.query(filter), { samples });
    }
  }

  // Sorting cost on a realistic result set (category match), PostgreSQL source.
  const pg = drivers.find((d) => d.name === 'postgres') || drivers[0];
  const base = await pg.repos.provider.query({ category: 'plumber' });
  const sortResults = {};
  for (const [name, cmp] of Object.entries(SORTS)) {
    sortResults[name] = await measure(`sort:${name}`, async () => [...base].sort(cmp), { samples: 2000 });
  }

  const columns = ['Filter', 'Rows', ...driverNames.flatMap((n) => [`${n} p50 (ms)`, `${n} p95 (ms)`])];
  const rows = FILTERS.map(([label]) => {
    const row = [label, counts[label][pg.name]];
    for (const n of driverNames) {
      const s = results[label][n];
      row.push(s ? s.p50 : '', s ? s.p95 : '');
    }
    return row;
  });

  const sortRows = Object.entries(sortResults).map(([name, s]) => [name, s.p50, s.p95, s.throughput]);

  return {
    title: 'Phase 12 — Provider discovery / search performance',
    description: `Search filter latency at the "${size.name}" dataset (${size.providers} providers).`,
    tables: [
      { title: 'Filter latency by driver', columns, rows },
      {
        title: 'Ranking (in-process sort on category result set)',
        columns: ['Sort', 'p50 (ms)', 'p95 (ms)', 'ops/s'],
        rows: sortRows,
      },
    ],
    notes: [
      'Repository returns the candidate set; the service ranks/limits it (distance ranking uses the haversine helper).',
      'The JSONB `categories @> ` containment path is backed by idx_providers_categories_gin.',
    ],
    raw: { results, counts, sortResults },
  };
}

module.exports = { run };
