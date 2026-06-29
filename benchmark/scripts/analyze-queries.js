'use strict';

/**
 * Standalone query analyzer: runs the Phase 6 EXPLAIN ANALYZE scenario against
 * whatever data currently lives in PostgreSQL and prints the Markdown section.
 * Assumes the database is already seeded (run `npm run bench:seed` first).
 *
 * Usage: node benchmark/scripts/analyze-queries.js
 */
const config = require('../config');
const { resolveSize } = config;
const { buildDataset } = require('../lib/seed');
const queryAnalysis = require('../scenarios/query-analysis');
const { Report } = require('../lib/reporter');
const postgres = require('../../src/db/postgres');

async function main() {
  // We only need the sample id lists from the dataset descriptor, not a reload.
  const size = resolveSize(process.env.BENCH_SIZE || 'small');
  const dataset = buildDataset(size, config.seed);

  await postgres.ensureSchema();
  const section = await queryAnalysis.run({ dataset });

  const report = new Report({ datasetSize: size.name, mode: 'query-analysis-only' });
  report.section(section);
  process.stdout.write(report.toMarkdown());
  process.stdout.write('\n');
  await postgres.close();
}

main().catch((err) => {
  console.error('[analyze] FAILED:', err);
  process.exit(1);
});
