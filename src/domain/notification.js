'use strict';

const { v4: uuidv4 } = require('uuid');
const { NOTIFICATION_TYPES } = require('../utils/constants');

/**
 * Notification templates. Each type maps to a title + a body builder. Designed
 * so a push-notification transport (FCM/APNs) can later consume the same
 * `{ title, body, data }` shape without changing callers.
 */
const TEMPLATES = {
  [NOTIFICATION_TYPES.BOOKING_ACCEPTED]: {
    title: 'Booking accepted',
    body: (d) => `Your ${d.serviceType || 'service'} booking was accepted.`,
  },
  [NOTIFICATION_TYPES.PROVIDER_EN_ROUTE]: {
    title: 'Provider on the way',
    body: () => 'Your provider is en route to your location.',
  },
  [NOTIFICATION_TYPES.PROVIDER_ARRIVED]: {
    title: 'Provider arrived',
    body: () => 'Your provider has arrived.',
  },
  [NOTIFICATION_TYPES.JOB_COMPLETED]: {
    title: 'Job completed',
    body: () => 'Your job has been marked completed.',
  },
  [NOTIFICATION_TYPES.PAYMENT_CONFIRMED]: {
    title: 'Payment confirmed',
    body: () => 'Your payment was confirmed. Thank you!',
  },
  [NOTIFICATION_TYPES.REVIEW_REMINDER]: {
    title: 'Leave a review',
    body: () => 'How did it go? Leave a review for your provider.',
  },
  [NOTIFICATION_TYPES.NEW_BOOKING]: {
    title: 'New booking request',
    body: (d) => `You have a new ${d.serviceType || 'service'} booking request.`,
  },
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: {
    title: 'Booking cancelled',
    body: () => 'A booking was cancelled.',
  },
  [NOTIFICATION_TYPES.PAYMENT_RECEIVED]: {
    title: 'Payment received',
    body: () => 'You have received a payment.',
  },
  [NOTIFICATION_TYPES.REVIEW_RECEIVED]: {
    title: 'New review',
    body: (d) => `You received a ${d.rating || ''}-star review.`,
  },
  [NOTIFICATION_TYPES.BOOKING_UPDATED]: {
    title: 'Booking updated',
    body: () => 'A booking has been updated.',
  },
  [NOTIFICATION_TYPES.NEW_FAVOURITE]: {
    title: 'New favourite',
    body: () => 'A customer added you to their favourites.',
  },
  [NOTIFICATION_TYPES.NEW_MESSAGE]: {
    title: 'New message',
    body: (d) => d.preview || 'You have a new message.',
  },
  [NOTIFICATION_TYPES.ANNOUNCEMENT]: {
    title: 'Tirelo Services',
    body: (d) => d.body || 'You have a new announcement.',
  },
};

function buildNotification(userId, type, data = {}) {
  const tpl = TEMPLATES[type];
  return {
    id: uuidv4(),
    userId,
    type,
    // data.title lets callers (e.g. admin broadcasts) override the template.
    title: data.title || (tpl ? tpl.title : 'Notification'),
    body: tpl ? tpl.body(data) : data.body || '',
    data,
    read: false,
    createdAt: new Date(),
  };
}

function toPublicJSON(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    read: n.read,
    createdAt: n.createdAt,
  };
}

module.exports = { buildNotification, toPublicJSON, TEMPLATES };
