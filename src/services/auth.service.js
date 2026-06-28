'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const domain = require('../domain/user');
const { getUserRepository } = require('../repositories');
const ApiError = require('../utils/ApiError');
const config = require('../config');

/**
 * User authentication: registration, login and JWT issuance/verification.
 * Storage is reached only through the injected user repository.
 */
class AuthService {
  static get repo() {
    return getUserRepository();
  }

  static _sign(user) {
    return jwt.sign(
      { sub: user.id, role: user.role, email: user.email },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn }
    );
  }

  /** Register a new user. Returns the public user plus a signed JWT. */
  static async register({ name, email, password, role, phone, profile }) {
    const normalisedEmail = domain.normaliseEmail(email);
    const existing = await AuthService.repo.findByEmail(normalisedEmail);
    if (existing) {
      throw ApiError.conflict('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const user = domain.createUser({ name, email: normalisedEmail, passwordHash, role, phone, profile });
    const saved = await AuthService.repo.create(user);

    return { user: domain.toPublicJSON(saved), token: AuthService._sign(saved) };
  }

  /** Authenticate by email + password. Returns the public user plus a JWT. */
  static async login({ email, password }) {
    const user = await AuthService.repo.findByEmail(domain.normaliseEmail(email));
    // Run a hash comparison even when the user is missing to avoid leaking,
    // via timing, whether an email is registered.
    const hash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    return { user: domain.toPublicJSON(user), token: AuthService._sign(user) };
  }

  /** Verify a JWT and return its decoded payload. */
  static verifyToken(token) {
    try {
      return jwt.verify(token, config.auth.jwtSecret);
    } catch (err) {
      throw ApiError.unauthorized('Invalid or expired token');
    }
  }

  /** Load the current user by id (used by /auth/me and middleware). */
  static async getById(id) {
    const user = await AuthService.repo.findById(id);
    if (!user) throw ApiError.notFound('User not found');
    return domain.toPublicJSON(user);
  }
}

module.exports = AuthService;
