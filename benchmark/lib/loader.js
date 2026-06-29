'use strict';

const { query } = require('../../src/db/postgres');

/**
 * Loads a generated dataset into a driver's repositories.
 *
 * For PostgreSQL it builds multi-row INSERTs using each repo's *own* column
 * extractors (`DocStore.columns`), so loaded rows are identical to rows the
 * application writes — no duplicated schema knowledge, no drift. For
 * memory/mongo it calls `repo.create` (chunked) since those have no bulk path.
 */

// dataset key -> repository key
const ENTITY_TO_REPO = [
  ['users', 'user'],
  ['providers', 'provider'],
  ['availability', 'availability'],
  ['bookings', 'booking'],
  ['transactions', 'transaction'],
  ['reviews', 'review'],
  ['conversations', 'conversation'],
  ['messages', 'message'],
  ['favourites', 'favourite'],
  ['notification', 'notification'],
  ['savedAddress', 'savedAddress'],
  ['auditLog', 'auditLog'],
];

async function pgBatchInsert(repo, docs, batchSize = 500) {
  if (!docs.length) return;
  const cols = [...repo.colNames, 'doc'];
  const colCount = cols.length;
  for (let start = 0; start < docs.length; start += batchSize) {
    const chunk = docs.slice(start, start + batchSize);
    const params = [];
    const tuples = chunk.map((doc, row) => {
      const base = row * colCount;
      const ph = repo.colNames.map((c, i) => {
        const v = repo.columns[c](doc);
        params.push(v === undefined ? null : v);
        return `$${base + i + 1}`;
      });
      params.push(JSON.stringify(doc));
      ph.push(`$${base + colCount}::jsonb`);
      return `(${ph.join(',')})`;
    });
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO ${repo.table} (${cols.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`,
      params
    );
  }
}

async function loopCreate(repo, docs, chunk = 200) {
  for (let i = 0; i < docs.length; i += chunk) {
    const slice = docs.slice(i, i + chunk);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(slice.map((d) => repo.create(d)));
  }
}

/** Load a dataset into the given driver. Returns ms elapsed. */
async function loadDataset(driver, dataset) {
  const start = process.hrtime.bigint();
  for (const [entityKey, repoKey] of ENTITY_TO_REPO) {
    const docs = dataset[entityKey] || [];
    const repo = driver.repos[repoKey];
    if (!repo || !docs.length) continue;
    if (driver.name === 'postgres' && repo.colNames) {
      // eslint-disable-next-line no-await-in-loop
      await pgBatchInsert(repo, docs);
    } else {
      // availability has `save` not `create` in some drivers
      const fn = repo.create ? 'create' : 'save';
      // eslint-disable-next-line no-await-in-loop
      await loopCreate({ create: (d) => repo[fn](d) }, docs);
    }
  }
  return Number(process.hrtime.bigint() - start) / 1e6;
}

module.exports = { loadDataset, pgBatchInsert, ENTITY_TO_REPO };
