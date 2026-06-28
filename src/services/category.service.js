'use strict';

const { SERVICE_CATEGORIES, SERVICE_CATEGORY_KEYS } = require('../utils/constants');

/**
 * Service categories are a fixed, curated list (electrician, plumber, …) so they
 * are served from constants rather than a mutable collection. Kept behind a
 * service so a DB-backed catalogue can be swapped in later without touching
 * callers.
 */
class CategoryService {
  static list() {
    return SERVICE_CATEGORIES;
  }

  static isValid(key) {
    return SERVICE_CATEGORY_KEYS.includes(key);
  }

  static get(key) {
    return SERVICE_CATEGORIES.find((c) => c.key === key) || null;
  }
}

module.exports = CategoryService;
