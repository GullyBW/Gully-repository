'use strict';

const { NOTIFICATION_CATEGORIES } = require('../utils/constants');

const CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES);

/** Default preferences: every category enabled. */
function defaultPreferences(userId) {
  const categories = {};
  for (const key of CATEGORY_KEYS) categories[key] = true;
  return { userId, categories, updatedAt: new Date() };
}

function applyEdit(pref, input) {
  for (const key of CATEGORY_KEYS) {
    if (input[key] !== undefined) pref.categories[key] = !!input[key];
  }
  pref.updatedAt = new Date();
  return pref;
}

function isEnabled(pref, category) {
  if (!pref || !pref.categories) return true;
  return pref.categories[category] !== false;
}

module.exports = { defaultPreferences, applyEdit, isEnabled, CATEGORY_KEYS };
