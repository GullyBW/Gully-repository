// TypeScript definitions for the Motse SDK (Phase 3, WS11).

export interface Tokens {
  access?: string;
  refresh?: string;
}

export interface Geo {
  lat: number;
  lng: number;
}

export class MotseError extends Error {
  code: string;
  retryable: boolean;
  status: number;
  traceId?: string;
}

export interface MotseClientOptions {
  baseUrl: string;
  deviceId?: string;
  tokens?: Tokens;
  fetch?: typeof fetch;
}

export class MotseClient {
  constructor(opts: MotseClientOptions);
  readonly tokens: Tokens;
  requestOtp(msisdn: string): Promise<{ challenge_id: string; sandbox_code?: string }>;
  verifyOtp(
    msisdn: string,
    code: string,
    opts?: { geo?: Geo }
  ): Promise<{ user: Record<string, unknown>; session: { access_token: string; refresh_token: string } }>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T>;
  wallet(): Promise<Array<{ id: string; type: string; balance_minor: number }>>;
  campaigns(state?: string): Promise<{ items: Array<Record<string, unknown>> }>;
  search(q: string, opts?: { types?: string[] }): Promise<{ query: string; results: Array<Record<string, unknown>> }>;
  contribute(args: { campaignId: string; sourceAccountId: string; amountMinor: number }): Promise<Record<string, unknown>>;
  notifications(): Promise<{ items: Array<Record<string, unknown>> }>;
  flags(): Promise<Record<string, unknown>>;

  // ── Cards (Phase 4) ──────────────────────────────────────────────
  listCards(): Promise<{ cards: MaskedCard[] }>;
  saveCard(args: {
    hostedFieldRef: string;
    brand?: CardBrand;
    last4?: string;
    expMonth?: number;
    expYear?: number;
    nickname?: string;
    gateway?: string;
    networkToken?: boolean;
  }): Promise<MaskedCard>;
  updateCard(cardId: string, args: { nickname?: string; expMonth?: number; expYear?: number }): Promise<MaskedCard>;
  setDefaultCard(cardId: string): Promise<MaskedCard>;
  replaceCardToken(
    cardId: string,
    args: { hostedFieldRef: string; last4?: string; expMonth?: number; expYear?: number }
  ): Promise<MaskedCard>;
  deleteCard(cardId: string): Promise<{ deleted: boolean }>;
  createCardIntent(args: {
    amountMinor: number;
    currency?: string;
    destAccountId: string;
    cardId?: string;
    token?: string;
    brand?: CardBrand;
    ref?: string;
    country?: string;
  }): Promise<CardIntent>;
  completeCard3ds(intentId: string, success?: boolean): Promise<CardIntent>;
  captureCard(intentId: string, amountMinor?: number): Promise<CardIntent>;
  voidCard(intentId: string): Promise<CardIntent>;
  refundCard(intentId: string, amountMinor?: number, reason?: string): Promise<CardIntent>;
  cardIntents(): Promise<{ intents: CardIntent[] }>;
  cardIntent(intentId: string): Promise<CardIntent>;
  createSubscription(args: {
    cardId: string;
    amountMinor: number;
    currency?: string;
    destAccountId: string;
    interval?: 'daily' | 'weekly' | 'monthly' | 'annual';
    plan?: string;
    graceDays?: number;
  }): Promise<Record<string, unknown>>;
  subscriptions(): Promise<{ subscriptions: Array<Record<string, unknown>> }>;
  pauseSubscription(id: string): Promise<Record<string, unknown>>;
  resumeSubscription(id: string): Promise<Record<string, unknown>>;
  cancelSubscription(id: string): Promise<Record<string, unknown>>;
  changeSubscription(id: string, args: { amountMinor?: number; plan?: string }): Promise<Record<string, unknown>>;
  cardGateways(): Promise<GatewayCapabilities>;
  static verifyCardWebhook(
    secret: string,
    parts: { timestamp: string | number; nonce: string; rawBody: string },
    signature: string
  ): boolean;
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | string;

export interface MaskedCard {
  id: string;
  owner_ref: string;
  brand: CardBrand;
  display: string; // e.g. "Visa **** **** **** 4242"
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  nickname: string;
  is_default: boolean;
  gateway: string;
  logo: string;
}

export interface CardIntent {
  id: string;
  state: string;
  gateway: string;
  brand: CardBrand;
  amount_minor: number;
  original_currency: string;
  settlement_currency: string;
  fx_rate: number;
  captured_minor: number;
  refunded_minor: number;
  gateway_token_masked: string | null;
  [key: string]: unknown;
}

export interface GatewayCapabilities {
  brands: CardBrand[];
  currencies: string[];
  order: string[];
  gateways: Array<{ name: string; brands: CardBrand[]; currencies: string[]; mode: 'live' | 'sandbox' }>;
}

export interface MotversePartnerOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export class MotsePartner {
  constructor(opts: MotversePartnerOptions);
  campaignLedger(campaignId: string): Promise<Record<string, unknown>>;
  publicSearch(q: string): Promise<{ query: string; results: Array<Record<string, unknown>> }>;
  subscribeWebhook(eventTypes: string[], url: string): Promise<Record<string, unknown>>;
  static verifyWebhook(secret: string, rawBody: string, signature: string): boolean;
}
