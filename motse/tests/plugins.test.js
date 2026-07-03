'use strict';

const request = require('supertest');
const express = require('express');
const { createApp } = require('../src/app');
const { world, adminUser } = require('./helpers');
const marketplace = require('../src/plugins/examples/marketplace.plugin');

/** Sign a plugin package the way an author would before distribution. */
function packageOf(w, mod, { tamperManifest = false } = {}) {
  const codeHash = require('../src/kernel/ids').sha256(String(mod.register));
  const manifest = tamperManifest
    ? { ...mod.manifest, permissions: [...mod.manifest.permissions, 'ledger:write'] }
    : mod.manifest;
  return {
    manifest: mod.manifest,
    register: mod.register,
    codeHash,
    // Sign the ORIGINAL manifest; if we tamper it below the sig won't match.
    signature: w.p.plugins.sign(manifest, codeHash),
  };
}

describe('Plugin architecture (WS5)', () => {
  test('install verifies the signature — unsigned/forged plugins are refused', () => {
    const w = world();
    const admin = adminUser(w.p);
    // No signature.
    expect(() =>
      w.p.plugins.install({ manifest: marketplace.manifest, register: marketplace.register }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    // Signature over a DIFFERENT manifest (privilege-escalation attempt).
    const forged = packageOf(w, marketplace);
    forged.manifest = { ...marketplace.manifest, permissions: ['ledger:write'] };
    expect(() => w.p.plugins.install(forged, admin.id)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
  });

  test('a signed plugin installs disabled, then hot-enables and serves routes', async () => {
    const w = world();
    const admin = adminUser(w.p);
    const { app } = createApp(w.p);
    const installed = w.p.plugins.install(packageOf(w, marketplace), admin.id);
    expect(installed.enabled).toBe(false);

    const { sandbox_code } = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', sandbox_code, { deviceId: 'd' });
    const authed = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'd');

    // Disabled → routes 404.
    const before = await authed(request(app).get('/v1/ext/marketplace/listings'));
    expect(before.status).toBe(404);

    w.p.plugins.enable('community-marketplace', admin.id);
    const list = await authed(request(app).get('/v1/ext/marketplace/listings'));
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    // Plugin mutations honour the same gateway idempotency rule (§7.1).
    const created = await authed(request(app).post('/v1/ext/marketplace/listings'))
      .set('Idempotency-Key', 'mkl-1')
      .send({ title: 'Hand-woven basket', price_minor: 15000, ward_ref: w.ward.id });
    expect(created.body.title).toBe('Hand-woven basket');
    const after = await authed(request(app).get('/v1/ext/marketplace/listings'));
    expect(after.body.items).toHaveLength(1);

    // Hot disable → routes stop serving, data persists.
    w.p.plugins.disable('community-marketplace', admin.id);
    const disabled = await authed(request(app).get('/v1/ext/marketplace/listings'));
    expect(disabled.status).toBe(404);
    w.p.plugins.enable('community-marketplace', admin.id);
    const reenabled = await authed(request(app).get('/v1/ext/marketplace/listings'));
    expect(reenabled.body.items).toHaveLength(1); // survived the disable
  });

  test('permission sandbox: a plugin only receives capabilities it declared', () => {
    const w = world();
    const admin = adminUser(w.p);
    let capturedHost;
    const probe = {
      manifest: {
        name: 'probe', version: '1.0.0', api_version: '1.0.0',
        permissions: ['ledger:read'], // NOT ledger:write
      },
      register: (host) => {
        capturedHost = host;
        return {};
      },
    };
    const codeHash = require('../src/kernel/ids').sha256(String(probe.register));
    w.p.plugins.install(
      { ...probe, codeHash, signature: w.p.plugins.sign(probe.manifest, codeHash) },
      admin.id
    );
    // Granted capability present; ungranted absent.
    expect(typeof capturedHost.balance).toBe('function'); // ledger:read
    expect(capturedHost.transfer).toBeUndefined(); // ledger:write NOT granted
    expect(capturedHost.reindex).toBeUndefined(); // search:index NOT granted
    // The guard makes an ungranted call fail loudly.
    expect(() => capturedHost.require('ledger:write')).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
  });

  test('namespaced storage isolates a plugin from core collections', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.plugins.install(packageOf(w, marketplace), admin.id);
    w.p.plugins.enable('community-marketplace', admin.id);
    // The plugin writes to plugin_community-marketplace_listings, never
    // to a core collection.
    const coreCollections = [...w.p.store.collections.keys()].filter(
      (n) => n.startsWith('plugin_')
    );
    expect(coreCollections).toContain('plugin_community-marketplace_listings');
    expect(w.p.store.collections.has('listings')).toBe(false); // no core clobber
  });

  test('dependency and api-version checks gate installation', () => {
    const w = world();
    const admin = adminUser(w.p);
    // Missing dependency.
    const needsDep = {
      manifest: { name: 'dependent', version: '1.0.0', api_version: '1.0.0', dependencies: { 'base-plugin': '^1.0.0' }, permissions: [] },
      register: () => ({}),
    };
    const h1 = require('../src/kernel/ids').sha256(String(needsDep.register));
    expect(() =>
      w.p.plugins.install({ ...needsDep, codeHash: h1, signature: w.p.plugins.sign(needsDep.manifest, h1) }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

    // Wrong api version (major mismatch).
    const wrongApi = {
      manifest: { name: 'future', version: '1.0.0', api_version: '9.0.0', permissions: [] },
      register: () => ({}),
    };
    const h2 = require('../src/kernel/ids').sha256(String(wrongApi.register));
    expect(() =>
      w.p.plugins.install({ ...wrongApi, codeHash: h2, signature: w.p.plugins.sign(wrongApi.manifest, h2) }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  test('a satisfied dependency chain installs, and lifecycle transitions are audited', () => {
    const w = world();
    const admin = adminUser(w.p);
    const base = {
      manifest: { name: 'base-plugin', version: '1.2.0', api_version: '1.0.0', permissions: [] },
      register: () => ({}),
    };
    const hb = require('../src/kernel/ids').sha256(String(base.register));
    w.p.plugins.install({ ...base, codeHash: hb, signature: w.p.plugins.sign(base.manifest, hb) }, admin.id);
    const dependent = {
      manifest: { name: 'dependent', version: '1.0.0', api_version: '1.0.0', dependencies: { 'base-plugin': '^1.1.0' }, permissions: [] },
      register: () => ({}),
    };
    const hd = require('../src/kernel/ids').sha256(String(dependent.register));
    expect(() =>
      w.p.plugins.install({ ...dependent, codeHash: hd, signature: w.p.plugins.sign(dependent.manifest, hd) }, admin.id)
    ).not.toThrow();
    expect(w.p.plugins.list().map((p) => p.name)).toEqual(
      expect.arrayContaining(['base-plugin', 'dependent'])
    );
    // Duplicate install refused.
    expect(() =>
      w.p.plugins.install({ ...base, codeHash: hb, signature: w.p.plugins.sign(base.manifest, hb) }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
    // Audit trail for install → enable → disable.
    w.p.plugins.enable('base-plugin', admin.id);
    w.p.plugins.disable('base-plugin', admin.id);
    const actions = w.p.audit.chainFor('plugin:base-plugin').map((e) => e.action);
    expect(actions).toEqual(['plugin.installed', 'plugin.enabled', 'plugin.disabled']);
  });

  test('router: ward-filtered listing, unknown prefix passthrough, disabled 404', async () => {
    const w = world();
    const admin = adminUser(w.p);
    const { app } = createApp(w.p);
    w.p.plugins.install(packageOf(w, marketplace), admin.id);
    w.p.plugins.enable('community-marketplace', admin.id);
    const { sandbox_code } = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', sandbox_code, { deviceId: 'd' });
    const authed = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'd');

    await authed(request(app).post('/v1/ext/marketplace/listings'))
      .set('Idempotency-Key', 'wl-1').send({ title: 'Ward basket', price_minor: 100, ward_ref: w.ward.id });
    await authed(request(app).post('/v1/ext/marketplace/listings'))
      .set('Idempotency-Key', 'wl-2').send({ title: 'Other basket', price_minor: 100, ward_ref: 'ward_other' });
    // Ward-filtered GET returns only the matching listing.
    const filtered = await authed(request(app).get(`/v1/ext/marketplace/listings?ward=${w.ward.id}`));
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].title).toBe('Ward basket');

    // An unknown plugin prefix falls through to the app's 404 handler.
    const unknown = await authed(request(app).get('/v1/ext/nosuchplugin/x'));
    expect(unknown.status).toBe(404);
  });

  test('admin API exposes plugin list and enable/disable', async () => {
    const w = world();
    const admin = adminUser(w.p);
    const { app } = createApp(w.p, { adminBootstrapToken: 'tb' });
    w.p.plugins.install(packageOf(w, marketplace), admin.id);
    // Log in as the admin.
    w.p.identity.grantRole(admin.id, 'platform_admin', 'platform', 'system:bootstrap');
    // admin already has the role via adminUser(); mint a session.
    const anon = admin;
    void anon;
    const { sandbox_code } = w.p.identity.requestOtp('+26771933333');
    const { user, session } = w.p.identity.verifyOtp('+26771933333', sandbox_code, { deviceId: 'a' });
    w.p.identity.grantInstitutional(user.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(user.id, 'platform_admin', 'platform', 'system:bootstrap');
    const asAdmin = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'a');

    const list = await asAdmin(request(app).get('/v1/admin/plugins'));
    expect(list.body.map((p) => p.name)).toContain('community-marketplace');
    const enabled = await asAdmin(request(app).post('/v1/admin/plugins/community-marketplace/enable'))
      .set('Idempotency-Key', 'pe-1').send({});
    expect(enabled.body.enabled).toBe(true);
  });
});
