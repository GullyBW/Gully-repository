'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, createProviderProfile, auth } = require('./helpers');

const app = createApp();

describe('Provider availability', () => {
  let provider;

  beforeEach(async () => {
    provider = await registerUser(app, 'provider', 'av@example.com');
    await createProviderProfile(app, provider.token);
  });

  it('returns default availability before any is set', async () => {
    const res = await request(app).get(`/api/availability/${provider.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.startTime).toBe('08:00');
    expect(res.body.data.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('lets a provider update working hours and slot size', async () => {
    const res = await request(app)
      .put('/api/availability')
      .set(auth(provider.token))
      .send({ startTime: '09:00', endTime: '12:00', slotMinutes: 60, workingDays: [1, 2, 3, 4, 5, 6] });
    expect(res.status).toBe(200);
    expect(res.body.data.endTime).toBe('12:00');
  });

  it('computes bookable slots for a working day', async () => {
    await request(app)
      .put('/api/availability')
      .set(auth(provider.token))
      .send({ startTime: '08:00', endTime: '11:00', slotMinutes: 60 });

    // 2026-06-29 is a Monday.
    const res = await request(app).get(`/api/availability/${provider.user.id}/slots?date=2026-06-29`);
    expect(res.status).toBe(200);
    expect(res.body.data.slots).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
    ]);
  });

  it('returns no slots on a non-working day', async () => {
    await request(app)
      .put('/api/availability')
      .set(auth(provider.token))
      .send({ workingDays: [1, 2, 3, 4, 5] });
    // 2026-06-28 is a Sunday.
    const res = await request(app).get(`/api/availability/${provider.user.id}/slots?date=2026-06-28`);
    expect(res.body.data.slots).toEqual([]);
  });

  it('returns no slots during vacation mode', async () => {
    await request(app)
      .put('/api/availability')
      .set(auth(provider.token))
      .send({ vacationMode: true, vacationUntil: '2026-12-31' });
    const res = await request(app).get(`/api/availability/${provider.user.id}/slots?date=2026-06-29`);
    expect(res.body.data.slots).toEqual([]);
  });

  it('respects holidays', async () => {
    await request(app)
      .put('/api/availability')
      .set(auth(provider.token))
      .send({ holidays: ['2026-06-29'] });
    const res = await request(app).get(`/api/availability/${provider.user.id}/slots?date=2026-06-29`);
    expect(res.body.data.slots).toEqual([]);
  });
});
