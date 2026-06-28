'use strict';

const { v4: uuidv4 } = require('uuid');
const { USER_ROLES } = require('../utils/constants');

/**
 * Plain-object user domain helpers, shared by the Mongo and in-memory
 * repositories. Password hashing is done in the auth service, not here.
 */

function normaliseEmail(email) {
  return String(email).trim().toLowerCase();
}

/** Build a new user object. `passwordHash` is supplied by the auth service. */
function createUser(input) {
  const now = new Date();
  return {
    id: uuidv4(),
    name: input.name,
    email: normaliseEmail(input.email),
    passwordHash: input.passwordHash,
    role: input.role || USER_ROLES.CUSTOMER,
    phone: input.phone,
    // Optional provider profile (profession, services, location).
    profile: input.profile || {},
    avatarUrl: input.avatarUrl || '',

    // Phase 8 security fields.
    emailVerified: false,
    emailVerificationToken: null,
    emailVerificationExpires: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    suspended: false,
    suspendedReason: null,

    createdAt: now,
    updatedAt: now,
  };
}

/** Shape returned to clients / embedded in JWTs — never exposes the hash or tokens. */
function toPublicJSON(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    profile: user.profile,
    avatarUrl: user.avatarUrl || '',
    emailVerified: !!user.emailVerified,
    suspended: !!user.suspended,
    createdAt: user.createdAt,
  };
}

module.exports = { normaliseEmail, createUser, toPublicJSON };
