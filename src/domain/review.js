'use strict';

const { v4: uuidv4 } = require('uuid');
const { REVIEW_STATUS } = require('../utils/constants');

/** Plain-object review domain helpers. */
function createReview(input) {
  const now = new Date();
  return {
    id: uuidv4(),
    providerId: input.providerId, // provider userId
    customerId: input.customerId,
    bookingReference: input.bookingReference,
    rating: input.rating,
    title: input.title || '',
    comment: input.comment || '',
    photos: input.photos || [],
    customerName: input.customerName || 'Customer',
    status: REVIEW_STATUS.PUBLISHED,
    reportCount: 0,
    reports: [],
    createdAt: now,
    updatedAt: now,
  };
}

const EDITABLE_FIELDS = ['rating', 'title', 'comment', 'photos'];

function applyEdit(review, input) {
  for (const f of EDITABLE_FIELDS) {
    if (input[f] !== undefined) review[f] = input[f];
  }
  review.updatedAt = new Date();
  return review;
}

function toPublicJSON(r) {
  return {
    id: r.id,
    providerId: r.providerId,
    customerId: r.customerId,
    bookingReference: r.bookingReference,
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    photos: r.photos,
    customerName: r.customerName,
    status: r.status,
    reportCount: r.reportCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

module.exports = { createReview, applyEdit, toPublicJSON };
