'use strict';
// Privacy-aware notification service. Notifications are keyed by anonymous case code
// and carry MINIMAL, non-identifying payloads (blueprint DT-2). A reporter polls by
// case code (no identity, no push to a device that could be linked). Production swaps
// the transport behind this port; the privacy contract is unchanged.
class NotificationService {
  constructor(store, clock = () => Date.now()) { this._store = store; this._clock = clock; }
  notify(caseCode, type, meta = {}) {
    // Strip anything that could identify; only a coarse type + safe metadata is kept.
    const safe = { type, at: this._clock(), status: meta.status };
    const list = this._store.get(caseCode) || [];
    list.push(safe);
    this._store.put(caseCode, list);
    return safe;
  }
  forCase(caseCode) { return this._store.get(caseCode) || []; }
  count() { return this._store.keys().reduce((n, k) => n + (this._store.get(k) || []).length, 0); }
}
module.exports = { NotificationService };
