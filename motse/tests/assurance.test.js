'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

describe('Security assurance (WS6)', () => {
  test('account takeover: OTP failures then success from a NEW device → hold blocks payouts', () => {
    const w = world();
    for (let i = 0; i < 5; i += 1) w.p.assurance.recordAuthFailure('+26771000002');
    expect(
      w.p.assurance.listEvents({ type: 'otp_bruteforce_suspected' })
    ).toHaveLength(1);

    w.p.assurance.recordLogin(w.kabo.id, { deviceId: 'attacker-phone', msisdn: '+26771000002' });
    expect(w.p.assurance.listEvents({ type: 'account_takeover_suspected' })).toHaveLength(1);
    expect(w.p.assurance.hasHold(w.kabo.id)).toBe(true);

    // The hold enforces through the EXISTING fraud engine on payouts.
    expect(() =>
      w.p.payments.payout({
        provider: 'orange_money', sourceAccountId: w.kaboWallet.id,
        msisdn: '+26771000002', amountMinor: 100, actorRef: w.kabo.id,
        idempotencyKey: 'ato-payout',
      })
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));

    // Holds expire after 24h, and admins can release early (audited).
    w.p.clock.advance(25 * 3600 * 1000);
    expect(w.p.assurance.hasHold(w.kabo.id)).toBe(false);
  });

  test('impossible travel: Gaborone → London in an hour raises high severity + hold', () => {
    const w = world();
    w.p.assurance.recordLogin(w.mma.id, {
      deviceId: 'd1', msisdn: '+26771000001', geo: { lat: -24.6282, lng: 25.9231 }, // Gaborone
    });
    w.p.clock.advance(3600 * 1000);
    w.p.assurance.recordLogin(w.mma.id, {
      deviceId: 'd1', msisdn: '+26771000001', geo: { lat: 51.5074, lng: -0.1278 }, // London
    });
    const events = w.p.assurance.listEvents({ type: 'impossible_travel' });
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('high');
    expect(w.p.assurance.hasHold(w.mma.id)).toBe(true);
    // …and Sev-2 incident auto-opened by ops (WS10 wiring).
    expect(
      w.p.ops.listIncidents().some((i) => i.source === 'security:impossible_travel')
    ).toBe(true);

    // Plausible travel does not trip it: Gaborone → Francistown overnight.
    const calm = world();
    calm.p.assurance.recordLogin(calm.mma.id, {
      deviceId: 'd1', geo: { lat: -24.6282, lng: 25.9231 },
    });
    calm.p.clock.advance(10 * 3600 * 1000);
    calm.p.assurance.recordLogin(calm.mma.id, {
      deviceId: 'd1', geo: { lat: -21.1661, lng: 27.5144 },
    });
    expect(calm.p.assurance.listEvents({ type: 'impossible_travel' })).toHaveLength(0);
  });

  test('SIM-swap heuristics: payout msisdn mismatch and fresh devices open reviews', () => {
    const w = world();
    // kabo's wallet paying out to a number that is NOT his registered msisdn.
    w.p.payments.payout({
      provider: 'smega', sourceAccountId: w.kaboWallet.id,
      msisdn: '+26771999999', amountMinor: 100, actorRef: w.kabo.id,
      idempotencyKey: 'mismatch-1',
    });
    expect(
      w.p.fraud.openReviews().some((r) => r.check === 'payout_msisdn_mismatch')
    ).toBe(true);
    // Device age flows from real registrations now.
    w.p.assurance.recordLogin(w.kabo.id, { deviceId: 'brand-new', msisdn: '+26771000002' });
    expect(w.p.assurance.deviceAgeMs(w.kabo.id, 'brand-new')).toBeLessThan(1000);
    expect(w.p.assurance.deviceAgeMs(w.kabo.id, null)).toBeNull();
  });

  test('API abuse: 40 4xx responses in 5 minutes blocks the key for 15 minutes', async () => {
    const w = world();
    const { app } = createApp(w.p);
    for (let i = 0; i < 40; i += 1) w.p.assurance.recordApiOutcome('10.0.0.9', 404);
    expect(w.p.assurance.isBlocked('10.0.0.9')).toBe(true);
    expect(w.p.assurance.listEvents({ type: 'api_abuse' })).toHaveLength(1);
    w.p.clock.advance(16 * 60 * 1000);
    expect(w.p.assurance.isBlocked('10.0.0.9')).toBe(false);

    // Over HTTP: hammer a nonexistent route, then get throttled.
    let lastStatus = 0;
    for (let i = 0; i < 41; i += 1) {
      const res = await request(app).get('/v1/definitely-not-a-route');
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429); // RATE_LIMITED once flagged as abusive
  });

  test('device risk scoring blends signals, age, holds and sharing', () => {
    const w = world();
    expect(w.p.assurance.deviceRisk(w.kabo.id, 'unknown-device').level).toBe('medium'); // unseen = age 0
    w.p.identity.reportDeviceSignal('rooted-x', { rooted: true });
    const risky = w.p.assurance.deviceRisk(w.kabo.id, 'rooted-x');
    expect(risky.level).toBe('high');
    expect(risky.reasons).toEqual(expect.arrayContaining(['root/jailbreak/emulator signal']));
    // A device seen 30 days ago with clean signals is low risk.
    w.p.assurance.recordLogin(w.mma.id, { deviceId: 'old-faithful' });
    w.p.clock.advance(30 * 24 * 3600 * 1000);
    expect(w.p.assurance.deviceRisk(w.mma.id, 'old-faithful').level).toBe('low');
  });

  test('credential rotation automation rotates only overdue secrets, audited', () => {
    const w = world();
    // Policies exist for every provider webhook secret (container wiring).
    expect(w.p.assurance.runRotation('test')).toHaveLength(0); // nothing due yet
    w.p.clock.advance(91 * 24 * 3600 * 1000);
    const rotated = w.p.assurance.runRotation('test');
    expect(rotated.map((r) => r.name).sort()).toEqual([
      'webhook:myzaka', 'webhook:orange_money', 'webhook:smega',
    ]);
    expect(w.p.secrets.current('webhook:orange_money').version).toBe(2);
    // Immediately after rotation, nothing is due again.
    expect(w.p.assurance.runRotation('test')).toHaveLength(0);
  });

  test('the security report aggregates events, holds and rotation posture', () => {
    const w = world();
    w.p.assurance.raise('impossible_travel', 'high', { subjectRef: w.mma.id });
    w.p.assurance.placeHold(w.mma.id, 'test');
    w.p.clock.advance(91 * 24 * 3600 * 1000); // rotation overdue
    const report = w.p.assurance.report();
    expect(report.events.by_severity.high).toBe(1);
    expect(report.active_holds).toBe(0); // the 24h hold expired with the jump
    expect(report.rotation.overdue.length).toBe(3);
    expect(report.recommendations).toEqual(
      expect.arrayContaining([
        'Review high-severity events and active holds',
        'Run credential rotation — policies overdue',
      ])
    );
    // Release-hold path (admin action) is audited.
    w.p.assurance.placeHold(w.kabo.id, 'test2');
    expect(w.p.assurance.releaseHold(w.kabo.id, 'admin')).toBe(true);
    expect(w.p.assurance.releaseHold(w.kabo.id, 'admin')).toBe(false);
  });

  test('login telemetry flows through the OTP verify route (HTTP wiring)', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const otp = await request(app)
      .post('/v1/identity/otp').set('Idempotency-Key', 'as-1')
      .send({ msisdn: '+26771888111' });
    // A wrong code records an auth failure…
    await request(app)
      .post('/v1/identity/otp/verify').set('Idempotency-Key', 'as-2')
      .set('X-Device-Id', 'd-h').send({ msisdn: '+26771888111', code: '000000' });
    expect(w.p.assurance.authFailures.size).toBeGreaterThan(0);
    // …and success records the login + device registration.
    await request(app)
      .post('/v1/identity/otp/verify').set('Idempotency-Key', 'as-3')
      .set('X-Device-Id', 'd-h')
      .send({ msisdn: '+26771888111', code: otp.body.sandbox_code, geo: { lat: -24.6, lng: 25.9 } });
    expect(w.p.assurance.logins.count()).toBe(1);
    expect(w.p.assurance.listEvents({ type: 'new_device' })).toHaveLength(1);
  });
});
