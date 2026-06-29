'use strict';

/**
 * Standalone dataset seeder. Generates the dataset for a given size and loads
 * it into PostgreSQL (the default driver). Useful for populating a database for
 * manual exploration or for running individual scenarios.
 *
 * Usage: node benchmark/scripts/seed.js [size] [--keep]
 *   size    one of: tiny | small | medium | large (default small)
 *   --keep  do not TRUNCATE first (append to existing data)
 */
const config = require('../config');
const { resolveSize } = config;
const { buildDataset } = require('../lib/seed');
const { loadDataset } = require('../lib/loader');
const { postgresDriver } = require('../lib/drivers');

async function main() {
  const argv = process.argv.slice(2);
  const keep = argv.includes('--keep');
  const sizeArg = argv.find((a) => !a.startsWith('--'));
  const size = resolveSize(sizeArg);

  console.log(`[seed] generating "${size.name}" dataset (seed=${config.seed})`);
  const dataset = buildDataset(size, config.seed);
  console.log('[seed] counts:', dataset.counts);

  const driver = postgresDriver();
  await driver.setup();
  if (!keep) {
    console.log('[seed] truncating existing tables');
    await driver.truncate();
  }
  const ms = await loadDataset(driver, dataset);
  const total = Object.values(dataset.counts).reduce((a, b) => a + b, 0);
  console.log(`[seed] loaded ${total} rows in ${Math.round(ms)}ms (${Math.round((total / ms) * 1000)} rows/s)`);
  await driver.teardown();
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
