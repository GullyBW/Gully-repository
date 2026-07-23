'use strict';
// Policy engine (blueprint phase2/02, DDR-09). FAIL-CLOSED: default deny, and if
// the engine is unavailable, requests are DENIED (never fail open).
class PolicyEngine {
  constructor() {
    this._available = true;
    this._rules = []; // { action, effect: 'allow'|'deny', when(req)->bool }
    this._default = 'deny';
  }

  setAvailable(v) {
    this._available = !!v;
  }

  addRule(rule) {
    this._rules.push(rule);
    return this;
  }

  evaluate(req) {
    if (!this._available) return { effect: 'deny', reason: 'engine-unavailable-fail-closed' };
    for (const r of this._rules) {
      if (r.action === req.action && (!r.when || r.when(req))) {
        return { effect: r.effect, reason: `rule:${r.action}:${r.effect}` };
      }
    }
    return { effect: this._default, reason: 'default-deny' };
  }

  introspect() {
    return { defaultEffect: this._default, failClosed: true, available: this._available };
  }
}

module.exports = { PolicyEngine };
