'use strict';

const mongoose = require('mongoose');
const { USER_ROLES } = require('../utils/constants');

const userSchema = new mongoose.Schema(
  {
    // Stable public id (uuid) used across the system and in JWTs.
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.CUSTOMER,
      index: true,
    },
    phone: { type: String },
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Phase 8: verification, password reset, suspension.
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null },
    emailVerificationExpires: { type: Date, default: null },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
    suspended: { type: Boolean, default: false, index: true },
    suspendedReason: { type: String, default: null },

    // Phase 3: uploaded profile photo (URL produced by StorageService).
    avatarUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
