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
