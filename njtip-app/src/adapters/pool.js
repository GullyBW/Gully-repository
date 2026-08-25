'use strict';
// Connection pool (bounded, with backpressure + stats). Models the enterprise resource-
// management concern the same way for any backing driver: a fixed number of "connections"
// is acquired and released; requests beyond the limit WAIT in FIFO order. In-process the
// "connection" is a handle to the shared driver, but the pool enforces the concurrency
// ceiling and records metrics — exactly what a production pg/redis pool provides.
//
// withConnection(fn) acquires, runs fn(conn) (fn may be async), and always releases.
class ConnectionPool {
  constructor(factory, { max = 10 } = {}) {
    this._factory = factory;         // () => connection
    this._max = max;
    this._all = [];                  // every connection created
    this._idle = [];                 // available connections
    this._waiters = [];              // FIFO resolvers waiting for a connection
    this._stats = { created: 0, acquired: 0, released: 0, waited: 0, maxInUse: 0 };
  }
  _inUse() { return this._all.length - this._idle.length; }

  acquire() {
    return new Promise((resolve) => {
      if (this._idle.length) { return resolve(this._checkout(this._idle.pop())); }
      if (this._all.length < this._max) { const c = this._factory(); this._all.push(c); this._stats.created++; return resolve(this._checkout(c)); }
      // Pool exhausted → wait (backpressure), preserving FIFO fairness.
      this._stats.waited++;
      this._waiters.push((c) => resolve(this._checkout(c)));
    });
  }
  _checkout(c) { this._stats.acquired++; this._stats.maxInUse = Math.max(this._stats.maxInUse, this._inUse()); return c; }
  release(c) {
    this._stats.released++;
    const next = this._waiters.shift();
    if (next) return next(c);        // hand directly to the next waiter
    this._idle.push(c);
  }
  async withConnection(fn) { const c = await this.acquire(); try { return await fn(c); } finally { this.release(c); } }
  stats() { return { ...this._stats, size: this._all.length, idle: this._idle.length, inUse: this._inUse(), max: this._max, waiting: this._waiters.length }; }
}
module.exports = { ConnectionPool };
