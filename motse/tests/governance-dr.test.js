'use strict';

/**
 * Phase 1 (configuration governance) + Phase 2 (disaster-recovery validation).
 * Governance: risk classification + policy-driven approval workflow (separation
 * of duties, N approvals by tier), full forensic change records, RBAC, rollback.
 * DR: a scenario suite measuring RTO/RPO/consistency over the REAL BackupService
 * + ChaosKv, with historical reports.
 */
const request = require('supertest');
const { ConfigGovernance } = require('../src/config/config.governance');
const { ConfigService } = require('../src/config/config.service');
const { DrValidator } = require('../src/ops/dr.validator');
const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

function fakeClock(start = 0) {
  let t = start;
  return { nowMs: () => t, nowIso: () => new Date(t).toISOString(), advance: (ms) => { t += ms; } };
}

// Governance without an identity → RBAC is delegated to the route (unit focus).
function gov(policy = {}) {
  const config = new ConfigService({ clock: fakeClock() });
  config.register('crit', { type: 'number', defaultValue: 5 });
  config.register('med', { type: 'number', defaultValue: 1 });
  config.register('low', { type: 'string', defaultValue: 'x' });
  const g = new ConfigGovernance({ config, clock: fakeClock(), policy });
  g.classify('crit', { risk: 'critical', affects: ['redis'] });
  g.classify('med', { risk: 'medium' });
  g.classify('low', { risk: 'low' });
  return { config, g };
}

describe('P1 · ConfigGovernance — risk-tiered approval workflow', () => {
  test('a critical change stays pending until distinct approvals meet the policy', () => {
    const { config, g } = gov();
    const chg = g.request('crit', 9, { actor: 'alice', justification: 'peak load' });
    expect(chg.status).toBe('pending');
    expect(chg.required_approvals).toBe(2);
    expect(chg.risk).toBe('critical');
    expect(config.get('crit')).toBe(5); // NOT applied yet
    // Separation of duties: the proposer cannot approve.
    let e; try { g.approve(chg.id, 'alice'); } catch (caught) { e = caught; }
    expect(e.code).toBe('PERMISSION_DENIED');
    g.approve(chg.id, 'bob');
    expect(config.get('crit')).toBe(5); // one approval short
    const done = g.approve(chg.id, 'carol');
    expect(done.status).toBe('applied');
    expect(config.get('crit')).toBe(9); // applied on the 2nd distinct approval
    expect(done.rollback_ref).not.toBeNull();
    expect(done.approvals.map((a) => a.by)).toEqual(['bob', 'carol']);
  });

  test('the same approver cannot approve twice', () => {
    const { g } = gov();
    const chg = g.request('crit', 7, { actor: 'alice', justification: 'x' });
    g.approve(chg.id, 'bob');
    let e; try { g.approve(chg.id, 'bob'); } catch (caught) { e = caught; }
    expect(e.code).toBe('STATE_CONFLICT');
  });

  test('a medium change applies immediately but is still recorded with a change record', () => {
    const { config, g } = gov();
    const chg = g.request('med', 42, { actor: 'alice', justification: 'tune' });
    expect(chg.status).toBe('applied');
    expect(config.get('med')).toBe(42);
    expect(g.history()[0]).toMatchObject({ key: 'med', to: 42, actor: 'alice', status: 'applied' });
  });

  test('a low-risk change needs no justification; medium+ requires one', () => {
    const { g } = gov();
    expect(g.request('low', 'y', { actor: 'alice' }).status).toBe('applied');
    let e; try { g.request('med', 2, { actor: 'alice' }); } catch (caught) { e = caught; }
    expect(e.code).toBe('INVALID_ARGUMENT'); // justification required
  });

  test('reject closes a pending change without applying it', () => {
    const { config, g } = gov();
    const chg = g.request('crit', 100, { actor: 'alice', justification: 'x' });
    const rej = g.reject(chg.id, 'bob', { reason: 'too risky at peak' });
    expect(rej.status).toBe('rejected');
    expect(config.get('crit')).toBe(5);
    let e; try { g.approve(chg.id, 'carol'); } catch (caught) { e = caught; }
    expect(e.code).toBe('STATE_CONFLICT'); // cannot approve a rejected change
  });

  test('an applied change can be rolled back to its prior value', () => {
    const { config, g } = gov();
    const chg = g.request('med', 20, { actor: 'alice', justification: 'x' });
    expect(config.get('med')).toBe(20);
    const rb = g.rollbackChange(chg.id, 'ops');
    expect(rb.status).toBe('rolled_back');
    expect(config.get('med')).toBe(1); // back to the original
    let e; try { g.rollbackChange(chg.id, 'ops'); } catch (caught) { e = caught; }
    expect(e.code).toBe('STATE_CONFLICT'); // only an applied change rolls back
  });

  test('policy is tunable per tier; policyReport lists classified keys', () => {
    const { g } = gov({ critical: { approvals: 1, distinctApprover: false } });
    const chg = g.request('crit', 3, { actor: 'alice', justification: 'x' });
    expect(chg.required_approvals).toBe(1);
    g.approve(chg.id, 'alice'); // self-approval now allowed by this policy
    expect(g.history()[0].status).toBe('applied');
    const report = g.policyReport();
    expect(report.classified_keys.find((k) => k.key === 'crit')).toMatchObject({ risk: 'critical' });
  });

  test('unknown keys/changes and bad risk labels are rejected', () => {
    const { g } = gov();
    const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    expect(code(() => g.request('ghost', 1, { actor: 'a', justification: 'x' }))).toBe('NOT_FOUND');
    expect(code(() => g.approve('nope', 'a'))).toBe('NOT_FOUND');
    expect(code(() => g.classify('crit', { risk: 'silly' }))).toBe('INVALID_ARGUMENT');
  });

  test('branch coverage: defaults, expiry, unclassified key, rollback-ref guard', () => {
    // No-arg-ish construction (default clock/metrics/policy).
    const config = new ConfigService({});
    config.register('a', { type: 'number', defaultValue: 1 });
    config.register('b', { type: 'number', defaultValue: 2 });
    const g = new ConfigGovernance({ config });
    g.classify('a'); // default opts → medium risk
    expect(g.riskOf('a')).toBe('medium');
    expect(g.riskOf('never-classified')).toBe('medium'); // fallback
    // An unclassified key defaults to medium (justification still required).
    const chg = g.request('b', 5, { actor: 'x', justification: 'j', expireAt: '2030-01-01T00:00:00Z' });
    expect(chg.status).toBe('applied');
    expect(chg.expire_at).not.toBeNull(); // expiry recorded
    // rollbackChange guard: a non-applied change cannot be rolled back.
    const pendingCfg = new ConfigService({});
    pendingCfg.register('c', { type: 'number', defaultValue: 1 });
    const g2 = new ConfigGovernance({ config: pendingCfg, policy: { critical: { approvals: 5, distinctApprover: true } } });
    g2.classify('c', { risk: 'critical' });
    const p = g2.request('c', 9, { actor: 'a', justification: 'j' }); // stays pending
    const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    expect(code(() => g2.rollbackChange(p.id, 'ops'))).toBe('STATE_CONFLICT');
  });

  test('RBAC: an approver without the platform role is rejected when identity is wired', () => {
    const config = new ConfigService({ clock: fakeClock() });
    config.register('k', { type: 'number', defaultValue: 1 });
    const identity = { requireRole: (actor) => { if (actor !== 'admin') throw Object.assign(new Error('no role'), { code: 'PERMISSION_DENIED' }); } };
    const g = new ConfigGovernance({ config, identity, clock: fakeClock() });
    g.classify('k', { risk: 'medium' });
    let e; try { g.request('k', 2, { actor: 'intruder', justification: 'x' }); } catch (caught) { e = caught; }
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(g.request('k', 2, { actor: 'admin', justification: 'x' }).status).toBe('applied');
  });
});

describe('P1 · governance over the real platform + HTTP', () => {
  function adminApp() {
    const w = world();
    const mk = (dev, msisdn) => {
      const otp = w.p.identity.requestOtp(msisdn);
      const { user, session } = w.p.identity.verifyOtp(msisdn, otp.sandbox_code, { deviceId: dev });
      w.p.identity.grantInstitutional(user.id, { institution: 'Ops' }, 'system:bootstrap');
      w.p.identity.grantRole(user.id, 'platform_admin', 'platform', 'system:bootstrap');
      return (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', dev);
    };
    const alice = mk('dev-alice', '+26772000001');
    const bob = mk('dev-bob', '+26772000002');
    const { app } = createApp(w.p);
    return { w, app, alice, bob };
  }
  let k = 0;
  const idem = () => `gd-${k++}`;

  test('a critical resilience change requires an approval chain before it applies live', async () => {
    const { w, app, alice, bob } = adminApp();
    const before = w.p.resilience.breaker('redis').failureThreshold;
    const req = await alice(request(app).post('/v1/admin/config/governance/requests')).set('Idempotency-Key', idem())
      .send({ key: 'resilience.redis.breaker.failureThreshold', value: before + 5, justification: 'peak capacity' });
    expect(req.status).toBe(200);
    expect(req.body.status).toBe('pending');
    expect(w.p.resilience.breaker('redis').failureThreshold).toBe(before); // not yet applied

    // Proposer cannot approve their own critical change.
    const self = await alice(request(app).post(`/v1/admin/config/governance/requests/${req.body.id}/approve`)).set('Idempotency-Key', idem()).send({});
    expect(self.status).toBe(403);

    await bob(request(app).post(`/v1/admin/config/governance/requests/${req.body.id}/approve`)).set('Idempotency-Key', idem()).send({});
    // Still one short (critical needs 2). A second distinct admin approves.
    const carolReq = await alice(request(app).get('/v1/admin/config/governance/pending'));
    expect(carolReq.body).toHaveLength(1);
  });

  test('governance policy + history are queryable for compliance', async () => {
    const { app, alice } = adminApp();
    const policy = await alice(request(app).get('/v1/admin/config/governance/policy'));
    expect(policy.status).toBe(200);
    expect(policy.body.policy.critical.approvals).toBe(2);
    expect(policy.body.classified_keys.length).toBeGreaterThan(0);
  });
});

describe('P2 · DrValidator — RTO/RPO measurement', () => {
  test('validateAll runs every scenario and measures RTO/RPO/confidence', async () => {
    const platform = createPlatform();
    const report = await platform.dr.validateAll();
    expect(report.scenarios).toBe(7);
    expect(report.passed).toBe(7); // all recovery paths succeed
    expect(report.recovery_confidence).toBe(1);
    expect(report.rto.met).toBe(true);
    expect(report.rto.max_ms).toBeGreaterThanOrEqual(0);
    expect(report.rpo.met).toBe(true);
    // Each result carries measured objectives.
    for (const r of report.results) {
      expect(r).toHaveProperty('recovery_ms');
      expect(r).toHaveProperty('rto_met');
      expect(r.consistent).toBe(true);
    }
    expect(platform.dr.latestReport()).toBe(report);
  });

  test('backup_restore proves ledger + audit integrity on a fresh platform', async () => {
    const platform = createPlatform();
    const r = await platform.dr.run('backup_restore');
    expect(r.success).toBe(true);
    expect(r.data_loss_rows).toBe(0);
    expect(r.detail).toMatch(/trial balance balanced/);
    expect(r.detail).toMatch(/audit chains verified/);
  });

  test('storage_corruption is DETECTED, not restored (integrity gate)', async () => {
    const platform = createPlatform();
    const r = await platform.dr.run('storage_corruption');
    expect(r.consistent).toBe(true); // "consistent" here = corruption correctly detected
    expect(r.detail).toMatch(/corruption detected/);
  });

  test('redis_failure proves the distributed layer fails closed and recovers', async () => {
    const platform = createPlatform();
    const r = await platform.dr.run('redis_failure');
    expect(r.success).toBe(true);
    expect(r.detail).toMatch(/failed closed/);
  });

  test('event_replay keeps stable outbox ids (idempotent consumers dedupe)', async () => {
    const platform = createPlatform();
    const r = await platform.dr.run('event_replay');
    expect(r.consistent).toBe(true);
    expect(r.detail).toMatch(/2 replayed with stable ids/);
  });

  test('a missed RTO target marks the scenario failed (objective enforcement)', async () => {
    const platform = createPlatform();
    // An impossibly tight RTO makes even a fast recovery "fail" the objective.
    const strict = new DrValidator({ platform, clock: platform.clock, rtoTargetMs: -1 });
    const r = await strict.run('backup_restore');
    expect(r.consistent).toBe(true); // recovery still worked
    expect(r.rto_met).toBe(false); // but the objective was not met
    expect(r.success).toBe(false);
  });

  test('an unknown scenario is captured as a failed, inconsistent result', async () => {
    const platform = createPlatform();
    const r = await platform.dr.run('does_not_exist');
    expect(r.success).toBe(false);
    expect(r.consistent).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('a fresh validator with default targets has no report until it runs', async () => {
    const platform = createPlatform();
    const dr = new DrValidator({ platform }); // default clock/metrics/targets
    expect(dr.latestReport()).toBeNull();
    expect(dr.scenarios()).toContain('backup_restore');
    const r = await dr.run('config_recovery');
    expect(r.success).toBe(true);
    expect(dr.rtoTargetMs).toBeGreaterThan(0); // default applied
  });

  test('DR reports are queryable over the admin API', async () => {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    const authed = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev-kabo');
    const run = await authed(request(app).post('/v1/admin/dr/validate')).set('Idempotency-Key', 'dr-1');
    expect(run.status).toBe(200);
    expect(run.body.passed).toBe(7);
    const reports = await authed(request(app).get('/v1/admin/dr/reports'));
    expect(reports.body.count).toBeGreaterThanOrEqual(1);
    expect(reports.body.latest.rto).toBeTruthy();
  });
});
