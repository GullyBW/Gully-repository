'use strict';

/** In-memory provider store for tests / no-DB runs. */
class MemoryProviderRepository {
  constructor() {
    this.store = new Map(); // userId -> provider
  }

  async create(provider) {
    this.store.set(provider.userId, { ...provider });
    return { ...provider };
  }

  async findByUserId(userId) {
    const p = this.store.get(userId);
    return p ? { ...p } : null;
  }

  async save(provider) {
    this.store.set(provider.userId, { ...provider });
    return { ...provider };
  }

  /** Apply the cheap, index-friendly filters; ranking/distance happen in the service. */
  async query(filter = {}) {
    const q = (filter.q || '').toLowerCase();
    return [...this.store.values()]
      .filter((p) => {
        if (filter.category && p.category !== filter.category && !(p.categories || []).includes(filter.category)) {
          return false;
        }
        if (filter.verifiedOnly && !p.verified) return false;
        if (filter.availableOnly && p.availabilityStatus !== 'available') return false;
        if (filter.minRating != null && p.rating < filter.minRating) return false;
        if (filter.maxPrice != null && (p.startingPrice == null || p.startingPrice > filter.maxPrice)) {
          return false;
        }
        if (q) {
          const hay = `${p.businessName} ${p.fullName} ${p.bio}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((p) => ({ ...p }));
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryProviderRepository;
