'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userDomain = require('../domain/user');
const refreshDomain = require('../domain/refreshToken');
const EmailService = require('./email.service');
const AuditService = require('./audit.service');
const { getUserRepository, getRefreshTokenRepository } = require('../repositories');
const { AUDIT_ACTIONS } = require('../utils/constants');
const ApiError = require('../utils/ApiError');
const config = require('../config');

/**
 * Authentication: registration, login, JWT access tokens plus refresh-token
 * rotation, email verification, password reset and session/device management.
 *
 * Backward compatible: register/login still return `{ user, token }`; they now
 * additionally return `refreshToken`. Existing callers that ignore it keep working.
 */
class AuthService {
  static get repo() {
    return getUserRepository();
  }

  static get refreshRepo() {
    return getRefreshTokenRepository();
  }

  static _signAccess(user) {
    return jwt.sign(
      { sub: user.id, role: user.role, email: user.email },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn }
    );
  }

  static async _issueRefresh(userId, context = {}) {
    const { record, raw } = refreshDomain.createRefreshToken(userId, context);
    await AuthService.refreshRepo.create(record);
    return raw;
  }

  /** Tokens returned to clients; dev/test also get the email token for convenience. */
  static _devToken(token) {
    return config.env === 'production' ? undefined : token;
  }

  /** Register a new user. Returns the public user, access + refresh tokens. */
  static async register(input, context = {}) {
    const { name, email, password, role, phone, profile } = input;
    const normalisedEmail = userDomain.normaliseEmail(email);

    const existing = await AuthService.repo.findByEmail(normalisedEmail);
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const user = userDomain.createUser({ name, email: normalisedEmail, passwordHash, role, phone, profile });

    const verificationToken = crypto.randomBytes(24).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const saved = await AuthService.repo.create(user);
    await EmailService.sendVerificationEmail(saved.email, verificationToken);

    const token = AuthService._signAccess(saved);
    const refreshToken = await AuthService._issueRefresh(saved.id, context);

    return {
      user: userDomain.toPublicJSON(saved),
      token,
      refreshToken,
      devEmailVerificationToken: AuthService._devToken(verificationToken),
    };
  }

  /** Authenticate by email + password. */
  static async login({ email, password }, context = {}) {
    const user = await AuthService.repo.findByEmail(userDomain.normaliseEmail(email));
    const hash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      await AuditService.log(AUDIT_ACTIONS.LOGIN_FAILED, { ip: context.ip, meta: { email } });
      throw ApiError.unauthorized('Invalid email or password');
    }
    if (user.suspended) {
      throw new ApiError(403, 'This account has been suspended. Contact support.');
    }

    const token = AuthService._signAccess(user);
    const refreshToken = await AuthService._issueRefresh(user.id, context);
    await AuditService.log(AUDIT_ACTIONS.LOGIN, { actorId: user.id, ip: context.ip });

    return { user: userDomain.toPublicJSON(user), token, refreshToken };
  }

  /**
   * Rotate a refresh token: validate it, revoke it, and issue a fresh
   * access + refresh pair. Reusing a revoked/expired token is rejected.
   */
  static async refresh(rawToken, context = {}) {
    if (!rawToken) throw ApiError.badRequest('refreshToken is required');
    const record = await AuthService.refreshRepo.findByHash(refreshDomain.hashToken(rawToken));
    if (!refreshDomain.isActive(record)) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }

    // Rotate: revoke the presented token, issue a new one.
    record.revoked = true;
    record.lastUsedAt = new Date();
    await AuthService.refreshRepo.save(record);

    const user = await AuthService.repo.findById(record.userId);
    if (!user || user.suspended) throw ApiError.unauthorized('Account unavailable');

    const token = AuthService._signAccess(user);
    const refreshToken = await AuthService._issueRefresh(user.id, context);
    await AuditService.log(AUDIT_ACTIONS.TOKEN_REFRESH, { actorId: user.id, ip: context.ip });

    return { token, refreshToken };
  }

  /** Revoke a refresh token (logout on this device). */
  static async logout(rawToken, actor) {
    if (!rawToken) return { success: true };
    const record = await AuthService.refreshRepo.findByHash(refreshDomain.hashToken(rawToken));
    if (record) {
      record.revoked = true;
      await AuthService.refreshRepo.save(record);
    }
    if (actor) await AuditService.log(AUDIT_ACTIONS.LOGOUT, { actorId: actor.id });
    return { success: true };
  }

  static async verifyEmail(token) {
    const user = await AuthService.repo.findByEmailVerificationToken(token);
    if (!user || (user.emailVerificationExpires && new Date(user.emailVerificationExpires) < new Date())) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.updatedAt = new Date();
    await AuthService.repo.save(user);
    await AuditService.log(AUDIT_ACTIONS.EMAIL_VERIFIED, { actorId: user.id });
    return { verified: true };
  }

  /** Begin password reset. Always succeeds (no user enumeration). */
  static async requestPasswordReset(email) {
    const user = await AuthService.repo.findByEmail(userDomain.normaliseEmail(email));
    let devToken;
    if (user) {
      const token = crypto.randomBytes(24).toString('hex');
      user.passwordResetToken = token;
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
      user.updatedAt = new Date();
      await AuthService.repo.save(user);
      await EmailService.sendPasswordResetEmail(user.email, token);
      devToken = AuthService._devToken(token);
    }
    return { success: true, devResetToken: devToken };
  }

  static async resetPassword(token, newPassword) {
    const user = await AuthService.repo.findByPasswordResetToken(token);
    if (!user || (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date())) {
      throw ApiError.badRequest('Invalid or expired reset token');
    }
    user.passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.updatedAt = new Date();
    await AuthService.repo.save(user);
    // Security: invalidate all existing sessions after a password change.
    await AuthService.refreshRepo.revokeAllForUser(user.id);
    await AuditService.log(AUDIT_ACTIONS.PASSWORD_RESET, { actorId: user.id });
    return { success: true };
  }

  /** Active and historical sessions/devices for a user. */
  static async listSessions(userId) {
    const tokens = await AuthService.refreshRepo.listByUser(userId);
    return tokens.map(refreshDomain.toPublicJSON);
  }

  static async revokeSession(actor, sessionId) {
    const tokens = await AuthService.refreshRepo.listByUser(actor.id);
    const owned = tokens.find((t) => t.id === sessionId);
    if (!owned) throw ApiError.notFound('Session not found');
    await AuthService.refreshRepo.revokeById(sessionId);
    return { success: true };
  }

  static verifyToken(token) {
    try {
      return jwt.verify(token, config.auth.jwtSecret);
    } catch (_err) {
      throw ApiError.unauthorized('Invalid or expired token');
    }
  }

  static async getById(id) {
    const user = await AuthService.repo.findById(id);
    if (!user) throw ApiError.notFound('User not found');
    return userDomain.toPublicJSON(user);
  }
}

module.exports = AuthService;
