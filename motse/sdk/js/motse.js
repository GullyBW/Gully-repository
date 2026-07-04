'use strict';

/**
 * Motse JavaScript/TypeScript SDK (Phase 3, WS11).
 *
 * Zero-dependency, isomorphic (Node 18+ and browsers — both have global
 * fetch). Two client kinds:
 *   MotseClient   — member/session auth (OTP → device-bound tokens),
 *                   idempotency keys on mutations, one-shot token refresh.
 *   MotsePartner  — API-key auth for the public developer API, plus a
 *                   webhook signature verifier.
 *
 * Distributed as `sdk/js/motse.js` (CommonJS + ESM-friendly) with the
 * hand-written types in `motse.d.ts`. See sdk/README.md.
 */

function randomKey() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

class MotseError extends Error {
  constructor(problem, status) {
    super(problem.domain_reason || problem.message || 'Motse API error');
    this.code = problem.code;
    this.retryable = !!problem.retryable;
    this.status = status;
    this.traceId = problem.trace_id;
  }
}

class MotseClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl      e.g. https://api.motse.bw
   * @param {string} [opts.deviceId]   stable per-install id (auto if absent)
   * @param {object} [opts.tokens]     { access, refresh } to resume a session
   * @param {function} [opts.fetch]    fetch impl (defaults to global fetch)
   */
  constructor({ baseUrl, deviceId, tokens, fetch: fetchImpl } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.deviceId = deviceId || `sdk-${randomKey().slice(0, 12)}`;
    this.access = tokens && tokens.access;
    this.refresh = tokens && tokens.refresh;
    this._fetch = fetchImpl || globalThis.fetch;
    if (!this._fetch) throw new Error('No fetch implementation available');
  }

  get tokens() {
    return { access: this.access, refresh: this.refresh };
  }

  async _request(method, path, body, { retry = true } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Device-Id': this.deviceId };
    if (this.access) headers.Authorization = `Bearer ${this.access}`;
    if (method !== 'GET') headers['Idempotency-Key'] = randomKey();
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry && this.refresh) {
      const refreshed = await this._doRefresh();
      if (refreshed) return this._request(method, path, body, { retry: false });
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new MotseError(data || {}, res.status);
    return data;
  }

  async _doRefresh() {
    try {
      const res = await this._fetch(`${this.baseUrl}/v1/identity/sessions/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomKey() },
        body: JSON.stringify({ refresh_token: this.refresh }),
      });
      if (!res.ok) return false;
      const session = await res.json();
      this.access = session.access_token;
      this.refresh = session.refresh_token;
      return true;
    } catch {
      return false;
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────
  requestOtp(msisdn) {
    return this._request('POST', '/v1/identity/otp', { msisdn });
  }

  async verifyOtp(msisdn, code, { geo } = {}) {
    const out = await this._request('POST', '/v1/identity/otp/verify', { msisdn, code, geo });
    this.access = out.session.access_token;
    this.refresh = out.session.refresh_token;
    return out;
  }

  // ── Thin wrappers over the common surfaces ───────────────────────
  get(path) { return this._request('GET', path); }
  post(path, body) { return this._request('POST', path, body); }

  wallet() { return this._request('GET', '/v1/wallet/accounts'); }
  campaigns(state) { return this._request('GET', `/v1/kgetsi/campaigns${state ? `?state=${state}` : ''}`); }
  search(q, opts = {}) {
    const qs = new URLSearchParams({ q, ...(opts.types ? { types: opts.types.join(',') } : {}) });
    return this._request('GET', `/v1/search?${qs}`);
  }
  contribute({ campaignId, sourceAccountId, amountMinor }) {
    return this._request('POST', `/v1/kgetsi/campaigns/${campaignId}/contributions`, {
      source_account_id: sourceAccountId, amount_minor: amountMinor,
    });
  }
  notifications() { return this._request('GET', '/v1/notifications'); }
  flags() { return this._request('GET', '/v1/flags'); }

  // ── Cards (Phase 4) ──────────────────────────────────────────────
  // Card data never touches the SDK: the app tokenizes with the gateway's
  // hosted fields and passes only the opaque reference + display metadata.
  listCards() { return this._request('GET', '/v1/cards'); }
  saveCard({ hostedFieldRef, brand, last4, expMonth, expYear, nickname, gateway, networkToken } = {}) {
    return this._request('POST', '/v1/cards', {
      hosted_field_ref: hostedFieldRef, brand, last4,
      exp_month: expMonth, exp_year: expYear, nickname, gateway, network_token: networkToken,
    });
  }
  updateCard(cardId, { nickname, expMonth, expYear } = {}) {
    return this._request('PATCH', `/v1/cards/${cardId}`, { nickname, exp_month: expMonth, exp_year: expYear });
  }
  setDefaultCard(cardId) { return this._request('POST', `/v1/cards/${cardId}/default`); }
  replaceCardToken(cardId, { hostedFieldRef, last4, expMonth, expYear } = {}) {
    return this._request('POST', `/v1/cards/${cardId}/replace-token`, {
      hosted_field_ref: hostedFieldRef, last4, exp_month: expMonth, exp_year: expYear,
    });
  }
  deleteCard(cardId) { return this._request('DELETE', `/v1/cards/${cardId}`); }

  createCardIntent({ amountMinor, currency, destAccountId, cardId, token, brand, ref, country } = {}) {
    return this._request('POST', '/v1/cards/intents', {
      amount_minor: amountMinor, currency, dest_account_id: destAccountId,
      card_id: cardId, token, brand, ref, country,
    });
  }
  completeCard3ds(intentId, success = true) {
    return this._request('POST', `/v1/cards/intents/${intentId}/3ds`, { success });
  }
  captureCard(intentId, amountMinor) {
    return this._request('POST', `/v1/cards/intents/${intentId}/capture`, { amount_minor: amountMinor });
  }
  voidCard(intentId) { return this._request('POST', `/v1/cards/intents/${intentId}/void`); }
  refundCard(intentId, amountMinor, reason) {
    return this._request('POST', `/v1/cards/intents/${intentId}/refund`, { amount_minor: amountMinor, reason });
  }
  cardIntents() { return this._request('GET', '/v1/cards/intents'); }
  cardIntent(intentId) { return this._request('GET', `/v1/cards/intents/${intentId}`); }

  createSubscription({ cardId, amountMinor, currency, destAccountId, interval, plan, graceDays } = {}) {
    return this._request('POST', '/v1/cards/subscriptions', {
      card_id: cardId, amount_minor: amountMinor, currency, dest_account_id: destAccountId,
      interval, plan, grace_days: graceDays,
    });
  }
  subscriptions() { return this._request('GET', '/v1/cards/subscriptions'); }
  pauseSubscription(id) { return this._request('POST', `/v1/cards/subscriptions/${id}/pause`); }
  resumeSubscription(id) { return this._request('POST', `/v1/cards/subscriptions/${id}/resume`); }
  cancelSubscription(id) { return this._request('POST', `/v1/cards/subscriptions/${id}/cancel`); }
  changeSubscription(id, { amountMinor, plan } = {}) {
    return this._request('PATCH', `/v1/cards/subscriptions/${id}`, { amount_minor: amountMinor, plan });
  }

  /** Gateway discovery (brands, currencies, selection order). */
  cardGateways() { return this._request('GET', '/v1/cards/gateways'); }

  // ── QR Code Platform (Phase 5) ───────────────────────────────────
  generateQr({ kind, tenant, subjectRef, ref, amountMinor, currency, expiresInMs, singleUse, dynamic, visibility, requiredRole, requiredLevel, data, restricted } = {}) {
    return this._request('POST', '/v1/qr', {
      kind, tenant, subject_ref: subjectRef, ref, amount_minor: amountMinor, currency,
      expires_in_ms: expiresInMs, single_use: singleUse, dynamic, visibility,
      required_role: requiredRole, required_level: requiredLevel, data, restricted,
    });
  }
  verifyQr(token, { tenant, amountMinor } = {}) {
    return this._request('POST', '/v1/qr/verify', { token, tenant, amount_minor: amountMinor });
  }
  decodeQr(token) { return this._request('POST', '/v1/qr/decode', { token }); }
  payWithQr(token, { provider, msisdn, cardId } = {}) {
    return this._request('POST', '/v1/qr/pay', { token, provider, msisdn, card_id: cardId });
  }
  myQrCodes() { return this._request('GET', '/v1/qr'); }
  revokeQr(qrId, reason) { return this._request('POST', `/v1/qr/${qrId}/revoke`, { reason }); }

  /**
   * Offline QR verification (Node only): signature + expiry, no server
   * round-trip. Revocation/replay still require an online `verifyQr`.
   */
  static verifyQrOffline(secret, token, nowMs = Date.now()) {
    const crypto = require('crypto');
    const parts = String(token).split('.');
    if (parts.length !== 2) return { valid: false, reason: 'malformed' };
    const [body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    let ok = false;
    try { ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig))); } catch { ok = false; }
    if (!ok) return { valid: false, reason: 'bad_signature' };
    let p;
    try { p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
    catch { return { valid: false, reason: 'malformed' }; }
    if (p.exp != null && nowMs > p.exp) return { valid: false, reason: 'expired' };
    return { valid: true, qr_id: p.id, kind: p.k, amount_minor: p.amt, currency: p.cur };
  }

  /**
   * Verify a gateway card-webhook signature (Node only). Gateways sign
   * `${timestamp}.${nonce}.${rawBody}` with the gateway secret; pass the
   * three header values and the raw body exactly as received.
   */
  static verifyCardWebhook(secret, { timestamp, nonce, rawBody }, signature) {
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${nonce}.${rawBody}`)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
    } catch {
      return false;
    }
  }
}

class MotsePartner {
  constructor({ baseUrl, apiKey, fetch: fetchImpl } = {}) {
    if (!baseUrl || !apiKey) throw new Error('baseUrl and apiKey are required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this._fetch = fetchImpl || globalThis.fetch;
  }

  async _request(method, path, body) {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
        ...(method !== 'GET' ? { 'Idempotency-Key': randomKey() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new MotseError(data || {}, res.status);
    return data;
  }

  campaignLedger(campaignId) {
    return this._request('GET', `/v1/public/campaigns/${campaignId}/ledger`);
  }
  publicSearch(q) { return this._request('GET', `/v1/search?q=${encodeURIComponent(q)}`); }
  subscribeWebhook(eventTypes, url) {
    return this._request('POST', '/v1/developer/subscriptions', { event_types: eventTypes, url });
  }

  /**
   * Verify a webhook delivery signature. Node only (needs a crypto HMAC);
   * `secret` is the app's webhook_secret shown at subscription time.
   */
  static verifyWebhook(secret, rawBody, signature) {
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
    } catch {
      return false;
    }
  }
}

module.exports = { MotseClient, MotsePartner, MotseError };
