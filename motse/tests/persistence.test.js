'use strict';

/**
 * Foundation F1 — repository transactional integrity (Unit of Work). The
 * in-memory Store now supports `transaction(fn)`: mutations commit together
 * or roll back atomically on failure, with byte-identical behaviour outside
 * a transaction (so every existing caller is unaffected).
 */
const { Store, Collection } = require('../src/kernel/store');
const { world } = require('./helpers');

describe('Store — Unit of Work transactions', () => {
  test('commit persists every mutation', () => {
    const store = new Store();
    const c = store.collection('accounts');
    c.insert({ id: 'a', bal: 100 });
    const out = store.transaction(() => {
      c.update('a', { bal: 90 });
      c.insert({ id: 'b', bal: 10 });
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(c.get('a').bal).toBe(90);
    expect(c.get('b').bal).toBe(10);
    expect(store.inTransaction).toBe(false);
  });

  test('rollback restores prior state across insert/update/delete', () => {
    const store = new Store();
    const c = store.collection('accounts');
    c.insert({ id: 'a', bal: 100 });
    c.insert({ id: 'd', bal: 5 });
    expect(() => store.transaction(() => {
      c.update('a', { bal: 999 }); // will be reverted
      c.insert({ id: 'b', bal: 10 }); // will be removed
      c.delete('d'); // will be restored
      throw new Error('boom');
    })).toThrow('boom');
    expect(c.get('a').bal).toBe(100); // update reverted
    expect(c.get('b')).toBeNull(); // insert removed
    expect(c.get('d').bal).toBe(5); // delete restored
    expect(store.inTransaction).toBe(false);
  });

  test('rollback reverts multi-collection mutations together', () => {
    const store = new Store();
    const ledger = store.collection('ledger');
    const intents = store.collection('intents');
    ledger.insert({ id: 'acc', bal: 0 });
    intents.insert({ id: 'i1', state: 'authorized' });
    expect(() => store.transaction(() => {
      ledger.update('acc', { bal: 500 });
      intents.update('i1', { state: 'captured' });
      throw new Error('capture failed after ledger write');
    })).toThrow();
    // Neither the ledger write nor the intent transition survives.
    expect(ledger.get('acc').bal).toBe(0);
    expect(intents.get('i1').state).toBe('authorized');
  });

  test('nested transactions join the outer unit and roll back as one', () => {
    const store = new Store();
    const c = store.collection('x');
    c.insert({ id: 'a', n: 1 });
    expect(() => store.transaction(() => {
      c.update('a', { n: 2 });
      store.transaction(() => { c.update('a', { n: 3 }); }); // joins outer
      throw new Error('outer fails');
    })).toThrow();
    expect(c.get('a').n).toBe(1); // both levels rolled back
  });

  test('a committed inner change stays if the outer commits', () => {
    const store = new Store();
    const c = store.collection('x');
    c.insert({ id: 'a', n: 1 });
    store.transaction(() => {
      store.transaction(() => { c.update('a', { n: 7 }); });
    });
    expect(c.get('a').n).toBe(7);
  });

  test('outside a transaction, behaviour is unchanged (no journaling)', () => {
    const store = new Store();
    const c = store.collection('x');
    c.insert({ id: 'a', n: 1 });
    c.update('a', { n: 2 });
    expect(c.delete('a')).toBe(true);
    expect(c.delete('missing')).toBe(false);
    expect(store.inTransaction).toBe(false);
  });

  test('a Collection with no owning Store works (no journaling path)', () => {
    const c = new Collection('orphan'); // store defaults to null
    c.insert({ id: 'a', n: 1 });
    expect(c.update('a', { n: 2 }).n).toBe(2);
    expect(c.delete('a')).toBe(true);
  });

  test('the live platform ledger stays balanced when wrapped in a transaction', () => {
    const w = world();
    const a = w.p.ledger.openAccount('m:a', 'community_trust');
    const b = w.p.ledger.openAccount('m:b', 'community_trust');
    // A balanced posting inside a transaction commits and keeps the books balanced.
    w.p.store.transaction(() => {
      w.p.ledger.providerDeposit({
        providerAccountId: w.providerClearing.id, destAccountId: a.id,
        amountMinor: 4000, providerTxRef: 'tx-uow', idempotencyKey: 'uow-1',
      });
    });
    expect(w.p.ledger.balance(a.id)).toBe(4000);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });
});
