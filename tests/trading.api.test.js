'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { auth, registerUser, makeAdmin } = require('./helpers');
const TradingService = require('../src/services/trading.service');

const app = createApp();

describe('Trading API', () => {
  let customer;
  let admin;

  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'trader@example.com');
    admin = await makeAdmin();
  });

  afterEach(() => {
    TradingService.resetEngine();
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/trading/quote/AAPL');
    expect(res.status).toBe(401);
  });

  test('returns a live quote', async () => {
    const res = await request(app).get('/api/trading/quote/AAPL').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.symbol).toBe('AAPL');
    expect(typeof res.body.data.last).toBe('number');
    expect(res.body.data.ask).toBeGreaterThanOrEqual(res.body.data.bid);
  });

  test('returns historical bars', async () => {
    const res = await request(app)
      .get('/api/trading/bars/AAPL?timeframe=5min&limit=50')
      .set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.data[0]).toHaveProperty('close');
  });

  test('returns news with sentiment', async () => {
    const news = await request(app).get('/api/trading/news/AAPL').set(auth(customer.token));
    expect(news.status).toBe(200);
    expect(Array.isArray(news.body.data)).toBe(true);

    const sent = await request(app).get('/api/trading/sentiment/AAPL').set(auth(customer.token));
    expect(sent.status).toBe(200);
    expect(typeof sent.body.data.score).toBe('number');
    expect(sent.body.data).toHaveProperty('company');
    expect(sent.body.data).toHaveProperty('market');
  });

  test('analyses a symbol and produces a blended signal', async () => {
    const res = await request(app).get('/api/trading/analyze/AAPL').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.signal).toHaveProperty('action');
    expect(res.body.data.signal.votes).toHaveLength(4);
    expect(res.body.data.technical).toHaveProperty('rsi');
  });

  test('returns a risk-managed decision without executing', async () => {
    const res = await request(app).get('/api/trading/signal/AAPL').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('decision');
    expect(res.body.data.decision).toHaveProperty('approved');
  });

  test('runs a backtest and reports performance metrics', async () => {
    const res = await request(app)
      .post('/api/trading/backtest')
      .set(auth(customer.token))
      .send({ symbol: 'AAPL', timeframe: '5min', limit: 300 });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data).toHaveProperty('sharpe');
    expect(res.body.data).toHaveProperty('maxDrawdownPct');
  });

  test('exposes the paper portfolio starting flat', async () => {
    const res = await request(app).get('/api/trading/portfolio').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.openPositions).toBe(0);
    expect(res.body.data.equity).toBe(res.body.data.startingEquity);
  });

  test('blocks non-admins from running the engine', async () => {
    const res = await request(app).post('/api/trading/cycle').set(auth(customer.token)).send({});
    expect(res.status).toBe(403);
  });

  test('lets an admin run a decision cycle (paper mode)', async () => {
    const res = await request(app)
      .post('/api/trading/cycle')
      .set(auth(admin.token))
      .send({ symbols: ['AAPL', 'MSFT'] });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('paper');
    expect(Array.isArray(res.body.data.evaluated)).toBe(true);
    expect(res.body.data.portfolio).toHaveProperty('equity');
  });

  test('reports engine state', async () => {
    const res = await request(app).get('/api/trading/state').set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('paper');
    expect(res.body.data.dataProvider).toBe('simulated');
    expect(res.body.data.running).toBe(false);
  });
});
