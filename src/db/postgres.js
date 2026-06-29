'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

/**
 * PostgreSQL connection pool + schema bootstrap. Lazily creates the pool on
 * first use so importing this module never connects (keeps tests/Mongo path
 * side-effect free). Storage uses a JSONB `doc` column per table mirroring the
 * domain objects, plus a few extracted columns for indexing/filtering.
 */
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.db.postgresUrl, max: 10 });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

/** Idempotently create all tables/indexes. Safe to run on every boot. */
async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, ensureSchema, close };
