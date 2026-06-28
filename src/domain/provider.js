'use strict';

const { PROVIDER_AVAILABILITY } = require('../utils/constants');

/**
 * Provider profile domain helpers. A provider profile is keyed by the owning
 * user's id (a user with role `provider`). Performance metrics (rating,
 * completedJobs, …) are maintained by the review and booking services.
 */

function createProvider(input) {
  const now = new Date();
  return {
    userId: input.userId,
    businessName: input.businessName,
    fullName: input.fullName,
    bio: input.bio || '',
    category: input.category, // primary category key
    categories: input.categories && input.categories.length ? input.categories : input.category ? [input.category] : [],
    yearsExperience: input.yearsExperience || 0,
    languages: input.languages || [],
    certifications: input.certifications || [],
    licenses: input.licenses || [],
    profilePhoto: input.profilePhoto || '',
    portfolio: input.portfolio || [],
    areasServed: input.areasServed || [],
    operatingHours: input.operatingHours || '',
    startingPrice: input.startingPrice, // minor units, optional
    location: input.location || {}, // { lat, lng, address }

    verified: false,
    availabilityStatus: input.availabilityStatus || PROVIDER_AVAILABILITY.AVAILABLE,
    responseTimeMinutes: input.responseTimeMinutes ?? 60,

    // Performance metrics.
    rating: 0,
    ratingSum: 0, // internal, kept to recompute averages cheaply
    reviewCount: 0,
    completedJobs: 0,
    responseRate: 100,
    cancellationRate: 0,
    memberSince: now,

    createdAt: now,
    updatedAt: now,
  };
}

// Fields a provider may edit on their own profile (whitelist — prevents a
// provider from spoofing metrics or the verified badge).
const EDITABLE_FIELDS = [
  'businessName',
  'fullName',
  'bio',
  'category',
  'categories',
  'yearsExperience',
  'languages',
  'certifications',
  'licenses',
  'profilePhoto',
  'portfolio',
  'areasServed',
  'operatingHours',
  'startingPrice',
  'location',
  'availabilityStatus',
  'responseTimeMinutes',
];

function applyEditableFields(provider, input) {
  for (const field of EDITABLE_FIELDS) {
    if (input[field] !== undefined) provider[field] = input[field];
  }
  if (input.category && (!provider.categories || !provider.categories.includes(input.category))) {
    provider.categories = Array.from(new Set([input.category, ...(provider.categories || [])]));
  }
  provider.updatedAt = new Date();
  return provider;
}

/** Compact shape for provider cards in discovery lists. */
function toCardJSON(p) {
  return {
    userId: p.userId,
    businessName: p.businessName,
    fullName: p.fullName,
    category: p.category,
    profilePhoto: p.profilePhoto,
    rating: round1(p.rating),
    reviewCount: p.reviewCount,
    completedJobs: p.completedJobs,
    startingPrice: p.startingPrice,
    availabilityStatus: p.availabilityStatus,
    verified: p.verified,
    responseTimeMinutes: p.responseTimeMinutes,
    distanceKm: p.distanceKm, // injected by the service when a point is given
  };
}

/** Full provider profile. */
function toPublicJSON(p) {
  return {
    userId: p.userId,
    businessName: p.businessName,
    fullName: p.fullName,
    bio: p.bio,
    category: p.category,
    categories: p.categories,
    yearsExperience: p.yearsExperience,
    languages: p.languages,
    certifications: p.certifications,
    licenses: p.licenses,
    profilePhoto: p.profilePhoto,
    portfolio: p.portfolio,
    areasServed: p.areasServed,
    operatingHours: p.operatingHours,
    startingPrice: p.startingPrice,
    location: p.location,
    verified: p.verified,
    availabilityStatus: p.availabilityStatus,
    responseTimeMinutes: p.responseTimeMinutes,
    rating: round1(p.rating),
    reviewCount: p.reviewCount,
    completedJobs: p.completedJobs,
    responseRate: p.responseRate,
    cancellationRate: p.cancellationRate,
    memberSince: p.memberSince,
    distanceKm: p.distanceKm,
  };
}

function round1(n) {
  return Math.round((n || 0) * 10) / 10;
}

module.exports = { createProvider, applyEditableFields, toCardJSON, toPublicJSON, EDITABLE_FIELDS };
