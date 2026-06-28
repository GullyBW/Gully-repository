'use strict';

const mongoose = require('mongoose');
const { REVIEW_STATUS } = require('../utils/constants');

const reportSchema = new mongoose.Schema(
  { by: String, reason: String, at: { type: Date, default: Date.now } },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    providerId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    bookingReference: { type: String, required: true, unique: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: '' },
    comment: { type: String, default: '' },
    photos: [{ type: String }],
    customerName: { type: String, default: 'Customer' },
    status: {
      type: String,
      enum: Object.values(REVIEW_STATUS),
      default: REVIEW_STATUS.PUBLISHED,
      index: true,
    },
    reportCount: { type: Number, default: 0 },
    reports: { type: [reportSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Review', reviewSchema);
