'use strict';

/**
 * Storage-agnostic collection store (repository base).
 *
 * The engineering doc maps each system of record to a managed store
 * (§6.1: Firestore for engagement data, Postgres for money, GCS for
 * media…). Domain services here depend only on this interface, so a
 * Firestore/Postgres adapter is a drop-in replacement — the same
 * repository-pattern discipline the rest of this repo uses.
 */
class Collection {
  constructor(name) {
    this.name = name;
    this.rows = new Map();
  }

  insert(row) {
    if (this.rows.has(row.id)) {
      throw new Error(`${this.name}: duplicate id ${row.id}`);
    }
    this.rows.set(row.id, { ...row });
    return { ...row };
  }

  get(id) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  update(id, patch) {
    const row = this.rows.get(id);
    if (!row) throw new Error(`${this.name}: no row ${id}`);
    const next = { ...row, ...patch };
    this.rows.set(id, next);
    return { ...next };
  }

  delete(id) {
    return this.rows.delete(id);
  }

  find(predicate = () => true) {
    return [...this.rows.values()].filter(predicate).map((r) => ({ ...r }));
  }

  findOne(predicate) {
    const hit = [...this.rows.values()].find(predicate);
    return hit ? { ...hit } : null;
  }

  count(predicate = () => true) {
    return this.find(predicate).length;
  }
}

class Store {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Collection(name));
    return this.collections.get(name);
  }
}

module.exports = { Store, Collection };
