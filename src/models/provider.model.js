'use strict';

const mongoose = require('mongoose');
const { PROVIDER_AVAILABILITY, SERVICE_CATEGORY_KEYS } = require('../utils/constants');

const providerSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, required: true, index: 'text' },
    fullName: { type: String, required: true },
    bio: { type: String, default: '' },
    category: { type: String, enum: SERVICE_CATEGORY_KEYS, required: true, index: true },
    categories: [{ type: String, enum: SERVICE_CATEGORY_KEYS }],
    yearsExperience: { type: Number, default: 0 },
    languages: [{ type: String }],
    certifications: [{ type: String }],
    licenses: [{ type: String }],
    profilePhoto: { type: String, default: '' },
    portfolio: [{ type: String }],
    areasServed: [{ type: String }],
    operatingHours: { type: String, default: '' },
    startingPrice: { type: Number },
    location: {
      lat: { type: Number },
      lng: { type: Number },
      address: { type: String },
    },

    verified: { type: Boolean, default: false, index: true },
    availabilityStatus: {
      type: String,
      enum: Object.values(PROVIDER_AVAILABILITY),
      default: PROVIDER_AVAILABILITY.AVAILABLE,
      index: true,
    },
    responseTimeMinutes: { type: Number, default: 60 },

    rating: { type: Number, default: 0, index: true },
    ratingSum: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    completedJobs: { type: Number, default: 0 },
    responseRate: { type: Number, default: 100 },
    cancellationRate: { type: Number, default: 0 },
    memberSince: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Provider', providerSchema);
