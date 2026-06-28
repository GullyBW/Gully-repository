'use strict';

const domain = require('../domain/notification');
const { getNotificationRepository } = require('../repositories');
const ApiError = require('../utils/ApiError');

/**
 * In-app notifications. `emit` is fire-and-forget from the caller's perspective
 * (failures are swallowed so a notification never breaks a booking/payment), and
 * is the single hook a future push-notification transport (FCM) would tap into.
 */
class NotificationService {
  static get repo() {
    return getNotificationRepository();
  }

  /** Create a notification for a user from a template. Never throws. */
  static async emit(userId, type, data = {}) {
    try {
      const notification = domain.buildNotification(userId, type, data);
      const saved = await NotificationService.repo.create(notification);
      // Hook point: dispatchPush(saved) once a device-token registry exists.
      return saved;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notifications] emit failed', err.message);
      return null;
    }
  }

  static async list(userId, { limit, unreadOnly } = {}) {
    const items = await NotificationService.repo.listByUser(userId, { limit, unreadOnly });
    return items.map(domain.toPublicJSON);
  }

  static async unreadCount(userId) {
    return NotificationService.repo.countUnread(userId);
  }

  static async markRead(actor, id) {
    const notification = await NotificationService.repo.findById(id);
    if (!notification) throw ApiError.notFound('Notification not found');
    if (notification.userId !== actor.id) throw new ApiError(403, 'Not your notification');
    notification.read = true;
    const saved = await NotificationService.repo.save(notification);
    return domain.toPublicJSON(saved);
  }

  static async markAllRead(actor) {
    await NotificationService.repo.markAllRead(actor.id);
    return { success: true };
  }
}

module.exports = NotificationService;
