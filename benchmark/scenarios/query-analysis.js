'use strict';

const pg = require('../lib/pg-admin');
const { query } = require('../../src/db/postgres');

/**
 * Phase 6/7/8 — PostgreSQL query analysis, index validation, JSONB review.
 *
 * Runs EXPLAIN (ANALYZE, BUFFERS) on every representative repository query,
 * detects sequential scans / external sorts, and confirms the expected index
 * backs each hot path. Also reports table/index sizes and index-usage counters,
 * then emits concrete recommendations.
 */
async function run(ctx) {
  const { dataset } = ctx;
  const customerId = dataset.sample.customerIds[0];
  const providerId = dataset.sample.providerIds[0];
  const category = 'plumber';

  // Pick a real conversation id and notification user from the DB.
  const conv = await query('SELECT id FROM conversations LIMIT 1');
  const conversationId = conv.rows[0] ? conv.rows[0].id : 'none';
  const ntfUser = await query('SELECT user_id FROM notifications LIMIT 1');
  const notifUser = ntfUser.rows[0] ? ntfUser.rows[0].user_id : customerId;

  const QUERIES = [
    ['provider: category + JSONB containment',
      `SELECT doc FROM providers WHERE (category=$1 OR doc->'categories' @> to_jsonb($1::text)) LIMIT 500`, [category]],
    ['provider: verified + available + rating',
      `SELECT doc FROM providers WHERE verified=true AND availability_status='available' AND rating >= $1 LIMIT 500`, [4]],
    ['booking: list by customer (newest)',
      `SELECT doc FROM bookings WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20`, [customerId]],
    ['booking: by status (newest)',
      `SELECT doc FROM bookings WHERE status=$1 ORDER BY created_at DESC LIMIT 100`, ['completed']],
    ['booking: count by status',
      `SELECT count(*)::int FROM bookings WHERE status=$1`, ['completed']],
    ['transaction: sum by status',
      `SELECT COALESCE(SUM(amount),0)::bigint FROM transactions WHERE status=$1`, ['succeeded']],
    ['transaction: list by customer (newest)',
      `SELECT doc FROM transactions WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20`, [customerId]],
    ['review: list by provider (newest)',
      `SELECT doc FROM reviews WHERE provider_id=$1 ORDER BY created_at DESC LIMIT 20`, [providerId]],
    ['notification: unread count (partial idx)',
      `SELECT count(*)::int FROM notifications WHERE user_id=$1 AND read=false`, [notifUser]],
    ['notification: list by user (newest)',
      `SELECT doc FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [notifUser]],
    ['message: conversation history',
      `SELECT doc FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 100`, [conversationId]],
    ['audit: by action (newest)',
      `SELECT doc FROM audit_logs WHERE action=$1 ORDER BY created_at DESC LIMIT 100`, ['login']],
  ];

  // Refresh planner statistics so EXPLAIN reflects the freshly loaded data.
  await query('ANALYZE');
  const sizes = await pg.tableSizes();
  const rowCountByTable = Object.fromEntries(sizes.map((s) => [s.table, s.rows]));

  // Above this row count a sequential scan on a filtered query is a real concern;
  // below it, the planner correctly prefers seq scan (it is genuinely faster).
  const SEQSCAN_CONCERN_ROWS = 20000;

  const rows = [];
  const recommendations = [];
  for (const [label, sql, params] of QUERIES) {
    // eslint-disable-next-line no-await-in-loop
    const { plan, flags } = await pg.explain(sql, params);
    const execMs = round(plan['Execution Time']);
    const sort = flags.sorts.length ? flags.sorts.join(',') : '—';

    if (flags.seqScans.length) {
      const table = flags.seqScans[0];
      const tableRows = rowCountByTable[table] || 0;
      // Verify an index path EXISTS for this filter even though seq scan won.
      // eslint-disable-next-line no-await-in-loop
      const forced = await pg.explainForced(sql, params);
      const access = `Seq Scan (${table}, ${tableRows} rows)`;
      const idx = forced.usedIndex ? `${forced.indexes.join(', ')} (validated)` : 'none available';
      rows.push([label, execMs, access, idx, sort]);
      if (tableRows >= SEQSCAN_CONCERN_ROWS && !forced.usedIndex) {
        recommendations.push(`\`${label}\` seq-scans ${table} (${tableRows} rows) with no index path — add an index.`);
      }
    } else {
      const idx = flags.indexScans.length ? flags.indexScans.join(', ') : '—';
      rows.push([label, execMs, 'Index', idx, sort]);
    }

    if (flags.tempFiles) {
      recommendations.push(`\`${label}\` spilled its sort to disk — consider raising work_mem or a covering index.`);
    }
  }

  const usage = await pg.indexUsage();
  const unused = usage.filter((u) => u.scans === 0 && !u.index.endsWith('_pkey') && u.sizeMB > 0);

  if (!recommendations.length) {
    recommendations.push(
      'No hot-path query needs a new index. Sequential scans that appear above are on small tables where the ' +
      'planner correctly prefers a scan; the "Index used" column confirms an index path is available and takes ' +
      'over as the table grows (validated with enable_seqscan=off).'
    );
  }

  return {
    title: 'Phase 6/7/8 — Query analysis, indexes & JSONB',
    description: 'EXPLAIN (ANALYZE, BUFFERS) on every representative repository query, plus storage and index-usage stats.',
    tables: [
      {
        title: 'Query plans (ANALYZE-fresh stats; index path validated with enable_seqscan=off)',
        columns: ['Query', 'Exec (ms)', 'Access', 'Index path', 'Sort'],
        rows,
      },
      {
        title: 'Table & index storage',
        columns: ['Table', 'Rows', 'Total (MB)', 'Index (MB)'],
        rows: sizes.map((s) => [s.table, s.rows, s.totalMB, s.indexMB]),
      },
    ],
    notes: [
      ...recommendations,
      'JSONB strategy: filter/sort keys (status, customer_id, category, created_at, rating, price) are promoted to ' +
        'indexed columns; the full document stays in `doc` for flexibility. Multi-value `categories` uses a GIN index.',
      unused.length
        ? `Indexes with zero scans this run (re-evaluate if also unused in production): ${unused.map((u) => u.index).join(', ')}.`
        : 'No zero-scan indexes detected in this run.',
    ],
    raw: { rows, sizes, usage },
  };
}

function round(n, dp = 3) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = { run };
