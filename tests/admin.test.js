'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const {
  registerUser,
  makeAdmin,
  createProviderProfile,
  auth,
} = require('./helpers');

const app = createApp();

describe('Admin dashboard', () => {
  let admin;
  beforeEach(async () => {
    admin = await makeAdmin();
  });

  it('forbids non-admins', async () => {
    const customer = await registerUser(app, 'customer', 'adm-c@example.com');
    const res = await request(app).get('/api/admin/dashboard').set(auth(customer.token));
    expect(res.status).toBe(403);
  });

  it('returns aggregate stats', async () => {
    await registerUser(app, 'customer', 'adm1@example.com');
    const provider = await registerUser(app, 'provider', 'adm-p@example.com');
    await createProviderProfile(app, provider.token);

    const res = await request(app).get('/api/admin/dashboard').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.users.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.providers.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data).toHaveProperty('revenue');
  });

  it('verifies a provider and writes an audit log', async () => {
    const provider = await registerUser(app, 'provider', 'adm-p2@example.com');
    await createProviderProfile(app, provider.token);

    const verify = await request(app)
      .patch(`/api/admin/providers/${provider.user.id}/verify`)
      .set(auth(admin.token))
      .send({ verified: true });
    expect(verify.body.data.verified).toBe(true);

    const logs = await request(app)
      .get('/api/admin/audit-logs')
      .query({ action: 'provider_verified' })
      .set(auth(admin.token));
    expect(logs.body.data.length).toBeGreaterThan(0);
  });

  it('searches users', async () => {
    await registerUser(app, 'customer', 'searchme@example.com', { name: 'Findable Person' });
    const res = await request(app)
      .get('/api/admin/users')
      .query({ q: 'Findable' })
      .set(auth(admin.token));
    expect(res.body.data.length).toBe(1);
  });

  it('broadcasts an announcement to a role', async () => {
    const customer = await registerUser(app, 'customer', 'bc@example.com');
    const res = await request(app)
      .post('/api/admin/broadcast')
      .set(auth(admin.token))
      .send({ role: 'customer', title: 'Hello', body: 'Welcome to Tirelo' });
    expect(res.body.data.sent).toBeGreaterThanOrEqual(1);

    const notes = await request(app).get('/api/notifications').set(auth(customer.token));
    expect(notes.body.data.some((n) => n.type === 'announcement')).toBe(true);
  });

  it('lists payments for monitoring', async () => {
    const res = await request(app).get('/api/admin/payments').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
