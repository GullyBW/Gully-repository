'use strict';

const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

/** Register a user of the given role and return { token, user }. */
async function makeUser(role, email) {
  const res = await request(app).post('/api/auth/register').send({
    name: `${role} user`,
    email,
    password: 'super-secret-pw',
    role,
    phone: '26771000000',
  });
  return res.body.data;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Booking API', () => {
  let customer;
  let provider;

  beforeEach(async () => {
    customer = await makeUser('customer', 'customer@example.com');
    provider = await makeUser('provider', 'provider@example.com');
  });

  const bookingPayload = () => ({
    providerId: provider.user.id,
    serviceType: 'plumbing',
    description: 'Leaking kitchen tap',
    amount: 15000,
    location: { address: 'Plot 123, Gaborone' },
  });

  it('lets a customer create a booking', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send(bookingPayload());

    expect(res.status).toBe(201);
    expect(res.body.data.reference).toMatch(/^BKG-/);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.customerId).toBe(customer.user.id);
  });

  it('requires authentication to create a booking', async () => {
    const res = await request(app).post('/api/bookings').send(bookingPayload());
    expect(res.status).toBe(401);
  });

  it('lets the provider accept a pending booking', async () => {
    const created = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send(bookingPayload());
    const ref = created.body.data.reference;

    const res = await request(app)
      .patch(`/api/bookings/${ref}/status`)
      .set(auth(provider.token))
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');
  });

  it('forbids a customer from accepting their own booking', async () => {
    const created = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send(bookingPayload());

    const res = await request(app)
      .patch(`/api/bookings/${created.body.data.reference}/status`)
      .set(auth(customer.token))
      .send({ status: 'accepted' });

    expect(res.status).toBe(403);
  });

  it('rejects an illegal status transition', async () => {
    const created = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send(bookingPayload());

    // pending -> completed is not allowed.
    const res = await request(app)
      .patch(`/api/bookings/${created.body.data.reference}/status`)
      .set(auth(provider.token))
      .send({ status: 'completed' });

    expect(res.status).toBe(409);
  });

  it('blocks an unrelated user from viewing a booking', async () => {
    const intruder = await makeUser('customer', 'intruder@example.com');
    const created = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send(bookingPayload());

    const res = await request(app)
      .get(`/api/bookings/${created.body.data.reference}`)
      .set(auth(intruder.token));

    expect(res.status).toBe(403);
  });

  describe('payment integration', () => {
    async function acceptedBooking() {
      const created = await request(app)
        .post('/api/bookings')
        .set(auth(customer.token))
        .send(bookingPayload());
      const ref = created.body.data.reference;
      await request(app)
        .patch(`/api/bookings/${ref}/status`)
        .set(auth(provider.token))
        .send({ status: 'accepted' });
      return ref;
    }

    it('refuses payment before the booking is accepted', async () => {
      const created = await request(app)
        .post('/api/bookings')
        .set(auth(customer.token))
        .send(bookingPayload());

      const res = await request(app)
        .post(`/api/bookings/${created.body.data.reference}/pay`)
        .set(auth(customer.token))
        .send({ method: 'card' });

      expect(res.status).toBe(409);
    });

    it('initiates payment for an accepted booking and links it', async () => {
      const ref = await acceptedBooking();

      const res = await request(app)
        .post(`/api/bookings/${ref}/pay`)
        .set(auth(customer.token))
        .send({ method: 'orange_money', payerMsisdn: '26771222333' });

      expect(res.status).toBe(201);
      expect(res.body.data.payment.reference).toMatch(/^TRL-/);
      expect(res.body.data.booking.paymentReference).toBe(res.body.data.payment.reference);
      expect(res.body.data.booking.paymentStatus).toBe('processing');
    });

    it('reflects settlement after the payment webhook fires', async () => {
      const ref = await acceptedBooking();
      const pay = await request(app)
        .post(`/api/bookings/${ref}/pay`)
        .set(auth(customer.token))
        .send({ method: 'card' });
      const paymentRef = pay.body.data.payment.reference;

      // Gateway settles the payment.
      await request(app)
        .post('/api/payments/webhook/card')
        .send({ reference: paymentRef, status: 'PAID', id: 'sess_1' });

      const res = await request(app)
        .get(`/api/bookings/${ref}/payment`)
        .set(auth(customer.token));

      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe('succeeded');
    });

    it('forbids a provider from paying for the booking', async () => {
      const ref = await acceptedBooking();
      const res = await request(app)
        .post(`/api/bookings/${ref}/pay`)
        .set(auth(provider.token))
        .send({ method: 'card' });
      expect(res.status).toBe(403);
    });
  });
});
