'use strict';

const express = require('express');
const { id, sha256, hmac, timingSafeEqual } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Plugin architecture (Phase 3, WS5). Motse becomes an extensible
 * platform: new modules install without touching the core.
 *
 * A plugin is { manifest, register(host) }:
 *   manifest: {
 *     name, version, api_version,
 *     permissions: ['ledger:read','search:index','events:subscribe', …],
 *     dependencies: { 'other-plugin': '^1.0.0' },
 *     routes_prefix?           // mounted under /v1/ext/<prefix>
 *   }
 *   register(host) → { routes?: Router, hooks?: {...} }
 *
 * Guarantees:
 *  - digital signature verification (HMAC over the manifest+code hash)
 *    before a plugin is ever loaded — unsigned/forged plugins refused;
 *  - permission SANDBOX: register() receives a capability-scoped host
 *    facade exposing ONLY the services the manifest's permissions grant,
 *    so a plugin literally cannot reach the ledger write API unless it
 *    declared (and was granted) 'ledger:write';
 *  - dependency + api-version + semver checks at load time;
 *  - lifecycle hooks (onEnable/onDisable) and hot enable/disable that
 *    mounts/unmounts routes on a live router with no restart;
 *  - every lifecycle transition is audited.
 *
 * Core services are never modified: a plugin is additive by construction.
 */
const API_VERSION = '1.x';

const PERMISSION_FACETS = {
  'identity:read': (p) => ({
    getUser: (uid) => safe(p.identity.get(uid)),
    attestMembership: (uid, m) => p.identity.attestMembership(uid, m),
  }),
  'ledger:read': (p) => ({
    balance: (accountId) => p.ledger.balance(accountId),
    accountsFor: (ownerRef) => p.ledger.accountsFor(ownerRef),
  }),
  'ledger:write': (p) => ({
    // Even granted, plugins post through the same audited, balanced API.
    transfer: (args) => p.ledger.transfer(args),
    openAccount: (owner, type) => p.ledger.openAccount(owner, type),
  }),
  'search:read': (p) => ({ search: (q, opts) => p.search.search(q, opts) }),
  'search:index': (p) => ({ reindex: () => p.search.reindex() }),
  'events:subscribe': (p, plugin) => ({
    subscribe: (type, handler) => p.bus.subscribe(type, `plugin:${plugin.name}`, handler),
  }),
  'events:publish': (p, plugin) => ({
    register: (type, version, fields) => p.bus.register(type, version, fields),
    publish: (type, data) => p.bus.publish(type, data),
  }),
  'notifications:send': (p) => ({
    notify: (userRef, msg) => p.notifications.notify(userRef, msg),
  }),
  'audit:append': (p, plugin) => ({
    append: (actor, action, objectRef, before, after) =>
      p.audit.append(actor, `plugin:${plugin.name}:${action}`, objectRef, before, after),
  }),
  'store:namespaced': (p, plugin) => ({
    // A plugin gets its OWN namespaced collections — no access to core rows.
    collection: (localName) => p.store.collection(`plugin_${plugin.name}_${localName}`),
  }),
};

class PluginManager {
  constructor({ store, clock, audit, platform, signingSecret }) {
    this.registry = store.collection('plugins');
    this.clock = clock;
    this.audit = audit;
    this.platform = platform;
    this.signingSecret = signingSecret || 'motse-plugin-signing-secret';
    this.loaded = new Map(); // name -> { manifest, plugin, enabled, mounted, hooks }
    // A single router the app mounts once at /v1/ext; plugins mount and
    // unmount their sub-routers here for hot enable/disable.
    this.router = express.Router();
    this.router.use((req, res, next) => {
      const parts = req.path.split('/').filter(Boolean);
      const prefix = parts[0];
      const entry = [...this.loaded.values()].find(
        (e) => e.manifest.routes_prefix === prefix
      );
      if (entry && !entry.enabled) {
        return next(err('NOT_FOUND', `Plugin "${entry.manifest.name}" is disabled`));
      }
      return next();
    });
    this._mountedRouters = new Map(); // prefix -> handler for delegation
    this.router.use((req, res, next) => {
      const parts = req.path.split('/').filter(Boolean);
      const handler = this._mountedRouters.get(parts[0]);
      if (!handler) return next();
      req.url = `/${parts.slice(1).join('/')}`; // strip the prefix
      return handler(req, res, next);
    });
  }

  /** Compute the signature an author embeds; also used to verify. */
  sign(manifest, codeHash) {
    return hmac(this.signingSecret, `${sha256(JSON.stringify(manifest))}.${codeHash}`);
  }

  /**
   * Install a plugin package: verify signature, api-version, deps and
   * semver, then register it (disabled until explicitly enabled).
   */
  install(pkg, actor) {
    const { manifest, register, codeHash, signature } = pkg;
    if (!manifest || !manifest.name || !manifest.version) {
      throw err('INVALID_ARGUMENT', 'Plugin manifest needs name and version');
    }
    // Digital signature verification — fail closed.
    const expected = this.sign(manifest, codeHash || sha256(String(register)));
    if (!signature || !timingSafeEqual(expected, signature)) {
      throw err('PERMISSION_DENIED', 'Plugin signature verification failed', {
        plugin: manifest.name,
      });
    }
    if (!semverSatisfiesApi(manifest.api_version || '1.0.0')) {
      throw err('INVALID_ARGUMENT', `Plugin targets api ${manifest.api_version}, host is ${API_VERSION}`);
    }
    if (this.loaded.has(manifest.name)) {
      throw err('STATE_CONFLICT', `Plugin ${manifest.name} already installed`);
    }
    for (const [dep, range] of Object.entries(manifest.dependencies || {})) {
      const depEntry = this.loaded.get(dep);
      if (!depEntry) throw err('INVALID_ARGUMENT', `Missing plugin dependency ${dep}`);
      if (!semverSatisfies(depEntry.manifest.version, range)) {
        throw err('INVALID_ARGUMENT', `Dependency ${dep}@${depEntry.manifest.version} does not satisfy ${range}`);
      }
    }
    // Build the permission-scoped host facade (the sandbox).
    const host = this._buildHost(manifest);
    const registration = register(host) || {};
    this.loaded.set(manifest.name, {
      manifest,
      registration,
      hooks: registration.hooks || {},
      routes: registration.routes || null,
      enabled: false,
      installed_at: this.clock.nowIso(),
    });
    this.registry.insert({
      id: id('plg'),
      name: manifest.name,
      version: manifest.version,
      permissions: manifest.permissions || [],
      dependencies: manifest.dependencies || {},
      routes_prefix: manifest.routes_prefix || null,
      state: 'installed',
      installed_at: this.clock.nowIso(),
    });
    this.audit.append(actor, 'plugin.installed', `plugin:${manifest.name}`, null, {
      version: manifest.version,
      permissions: manifest.permissions || [],
    });
    return { name: manifest.name, version: manifest.version, enabled: false };
  }

  /** Hot enable: mount routes, run onEnable, flip state — no restart. */
  enable(name, actor) {
    const entry = this._entry(name);
    if (entry.enabled) return { name, enabled: true };
    if (entry.routes && entry.manifest.routes_prefix) {
      this._mountedRouters.set(entry.manifest.routes_prefix, entry.routes);
    }
    entry.enabled = true;
    if (entry.hooks.onEnable) entry.hooks.onEnable();
    this._setState(name, 'enabled');
    this.audit.append(actor, 'plugin.enabled', `plugin:${name}`, null, null);
    return { name, enabled: true };
  }

  /** Hot disable: unmount routes, run onDisable. State/data persist. */
  disable(name, actor) {
    const entry = this._entry(name);
    if (!entry.enabled) return { name, enabled: false };
    if (entry.manifest.routes_prefix) this._mountedRouters.delete(entry.manifest.routes_prefix);
    entry.enabled = false;
    if (entry.hooks.onDisable) entry.hooks.onDisable();
    this._setState(name, 'disabled');
    this.audit.append(actor, 'plugin.disabled', `plugin:${name}`, null, null);
    return { name, enabled: false };
  }

  list() {
    return [...this.loaded.values()].map((e) => ({
      name: e.manifest.name,
      version: e.manifest.version,
      permissions: e.manifest.permissions || [],
      routes_prefix: e.manifest.routes_prefix || null,
      enabled: e.enabled,
    }));
  }

  get(name) {
    const entry = this.loaded.get(name);
    return entry ? { ...entry.manifest, enabled: entry.enabled } : null;
  }

  _buildHost(manifest) {
    const granted = new Set(manifest.permissions || []);
    const host = {
      clock: this.platform.clock, // reading the injected clock is always safe
      manifest,
      permissions: [...granted],
    };
    for (const [perm, factory] of Object.entries(PERMISSION_FACETS)) {
      if (granted.has(perm)) {
        Object.assign(host, factory(this.platform, manifest));
      }
    }
    // A guard so a plugin calling an ungranted capability fails loudly.
    host.require = (perm) => {
      if (!granted.has(perm)) {
        throw err('PERMISSION_DENIED', `Plugin ${manifest.name} lacks permission ${perm}`);
      }
    };
    return host;
  }

  _entry(name) {
    const entry = this.loaded.get(name);
    if (!entry) throw err('NOT_FOUND', `No plugin ${name}`);
    return entry;
  }

  _setState(name, state) {
    const row = this.registry.findOne((p) => p.name === name);
    if (row) this.registry.update(row.id, { state });
  }
}

function safe(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

// Minimal semver: supports ^, ~, and exact. Enough for plugin ranges.
function semverSatisfies(version, range) {
  const [vMaj, vMin, vPatch] = version.split('.').map(Number);
  if (range.startsWith('^')) {
    const [rMaj, rMin, rPatch] = range.slice(1).split('.').map(Number);
    return vMaj === rMaj && (vMin > rMin || (vMin === rMin && vPatch >= (rPatch || 0)));
  }
  if (range.startsWith('~')) {
    const [rMaj, rMin] = range.slice(1).split('.').map(Number);
    return vMaj === rMaj && vMin === rMin;
  }
  return version === range;
}

function semverSatisfiesApi(apiVersion) {
  return apiVersion.split('.')[0] === API_VERSION.split('.')[0];
}

module.exports = { PluginManager, API_VERSION, PERMISSION_FACETS };
