'use strict';

const { world, adminUser, freshVerifiedUser } = require('./helpers');

describe('Feature flags & remote config (WS7, doc §16)', () => {
  test('evaluation precedence: user > ward > morafe > global > default', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.flags.define('module.mmino'); // already defined in container — idempotent
    const ctx = { userRef: w.mma.id, wardRef: w.ward.id, morafeRefs: ['bakalanga'] };

    expect(w.p.flags.evaluate('module.mmino', ctx)).toBe(false); // default
    w.p.flags.set('module.mmino', 'global', true, admin.id);
    expect(w.p.flags.evaluate('module.mmino', ctx)).toBe(true);
    w.p.flags.set('module.mmino', 'morafe:bakalanga', false, admin.id);
    expect(w.p.flags.evaluate('module.mmino', ctx)).toBe(false);
    w.p.flags.set('module.mmino', `ward:${w.ward.id}`, true, admin.id);
    expect(w.p.flags.evaluate('module.mmino', ctx)).toBe(true);
    w.p.flags.set('module.mmino', `user:${w.mma.id}`, false, admin.id);
    expect(w.p.flags.evaluate('module.mmino', ctx)).toBe(false);

    // Unset walks back down the precedence chain.
    w.p.flags.unset('module.mmino', `user:${w.mma.id}`, admin.id);
    expect(w.p.flags.evaluate('module.mmino', ctx)).toBe(true);
    // Someone with no context sees global.
    expect(w.p.flags.evaluate('module.mmino', {})).toBe(true);
  });

  test('remote config carries arbitrary JSON and every change is audited + evented', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.flags.set('config.data_budget_kb', 'global', 1024, admin.id);
    expect(w.p.flags.evaluate('config.data_budget_kb', {})).toBe(1024);
    expect(w.p.audit.verifyChain('flag:config.data_budget_kb').valid).toBe(true);
    expect(w.p.bus.eventsOf('pilot.flag.changed').length).toBeGreaterThan(0);
    // Unknown flags and scopes fail loudly.
    expect(() => w.p.flags.set('nope', 'global', 1, admin.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
    expect(() => w.p.flags.set('config.data_budget_kb', 'planet:earth', 1, admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    // Unsetting a scope that has no override is a no-op, not an error.
    expect(w.p.flags.unset('config.data_budget_kb', 'ward:none', admin.id)).toBe(false);
  });

  test('snapshotFor resolves a member context for the client bootstrap call', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.flags.set('module.mmino', `ward:${w.ward.id}`, true, admin.id);
    const snapshot = w.p.flags.snapshotFor(w.p.identity, w.mma.id); // mma lives in the ward
    expect(snapshot['module.mmino']).toBe(true);
    expect(snapshot['module.kgetsi']).toBe(true); // container default
    const anonymous = w.p.flags.snapshotFor(w.p.identity, null);
    expect(anonymous['module.mmino']).toBe(false);
  });
});

describe('Pilot management (WS7)', () => {
  function pilotWorld() {
    const w = world();
    const admin = adminUser(w.p);
    const pilot = w.p.pilots.create(
      { name: 'Central pilot', district: 'central', flagProfile: { 'module.mmino': true } },
      admin.id
    );
    return { w, admin, pilot };
  }

  test('stage machine gates going live on enrolled wards AND an assigned admin', () => {
    const { w, admin, pilot } = pilotWorld();
    w.p.pilots.advanceStage(pilot.id, 'onboarding', admin.id);
    expect(() => w.p.pilots.advanceStage(pilot.id, 'live', admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' }) // no wards yet
    );
    w.p.pilots.enrollWard(pilot.id, w.ward.id, admin.id);
    expect(() => w.p.pilots.advanceStage(pilot.id, 'live', admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' }) // no admin yet
    );
    w.p.pilots.assignAdmin(pilot.id, admin.id, admin.id);
    const live = w.p.pilots.advanceStage(pilot.id, 'live', admin.id);
    expect(live.stage).toBe('live');
    // Illegal transitions rejected; pause/resume works.
    expect(() => w.p.pilots.advanceStage(pilot.id, 'onboarding', admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    w.p.pilots.advanceStage(pilot.id, 'paused', admin.id);
    expect(w.p.pilots.advanceStage(pilot.id, 'live', admin.id).stage).toBe('live');
    expect(w.p.pilots.get(pilot.id).stage_history.map((s) => s.stage)).toEqual(
      ['planned', 'onboarding', 'live', 'paused', 'live']
    );
  });

  test('enrolling a ward applies the flag profile per-ward (pilots are a flag, not a build)', () => {
    const { w, admin, pilot } = pilotWorld();
    expect(w.p.flags.evaluate('module.mmino', { wardRef: w.ward.id })).toBe(false);
    w.p.pilots.enrollWard(pilot.id, w.ward.id, admin.id);
    expect(w.p.flags.evaluate('module.mmino', { wardRef: w.ward.id })).toBe(true);
    // Residents of other wards remain dark.
    expect(w.p.flags.evaluate('module.mmino', { wardRef: 'ward_other' })).toBe(false);
    // Idempotent enrollment.
    w.p.pilots.enrollWard(pilot.id, w.ward.id, admin.id);
    expect(w.p.pilots.get(pilot.id).ward_refs).toHaveLength(1);
  });

  test('community onboarding: registerVillage creates the ward, headman office and enrollment', () => {
    const { w, admin, pilot } = pilotWorld();
    const { village, ward } = w.p.pilots.registerVillage(
      pilot.id,
      { name: 'Mogorosi', headmanMsisdn: '+26771777001' },
      admin.id
    );
    expect(village.ward_ref).toBe(ward.id);
    const headman = w.p.identity.get(village.headman_ref);
    expect(headman.level).toBe('L3');
    expect(w.p.identity.hasRole(headman.id, 'headman_office', `ward:${ward.id}`)).toBe(true);
    expect(w.p.pilots.get(pilot.id).ward_refs).toContain(ward.id);
    // The headman can now endorse residents (the L2 path works end-to-end).
    const resident = freshVerifiedUser(w.p);
    const endorsed = w.p.identity.endorseWardResidency(resident.id, ward.id, headman.id);
    expect(endorsed.level).toBe('L2');
  });

  test('health and report aggregate residents, activity and stage history', () => {
    const { w, admin, pilot } = pilotWorld();
    w.p.pilots.enrollWard(pilot.id, w.ward.id, admin.id);
    w.p.pilots.assignAdmin(pilot.id, admin.id, admin.id);
    const letsema = w.p.kgotla.createLetsema(w.ward.id, w.mma.id, { title: 'x', date: 'y' });
    w.p.kgotla.joinLetsema(letsema.id, w.kabo.id, {});
    const health = w.p.pilots.health(pilot.id);
    expect(health.residents).toBeGreaterThanOrEqual(1); // mma lives in the ward
    expect(health.letsemas).toBe(1);
    expect(health.letsema_participants).toBe(1);
    expect(health.admins).toBe(1);
    const report = w.p.pilots.report(pilot.id);
    expect(report.pilot.stage_history[0].stage).toBe('planned');
    expect(report.usage).toHaveProperty('residents');
    expect(report.health.flags).toContain('module.mmino');
  });

  test('pilot admin assignment requires L3', () => {
    const { w, admin, pilot } = pilotWorld();
    expect(() => w.p.pilots.assignAdmin(pilot.id, w.kabo.id, admin.id)).toThrow(
      expect.objectContaining({ code: 'AUTH_LEVEL_REQUIRED' })
    );
  });

  test('bad inputs are rejected', () => {
    const { w, admin, pilot } = pilotWorld();
    expect(() => w.p.pilots.create({ name: '', district: '' }, admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => w.p.pilots.advanceStage(pilot.id, 'warp', admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => w.p.pilots.get('plt_none')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });
});
