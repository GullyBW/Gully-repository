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
