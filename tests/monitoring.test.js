'use strict';

const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

describe('Monitoring endpoints', () => {
  it('exposes JSON metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('requestsTotal');
    expect(res.body.data).toHaveProperty('byStatus');
  });

  it('exposes Prometheus-format metrics', async () => {
    const res = await request(app).get('/metrics/prometheus');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('tirelo_requests_total');
    expect(res.text).toContain('tirelo_requests_by_status{class="2xx"}');
  });

  it('echoes a request id header', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
