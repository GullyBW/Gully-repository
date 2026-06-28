'use strict';

const { getUserRepository } = require('../repositories');
const AuditService = require('./audit.service');
const { AUDIT_ACTIONS } = require('../utils/constants');
const ApiError = require('../utils/ApiError');

/**
 * User blocking. A block prevents messaging in either direction. Stored as a
 * list on the blocking user (additive `blockedUserIds` field) — no schema break.
 */
class BlockService {
  static get repo() {
    return getUserRepository();
  }

  static async block(actor, targetId) {
    if (actor.id === targetId) throw ApiError.badRequest('You cannot block yourself');
    const user = await BlockService.repo.findById(actor.id);
    if (!user) throw ApiError.notFound('User not found');
    const set = new Set(user.blockedUserIds || []);
    set.add(targetId);
    user.blockedUserIds = [...set];
    user.updatedAt = new Date();
    await BlockService.repo.save(user);
    await AuditService.log(AUDIT_ACTIONS.USER_BLOCKED, { actorId: actor.id, targetId });
    return { blocked: true };
  }

  static async unblock(actor, targetId) {
    const user = await BlockService.repo.findById(actor.id);
    if (!user) throw ApiError.notFound('User not found');
    user.blockedUserIds = (user.blockedUserIds || []).filter((id) => id !== targetId);
    user.updatedAt = new Date();
    await BlockService.repo.save(user);
    return { blocked: false };
  }

  static async list(actor) {
    const user = await BlockService.repo.findById(actor.id);
    return user ? user.blockedUserIds || [] : [];
  }

  /** True if either user has blocked the other. */
  static async isBlockedBetween(aId, bId) {
    const [a, b] = await Promise.all([
      BlockService.repo.findById(aId),
      BlockService.repo.findById(bId),
    ]);
    return (
      (a && (a.blockedUserIds || []).includes(bId)) ||
      (b && (b.blockedUserIds || []).includes(aId)) ||
      false
    );
  }
}

module.exports = BlockService;
