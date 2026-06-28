'use strict';

const domain = require('../domain/availability');
const { getAvailabilityRepository } = require('../repositories');
const { USER_ROLES } = require('../utils/constants');
const ApiError = require('../utils/ApiError');

/** Provider availability management + bookable-slot computation for customers. */
class AvailabilityService {
  static get repo() {
    return getAvailabilityRepository();
  }

  /** Current config for a provider, or sensible defaults if none saved yet. */
  static async getForProvider(providerId) {
    const existing = await AvailabilityService.repo.findByProvider(providerId);
    return domain.toPublicJSON(existing || domain.defaultAvailability(providerId));
  }

  /** Provider creates/updates their own availability. */
  static async upsert(actor, input) {
    if (actor.role !== USER_ROLES.PROVIDER && actor.role !== USER_ROLES.ADMIN) {
      throw new ApiError(403, 'Only providers manage availability');
    }
    const current =
      (await AvailabilityService.repo.findByProvider(actor.id)) ||
      domain.defaultAvailability(actor.id);
    domain.applyEdit(current, input);
    const saved = await AvailabilityService.repo.save(current);
    return domain.toPublicJSON(saved);
  }

  /** Bookable slots for a provider on a date ('YYYY-MM-DD'). */
  static async slots(providerId, dateStr) {
    if (!dateStr) throw ApiError.badRequest('date (YYYY-MM-DD) is required');
    const availability =
      (await AvailabilityService.repo.findByProvider(providerId)) ||
      domain.defaultAvailability(providerId);
    return {
      providerId,
      date: dateStr,
      slots: domain.computeSlots(availability, dateStr),
    };
  }
}

module.exports = AvailabilityService;
