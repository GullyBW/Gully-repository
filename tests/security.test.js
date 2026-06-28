'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, makeAdmin, auth } = require('./helpers');

const app = createApp();

describe('Security: refresh tokens, verification, reset, sessions', () => {
  it('returns an access + refresh token on register and login', async () => {
    const reg = await registerUser(app, 'customer', 'sec1@example.com');
    expect(reg.token).toBeDefined();
    expect(reg.refreshToken).toBeDefined();
  });

  it('rotates refresh tokens and rejects a reused (revoked) token', async () => {
    const reg = await registerUser(app, 'customer', 'sec2@example.com');

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.token).toBeDefined();
    expect(refreshed.body.data.refreshToken).not.toBe(reg.refreshToken);

    // Reusing the original (now revoked) token must fail.
    const reused = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.refreshToken });
    expect(reused.status).toBe(401);
  });

  it('verifies email with the issued token', async () => {
    const reg = await registerUser(app, 'customer', 'sec3@example.com');
    expect(reg.devEmailVerificationToken).toBeDefined();

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: reg.devEmailVerificationToken });
    expect(res.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set(auth(reg.token));
    expect(me.body.data.emailVerified).toBe(true);
  });

  it('resets a password and lets the user log in with the new one', async () => {
    await registerUser(app, 'customer', 'sec4@example.com');

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'sec4@example.com' });
    expect(forgot.body.data.devResetToken).toBeDefined();

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: forgot.body.data.devResetToken, password: 'brand-new-pw-123' });

    const good = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sec4@example.com', password: 'brand-new-pw-123' });
    expect(good.status).toBe(200);

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sec4@example.com', password: 'super-secret-pw' });
    expect(bad.status).toBe(401);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('lists and revokes sessions', async () => {
    const reg = await registerUser(app, 'customer', 'sec5@example.com');
    const list = await request(app).get('/api/auth/sessions').set(auth(reg.token));
    expect(list.body.data.length).toBeGreaterThan(0);

    const sessionId = list.body.data[0].id;
    const del = await request(app)
      .delete(`/api/auth/sessions/${sessionId}`)
      .set(auth(reg.token));
    expect(del.status).toBe(200);
  });

  it('blocks login for a suspended account', async () => {
    const user = await registerUser(app, 'customer', 'sec6@example.com');
    const admin = await makeAdmin();

    await request(app)
      .patch(`/api/admin/users/${user.user.id}/suspend`)
      .set(auth(admin.token))
      .send({ suspended: true, reason: 'abuse' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sec6@example.com', password: 'super-secret-pw' });
    expect(res.status).toBe(403);
  });
});
