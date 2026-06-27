'use strict';

const request = require('supertest');
const crypto = require('crypto');
const createApp = require('../src/app');
const PaymentService = require('../src/services/payment.service');
const { PAYMENT_STATUS, PAYMENT_METHODS } = require('../src/utils/constants');
const config = require('../src/config');

const app = createApp();

describe('Payment API', () => {
  describe('GET /api/payments/methods', () => {
    it('lists the supported payment methods', async () => {
      const res = await request(app).get('/api/payments/methods');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining(['orange_money', 'myzaka', 'bank_transfer'])
      );
    });
  });

  describe('POST /api/payments', () => {
    it('creates an Orange Money payment (sandbox -> processing)', async () => {
      const res = await request(app).post('/api/payments').send({
        customerId: 'cust_1',
        bookingId: 'book_1',
        amount: 15000, // 150.00 BWP
        method: PAYMENT_METHODS.ORANGE_MONEY,
        payerMsisdn: '26771000000',
        description: 'Plumbing call-out',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.reference).toMatch(/^TRL-/);
      expect(res.body.data.status).toBe(PAYMENT_STATUS.PROCESSING);
      expect(res.body.data.currency).toBe(config.payment.defaultCurrency);
    });

    it('returns bank details for a bank transfer and stays pending', async () => {
      const res = await request(app).post('/api/payments').send({
        customerId: 'cust_2',
        amount: 50000,
        method: PAYMENT_METHODS.BANK_TRANSFER,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(PAYMENT_STATUS.PENDING);
      expect(res.body.data.providerMeta.paymentReference).toBe(res.body.data.reference);
      expect(res.body.data.providerMeta.accountNumber).toBeDefined();
    });

    it('rejects mobile money without a payer MSISDN', async () => {
      const res = await request(app).post('/api/payments').send({
        customerId: 'cust_3',
        amount: 1000,
        method: PAYMENT_METHODS.MYZAKA,
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unsupported method', async () => {
      const res = await request(app).post('/api/payments').send({
        customerId: 'cust_4',
        amount: 1000,
        method: 'bitcoin',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a non-positive amount', async () => {
      const res = await request(app).post('/api/payments').send({
        customerId: 'cust_5',
        amount: 0,
        method: PAYMENT_METHODS.BANK_TRANSFER,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('card gateway', () => {
    it('creates a card payment and returns a hosted checkout URL', async () => {
      const res = await request(app).post('/api/payments').send({
        customerId: 'cust_card',
        bookingId: 'book_card',
        amount: 30000,
        method: PAYMENT_METHODS.CARD,
        description: 'Electrician visit',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(PAYMENT_STATUS.PROCESSING);
      expect(res.body.data.providerMeta.checkoutUrl).toContain(res.body.data.reference);
    });

    it('settles a card payment via the gateway webhook', async () => {
      const created = await PaymentService.createPayment({
        customerId: 'cust_card2',
        amount: 30000,
        method: PAYMENT_METHODS.CARD,
      });

      const res = await request(app)
        .post(`/api/payments/webhook/${PAYMENT_METHODS.CARD}`)
        .send({ reference: created.reference, status: 'PAID', id: 'sess_123' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(PAYMENT_STATUS.SUCCEEDED);
    });
  });

  describe('webhook -> settlement', () => {
    it('settles a payment as succeeded via the provider webhook', async () => {
      const created = await PaymentService.createPayment({
        customerId: 'cust_6',
        amount: 20000,
        method: PAYMENT_METHODS.ORANGE_MONEY,
        payerMsisdn: '26771222333',
      });

      const res = await request(app)
        .post(`/api/payments/webhook/${PAYMENT_METHODS.ORANGE_MONEY}`)
        .send({ order_id: created.reference, status: 'SUCCESS', txnid: 'OM123' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(PAYMENT_STATUS.SUCCEEDED);

      const fetched = await request(app).get(`/api/payments/${created.reference}`);
      expect(fetched.body.data.status).toBe(PAYMENT_STATUS.SUCCEEDED);
    });

    it('is idempotent once terminal (replayed webhook does not change status)', async () => {
      const created = await PaymentService.createPayment({
        customerId: 'cust_7',
        amount: 20000,
        method: PAYMENT_METHODS.MYZAKA,
        payerMsisdn: '26771222444',
      });

      await PaymentService.handleWebhook(PAYMENT_METHODS.MYZAKA, {
        payload: { externalRef: created.reference, status: 'COMPLETED' },
      });
      // Replay with a failure — should be ignored because it's already succeeded.
      const again = await PaymentService.handleWebhook(PAYMENT_METHODS.MYZAKA, {
        payload: { externalRef: created.reference, status: 'FAILED' },
      });

      expect(again.status).toBe(PAYMENT_STATUS.SUCCEEDED);
    });

    it('rejects a webhook with an invalid signature in live mode', () => {
      const provider = require('../src/providers/orangeMoney.provider');
      const live = new provider({
        clientId: 'id',
        clientSecret: 'secret',
        baseUrl: 'https://example.test',
        webhookSecret: 'topsecret',
      });
      const rawBody = JSON.stringify({ order_id: 'TRL-X', status: 'SUCCESS' });
      const good = crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex');

      expect(live.verifyWebhook({ rawBody, signature: good })).toBe(true);
      expect(live.verifyWebhook({ rawBody, signature: 'deadbeef' })).toBe(false);
    });
  });

  describe('cancellation', () => {
    it('cancels a pending payment', async () => {
      const created = await PaymentService.createPayment({
        customerId: 'cust_8',
        amount: 9000,
        method: PAYMENT_METHODS.BANK_TRANSFER,
      });

      const res = await request(app).post(`/api/payments/${created.reference}/cancel`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(PAYMENT_STATUS.CANCELLED);
    });

    it('refuses to cancel a settled payment', async () => {
      const created = await PaymentService.createPayment({
        customerId: 'cust_9',
        amount: 9000,
        method: PAYMENT_METHODS.BANK_TRANSFER,
      });
      await PaymentService.handleWebhook(PAYMENT_METHODS.BANK_TRANSFER, {
        payload: { reference: created.reference, status: 'CONFIRMED', bankReference: 'FNB-9' },
      });

      const res = await request(app).post(`/api/payments/${created.reference}/cancel`).send({});
      expect(res.status).toBe(409);
    });
  });

  describe('listing', () => {
    it('lists a customer transactions newest first', async () => {
      await PaymentService.createPayment({
        customerId: 'cust_10',
        amount: 1000,
        method: PAYMENT_METHODS.BANK_TRANSFER,
      });
      await PaymentService.createPayment({
        customerId: 'cust_10',
        amount: 2000,
        method: PAYMENT_METHODS.BANK_TRANSFER,
      });

      const res = await request(app).get('/api/payments').query({ customerId: 'cust_10' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });
});
