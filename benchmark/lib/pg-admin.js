'use strict';

const { Pool } = require('pg');
const config = require('../config');

/**
 * Low-level PostgreSQL introspection helpers used by the query-analysis,
 * index, and operational-readiness scenarios. Uses the project's pool via
 * `src/db/postgres` for normal queries; spins up dedicated pools only for the
 * connection-pool sweep (Phase 9).
 */
const postgres = require('../../src/db/postgres');

/** Run EXPLAIN (ANALYZE, FORMAT JSON) and return the plan + flags. */
async function explain(sql, params = []) {
  const r = await postgres.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const plan = r.rows[0]['QUERY PLAN'][0];
  return { plan, flags: analyzePlan(plan.Plan) };
}

/**
 * Re-plan a query with `enable_seqscan=off` (scoped to a transaction) to verify
 * that an index access path exists and is usable for a filter, even when the
 * planner prefers a sequential scan because the table is currently small.
 * Returns the index path + cost, or null if no index path is possible.
 */
async function explainForced(sql, params = []) {
  const client = await postgres.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const r = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
    const plan = r.rows[0]['QUERY PLAN'][0];
    const flags = analyzePlan(plan.Plan);
    return {
      execMs: round(plan['Execution Time'], 3),
      indexes: flags.indexScans,
      usedIndex: flags.indexScans.length > 0,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Walk a plan tree and flag common inefficiencies (Phase 6). */
function analyzePlan(node, flags = { seqScans: [], sorts: [], nestedLoops: 0, tempFiles: false, indexScans: [] }) {
  if (!node) return flags;
  const type = node['Node Type'];
  if (type === 'Seq Scan') flags.seqScans.push(node['Relation Name']);
  if (type === 'Index Scan' || type === 'Index Only Scan' || type === 'Bitmap Index Scan') {
    if (node['Index Name']) flags.indexScans.push(node['Index Name']);
  }
  if (type === 'Sort') {
    flags.sorts.push(node['Sort Method'] || 'unknown');
    if ((node['Sort Method'] || '').includes('external')) flags.tempFiles = true;
  }
  if (type === 'Nested Loop') flags.nestedLoops += 1;
  for (const child of node.Plans || []) analyzePlan(child, flags);
  return flags;
}

/** Per-table on-disk size + row estimate. */
async function tableSizes() {
  const r = await postgres.query(`
    SELECT relname AS table,
           n_live_tup AS rows,
           pg_total_relation_size(relid) AS total_bytes,
           pg_indexes_size(relid) AS index_bytes
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC`);
  return r.rows.map((row) => ({
    table: row.table,
    rows: Number(row.rows),
    totalMB: round(Number(row.total_bytes) / 1048576),
    indexMB: round(Number(row.index_bytes) / 1048576),
  }));
}

/** Index usage stats (scans, tuples read) — drives "unused index" findings. */
async function indexUsage() {
  const r = await postgres.query(`
    SELECT relname AS table, indexrelname AS index,
           idx_scan AS scans,
           pg_relation_size(indexrelid) AS bytes
    FROM pg_stat_user_indexes
    ORDER BY relname, indexrelname`);
  return r.rows.map((row) => ({
    table: row.table,
    index: row.index,
    scans: Number(row.scans),
    sizeMB: round(Number(row.bytes) / 1048576),
  }));
}

/** Key server tuning parameters, for the report's "Database configuration". */
async function serverSettings() {
  const names = [
    'server_version', 'shared_buffers', 'work_mem', 'effective_cache_size',
    'max_connections', 'max_parallel_workers_per_gather', 'random_page_cost',
  ];
  const r = await postgres.query(
    `SELECT name, setting, unit FROM pg_settings WHERE name = ANY($1)`,
    [names]
  );
  const out = {};
  for (const row of r.rows) out[row.name] = `${row.setting}${row.unit ? ' ' + row.unit : ''}`;
  return out;
}

async function resetStats() {
  // Reset table/index counters so a run measures only its own activity.
  await postgres.query('SELECT pg_stat_reset()');
}

/** Run a tiny SELECT workload through a custom-sized pool (Phase 9). */
async function timePoolConfig({ max, total = 2000, concurrency = 50 }) {
  const pool = new Pool({ connectionString: config.postgresUrl, max });
  const { measureConcurrent } = require('./stats');
  try {
    // warm the pool
    await Promise.all(Array.from({ length: Math.min(max, concurrency) }, () => pool.query('SELECT 1')));
    return await measureConcurrent(`pool=${max}`, () => pool.query('SELECT id FROM users LIMIT 1'), {
      total,
      concurrency,
    });
  } finally {
    await pool.end();
  }
}

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = {
  explain,
  explainForced,
  analyzePlan,
  tableSizes,
  indexUsage,
  serverSettings,
  resetStats,
  timePoolConfig,
};
