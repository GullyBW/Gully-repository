'use strict';

const { id, sha256 } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Backup / restore with verification (Phase 2, WS10; doc §16 DR).
 *
 * A snapshot captures every store collection plus derived ledger state,
 * with per-collection checksums and a manifest checksum. Verification
 * recomputes checksums; restore rebuilds a platform's store and derived
 * state (ledger balances from postings, audit chain heads from events)
 * and then PROVES integrity: trial balance re-derived from postings must
 * match, and every audit chain must still verify. Quarterly restore
 * drills run exactly this path (docs/DEPLOYMENT.md).
 */
class BackupService {
  constructor({ clock }) {
    this.clock = clock;
    this.backups = new Map(); // id -> snapshot (production: GCS bucket)
  }

  snapshot(platform, { note = null } = {}) {
    const collections = {};
    const checksums = {};
    for (const [name, collection] of platform.store.collections) {
      const rows = collection.find();
      collections[name] = rows;
      checksums[name] = sha256(JSON.stringify(rows));
    }
    const balances = [...platform.ledger.balances.entries()];
    const snapshot = {
      id: id('bak'),
      created_at: this.clock.nowIso(),
      note,
      collections,
      ledger_balances: balances,
      checksums,
      manifest_checksum: sha256(JSON.stringify(checksums) + sha256(JSON.stringify(balances))),
    };
    this.backups.set(snapshot.id, snapshot);
    return {
      id: snapshot.id,
      created_at: snapshot.created_at,
      note,
      collections: Object.keys(collections).length,
      rows: Object.values(collections).reduce((s, rows) => s + rows.length, 0),
      manifest_checksum: snapshot.manifest_checksum,
    };
  }

  list() {
    return [...this.backups.values()].map((b) => ({
      id: b.id,
      created_at: b.created_at,
      note: b.note,
      collections: Object.keys(b.collections).length,
      manifest_checksum: b.manifest_checksum,
    }));
  }

  get(backupId) {
    const backup = this.backups.get(backupId);
    if (!backup) throw err('NOT_FOUND', `No backup ${backupId}`);
    return backup;
  }

  /** Backup verification: recompute every checksum. Fails loudly. */
  verify(backupId) {
    const backup = this.get(backupId);
    const failures = [];
    for (const [name, rows] of Object.entries(backup.collections)) {
      if (sha256(JSON.stringify(rows)) !== backup.checksums[name]) failures.push(name);
    }
    const manifest = sha256(
      JSON.stringify(backup.checksums) + sha256(JSON.stringify(backup.ledger_balances))
    );
    if (manifest !== backup.manifest_checksum) failures.push('manifest');
    return { backup_id: backupId, valid: failures.length === 0, failures };
  }

  /**
   * Restore into a platform (typically a FRESH one for drills; in-place
   * for real DR). Rebuilds derived state and returns proof of integrity.
   */
  restore(backupId, platform) {
    const backup = this.get(backupId);
    const verification = this.verify(backupId);
    if (!verification.valid) {
      throw err('STATE_CONFLICT', `Backup fails verification: ${verification.failures.join(',')}`);
    }
    // Load raw collections.
    for (const [name, rows] of Object.entries(backup.collections)) {
      const collection = platform.store.collection(name);
      collection.rows.clear();
      for (const row of rows) collection.rows.set(row.id, { ...row });
    }
    // Rebuild ledger balances INDEPENDENTLY from postings, then compare
    // to the snapshot's balances — a real integrity check, not a copy.
    const rebuilt = new Map();
    for (const account of platform.store.collection('ledger_accounts').find()) {
      rebuilt.set(account.id, 0);
    }
    for (const posting of platform.store.collection('ledger_postings').find()) {
      for (const entry of posting.entries) {
        rebuilt.set(entry.account_id, (rebuilt.get(entry.account_id) || 0) + entry.amount_minor);
      }
    }
    const snapshotBalances = new Map(backup.ledger_balances);
    const balanceMismatches = [];
    for (const [accountId, value] of rebuilt) {
      if ((snapshotBalances.get(accountId) || 0) !== value) balanceMismatches.push(accountId);
    }
    platform.ledger.balances = rebuilt;

    // Rebuild audit chain heads and verify every chain end-to-end.
    platform.audit.heads = new Map();
    const brokenChains = [];
    const objectRefs = new Set(
      platform.store.collection('audit_events').find().map((e) => e.object_ref)
    );
    for (const objectRef of objectRefs) {
      const chain = platform.audit.chainFor(objectRef);
      platform.audit.heads.set(objectRef, chain[chain.length - 1].hash);
      if (!platform.audit.verifyChain(objectRef).valid) brokenChains.push(objectRef);
    }
    const trialBalance = platform.ledger.trialBalance();
    return {
      backup_id: backupId,
      restored_collections: Object.keys(backup.collections).length,
      trial_balance: trialBalance,
      balance_mismatches: balanceMismatches,
      audit_chains_verified: objectRefs.size,
      broken_audit_chains: brokenChains,
      success:
        trialBalance.balanced && balanceMismatches.length === 0 && brokenChains.length === 0,
    };
  }
}

module.exports = { BackupService };
