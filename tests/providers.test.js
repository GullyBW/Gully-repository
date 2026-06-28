'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, createProviderProfile, makeAdmin, auth } = require('./helpers');

const app = createApp();

describe('Provider profiles & discovery', () => {
  let provider;
  beforeEach(async () => {
    provider = await registerUser(app, 'provider', 'prov1@example.com');
  });

  it('lets a provider create a profile', async () => {
    const data = await createProviderProfile(app, provider.token, { businessName: 'Kgosi Plumbing' });
    expect(data.businessName).toBe('Kgosi Plumbing');
    expect(data.verified).toBe(false);
    expect(data.rating).toBe(0);
  });

  it('forbids a customer from creating a provider profile', async () => {
    const customer = await registerUser(app, 'customer', 'c1@example.com');
    const res = await request(app)
      .post('/api/providers')
      .set(auth(customer.token))
      .send({ businessName: 'X', category: 'plumber' });
    expect(res.status).toBe(403);
  });

  it('exposes a public profile and hides editing from non-owners', async () => {
    await createProviderProfile(app, provider.token);
    const res = await request(app).get(`/api/providers/${provider.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(provider.user.id);
  });

  describe('search', () => {
    let plumberNear;
    let plumberFar;
    let electrician;

    beforeEach(async () => {
      plumberNear = provider; // plumber in Gaborone
      await createProviderProfile(app, plumberNear.token, {
        businessName: 'Near Plumber',
        category: 'plumber',
        startingPrice: 10000,
        location: { lat: -24.6545, lng: 25.9086, address: 'Gaborone CBD' },
      });

      const p2 = await registerUser(app, 'provider', 'prov2@example.com');
      plumberFar = p2;
      await createProviderProfile(app, p2.token, {
        businessName: 'Far Plumber',
        category: 'plumber',
        startingPrice: 30000,
        location: { lat: -21.17, lng: 27.5078, address: 'Francistown' },
      });

      const p3 = await registerUser(app, 'provider', 'prov3@example.com');
      electrician = p3;
      await createProviderProfile(app, p3.token, {
        businessName: 'Sparky',
        category: 'electrician',
        startingPrice: 15000,
        location: { lat: -24.65, lng: 25.91, address: 'Gaborone' },
      });
    });

    it('filters by category', async () => {
      const res = await request(app).get('/api/providers').query({ category: 'electrician' });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].businessName).toBe('Sparky');
    });

    it('computes distance and sorts nearest first', async () => {
      const res = await request(app)
        .get('/api/providers')
        .query({ category: 'plumber', lat: -24.6545, lng: 25.9086, sort: 'nearest' });
      expect(res.status).toBe(200);
      expect(res.body.items[0].businessName).toBe('Near Plumber');
      expect(res.body.items[0].distanceKm).toBeLessThan(res.body.items[1].distanceKm);
    });

    it('sorts by lowest price', async () => {
      const res = await request(app)
        .get('/api/providers')
        .query({ category: 'plumber', sort: 'lowest_price' });
      expect(res.body.items[0].startingPrice).toBe(10000);
    });

    it('filters by max distance', async () => {
      const res = await request(app)
        .get('/api/providers')
        .query({ category: 'plumber', lat: -24.6545, lng: 25.9086, maxDistanceKm: 50 });
      expect(res.body.total).toBe(1); // far plumber excluded
    });

    it('paginates results', async () => {
      const res = await request(app).get('/api/providers').query({ limit: 2, page: 1 });
      expect(res.body.items.length).toBe(2);
      expect(res.body.hasMore).toBe(true);
    });

    it('text-searches by business name', async () => {
      const res = await request(app).get('/api/providers').query({ q: 'sparky' });
      expect(res.body.total).toBe(1);
    });
  });

  describe('verification & availability', () => {
    it('only an admin can verify a provider', async () => {
      await createProviderProfile(app, provider.token);
      const customer = await registerUser(app, 'customer', 'c2@example.com');
      const denied = await request(app)
        .patch(`/api/providers/${provider.user.id}/verify`)
        .set(auth(customer.token))
        .send({ verified: true });
      expect(denied.status).toBe(403);

      const admin = await makeAdmin();
      const ok = await request(app)
        .patch(`/api/providers/${provider.user.id}/verify`)
        .set(auth(admin.token))
        .send({ verified: true });
      expect(ok.status).toBe(200);
      expect(ok.body.data.verified).toBe(true);
    });

    it('lets a provider set availability status', async () => {
      await createProviderProfile(app, provider.token);
      const res = await request(app)
        .patch('/api/providers/availability')
        .set(auth(provider.token))
        .send({ status: 'busy' });
      expect(res.status).toBe(200);
      expect(res.body.data.availabilityStatus).toBe('busy');
    });
  });
});
