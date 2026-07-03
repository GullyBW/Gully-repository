'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Feature flags + remote configuration (doc §16: "All ten layers ship
 * dark and enable per-ward/per-morafe — pilots are a flag, not a build").
 *
 * A flag value can be set at four scopes; evaluation precedence is
 *   user:<id>  >  ward:<id>  >  morafe:<ref>  >  global  >  default.
 * Every change is audited and evented so a pilot rollout is a readable
 * history, not a mystery. Remote config uses the same machinery with
 * arbitrary JSON values (client-tunable knobs: data budgets, pack sizes).
 */
const SCOPE_KINDS = ['global', 'morafe', 'ward', 'user'];
const PRECEDENCE = ['user', 'ward', 'morafe', 'global'];

class FlagService {
  constructor({ store, clock, audit, bus }) {
    this.definitions = store.collection('flag_definitions');
    this.values = store.collection('flag_values');
    this.clock = clock;
    this.audit = audit;
    this.bus = bus;
    bus.register('pilot.flag.changed', 1, ['key', 'scope']);
  }

  /** Declare a flag (or config key) with its default. Idempotent. */
  define(key, { description, defaultValue = false, kind = 'flag' } = {}) {
    const existing = this.definitions.findOne((d) => d.key === key);
    if (existing) return existing;
    return this.definitions.insert({
      id: id('flg'),
      key,
      kind, // 'flag' (boolean) | 'config' (any JSON)
      description: description || null,
      default_value: defaultValue,
      created_at: this.clock.nowIso(),
    });
  }

  definition(key) {
    const def = this.definitions.findOne((d) => d.key === key);
    if (!def) throw err('NOT_FOUND', `No flag defined: ${key}`);
    return def;
  }

  /**
   * Set a value at a scope. scope: 'global' | 'morafe:<ref>' |
   * 'ward:<id>' | 'user:<id>'. Audited + evented.
   */
  set(key, scope, value, actor) {
    this.definition(key);
    const kind = scope === 'global' ? 'global' : scope.split(':')[0];
    if (!SCOPE_KINDS.includes(kind)) {
      throw err('INVALID_ARGUMENT', `Scope must be one of ${SCOPE_KINDS.join('|')}`);
    }
    const existing = this.values.findOne((v) => v.key === key && v.scope === scope);
    const before = existing ? existing.value : undefined;
    if (existing) {
      this.values.update(existing.id, { value, updated_by: actor, updated_at: this.clock.nowIso() });
    } else {
      this.values.insert({
        id: id('flv'),
        key,
        scope,
        scope_kind: kind,
        value,
        updated_by: actor,
        updated_at: this.clock.nowIso(),
      });
    }
    this.audit.append(actor, 'pilot.flag_set', `flag:${key}`, { scope, value: before }, { scope, value });
    this.bus.publish('pilot.flag.changed', { key, scope });
    return this.values.findOne((v) => v.key === key && v.scope === scope);
  }

  /** Remove a scoped override (falls back to broader scopes). */
  unset(key, scope, actor) {
    const existing = this.values.findOne((v) => v.key === key && v.scope === scope);
    if (!existing) return false;
    this.values.delete(existing.id);
    this.audit.append(actor, 'pilot.flag_unset', `flag:${key}`, { scope, value: existing.value }, null);
    this.bus.publish('pilot.flag.changed', { key, scope });
    return true;
  }

  /**
   * Evaluate for a context { userRef, wardRef, morafeRefs[] }.
   * Most-specific scope wins.
   */
  evaluate(key, context = {}) {
    const def = this.definition(key);
    const candidates = new Map(
      this.values.find((v) => v.key === key).map((v) => [v.scope, v.value])
    );
    for (const kind of PRECEDENCE) {
      if (kind === 'user' && context.userRef && candidates.has(`user:${context.userRef}`)) {
        return candidates.get(`user:${context.userRef}`);
      }
      if (kind === 'ward' && context.wardRef && candidates.has(`ward:${context.wardRef}`)) {
        return candidates.get(`ward:${context.wardRef}`);
      }
      if (kind === 'morafe') {
        for (const morafe of context.morafeRefs || []) {
          if (candidates.has(`morafe:${morafe}`)) return candidates.get(`morafe:${morafe}`);
        }
      }
      if (kind === 'global' && candidates.has('global')) return candidates.get('global');
    }
    return def.default_value;
  }

  /** Evaluate every defined key for a user — the client bootstrap call. */
  snapshotFor(identity, userRef) {
    let context = {};
    if (userRef) {
      const user = identity.users.get(userRef);
      if (user) context = { userRef, wardRef: user.ward_ref, morafeRefs: user.morafe_refs };
    }
    const out = {};
    for (const def of this.definitions.find()) {
      out[def.key] = this.evaluate(def.key, context);
    }
    return out;
  }

  list() {
    return this.definitions.find().map((def) => ({
      ...def,
      overrides: this.values.find((v) => v.key === def.key),
    }));
  }
}

module.exports = { FlagService };
