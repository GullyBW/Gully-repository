'use strict';

const domain = require('../domain/provider');
const GeoService = require('./geo.service');
const CategoryService = require('./category.service');
const {
  getProviderRepository,
  getReviewRepository,
  getUserRepository,
} = require('../repositories');
const { USER_ROLES, PROVIDER_AVAILABILITY, REVIEW_STATUS } = require('../utils/constants');
const ApiError = require('../utils/ApiError');

const SORTS = {
  nearest: (a, b) => num(a.distanceKm) - num(b.distanceKm),
  highest_rated: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
  lowest_price: (a, b) => num(a.startingPrice) - num(b.startingPrice),
  most_jobs: (a, b) => b.completedJobs - a.completedJobs,
  fastest_response: (a, b) => a.responseTimeMinutes - b.responseTimeMinutes,
};

function num(v) {
  return v == null ? Number.POSITIVE_INFINITY : v;
}

/**
 * Provider profiles + the discovery/search experience that replaces manual
 * provider-ID entry. Performance metrics are recomputed here so they stay
 * authoritative (a provider can never set their own rating or verified badge).
 */
class ProviderService {
  static get repo() {
    return getProviderRepository();
  }

  /** Create or update the calling provider's own profile. */
  static async upsertProfile(actor, input) {
    if (actor.role !== USER_ROLES.PROVIDER && actor.role !== USER_ROLES.ADMIN) {
      throw new ApiError(403, 'Only providers can manage a provider profile');
    }
    if (input.category && !CategoryService.isValid(input.category)) {
      throw ApiError.badRequest(`Unknown service category '${input.category}'`);
    }

    const existing = await ProviderService.repo.findByUserId(actor.id);
    if (existing) {
      const updated = domain.applyEditableFields(existing, input);
      return ProviderService.repo.save(updated);
    }

    if (!input.category) throw ApiError.badRequest('category is required to create a profile');
    if (!input.businessName) throw ApiError.badRequest('businessName is required');

    // Denormalise the provider's name from their user record for display/search.
    const user = await getUserRepository().findById(actor.id);
    const created = domain.createProvider({
      ...input,
      userId: actor.id,
      fullName: input.fullName || user?.name || 'Provider',
    });
    return ProviderService.repo.create(created);
  }

  /** Full public profile by provider userId. */
  static async getProfile(userId) {
    const provider = await ProviderService.repo.findByUserId(userId);
    if (!provider) throw ApiError.notFound('Provider not found');
    return domain.toPublicJSON(provider);
  }

  /** The raw provider record (internal use, e.g. booking validation). */
  static async getRaw(userId) {
    return ProviderService.repo.findByUserId(userId);
  }

  /**
   * Discovery search. Cheap filters are pushed to the repository; distance,
   * sorting and pagination are applied here so behaviour is identical across
   * MongoDB and the in-memory store.
   */
  static async search(params = {}) {
    const {
      category,
      q,
      minRating,
      maxPrice,
      availableOnly,
      verifiedOnly,
      lat,
      lng,
      maxDistanceKm,
      sort,
      page = 1,
      limit = 10,
    } = params;

    let items = await ProviderService.repo.query({
      category,
      q,
      minRating: toNum(minRating),
      maxPrice: toNum(maxPrice),
      availableOnly: toBool(availableOnly),
      verifiedOnly: toBool(verifiedOnly),
    });

    const near =
      lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null;
    if (near) {
      for (const p of items) {
        const d = GeoService.distanceKm(near, p.location);
        p.distanceKm = d == null ? null : Math.round(d * 10) / 10;
      }
      const maxKm = toNum(maxDistanceKm);
      if (maxKm != null) {
        items = items.filter((p) => p.distanceKm != null && p.distanceKm <= maxKm);
      }
    }

    const sorter = SORTS[sort] || ProviderService._defaultSort;
    items.sort(sorter);

    const total = items.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const startIdx = (pageNum - 1) * lim;
    const slice = items.slice(startIdx, startIdx + lim);

    return {
      items: slice.map(domain.toCardJSON),
      page: pageNum,
      limit: lim,
      total,
      hasMore: startIdx + lim < total,
    };
  }

  /** Admin: approve/revoke a provider's verified badge. */
  static async setVerified(userId, verified, actor) {
    if (actor.role !== USER_ROLES.ADMIN) {
      throw new ApiError(403, 'Only an admin can verify providers');
    }
    const provider = await ProviderService.repo.findByUserId(userId);
    if (!provider) throw ApiError.notFound('Provider not found');
    provider.verified = !!verified;
    provider.updatedAt = new Date();
    return domain.toPublicJSON(await ProviderService.repo.save(provider));
  }

  /** Provider toggles their live availability (available/busy/offline/vacation). */
  static async setAvailabilityStatus(actor, status) {
    if (!Object.values(PROVIDER_AVAILABILITY).includes(status)) {
      throw ApiError.badRequest('Invalid availability status');
    }
    const provider = await ProviderService.repo.findByUserId(actor.id);
    if (!provider) throw ApiError.notFound('Provider profile not found');
    provider.availabilityStatus = status;
    provider.updatedAt = new Date();
    return domain.toPublicJSON(await ProviderService.repo.save(provider));
  }

  /**
   * Recompute a provider's rating + review count from their published reviews.
   * Called by the review service after any review create/edit/remove so the
   * aggregate never drifts.
   */
  static async recalculateRating(providerUserId) {
    const provider = await ProviderService.repo.findByUserId(providerUserId);
    if (!provider) return null;
    const reviews = await getReviewRepository().listByProvider(providerUserId, { limit: 10000 });
    const published = reviews.filter((r) => r.status === REVIEW_STATUS.PUBLISHED);
    const sum = published.reduce((acc, r) => acc + r.rating, 0);
    provider.reviewCount = published.length;
    provider.ratingSum = sum;
    provider.rating = published.length ? sum / published.length : 0;
    provider.updatedAt = new Date();
    return ProviderService.repo.save(provider);
  }

  /** Bump completed-jobs counter when a booking is completed. */
  static async incrementCompletedJobs(providerUserId) {
    const provider = await ProviderService.repo.findByUserId(providerUserId);
    if (!provider) return null;
    provider.completedJobs = (provider.completedJobs || 0) + 1;
    provider.updatedAt = new Date();
    return ProviderService.repo.save(provider);
  }

  static _defaultSort(a, b) {
    // Verified, then higher rated, then more jobs.
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.completedJobs - a.completedJobs;
  }
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toBool(v) {
  return v === true || v === 'true' || v === '1';
}

module.exports = ProviderService;
