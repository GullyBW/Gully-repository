'use strict';

const mongoose = require('mongoose');
const { BOOKING_STATUS } = require('../utils/constants');

const bookingSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, required: true, index: true },
    providerId: { type: String, required: true, index: true },
    serviceType: { type: String, required: true },
    description: { type: String },
    scheduledFor: { type: Date },
    location: {
      address: { type: String },
      lat: { type: Number },
      lng: { type: Number },
    },
    amount: { type: Number, required: true, min: 1 }, // minor units
    currency: { type: String, required: true, default: 'BWP' },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING,
      index: true,
    },
    paymentReference: { type: String, index: true },
    paymentStatus: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);
