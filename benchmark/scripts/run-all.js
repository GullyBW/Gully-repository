'use strict';

/**
 * Benchmark orchestrator (Phase 1 framework + Phase 16 report).
 *
 * Steps:
 *   1. Resolve dataset size + build a deterministic dataset.
 *   2. Bring up every available driver (PostgreSQL always; in-memory always;
 *      MongoDB only if reachable), create schema, clean, and load the dataset.
 *   3. Run each scenario, collecting report sections.
 *   4. Emit JSON + Markdown reports and refresh the dashboard data.
 *   5. Tear everything down.
 *
 * Usage: node benchmark/scripts/run-all.js [size] [--only=crud,search]
 * Env: BENCH_SIZE, BENCH_DATABASE_URL, BENCH_MONGODB_URI, BENCH_SAMPLES, ...
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { resolveSize } = config;
const { buildDataset } = require('../lib/seed');
const { loadDataset } = require('../lib/loader');
const drivers = require('../lib/drivers');
const pgAdmin = require('../lib/pg-admin');
const { Report } = require('../lib/reporter');
const stats = require('../lib/stats');

const SCENARIOS = {
  crud: require('../scenarios/repository-crud'),
  search: require('../scenarios/search'),
  workload: require('../scenarios/workload'),
  payment: require('../scenarios/payment'),
  concurrency: require('../scenarios/concurrency'),
  query: require('../scenarios/query-analysis'),
  operational: require('../scenarios/operational'),
};

// Scenarios that compare across all drivers vs. PostgreSQL-only ones.
const PG_ONLY = new Set(['query', 'operational']);

function parseArgs(argv) {
  const args = { only: null, size: null };
  for (const a of argv) {
    if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim());
    else if (!a.startsWith('--')) args.size = a;
  }
  return args;
}

async function reachableMongo(url) {
  if (!url) return false;
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(url, { serverSelectionTimeoutMS: 1500 });
    await mongoose.connection.close();
    return true;
  } catch (_e) {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const size = resolveSize(args.size);
  const selected = args.only || Object.keys(SCENARIOS);

  console.log(`[bench] size=${size.name} (${JSON.stringify({ users: size.users, providers: size.providers, bookings: size.bookings })})`);
  console.log(`[bench] scenarios: ${selected.join(', ')}`);

  const dataset = buildDataset(size, config.seed);
  console.log(`[bench] generated dataset:`, dataset.counts);

  // ---- Bring up drivers ----
  const active = [];
  const pgDriver = drivers.postgresDriver();
  await pgDriver.setup();
  await pgDriver.truncate();
  active.push(pgDriver);

  const memDriver = drivers.memoryDriver();
  await memDriver.setup();
  active.push(memDriver);

  if (await reachableMongo(config.mongoUrl)) {
    const m = drivers.mongoDriver(config.mongoUrl);
    await m.setup();
    await m.truncate();
    active.push(m);
    console.log('[bench] MongoDB comparison ENABLED');
  } else {
    console.log('[bench] MongoDB comparison skipped (no reachable BENCH_MONGODB_URI)');
  }

  // ---- Load dataset into every driver, timing each load ----
  const loadRows = [];
  for (const d of active) {
    const ms = await loadDataset(d, dataset);
    const total = Object.values(dataset.counts).reduce((a, b) => a + b, 0);
    loadRows.push([d.name, Math.round(ms), Math.round((total / ms) * 1000)]);
    console.log(`[bench] loaded ${total} rows into ${d.name} in ${Math.round(ms)}ms`);
  }

  await pgAdmin.resetStats();

  // ---- Report scaffold ----
  const serverSettings = await pgAdmin.serverSettings();
  const report = new Report({
    datasetSize: size.name,
    users: size.users,
    providers: size.providers,
    bookings: size.bookings,
    seed: config.seed,
    drivers: active.map((d) => d.name).join(', '),
    node: process.version,
    cpu: `${os.cpus()[0].model} × ${os.cpus().length}`,
    memoryGB: Math.round(os.totalmem() / 1073741824),
    platform: `${os.type()} ${os.release()}`,
    pgVersion: serverSettings.server_version,
    sharedBuffers: serverSettings.shared_buffers,
    workMem: serverSettings.work_mem,
    maxConnections: serverSettings.max_connections,
  });

  report.section({
    title: 'Dataset load (bulk insert)',
    description: 'Time to bulk-load the full generated dataset into each driver.',
    tables: [{
      title: 'Load throughput',
      columns: ['Driver', 'Load time (ms)', 'rows/s'],
      rows: loadRows,
    }],
    notes: [`Total rows per driver: ${Object.values(dataset.counts).reduce((a, b) => a + b, 0)}.`],
  });

  // ---- Run scenarios ----
  const ctx = { drivers: active, dataset, config, size, stats, pg: pgAdmin };
  for (const key of selected) {
    const scenario = SCENARIOS[key];
    if (!scenario) {
      console.warn(`[bench] unknown scenario "${key}" — skipping`);
      continue;
    }
    console.log(`[bench] running scenario: ${key}`);
    const scenarioCtx = PG_ONLY.has(key)
      ? { ...ctx, drivers: active.filter((d) => d.name === 'postgres') }
      : ctx;
    // eslint-disable-next-line no-await-in-loop
    const section = await scenario.run(scenarioCtx);
    report.section(section);
  }

  // ---- Emit reports ----
  const baseName = `benchmark-${size.name}`;
  const { jsonPath, mdPath } = report.write(config.reportsDir, baseName);
  // Latest pointer for the dashboard.
  fs.writeFileSync(path.join(config.reportsDir, 'latest.json'), JSON.stringify(report.doc, null, 2));
  console.log(`[bench] wrote ${path.relative(process.cwd(), jsonPath)} and ${path.relative(process.cwd(), mdPath)}`);

  // ---- Teardown ----
  for (const d of active) {
    // eslint-disable-next-line no-await-in-loop
    await d.teardown().catch(() => {});
  }
  console.log('[bench] done');
}

main().catch((err) => {
  console.error('[bench] FAILED:', err);
  process.exitCode = 1;
});
