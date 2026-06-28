'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, auth } = require('./helpers');

const app = createApp();

describe('Categories API', () => {
  it('lists service categories with display metadata', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    const keys = res.body.data.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['electrician', 'plumber', 'solar_installation']));
    expect(res.body.data[0]).toHaveProperty('name');
    expect(res.body.data[0]).toHaveProperty('icon');
  });
});

describe('Geo / Maps API', () => {
  let customer;
  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'geo-customer@example.com');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/geo/search?q=gaborone');
    expect(res.status).toBe(401);
  });

  it('searches Botswana places in sandbox mode', async () => {
    const res = await request(app).get('/api/geo/search?q=game').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('lat');
    expect(res.body.data[0]).toHaveProperty('lng');
  });

  it('geocodes an address', async () => {
    const res = await request(app)
      .post('/api/geo/geocode')
      .set(auth(customer.token))
      .send({ address: 'Francistown' });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.lat).toBe('number');
  });

  it('computes distance between two points', async () => {
    const res = await request(app)
      .get('/api/geo/distance')
      .query({ fromLat: -24.6545, fromLng: 25.9086, toLat: -21.17, toLng: 27.5078 })
      .set(auth(customer.token));
    expect(res.status).toBe(200);
    // Gaborone -> Francistown is ~430 km.
    expect(res.body.data.distanceKm).toBeGreaterThan(300);
  });
});
