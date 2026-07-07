'use strict';

const { id } = require('../kernel/ids');

const WARD_THROTTLE_PER_MINUTE = 600; // per-ward fan-out throttle (§12)

/**
 * SMS gateway (doc §12): outbound fan-out for notices/alerts with
 * per-ward throttling; inbound keywords (LETSEMA JOIN 42) map to API
 * commands; delivery receipts feed the notification ledger.
 * Transport is pluggable — this default records messages (sandbox).
 */
class SmsGateway {
  constructor(platform, transport = null) {
    this.platform = platform;
    this.transport = transport || { send: () => ({ delivered: true }) };
    this.outboundLog = platform.store.collection('sms_outbound');
    this.throttle = new Map(); // wardRef -> { windowStart, count }

    // Notices and civic alerts fan out over SMS automatically (P9).
    platform.bus.subscribe('kgotla.notice.published', 'sms-fanout', (event) => {
      const notice = platform.kgotla.notices.get(event.data.notice_id);
      this.fanOutToWard(event.data.ward_ref, `NOTICE: ${notice.title}`);
    });
    platform.bus.subscribe('kgotla.alert.published', 'sms-fanout', (event) => {
      const alert = platform.kgotla.alerts.get(event.data.alert_id);
      this.fanOutToWard(event.data.ward_ref, `ALERT (${alert.severity}): ${alert.body}`);
    });
  }

  /** Fan out to every verified resident of a ward, throttled per ward. */
  fanOutToWard(wardRef, body) {
    const residents = this.platform.identity.users.find((u) => u.ward_ref === wardRef);
    const sent = [];
    for (const resident of residents) {
      if (!this._allow(wardRef)) break;
      const receipt = this.transport.send({ to: resident.id, body });
      sent.push(
        this.outboundLog.insert({
          id: id('sms'),
          ward_ref: wardRef,
          user_ref: resident.id,
          body,
          delivered: !!receipt.delivered,
          ts: this.platform.clock.nowIso(),
        })
      );
    }
    return sent;
  }

  /**
   * Inbound keyword handler — e.g. "LETSEMA JOIN 42", "BAL".
   * Same services, same idempotency rules as the app (§8).
   */
  handleInbound(msisdn, text, messageId) {
    const user = this.platform.identity.findOrCreateByMsisdn(msisdn);
    const words = String(text || '').trim().toUpperCase().split(/\s+/);

    if (words[0] === 'LETSEMA' && words[1] === 'JOIN' && words[2]) {
      const letsema = this.platform.kgotla.letsemaByShortCode(words[2]);
      if (!letsema) return { reply: `No letsema ${words[2]}` };
      this.platform.kgotla.joinLetsema(letsema.id, user.id, {
        channel: 'sms',
        idempotencyKey: `sms:${messageId || `${msisdn}:${text}`}`,
      });
      return { reply: `Joined "${letsema.title}" on ${letsema.date}` };
    }
    if (words[0] === 'BAL') {
      const account = this.platform.ledger.accounts.findOne(
        (a) => a.owner_ref === user.id && a.type === 'user_wallet'
      );
      const balance = account ? this.platform.ledger.balance(account.id) : 0;
      return { reply: `Balance: BWP ${(balance / 100).toFixed(2)}` };
    }
    return { reply: 'Commands: LETSEMA JOIN <code>, BAL' };
  }

  _allow(wardRef) {
    const now = this.platform.clock.nowMs();
    const bucket = this.throttle.get(wardRef);
    if (!bucket || now - bucket.windowStart > 60000) {
      this.throttle.set(wardRef, { windowStart: now, count: 1 });
      return true;
    }
    if (bucket.count >= WARD_THROTTLE_PER_MINUTE) return false;
    bucket.count += 1;
    return true;
  }
}

module.exports = { SmsGateway, WARD_THROTTLE_PER_MINUTE };
