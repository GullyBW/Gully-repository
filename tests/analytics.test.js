'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const {
  registerUser,
  makeAdmin,
  createProviderProfile,
  completeBooking,
  auth,
} = require('./helpers');

const app = createApp();

describe('Analytics & reporting', () => {
  let customer;
  let provider;

  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'an-c@example.com');
    provider = await registerUser(app, 'provider', 'an-p@example.com');
    await createProviderProfile(app, provider.token);
  });

  it('returns provider analytics', async () => {
    await completeBooking(app, customer, provider);
    const res = await request(app).get('/api/analytics/provider').set(auth(provider.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('monthly');
    expect(res.body.data.totalBookings).toBeGreaterThanOrEqual(1);
    expect(res.body.data).toHaveProperty('acceptanceRate');
  });

  it('returns customer analytics', async () => {
    await completeBooking(app, customer, provider);
    const res = await request(app).get('/api/analytics/customer').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.totalBookings).toBeGreaterThanOrEqual(1);
    expect(res.body.data.byCategory.length).toBeGreaterThanOrEqual(1);
  });

  it('returns admin analytics and restricts to admins', async () => {
    const denied = await request(app).get('/api/analytics/admin').set(auth(customer.token));
    expect(denied.status).toBe(403);

    const admin = await makeAdmin();
    const res = await request(app).get('/api/analytics/admin').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('revenueMinor');
    expect(res.body.data).toHaveProperty('popularCategories');
  });

  it('exports a CSV report', async () => {
    await completeBooking(app, customer, provider);
    const res = await request(app)
      .get('/api/analytics/export')
      .query({ report: 'provider-monthly', format: 'csv' })
      .set(auth(provider.token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('month');
  });
});
