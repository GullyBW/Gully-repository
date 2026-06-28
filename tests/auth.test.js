'use strict';

const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

const sampleUser = {
  name: 'Kabo Moremi',
  email: 'kabo@example.com',
  password: 'super-secret-pw',
  phone: '26771000000',
};

describe('Authentication API', () => {
  describe('POST /api/auth/register', () => {
    it('registers a user and returns a token', async () => {
      const res = await request(app).post('/api/auth/register').send(sampleUser);
      expect(res.status).toBe(201);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('kabo@example.com');
      // Password hash must never be returned.
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('defaults the role to customer', async () => {
      const res = await request(app).post('/api/auth/register').send(sampleUser);
      expect(res.body.data.user.role).toBe('customer');
    });

    it('rejects a duplicate email', async () => {
      await request(app).post('/api/auth/register').send(sampleUser);
      const res = await request(app).post('/api/auth/register').send(sampleUser);
      expect(res.status).toBe(409);
    });

    it('rejects a weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...sampleUser, password: 'short' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(sampleUser);
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: sampleUser.email, password: sampleUser.password });
      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeDefined();
    });

    it('rejects a wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: sampleUser.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    });

    it('rejects an unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever12' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the current user with a valid token', async () => {
      const reg = await request(app).post('/api/auth/register').send(sampleUser);
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${reg.body.data.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(sampleUser.email);
    });

    it('rejects requests without a token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects a malformed token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });
  });
});
