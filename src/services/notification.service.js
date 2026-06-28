'use strict';

const domain = require('../domain/notification');
const deviceDomain = require('../domain/deviceToken');
const prefDomain = require('../domain/notificationPreference');
const PushService = require('./push.service');
const {
  getNotificationRepository,
  getDeviceTokenRepository,
  getNotificationPreferenceRepository,
} = require('../repositories');
const { categoryForNotification } = require('../utils/constants');
const ApiError = require('../utils/ApiError');

/**
 * In-app notifications + push delivery. `emit` always records an in-app
 * notification (history) and, when the user's preferences allow that category,
 * dispatches a push via PushService. Failures never break the caller.
 */
class NotificationService {
  static get repo() {
    return getNotificationRepository();
  }

  static async emit(userId, type, data = {}) {
    try {
      const notification = domain.buildNotification(userId, type, data);
      const saved = await NotificationService.repo.create(notification);

      // Respect per-category push preferences; in-app history is always kept.
      const category = categoryForNotification(type);
      const pref = await getNotificationPreferenceRepository().findByUser(userId);
      if (prefDomain.isEnabled(pref, category)) {
        PushService.dispatch(userId, saved).catch(() => {});
      }
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

  // ---- Device tokens (Phase 2) ----

  static async registerDevice(actor, token, platform) {
    if (!token) throw ApiError.badRequest('token is required');
    const record = deviceDomain.createDeviceToken(actor.id, token, platform);
    const saved = await getDeviceTokenRepository().upsert(record);
    return deviceDomain.toPublicJSON(saved);
  }

  static async unregisterDevice(token) {
    const removed = await getDeviceTokenRepository().removeByToken(token);
    return { removed };
  }

  static async listDevices(actor) {
    const devices = await getDeviceTokenRepository().listByUser(actor.id);
    return devices.map(deviceDomain.toPublicJSON);
  }

  // ---- Preferences (Phase 2) ----

  static async getPreferences(actor) {
    const pref =
      (await getNotificationPreferenceRepository().findByUser(actor.id)) ||
      prefDomain.defaultPreferences(actor.id);
    return pref.categories;
  }

  static async updatePreferences(actor, input) {
    const repo = getNotificationPreferenceRepository();
    const pref = (await repo.findByUser(actor.id)) || prefDomain.defaultPreferences(actor.id);
    prefDomain.applyEdit(pref, input);
    const saved = await repo.save(pref);
    return saved.categories;
  }
}

module.exports = NotificationService;
