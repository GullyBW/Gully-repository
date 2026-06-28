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
    createdAt: now,
    updatedAt: now,
  };
}

/** Shape returned to clients / embedded in JWTs — never exposes the hash. */
function toPublicJSON(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    profile: user.profile,
    createdAt: user.createdAt,
  };
}

module.exports = { normaliseEmail, createUser, toPublicJSON };
