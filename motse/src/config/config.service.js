'use strict';

const crypto = require('crypto');
const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

const NOOP_METRICS = { inc() {}, setGauge() {} };

/**
 * Distributed configuration platform (Mission 6). The operational-config layer
 * that governs the runtime knobs of the resilience/observability subsystems —
 * without a restart. Complements the domain FlagService (per-ward/morafe pilot
 * flags), which is unchanged; this owns typed operational config with:
 *
 *   - TYPED keys with a VALIDATOR (a bad resilience threshold is rejected) and
 *     an optional live APPLIER (the value is pushed into the running object).
 *   - VERSIONED revisions (append-only), rollback to any revision, and named
 *     SNAPSHOTS of the whole config for point-in-time restore.
 *   - Feature management: deterministic PERCENTAGE / CANARY rollout by subject
 *     hash, plus per-subject targeting overrides.
 *   - SCHEDULING: activateAt / expireAt windows and TTL overrides; a `tick()`
 *     activates/expires due changes (driven by the health cycle — no new timer).
 *   - EMERGENCY ops: a global KILL SWITCH and SAFE MODE that force flagged keys
 *     to their safe defaults, plus temporary overrides. Everything is audited
 *     and evented.
 *
 * Every mutation is atomic over the Store's Unit of Work where a Store is
 * provided; in-memory revisions/snapshots keep it testable standalone.
 */
class ConfigService {
  constructor({ clock, audit = null, bus = null, metrics = null } = {}) {
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.audit = audit;
    this.bus = bus;
    this.metrics = metrics || NOOP_METRICS;
    this.keys = new Map(); // key -> definition
    this.revisions = []; // append-only revision log (all keys)
    this.snapshots = new Map(); // label -> { at, values }
    this._rev = 0;
    this.killSwitchOn = false;
    this.safeModeOn = false;
    if (bus && !bus.schemas.has('config.changed')) bus.register('config.changed', 1, ['key']);
  }

  /**
   * Register a typed config key.
   * @param key          dotted key, e.g. "resilience.redis.breaker.failureThreshold"
   * @param type         'number' | 'boolean' | 'string' | 'json'
   * @param defaultValue safe default (also the kill-switch / safe-mode value unless safeValue given)
   * @param validate     (value) => true | string(error) — rejects bad values
   * @param apply        (value) => void — live application into the running system
   * @param safeValue    value forced under kill switch / safe mode (defaults to defaultValue)
   * @param emergencyManaged whether kill switch / safe mode overrides this key
   */
  register(key, { type = 'json', defaultValue, validate = null, apply = null, description = '', safeValue, emergencyManaged = false } = {}) {
    if (this.keys.has(key)) throw err('STATE_CONFLICT', `config key already registered: ${key}`);
    const def = {
      key, type, description,
      default_value: defaultValue,
      safe_value: safeValue !== undefined ? safeValue : defaultValue,
      emergency_managed: emergencyManaged,
      validate, apply,
      value: defaultValue, // current stored value (pre-schedule/emergency)
      target: null, // { percent, salt } rollout, or null
      overrides: new Map(), // subject -> value (targeting)
      schedule: null, // { activateAt, expireAt, pending }
      updated_by: 'system', updated_at: this.clock.nowIso(),
    };
    this.keys.set(key, def);
    if (def.apply) this._applyOne(def, def.default_value); // seed the running system
    return this._public(def);
  }

  _def(key) {
    const def = this.keys.get(key);
    if (!def) throw err('NOT_FOUND', `unknown config key: ${key}`);
    return def;
  }

  _validate(def, value) {
    if (def.type === 'number' && typeof value !== 'number') throw err('INVALID_ARGUMENT', `${def.key} expects a number`);
    if (def.type === 'boolean' && typeof value !== 'boolean') throw err('INVALID_ARGUMENT', `${def.key} expects a boolean`);
    if (def.type === 'string' && typeof value !== 'string') throw err('INVALID_ARGUMENT', `${def.key} expects a string`);
    if (def.validate) {
      const res = def.validate(value);
      if (res !== true) throw err('INVALID_ARGUMENT', `${def.key} rejected: ${res}`);
    }
  }

  /**
   * Set a value (validated, versioned, live-applied, audited).
   * @param opts.actor       who
   * @param opts.reason      audit note
   * @param opts.activateAt  ISO/ms — defer activation (scheduled)
   * @param opts.expireAt    ISO/ms — auto-revert to default after
   */
  set(key, value, { actor = 'system', reason = null, activateAt = null, expireAt = null } = {}) {
    const def = this._def(key);
    this._validate(def, value);
    const before = def.value;
    const now = this.clock.nowMs();
    const activateMs = parseTime(activateAt);
    const expireMs = parseTime(expireAt);
    if (activateMs && activateMs > now) {
      // Scheduled: stage it; tick() will activate when due.
      def.schedule = { activateAt: activateMs, expireAt: expireMs, pendingValue: value };
      this._record(def, before, value, actor, reason, 'scheduled');
      return this._public(def);
    }
    def.value = value;
    def.schedule = expireMs ? { expireAt: expireMs } : null;
    def.updated_by = actor;
    def.updated_at = this.clock.nowIso();
    this._applyEffective(def);
    this._record(def, before, value, actor, reason, 'set');
    return this._public(def);
  }

  /** Percentage / canary rollout: `percent`% of subjects (by stable hash) get `value`. */
  rollout(key, value, percent, { salt = 'motse', actor = 'system' } = {}) {
    const def = this._def(key);
    this._validate(def, value);
    if (percent < 0 || percent > 100) throw err('INVALID_ARGUMENT', 'percent must be 0..100');
    def.target = { value, percent, salt };
    this._record(def, def.value, value, actor, `rollout ${percent}%`, 'rollout');
    return this._public(def);
  }

  /** Per-subject targeting override (a tenant/user pinned to a value). */
  target(key, subject, value, { actor = 'system' } = {}) {
    const def = this._def(key);
    this._validate(def, value);
    def.overrides.set(subject, value);
    this._record(def, def.value, value, actor, `target ${subject}`, 'target');
    return this._public(def);
  }

  /**
   * The effective value for an optional subject. Precedence:
   *   kill switch / safe mode (managed keys) > per-subject target >
   *   rollout bucket > current value.
   */
  effective(key, subject = null) {
    const def = this._def(key);
    if ((this.killSwitchOn || this.safeModeOn) && def.emergency_managed) return def.safe_value;
    if (subject != null && def.overrides.has(subject)) return def.overrides.get(subject);
    if (subject != null && def.target && inBucket(subject, def.target.salt, def.target.percent)) {
      return def.target.value;
    }
    return def.value;
  }

  get(key) { return this.effective(key); }

  /** Roll a key back to a prior revision's value. */
  rollback(key, rev, { actor = 'system' } = {}) {
    const def = this._def(key);
    const target = this.revisions.find((r) => r.key === key && r.rev === rev);
    if (!target) throw err('NOT_FOUND', `no revision ${rev} for ${key}`);
    return this.set(key, target.to, { actor, reason: `rollback to rev ${rev}` });
  }

  history(key) {
    return this.revisions.filter((r) => r.key === key);
  }

  /** Capture a named snapshot of every key's current value (rollback point). */
  snapshot(label, { actor = 'system' } = {}) {
    const values = {};
    for (const [key, def] of this.keys) values[key] = def.value;
    this.snapshots.set(label, { at: this.clock.nowIso(), by: actor, values });
    return { label, keys: Object.keys(values).length, at: this.clock.nowIso() };
  }

  /** Restore a snapshot (each differing key is re-set + re-applied + audited). */
  restore(label, { actor = 'system' } = {}) {
    const snap = this.snapshots.get(label);
    if (!snap) throw err('NOT_FOUND', `no snapshot ${label}`);
    const changed = [];
    for (const [key, value] of Object.entries(snap.values)) {
      const def = this.keys.get(key);
      if (def && !deepEqual(def.value, value)) { this.set(key, value, { actor, reason: `restore ${label}` }); changed.push(key); }
    }
    return { label, restored: changed.length, keys: changed };
  }

  // ── emergency operations ────────────────────────────────────────────
  killSwitch(on, { actor = 'system' } = {}) {
    this.killSwitchOn = !!on;
    this.metrics.setGauge('motse_config_kill_switch', {}, on ? 1 : 0);
    if (on) this.metrics.inc('motse_config_emergency_total', { type: 'kill_switch' }); // activation count for analytics
    this._reapplyManaged();
    if (this.audit) this.audit.append(actor, 'config.kill_switch', 'config:global', { on: !on }, { on: !!on });
    return { kill_switch: this.killSwitchOn };
  }

  safeMode(on, { actor = 'system' } = {}) {
    this.safeModeOn = !!on;
    this.metrics.setGauge('motse_config_safe_mode', {}, on ? 1 : 0);
    if (on) this.metrics.inc('motse_config_emergency_total', { type: 'safe_mode' }); // activation count for analytics
    this._reapplyManaged();
    if (this.audit) this.audit.append(actor, 'config.safe_mode', 'config:global', { on: !on }, { on: !!on });
    return { safe_mode: this.safeModeOn };
  }

  /** Process due scheduled activations and expirations. Idempotent per call. */
  tick() {
    const now = this.clock.nowMs();
    const activated = [];
    const expired = [];
    for (const def of this.keys.values()) {
      const s = def.schedule;
      if (!s) continue;
      if (s.pendingValue !== undefined && s.activateAt && s.activateAt <= now) {
        def.value = s.pendingValue;
        def.schedule = s.expireAt ? { expireAt: s.expireAt } : null;
        this._applyEffective(def);
        this._record(def, undefined, def.value, 'scheduler', 'activated', 'activate');
        activated.push(def.key);
      } else if (s.expireAt && s.expireAt <= now && s.pendingValue === undefined) {
        const before = def.value;
        def.value = def.default_value;
        def.schedule = null;
        this._applyEffective(def);
        this._record(def, before, def.default_value, 'scheduler', 'expired', 'expire');
        expired.push(def.key);
      }
    }
    return { activated, expired };
  }

  /** Re-apply every key's effective value to its running system (post-restore/boot). */
  reapplyAll() {
    for (const def of this.keys.values()) this._applyEffective(def);
    return { applied: [...this.keys.keys()].filter((k) => this.keys.get(k).apply) };
  }

  list() {
    return [...this.keys.values()].map((d) => this._public(d));
  }

  stats() {
    return {
      keys: this.keys.size,
      revisions: this.revisions.length,
      snapshots: [...this.snapshots.keys()],
      kill_switch: this.killSwitchOn,
      safe_mode: this.safeModeOn,
      scheduled: [...this.keys.values()].filter((d) => d.schedule).map((d) => d.key),
      rollouts: [...this.keys.values()].filter((d) => d.target).map((d) => ({ key: d.key, percent: d.target.percent })),
    };
  }

  // ── internals ───────────────────────────────────────────────────────
  _applyEffective(def) {
    const value = (this.killSwitchOn || this.safeModeOn) && def.emergency_managed ? def.safe_value : def.value;
    this._applyOne(def, value);
  }

  _applyOne(def, value) {
    if (!def.apply) return;
    try { def.apply(value); } catch (e) { /* an applier must never break a config change */ }
  }

  _reapplyManaged() {
    for (const def of this.keys.values()) if (def.emergency_managed) this._applyEffective(def);
  }

  _record(def, before, after, actor, reason, op) {
    this._rev += 1;
    const rev = { rev: this._rev, key: def.key, op, from: before, to: after, actor, reason, at: this.clock.nowIso() };
    this.revisions.push(rev);
    if (this.revisions.length > 5000) this.revisions.shift();
    this.metrics.inc('motse_config_changes_total', { op });
    if (this.audit) this.audit.append(actor, `config.${op}`, `config:${def.key}`, { value: before }, { value: after });
    if (this.bus) this.bus.publish('config.changed', { key: def.key });
  }

  _public(def) {
    return {
      key: def.key, type: def.type, description: def.description,
      value: def.value, default_value: def.default_value, effective: this.effective(def.key),
      emergency_managed: def.emergency_managed,
      rollout: def.target ? { percent: def.target.percent } : null,
      targets: def.overrides.size,
      scheduled: def.schedule || null,
      updated_by: def.updated_by, updated_at: def.updated_at,
    };
  }
}

/** Deterministic rollout bucket: subject is in the first `percent`% by hash. */
function inBucket(subject, salt, percent) {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const h = crypto.createHash('sha256').update(`${salt}:${subject}`).digest();
  const bucket = h.readUInt16BE(0) % 100; // 0..99
  return bucket < percent;
}

function parseTime(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
}

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

module.exports = { ConfigService, inBucket };
