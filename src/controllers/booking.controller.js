'use strict';

const BookingService = require('../services/booking.service');
const { toPublicJSON } = require('../domain/booking');
const { toPublicJSON: paymentToPublicJSON } = require('../domain/transaction');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const BookingController = {
  // POST /api/bookings
  create: asyncHandler(async (req, res) => {
    const booking = await BookingService.create(req.body, req.user);
    res.status(201).json({ success: true, data: toPublicJSON(booking) });
  }),

  // GET /api/bookings
  list: asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const bookings = await BookingService.listMine(req.user, { limit });
    res.json({ success: true, data: bookings.map(toPublicJSON) });
  }),

  // GET /api/bookings/:reference
  getOne: asyncHandler(async (req, res) => {
    const booking = await BookingService.getForActor(req.params.reference, req.user);
    res.json({ success: true, data: toPublicJSON(booking) });
  }),

  // PATCH /api/bookings/:reference/status
  updateStatus: asyncHandler(async (req, res) => {
    const booking = await BookingService.updateStatus(
      req.params.reference,
      req.body.status,
      req.user
    );
    res.json({ success: true, data: toPublicJSON(booking) });
  }),

  // POST /api/bookings/:reference/pay
  pay: asyncHandler(async (req, res) => {
    const { method, payerMsisdn } = req.body;
    const { booking, payment } = await BookingService.initiatePayment(
      req.params.reference,
      { method, payerMsisdn },
      req.user
    );
    res.status(201).json({
      success: true,
      data: { booking: toPublicJSON(booking), payment: paymentToPublicJSON(payment) },
    });
  }),

  // GET /api/bookings/:reference/payment
  paymentStatus: asyncHandler(async (req, res) => {
    const booking = await BookingService.syncPayment(req.params.reference, req.user);
    res.json({
      success: true,
      data: {
        reference: booking.reference,
        paymentReference: booking.paymentReference,
        paymentStatus: booking.paymentStatus,
      },
    });
  }),
};

module.exports = BookingController;
