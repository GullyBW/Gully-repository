'use strict';

const domain = require('../domain/review');
const ProviderService = require('./provider.service');
const NotificationService = require('./notification.service');
const {
  getReviewRepository,
  getBookingRepository,
  getUserRepository,
} = require('../repositories');
const { BOOKING_STATUS, USER_ROLES, REVIEW_STATUS, NOTIFICATION_TYPES } = require('../utils/constants');
const ApiError = require('../utils/ApiError');

/**
 * Ratings & reviews. Only a customer who completed a booking with the provider
 * may review it, and exactly once per booking. Every create/edit/moderation
 * recomputes the provider's aggregate rating so it can never drift.
 */
class ReviewService {
  static get repo() {
    return getReviewRepository();
  }

  static async create(actor, input) {
    const { providerId, bookingReference, rating, title, comment, photos } = input;

    const booking = await getBookingRepository().findByReference(bookingReference);
    if (!booking) throw ApiError.notFound('Booking not found');
    if (booking.customerId !== actor.id && actor.role !== USER_ROLES.ADMIN) {
      throw new ApiError(403, 'You can only review your own bookings');
    }
    if (booking.status !== BOOKING_STATUS.COMPLETED) {
      throw ApiError.conflict('You can only review a completed booking');
    }
    if (booking.providerId !== providerId) {
      throw ApiError.badRequest('Provider does not match the booking');
    }

    const existing = await ReviewService.repo.findByBooking(bookingReference);
    if (existing) throw ApiError.conflict('This booking has already been reviewed');

    const user = await getUserRepository().findById(actor.id);
    const review = domain.createReview({
      providerId,
      customerId: actor.id,
      bookingReference,
      rating,
      title,
      comment,
      photos,
      customerName: user?.name || 'Customer',
    });
    const saved = await ReviewService.repo.create(review);

    await ProviderService.recalculateRating(providerId);
    await NotificationService.emit(providerId, NOTIFICATION_TYPES.REVIEW_RECEIVED, {
      bookingReference,
      rating,
    });

    return domain.toPublicJSON(saved);
  }

  static async edit(actor, reviewId, input) {
    const review = await ReviewService.repo.findById(reviewId);
    if (!review) throw ApiError.notFound('Review not found');
    if (review.customerId !== actor.id && actor.role !== USER_ROLES.ADMIN) {
      throw new ApiError(403, 'You can only edit your own review');
    }
    domain.applyEdit(review, input);
    const saved = await ReviewService.repo.save(review);
    await ProviderService.recalculateRating(review.providerId);
    return domain.toPublicJSON(saved);
  }

  /** Flag a review for moderation. Anyone but the author may report. */
  static async report(actor, reviewId, reason) {
    const review = await ReviewService.repo.findById(reviewId);
    if (!review) throw ApiError.notFound('Review not found');
    if (review.customerId === actor.id) {
      throw ApiError.badRequest('You cannot report your own review');
    }
    review.reportCount = (review.reportCount || 0) + 1;
    review.reports.push({ by: actor.id, reason: reason || 'unspecified', at: new Date() });
    if (review.status === REVIEW_STATUS.PUBLISHED) review.status = REVIEW_STATUS.REPORTED;
    review.updatedAt = new Date();
    const saved = await ReviewService.repo.save(review);
    return domain.toPublicJSON(saved);
  }

  /** Admin moderation: 'remove' takes a review down, 'publish' restores it. */
  static async moderate(actor, reviewId, action) {
    if (actor.role !== USER_ROLES.ADMIN) throw new ApiError(403, 'Admin only');
    const review = await ReviewService.repo.findById(reviewId);
    if (!review) throw ApiError.notFound('Review not found');
    if (action === 'remove') review.status = REVIEW_STATUS.REMOVED;
    else if (action === 'publish') review.status = REVIEW_STATUS.PUBLISHED;
    else throw ApiError.badRequest("action must be 'remove' or 'publish'");
    review.updatedAt = new Date();
    const saved = await ReviewService.repo.save(review);
    await ProviderService.recalculateRating(review.providerId);
    return domain.toPublicJSON(saved);
  }

  /** Public list for a provider — published reviews only. */
  static async listForProvider(providerId, { limit = 20 } = {}) {
    const reviews = await ReviewService.repo.listByProvider(providerId, { limit: 10000 });
    return reviews
      .filter((r) => r.status === REVIEW_STATUS.PUBLISHED)
      .slice(0, limit)
      .map(domain.toPublicJSON);
  }
}

module.exports = ReviewService;
