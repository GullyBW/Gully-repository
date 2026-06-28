'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const cache = require('../src/services/cache.service');

const app = createApp();

describe('Health & caching', () => {
  it('reports liveness', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('live');
  });

  it('reports readiness (test env)', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('caches the categories response (MISS then HIT)', async () => {
    await cache.flush();
    const first = await request(app).get('/api/categories');
    expect(first.headers['x-cache']).toBe('MISS');
    const second = await request(app).get('/api/categories');
    expect(second.headers['x-cache']).toBe('HIT');
  });
});
