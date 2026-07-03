'use strict';

const { id, hmac } = require('../kernel/ids');

const SESSION_TTL_MS = 120 * 1000; // operator budget (§12)

/**
 * USSD gateway (doc §12, P9) — adapter service.
 *
 * Operator webhooks (Africa's Talking style) drive a server-side menu
 * state machine. The gateway executes the same commands through the
 * same services with the same idempotency rules as the app — a letsema
 * signup from a Nokia brick and from the app are indistinguishable
 * server-side (§8). Sessions carry a session-scoped capability token.
 */
class UssdGateway {
  constructor(platform) {
    this.platform = platform;
    this.sessions = new Map(); // operator session id -> { user, token, expiresAt }
  }

  /**
   * POST /v1/gateway/ussd/session
   * @param {string} sessionId operator session id
   * @param {string} msisdn
   * @param {string} text accumulated input, e.g. "" | "1" | "1*42"
   * @returns {{response: string, end: boolean}} CON/END semantics
   */
  handle({ sessionId, msisdn, text }) {
    const now = this.platform.clock.nowMs();
    let session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < now) {
      const user = this.platform.identity.findOrCreateByMsisdn(msisdn);
      session = {
        user,
        // Session-scoped capability token minted by the gateway (§5.3).
        token: hmac('ussd-capability', `${sessionId}|${user.id}|${now}`),
        expiresAt: now + SESSION_TTL_MS,
      };
      this.sessions.set(sessionId, session);
    }
    session.expiresAt = now + SESSION_TTL_MS;

    const parts = String(text || '')
      .split('*')
      .filter((p) => p !== '');
    try {
      return this._route(session, sessionId, parts);
    } catch (e) {
      return { response: `Error: ${e.domainReason || e.message}`, end: true };
    }
  }

  _route(session, sessionId, parts) {
    const { kgotla, kgetsi, ledger } = this.platform;
    const user = session.user;

    if (parts.length === 0) {
      return {
        response:
          'Motse\n1. Letsema\n2. Balance\n3. Give to campaign\n4. Ward notices',
        end: false,
      };
    }

    switch (parts[0]) {
      case '1': {
        // Letsema: join by short code.
        if (parts.length === 1) {
          return { response: 'Enter letsema code:', end: false };
        }
        const letsema = kgotla.letsemaByShortCode(parts[1]);
        if (!letsema) return { response: `No letsema ${parts[1]}`, end: true };
        kgotla.joinLetsema(letsema.id, user.id, {
          channel: 'ussd',
          // Deterministic per session+action: operator retries dedupe.
          idempotencyKey: `ussd:${sessionId}:letsema:${letsema.id}`,
        });
        return {
          response: `Joined "${letsema.title}" on ${letsema.date}. Re a leboga!`,
          end: true,
        };
      }
      case '2': {
        // Balance (hot path — Redis pre-computed in production, §15.1).
        const account = ledger.accounts.findOne(
          (a) => a.owner_ref === user.id && a.type === 'user_wallet'
        );
        const balance = account ? ledger.balance(account.id) : 0;
        return { response: `Balance: BWP ${(balance / 100).toFixed(2)}`, end: true };
      }
      case '3': {
        // Give: campaign id, then amount in Pula.
        if (parts.length === 1) return { response: 'Enter campaign code:', end: false };
        if (parts.length === 2) return { response: 'Enter amount (BWP):', end: false };
        const campaign = this.platform.kgetsi.campaigns.get(parts[1]);
        if (!campaign) return { response: `No campaign ${parts[1]}`, end: true };
        const amountMinor = Math.round(Number(parts[2]) * 100);
        const wallet = ledger.accounts.findOne(
          (a) => a.owner_ref === user.id && a.type === 'user_wallet'
        );
        if (!wallet) return { response: 'No wallet. Dial again after registering.', end: true };
        kgetsi.contribute(campaign.id, {
          sourceAccountId: wallet.id,
          amountMinor,
          contributorRef: user.id,
          idempotencyKey: `ussd:${sessionId}:give:${campaign.id}:${amountMinor}`,
        });
        // Operator PIN happens on the operator side; we read back the
        // transaction reference (§5.3 payment confirmations over USSD).
        return {
          response: `Sent BWP ${parts[2]} to "${campaign.title}". Ref ${sessionId.slice(-6)}`,
          end: true,
        };
      }
      case '4': {
        if (!user.ward_ref) return { response: 'No ward on your profile yet.', end: true };
        const notices = kgotla.noticesFor(user.ward_ref).slice(-3);
        if (notices.length === 0) return { response: 'No notices.', end: true };
        return {
          response: notices.map((n, i) => `${i + 1}. ${n.title}`).join('\n'),
          end: true,
        };
      }
      default:
        return { response: 'Invalid choice.', end: true };
    }
  }
}

module.exports = { UssdGateway, SESSION_TTL_MS };
