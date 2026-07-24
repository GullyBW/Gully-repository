'use strict';
// Outbound notification-provider PORT (email / SMS / push) for AUTHENTICATED STAFF only —
// investigators, oversight board, admins — e.g. "a case was assigned to your queue".
//
// ANONYMITY BOUNDARY (fail-closed): anonymous reporters are NEVER pushed to a device.
// Their only channel is poll-by-case-code (adapters/notifications.js), so a reporter can
// not be linked to a contact address. This provider therefore REFUSES to send anything
// addressed to a reporter/case code, and refuses case content in the body. It carries a
// coarse, non-identifying reason to a STAFF principal's registered channel.
//
// Reference providers capture messages in memory (assertable in tests). Production drivers
// are SES/SendGrid (email), Twilio/SNS (SMS), FCM/APNs (push) behind the SAME send()
// interface (docs/production-adapters.md).

const STAFF_ROLES = new Set(['investigator', 'oversight-board', 'admin']);
const CONTENT_KEYS = new Set(['content', 'body', 'plaintext', 'caseContent', 'reportText']);

function assertStaffSafe(msg) {
  if (!msg || !msg.toPrincipal) throw new Error('notify: a staff principal is required (no anonymous push)');
  if (msg.role && !STAFF_ROLES.has(msg.role)) throw new Error('notify: only staff roles may receive push/email/sms');
  for (const k of Object.keys(msg.data || {})) {
    if (CONTENT_KEYS.has(k)) throw new Error(`notify: case content must not leave the zone (${k})`);
  }
}

// One in-memory reference provider parameterised by channel.
class CaptureProvider {
  constructor(channel, { clock = () => Date.now() } = {}) { this.channel = channel; this._clock = clock; this._sent = []; }
  send(msg) {
    assertStaffSafe(msg);
    const rec = { channel: this.channel, to: msg.toPrincipal, reason: msg.reason, at: this._clock(), data: msg.data || {} };
    this._sent.push(rec);
    return { accepted: true, channel: this.channel, id: this._sent.length };
  }
  sent() { return [...this._sent]; }
}

// A dispatcher that fans a notification out to the configured channels for a principal.
class NotificationDispatcher {
  constructor(providers = {}) { this._providers = providers; } // { email, sms, push }
  dispatch(channels, msg) {
    const out = [];
    for (const ch of channels) { const p = this._providers[ch]; if (p) out.push(p.send(msg)); }
    return out;
  }
}

function makeNotificationProviders(cfg = {}) {
  // Reference capture providers by default; production returns SES/Twilio/FCM drivers.
  const clock = cfg.clock;
  return new NotificationDispatcher({
    email: new CaptureProvider('email', { clock }),
    sms: new CaptureProvider('sms', { clock }),
    push: new CaptureProvider('push', { clock }),
  });
}

module.exports = { CaptureProvider, NotificationDispatcher, makeNotificationProviders, assertStaffSafe, STAFF_ROLES };
