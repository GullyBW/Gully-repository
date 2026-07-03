'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');

/**
 * API integration (doc §17 pyramid): gateway conventions from §7.1 —
 * idempotency enforcement, problem-details envelope, cursor pagination,
 * field masks — plus representative end-to-end flows over HTTP.
 */
describe('API gateway conventions (§7.1)', () => {
  let app;
  let platform;
  let session;
  let user;

  beforeEach(async () => {
    ({ app, platform } = createApp());
    const otp = await request(app)
      .post('/v1/identity/otp')
      .set('Idempotency-Key', 'otp-1')
      .send({ msisdn: '+26771555001' });
    const verified = await request(app)
      .post('/v1/identity/otp/verify')
      .set('Idempotency-Key', 'otp-verify-1')
      .set('X-Device-Id', 'test-device')
      .send({ msisdn: '+26771555001', code: otp.body.sandbox_code });
    session = verified.body.session;
    user = verified.body.user;
  });

  const authed = (req) =>
    req.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'test-device');

  test('mutations without an Idempotency-Key are rejected with the problem envelope', async () => {
    const res = await authed(request(app).post('/v1/ledger/accounts')).send({ type: 'user_wallet' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      retryable: false,
    });
    expect(res.body.trace_id).toBeTruthy();
  });

  test('replaying an Idempotency-Key returns the original response, marked as replay', async () => {
    const first = await authed(request(app).post('/v1/ledger/accounts'))
      .set('Idempotency-Key', 'acct-1')
      .send({ type: 'user_wallet' });
    expect(first.status).toBe(200);
    const replay = await authed(request(app).post('/v1/ledger/accounts'))
      .set('Idempotency-Key', 'acct-1')
      .send({ type: 'user_wallet' });
    expect(replay.body.id).toBe(first.body.id); // no second account
    expect(replay.headers['idempotent-replay']).toBe('true');
  });

  test('errors carry { code, message, domain_reason, retryable, trace_id } with domain codes', async () => {
    const wallet = (
      await authed(request(app).post('/v1/ledger/accounts'))
        .set('Idempotency-Key', 'acct-2')
        .send({ type: 'user_wallet' })
    ).body;
    const res = await authed(request(app).post('/v1/ledger/transfers'))
      .set('Idempotency-Key', 'tx-1')
      .send({ source: wallet.id, dest: wallet.id, amount_minor: -5 });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(
      expect.arrayContaining(['code', 'message', 'domain_reason', 'retryable', 'trace_id'].sort())
    );
  });

  test('device binding: a stolen token fails from another device', async () => {
    const res = await request(app)
      .get(`/v1/ledger/accounts/acc_x/balance`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .set('X-Device-Id', 'attacker-device');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('cursor pagination: page_token / next_page_token walk the collection', async () => {
    const w = platform;
    const admin = w.identity.registerAnonymous('api-admin');
    w.identity.grantInstitutional(admin.id, { institution: 'Ops' }, 'system:bootstrap');
    const ward = w.kgotla.createWard({ district: 'central', name: 'Serowe-01' });
    w.identity.grantRole(admin.id, 'headman_office', `ward:${ward.id}`, 'system:bootstrap');
    for (let i = 0; i < 5; i += 1) {
      w.kgotla.publishNotice(ward.id, admin.id, { title: `Notice ${i}`, body: '…' });
    }
    const page1 = await request(app).get(
      `/v1/kgotla/wards/${ward.id}/notices?page_size=2`
    );
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.next_page_token).toBeTruthy();
    const page2 = await request(app).get(
      `/v1/kgotla/wards/${ward.id}/notices?page_size=2&page_token=${page1.body.next_page_token}`
    );
    expect(page2.body.items[0].title).toBe('Notice 2');
  });

  test('field masks trim responses to the requested fields (data budgets, P8)', async () => {
    const consent = await authed(request(app).post('/v1/heritage/consents'))
      .set('Idempotency-Key', 'consent-1')
      .send({ subject_ref: user.id, spoken_audio_ref: 'med_x', language: 'tn' });
    const item = await authed(request(app).post('/v1/heritage/items'))
      .set('Idempotency-Key', 'item-1')
      .send({
        type: 'audio',
        narrator_ref: user.id,
        morafe_ref: 'bangwato',
        visibility: 'public',
        consent_ref: consent.body.id,
        title: 'Leano la pula',
      });
    await authed(request(app).post(`/v1/heritage/items/${item.body.id}/publish`))
      .set('Idempotency-Key', 'pub-1')
      .send({});
    const masked = await request(app).get(`/v1/heritage/items/${item.body.id}?fields=id,state`);
    expect(Object.keys(masked.body).sort()).toEqual(['id', 'state']);
  });
});

describe('End-to-end flows over HTTP', () => {
  test('restricted item over the API: member reads, outsider gets MEMBERSHIP_REQUIRED', async () => {
    const { app, platform: p } = createApp();
    const admin = p.identity.registerAnonymous('e2e-admin');
    p.identity.grantInstitutional(admin.id, { institution: 'Ops' }, 'system:bootstrap');
    const ward = p.kgotla.createWard({ district: 'central', name: 'W' });
    const headman = p.identity.registerAnonymous('e2e-headman');
    p.identity.grantInstitutional(headman.id, { institution: 'HO' }, 'system:bootstrap');
    p.identity.grantRole(headman.id, 'headman_office', `ward:${ward.id}`, 'system:bootstrap');

    const { sandbox_code } = p.identity.requestOtp('+26771555002');
    const { user: member, session: memberSession } = p.identity.verifyOtp(
      '+26771555002',
      sandbox_code,
      { deviceId: 'd-m' }
    );
    p.identity.endorseWardResidency(member.id, ward.id, headman.id);
    p.identity.joinMorafe(member.id, 'bakalanga', headman.id);

    const otp2 = p.identity.requestOtp('+26771555003');
    const { session: outsiderSession } = p.identity.verifyOtp('+26771555003', otp2.sandbox_code, {
      deviceId: 'd-o',
    });

    const consent = p.heritage.recordConsent({
      subjectRef: member.id,
      spokenAudioRef: 'med_c',
      language: 'ik',
    });
    const item = p.heritage.submit(member.id, {
      type: 'audio',
      narratorRef: member.id,
      morafeRef: 'bakalanga',
      visibility: 'members',
      consentRef: consent.id,
    });
    p.heritage.publish(item.id, member.id);

    const memberRead = await request(app)
      .get(`/v1/heritage/items/${item.id}`)
      .set('Authorization', `Bearer ${memberSession.access_token}`)
      .set('X-Device-Id', 'd-m');
    expect(memberRead.status).toBe(200);

    const outsiderRead = await request(app)
      .get(`/v1/heritage/items/${item.id}`)
      .set('Authorization', `Bearer ${outsiderSession.access_token}`)
      .set('X-Device-Id', 'd-o');
    expect(outsiderRead.status).toBe(403);
    expect(outsiderRead.body.code).toBe('MEMBERSHIP_REQUIRED');

    const anonRead = await request(app).get(`/v1/heritage/items/${item.id}`);
    expect(anonRead.status).toBe(403);

    // And the public search surface stays clean (fail closed).
    const search = await request(app).get('/v1/heritage/search');
    expect(JSON.stringify(search.body)).not.toContain(item.id);
  });

  test('public transparency endpoints work without any authentication (§7.3)', async () => {
    const { app, platform: p } = createApp();
    const opener = p.identity.registerAnonymous('e2e-opener');
    p.identity.grantInstitutional(opener.id, { institution: 'Ops' }, 'system:bootstrap');
    const { sandbox_code } = p.identity.requestOtp('+26771555004');
    const { user: giver } = p.identity.verifyOtp('+26771555004', sandbox_code, { deviceId: 'd' });
    const clearing = p.ledger.openAccount('om', 'provider_clearing');
    const wallet = p.ledger.openAccount(giver.id, 'user_wallet');
    p.ledger.providerDeposit({
      providerAccountId: clearing.id,
      destAccountId: wallet.id,
      amountMinor: 10000,
      providerTxRef: 't1',
      idempotencyKey: 't1',
    });
    const campaign = p.kgetsi.open(giver.id, {
      campaignClass: 'community',
      title: 'Clinic roof',
      targetMinor: 5000,
      milestones: [{ description: 'roof', amount_minor: 5000 }],
    });
    p.kgetsi.endorse(campaign.id, opener.id, 'ok');
    p.kgetsi.goLive(campaign.id, opener.id);
    p.kgetsi.contribute(campaign.id, {
      sourceAccountId: wallet.id,
      amountMinor: 5000,
      contributorRef: giver.id,
      idempotencyKey: 'give-1',
    });

    const ledgerRes = await request(app).get(`/v1/public/campaigns/${campaign.id}/ledger`);
    expect(ledgerRes.status).toBe(200);
    expect(ledgerRes.body.funded_minor).toBe(5000);

    const auditRes = await request(app).get(
      `/v1/public/audit/${encodeURIComponent(`campaign:${campaign.id}`)}`
    );
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.verification.valid).toBe(true);
    expect(auditRes.body.entries.length).toBeGreaterThan(0);

    const proofRes = await request(app).get(
      `/v1/public/audit/${encodeURIComponent(`campaign:${campaign.id}`)}/proof/${auditRes.body.entries[0].id}`
    );
    expect(proofRes.status).toBe(200);
    expect(proofRes.body.valid).toBe(true);
  });

  test('USSD webhook and health check', async () => {
    const { app } = createApp();
    const res = await request(app)
      .post('/v1/gateway/ussd/session')
      .set('Idempotency-Key', 'ussd-1')
      .send({ session_id: 's1', msisdn: '+26771555005', text: '' });
    expect(res.status).toBe(200);
    expect(res.body.response).toContain('Motse');

    const health = await request(app).get('/health');
    expect(health.body.ok).toBe(true);
    expect(health.body.trial_balance.balanced).toBe(true);
  });
});
