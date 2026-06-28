'use strict';

/**
 * Shared payment constants. Exported so the rest of the Tirelo backend
 * (bookings, notifications, etc.) can reference the same enums.
 */

const PAYMENT_METHODS = Object.freeze({
  ORANGE_MONEY: 'orange_money',
  MYZAKA: 'myzaka',
  BANK_TRANSFER: 'bank_transfer',
  CARD: 'card', // Visa/Mastercard via a hosted card gateway (DPO/Flutterwave/Stripe)
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending', // created, awaiting provider/customer action
  PROCESSING: 'processing', // provider acknowledged, in flight
  SUCCEEDED: 'succeeded', // funds confirmed
  FAILED: 'failed', // provider declined or errored
  CANCELLED: 'cancelled', // cancelled by user/system before completion
  REFUNDED: 'refunded', // funds returned to customer
});

// Status values that are final and cannot transition further.
const TERMINAL_STATUSES = Object.freeze([
  PAYMENT_STATUS.SUCCEEDED,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
]);

const USER_ROLES = Object.freeze({
  CUSTOMER: 'customer', // books services
  PROVIDER: 'provider', // a vendor: plumber, electrician, cleaner, healer...
  ADMIN: 'admin',
});

const BOOKING_STATUS = Object.freeze({
  PENDING: 'pending', // requested by customer, awaiting provider
  ACCEPTED: 'accepted', // provider agreed
  IN_PROGRESS: 'in_progress', // work underway
  COMPLETED: 'completed', // work done
  CANCELLED: 'cancelled', // cancelled by either party
  DECLINED: 'declined', // provider rejected the request
});

// Allowed booking status transitions. Used to reject illegal state changes.
const BOOKING_TRANSITIONS = Object.freeze({
  [BOOKING_STATUS.PENDING]: [
    BOOKING_STATUS.ACCEPTED,
    BOOKING_STATUS.DECLINED,
    BOOKING_STATUS.CANCELLED,
  ],
  [BOOKING_STATUS.ACCEPTED]: [BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED],
  [BOOKING_STATUS.IN_PROGRESS]: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED],
  [BOOKING_STATUS.COMPLETED]: [],
  [BOOKING_STATUS.CANCELLED]: [],
  [BOOKING_STATUS.DECLINED]: [],
});

/**
 * Service categories offered on the marketplace. `key` is the stable machine
 * value stored on providers/bookings; `name` and `icon` (an Ionicons name) are
 * for display.
 */
const SERVICE_CATEGORIES = Object.freeze([
  { key: 'electrician', name: 'Electrician', icon: 'flash-outline' },
  { key: 'plumber', name: 'Plumber', icon: 'water-outline' },
  { key: 'mechanic', name: 'Mechanic', icon: 'car-outline' },
  { key: 'cleaner', name: 'Cleaner', icon: 'sparkles-outline' },
  { key: 'carpenter', name: 'Carpenter', icon: 'hammer-outline' },
  { key: 'painter', name: 'Painter', icon: 'color-fill-outline' },
  { key: 'appliance_repair', name: 'Appliance Repair', icon: 'build-outline' },
  { key: 'air_conditioning', name: 'Air Conditioning', icon: 'snow-outline' },
  { key: 'gardening', name: 'Gardening', icon: 'leaf-outline' },
  { key: 'moving_services', name: 'Moving Services', icon: 'cube-outline' },
  { key: 'security_services', name: 'Security Services', icon: 'shield-checkmark-outline' },
  { key: 'it_services', name: 'IT Services', icon: 'laptop-outline' },
  { key: 'satellite_installation', name: 'Satellite Installation', icon: 'tv-outline' },
  { key: 'solar_installation', name: 'Solar Installation', icon: 'sunny-outline' },
  { key: 'general_handyman', name: 'General Handyman', icon: 'construct-outline' },
]);

const SERVICE_CATEGORY_KEYS = Object.freeze(SERVICE_CATEGORIES.map((c) => c.key));

const PROVIDER_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  BUSY: 'busy',
  OFFLINE: 'offline',
  VACATION: 'vacation',
});

const REVIEW_STATUS = Object.freeze({
  PUBLISHED: 'published',
  REPORTED: 'reported', // flagged, awaiting admin moderation
  REMOVED: 'removed', // taken down by admin
});

const NOTIFICATION_TYPES = Object.freeze({
  // Customer-facing
  BOOKING_ACCEPTED: 'booking_accepted',
  PROVIDER_EN_ROUTE: 'provider_en_route',
  PROVIDER_ARRIVED: 'provider_arrived',
  JOB_COMPLETED: 'job_completed',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  REVIEW_REMINDER: 'review_reminder',
  // Provider-facing
  NEW_BOOKING: 'new_booking',
  BOOKING_UPDATED: 'booking_updated',
  BOOKING_CANCELLED: 'booking_cancelled',
  PAYMENT_RECEIVED: 'payment_received',
  REVIEW_RECEIVED: 'review_received',
  NEW_FAVOURITE: 'new_favourite',
  // Both
  NEW_MESSAGE: 'new_message',
  ANNOUNCEMENT: 'announcement',
});

/**
 * Maps each notification type to a preference category so users can toggle
 * whole groups on/off (Phase 2 notification preferences).
 */
const NOTIFICATION_CATEGORIES = Object.freeze({
  bookings: [
    NOTIFICATION_TYPES.BOOKING_ACCEPTED,
    NOTIFICATION_TYPES.PROVIDER_EN_ROUTE,
    NOTIFICATION_TYPES.PROVIDER_ARRIVED,
    NOTIFICATION_TYPES.JOB_COMPLETED,
    NOTIFICATION_TYPES.NEW_BOOKING,
    NOTIFICATION_TYPES.BOOKING_UPDATED,
    NOTIFICATION_TYPES.BOOKING_CANCELLED,
  ],
  payments: [NOTIFICATION_TYPES.PAYMENT_CONFIRMED, NOTIFICATION_TYPES.PAYMENT_RECEIVED],
  reviews: [NOTIFICATION_TYPES.REVIEW_REMINDER, NOTIFICATION_TYPES.REVIEW_RECEIVED],
  messages: [NOTIFICATION_TYPES.NEW_MESSAGE],
  social: [NOTIFICATION_TYPES.NEW_FAVOURITE],
  marketing: [NOTIFICATION_TYPES.ANNOUNCEMENT],
});

/** Resolve the preference category for a notification type. */
function categoryForNotification(type) {
  for (const [category, types] of Object.entries(NOTIFICATION_CATEGORIES)) {
    if (types.includes(type)) return category;
  }
  return 'bookings';
}

const AUDIT_ACTIONS = Object.freeze({
  LOGIN: 'login',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  TOKEN_REFRESH: 'token_refresh',
  PASSWORD_RESET: 'password_reset',
  EMAIL_VERIFIED: 'email_verified',
  PROVIDER_VERIFIED: 'provider_verified',
  PROVIDER_SUSPENDED: 'provider_suspended',
  BOOKING_CANCELLED_ADMIN: 'booking_cancelled_admin',
  REFUND_ISSUED: 'refund_issued',
  REVIEW_MODERATED: 'review_moderated',
  BROADCAST_SENT: 'broadcast_sent',
  CONVERSATION_REPORTED: 'conversation_reported',
  USER_BLOCKED: 'user_blocked',
});

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  TERMINAL_STATUSES,
  USER_ROLES,
  BOOKING_STATUS,
  BOOKING_TRANSITIONS,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_KEYS,
  PROVIDER_AVAILABILITY,
  REVIEW_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  categoryForNotification,
  AUDIT_ACTIONS,
};
