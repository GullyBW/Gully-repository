'use strict';
// Unit of Work (transactional boundary) over a SQL driver that supports begin/commit/
// rollback. run(fn) executes fn inside a transaction: it commits on success and rolls
// back on ANY thrown error, so a multi-step domain operation is all-or-nothing. This is
// the seam a production PgDriver fills with real BEGIN/COMMIT/ROLLBACK; the in-memory
// driver uses snapshot isolation.
//
// Usage:
//   const uow = new UnitOfWork(driver);
//   uow.run(() => { store.putIfVersion(...); other.put(...); });   // atomic
class UnitOfWork {
  constructor(driver) { this._d = driver; }
  supported() { return typeof this._d.begin === 'function' && typeof this._d.commit === 'function' && typeof this._d.rollback === 'function'; }
  run(fn) {
    if (!this.supported()) return fn(); // degrade gracefully if the driver has no txns
    this._d.begin();
    try { const out = fn(); this._d.commit(); return out; }
    catch (e) { this._d.rollback(); throw e; }
  }
}
module.exports = { UnitOfWork };
