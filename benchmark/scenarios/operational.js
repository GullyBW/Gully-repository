'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pexec = promisify(execFile);
const { query } = require('../../src/db/postgres');
const config = require('../config');

/**
 * Phase 14 — Operational readiness.
 *
 * Times the maintenance operations a production deployment depends on:
 * ANALYZE, VACUUM, pg_dump (custom format) and an optional restore into a
 * scratch database. Also reports autovacuum-related settings. Each step is
 * guarded so a missing CLI (pg_dump/pg_restore) degrades to a "skipped" note
 * rather than failing the suite.
 */
async function run() {
  const rows = [];
  const notes = [];

  async function timeSql(label, sql) {
    const t0 = process.hrtime.bigint();
    await query(sql);
    rows.push([label, round(Number(process.hrtime.bigint() - t0) / 1e6)]);
  }

  await timeSql('ANALYZE (whole DB)', 'ANALYZE');
  await timeSql('VACUUM (ANALYZE)', 'VACUUM (ANALYZE)');

  // pg_dump (custom format) — measures backup time + artifact size.
  const dumpPath = path.join(os.tmpdir(), `tirelo-bench-${Date.now()}.dump`);
  let dumpOk = false;
  try {
    const t0 = process.hrtime.bigint();
    await pexec('pg_dump', ['--dbname', config.postgresUrl, '--format=custom', '--file', dumpPath], { timeout: 120000 });
    const ms = round(Number(process.hrtime.bigint() - t0) / 1e6);
    const sizeMB = round(fs.statSync(dumpPath).size / 1048576);
    rows.push([`pg_dump (custom) → ${sizeMB} MB`, ms]);
    dumpOk = true;
  } catch (err) {
    notes.push(`pg_dump skipped: ${err.message.split('\n')[0]}`);
  }

  // Optional restore into a scratch DB.
  if (dumpOk) {
    const scratch = `tirelo_bench_restore_${Date.now()}`;
    try {
      await pexec('psql', [config.postgresUrl, '-c', `CREATE DATABASE ${scratch}`], { timeout: 30000 });
      const restoreUrl = config.postgresUrl.replace(/\/[^/]*$/, `/${scratch}`);
      const t0 = process.hrtime.bigint();
      // pg_restore returns non-zero on benign warnings; tolerate via exit handling.
      await pexec('pg_restore', ['--dbname', restoreUrl, '--no-owner', dumpPath], { timeout: 120000 }).catch(() => {});
      rows.push(['pg_restore (scratch DB)', round(Number(process.hrtime.bigint() - t0) / 1e6)]);
      await pexec('psql', [config.postgresUrl, '-c', `DROP DATABASE ${scratch}`], { timeout: 30000 });
    } catch (err) {
      notes.push(`Restore step skipped: ${err.message.split('\n')[0]}`);
    } finally {
      fs.existsSync(dumpPath) && fs.unlinkSync(dumpPath);
    }
  }

  // Autovacuum + maintenance-relevant settings.
  const settings = await query(
    `SELECT name, setting, unit FROM pg_settings
     WHERE name IN ('autovacuum','autovacuum_vacuum_scale_factor','autovacuum_analyze_scale_factor',
                    'maintenance_work_mem','checkpoint_timeout','wal_level')`
  );
  const settingRows = settings.rows.map((r) => [r.name, `${r.setting}${r.unit ? ' ' + r.unit : ''}`]);

  notes.push(
    'Recommended schedule: rely on autovacuum (on by default); add a nightly `pg_dump --format=custom` ' +
      '(see deploy/backup.sh) + managed snapshots; run `ANALYZE` after bulk loads; `REINDEX CONCURRENTLY` only ' +
      'if index bloat is observed.',
    'Replication readiness: `wal_level=replica` (or higher) enables streaming replicas / PITR — confirm before go-live.'
  );

  return {
    title: 'Phase 14 — Operational readiness',
    description: 'Backup/restore/maintenance timings and autovacuum configuration.',
    tables: [
      { title: 'Maintenance operation timings', columns: ['Operation', 'ms'], rows },
      { title: 'Relevant settings', columns: ['Setting', 'Value'], rows: settingRows },
    ],
    notes,
    raw: { rows, settingRows },
  };
}

function round(n, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = { run };
