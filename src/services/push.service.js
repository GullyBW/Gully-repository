'use strict';

const config = require('../config');
const { getDeviceTokenRepository } = require('../repositories');

/**
 * Push delivery abstraction. Uses Firebase Cloud Messaging when configured
 * (`PUSH_TRANSPORT=fcm` + `firebase-admin` installed); otherwise a console
 * transport that always "delivers" so the app works without FCM. Failed sends
 * are retried with backoff up to `config.push.maxRetries`.
 */
class PushService {
  static _fcm = undefined; // lazy-initialised messaging instance or null

  static _messaging() {
    if (PushService._fcm !== undefined) return PushService._fcm;
    PushService._fcm = null;
    if (config.push.transport === 'fcm' && config.push.fcmServiceAccount) {
      try {
        // eslint-disable-next-line global-require
        const admin = require('firebase-admin');
        const credential = config.push.fcmServiceAccount.trim().startsWith('{')
          ? JSON.parse(config.push.fcmServiceAccount)
          : require(config.push.fcmServiceAccount);
        if (!admin.apps.length) {
          admin.initializeApp({ credential: admin.credential.cert(credential) });
        }
        PushService._fcm = admin.messaging();
      } catch (_err) {
        PushService._fcm = null; // firebase-admin not installed / bad config
      }
    }
    return PushService._fcm;
  }

  /** Send to every device a user has registered. Returns per-token results. */
  static async dispatch(userId, notification) {
    const tokens = await getDeviceTokenRepository().listByUser(userId);
    const results = [];
    for (const t of tokens) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await PushService.sendToToken(t, notification));
    }
    return results;
  }

  static async sendToToken(deviceToken, notification) {
    let attempts = 0;
    let lastError = null;
    while (attempts < config.push.maxRetries) {
      attempts += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        await PushService._send(deviceToken, notification);
        return { token: deviceToken.token, delivered: true, attempts };
      } catch (err) {
        lastError = err;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 2 ** attempts * 10));
      }
    }
    return { token: deviceToken.token, delivered: false, attempts, error: lastError?.message };
  }

  static async _send(deviceToken, notification) {
    const messaging = PushService._messaging();
    if (!messaging) {
      // Console transport: no-op success.
      return { transport: 'console' };
    }
    await messaging.send({
      token: deviceToken.token,
      notification: { title: notification.title, body: notification.body },
      data: Object.fromEntries(
        Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)])
      ),
    });
    return { transport: 'fcm' };
  }
}

module.exports = PushService;
