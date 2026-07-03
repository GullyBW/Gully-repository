'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Ledger service (doc §9) — extracted day one, Postgres system of record
 * in production (P3, P6). All amounts are integer minor units (thebe).
 *
 * Invariants enforced here, not in callers:
 *  - Every posting set balances to exactly zero (double entry).
 *  - Every posting carries an idempotency key; replay returns the
 *    original posting (never a duplicate).
 *  - User-owned accounts can never go negative; only external provider
 *    clearing accounts may carry negative balances.
 *  - Escrow release ≤ escrow funded; releases reference milestones.
 *  - Splits are declarative, versioned, and sum exactly (largest-
 *    remainder rounding) — no thebe is created or destroyed.
 */
const ACCOUNT_TYPES = [
  'user_wallet', // a person's Motse wallet
  'escrow', // campaign / booking custody
  'trust', // Letlole trust treasury
  'platform_fees', // Motse revenue
  'community_trust', // community beneficiary accounts
  'provider_clearing', // Orange Money / MyZaka / card gateway mirror accounts
];

const OVERDRAFT_ALLOWED = new Set(['provider_clearing']);

class LedgerService {
  constructor({ store, clock, bus, idempotency, audit }) {
    this.accounts = store.collection('ledger_accounts');
    this.postings = store.collection('ledger_postings');
    this.payouts = store.collection('ledger_payouts');
    this.rejections = store.collection('ledger_rejections');
    this.reconciliationRuns = store.collection('reconciliation_runs');
    this.splitTemplates = store.collection('split_templates');
    this.balances = new Map(); // account id -> minor units, maintained per posting
    this.clock = clock;
    this.bus = bus;
    this.idempotency = idempotency;
    this.audit = audit;

    bus.register('ledger.posting.committed', 1, ['posting_id', 'purpose', 'ref']);
    bus.register('ledger.posting.rejected', 1, ['reason', 'purpose']);
    bus.register('ledger.payout.settled', 1, ['payout_id', 'account_id', 'amount_minor']);
    bus.register('ledger.payout.failed', 1, ['payout_id', 'reason']);
    bus.register('ledger.reconciliation.variance', 1, ['variance_minor', 'details']);
  }

  // ── Accounts ───────────────────────────────────────────────────────

  openAccount(ownerRef, type, currency = 'BWP') {
    if (!ACCOUNT_TYPES.includes(type)) throw err('INVALID_ARGUMENT', `Unknown account type ${type}`);
    const account = this.accounts.insert({
      id: id('acc'),
      owner_ref: ownerRef,
      type,
      currency,
      created_at: this.clock.nowIso(),
    });
    this.balances.set(account.id, 0);
    return account;
  }

  balance(accountId) {
    if (!this.accounts.get(accountId)) throw err('NOT_FOUND', `No account ${accountId}`);
    return this.balances.get(accountId) || 0;
  }

  /** A member's own accounts with balances (the wallet screen). */
  accountsFor(ownerRef) {
    return this.accounts
      .find((a) => a.owner_ref === ownerRef)
      .map((account) => ({ ...account, balance_minor: this.balance(account.id) }));
  }

  /** A member's own posting history across their accounts (receipts). */
  historyFor(ownerRef, limit = 50) {
    const mine = new Set(this.accounts.find((a) => a.owner_ref === ownerRef).map((a) => a.id));
    return this.postings
      .find((p) => p.entries.some((e) => mine.has(e.account_id)))
      .slice(-limit)
      .reverse()
      .map((posting) => ({
        id: posting.id,
        ts: posting.ts,
        purpose: posting.purpose,
        ref: posting.ref,
        // Only the caller's own legs — other parties' accounts stay private.
        my_entries: posting.entries.filter((e) => mine.has(e.account_id)),
      }));
  }

  // ── Postings (double entry) ────────────────────────────────────────

  /**
   * Commit a balanced posting set atomically.
   * entries: [{ account_id, amount_minor }] — positive credits, negative
   * debits; the set MUST sum to zero (LEDGER_IMBALANCE_REJECTED).
   * Every posting references a business object (`ref`) per §9.1.
   */
  post({ entries, purpose, ref, idempotencyKey, actorRef = 'system:ledger' }) {
    try {
      const { result } = this.idempotency.execute(`ledger:${idempotencyKey}`, () =>
        this._commit({ entries, purpose, ref, actorRef, idempotencyKey })
      );
      return result;
    } catch (e) {
      // Domain rejections are recorded for the admin ledger explorer —
      // once per idempotency key, so replays don't spam the log.
      if (e.retryable === false && e.code !== 'IDEMPOTENT_REPLAY') {
        const already = this.rejections.findOne((r) => r.idempotency_key === idempotencyKey);
        if (!already) {
          this.rejections.insert({
            id: id('rej'),
            reason: e.code,
            domain_reason: e.domainReason || null,
            purpose,
            ref,
            idempotency_key: idempotencyKey,
            actor_ref: actorRef,
            ts: this.clock.nowIso(),
          });
          this.bus.publish('ledger.posting.rejected', { reason: e.code, purpose, ref });
        }
      }
      throw e;
    }
  }

  _commit({ entries, purpose, ref, actorRef, idempotencyKey }) {
    if (!Array.isArray(entries) || entries.length < 2) {
      throw err('INVALID_ARGUMENT', 'A posting set needs at least two entries');
    }
    let sum = 0;
    for (const entry of entries) {
      if (!Number.isInteger(entry.amount_minor)) {
        throw err('INVALID_ARGUMENT', 'Amounts are integer minor units (thebe)');
      }
      if (!this.accounts.get(entry.account_id)) {
        throw err('NOT_FOUND', `No account ${entry.account_id}`);
      }
      sum += entry.amount_minor;
    }
    if (sum !== 0) {
      throw err('LEDGER_IMBALANCE_REJECTED', `Posting set sums to ${sum}, not zero`);
    }
    // Funds check before any write — atomic all-or-nothing.
    for (const entry of entries) {
      const account = this.accounts.get(entry.account_id);
      const next = (this.balances.get(entry.account_id) || 0) + entry.amount_minor;
      if (next < 0 && !OVERDRAFT_ALLOWED.has(account.type)) {
        throw err('STATE_CONFLICT', `Insufficient funds in ${entry.account_id}`, {
          account_id: entry.account_id,
        });
      }
    }
    const posting = this.postings.insert({
      id: id('pst'),
      entries: entries.map((e) => ({ ...e })),
      purpose,
      ref,
      idempotency_key: idempotencyKey,
      ts: this.clock.nowIso(),
    });
    for (const entry of entries) {
      this.balances.set(
        entry.account_id,
        (this.balances.get(entry.account_id) || 0) + entry.amount_minor
      );
    }
    this.audit.append(actorRef, 'ledger.posting.committed', ref, null, {
      posting_id: posting.id,
      purpose,
    });
    this.bus.publish('ledger.posting.committed', {
      posting_id: posting.id,
      purpose,
      ref,
      entries: posting.entries,
    });
    return posting;
  }

  /** Simple two-leg transfer (POST /v1/ledger/transfers). */
  transfer({ source, dest, amountMinor, purpose, ref, idempotencyKey, actorRef }) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw err('INVALID_ARGUMENT', 'amount_minor must be a positive integer');
    }
    return this.post({
      entries: [
        { account_id: source, amount_minor: -amountMinor },
        { account_id: dest, amount_minor: amountMinor },
      ],
      purpose,
      ref,
      idempotencyKey,
      actorRef,
    });
  }

  /**
   * Provider deposit: money arriving from a mobile-money / card webhook.
   * The provider clearing account is debited (it owes us the float) and
   * the destination credited — the ledger mirrors partner statements.
   */
  providerDeposit({ providerAccountId, destAccountId, amountMinor, providerTxRef, idempotencyKey }) {
    return this.post({
      entries: [
        { account_id: providerAccountId, amount_minor: -amountMinor },
        { account_id: destAccountId, amount_minor: amountMinor },
      ],
      purpose: 'provider_deposit',
      ref: providerTxRef,
      idempotencyKey,
    });
  }

  // ── Splits (doc §9.3) ──────────────────────────────────────────────

  /**
   * Execute a versioned split template atomically from a source account.
   * template: { name, version, shares: [{ account_id, pct }] } with pct
   * summing to 100. Largest-remainder rounding guarantees the shares sum
   * exactly to the amount.
   */
  executeSplit({ sourceAccountId, amountMinor, template, ref, idempotencyKey }) {
    const totalPct = template.shares.reduce((s, share) => s + share.pct, 0);
    if (totalPct !== 100) throw err('INVALID_ARGUMENT', `Split "${template.name}" sums to ${totalPct}%`);
    const amounts = LedgerService.apportion(amountMinor, template.shares.map((s) => s.pct));
    const entries = [{ account_id: sourceAccountId, amount_minor: -amountMinor }];
    template.shares.forEach((share, i) => {
      if (amounts[i] > 0) entries.push({ account_id: share.account_id, amount_minor: amounts[i] });
    });
    const posting = this.post({
      entries,
      purpose: `split:${template.name}@v${template.version}`,
      ref,
      idempotencyKey,
    });
    return {
      posting,
      lines: template.shares.map((share, i) => ({
        account_id: share.account_id,
        pct: share.pct,
        amount_minor: amounts[i],
      })),
    };
  }

  /**
   * Split-template registry: declarative, versioned templates (§9.3)
   * browsable in the admin ledger explorer. Registering a new version
   * never mutates an old one — history is preserved.
   */
  registerSplitTemplate({ name, version, shares }, actorRef = 'system:ledger') {
    const totalPct = shares.reduce((s, share) => s + share.pct, 0);
    if (totalPct !== 100) throw err('INVALID_ARGUMENT', `Template "${name}" sums to ${totalPct}%`);
    if (this.splitTemplates.findOne((t) => t.name === name && t.version === version)) {
      throw err('STATE_CONFLICT', `Template ${name}@v${version} already registered`);
    }
    const template = this.splitTemplates.insert({
      id: id('spt'),
      name,
      version,
      shares: shares.map((s) => ({ ...s })),
      registered_by: actorRef,
      registered_at: this.clock.nowIso(),
    });
    this.audit.append(actorRef, 'ledger.split_template_registered', `split_template:${name}`,
      null, { version, shares });
    return template;
  }

  listSplitTemplates() {
    return this.splitTemplates.find();
  }

  /** Largest-remainder apportionment: integer shares that sum exactly. */
  static apportion(amountMinor, pcts) {
    const raw = pcts.map((pct) => (amountMinor * pct) / 100);
    const floors = raw.map(Math.floor);
    let remainder = amountMinor - floors.reduce((a, b) => a + b, 0);
    const order = raw
      .map((value, index) => ({ index, frac: value - Math.floor(value) }))
      .sort((a, b) => b.frac - a.frac || a.index - b.index);
    const result = [...floors];
    for (let i = 0; i < order.length && remainder > 0; i += 1, remainder -= 1) {
      result[order[i].index] += 1;
    }
    return result;
  }

  // ── Payouts (doc §9.3) ─────────────────────────────────────────────

  /** Queue a mobile-money payout; settle on provider receipt. */
  requestPayout({ accountId, providerAccountId, amountMinor, msisdnRef, ref, idempotencyKey }) {
    const posting = this.post({
      entries: [
        { account_id: accountId, amount_minor: -amountMinor },
        { account_id: providerAccountId, amount_minor: amountMinor },
      ],
      purpose: 'payout',
      ref,
      idempotencyKey,
    });
    const payout = this.payouts.insert({
      id: id('pay'),
      account_id: accountId,
      provider_account_id: providerAccountId,
      amount_minor: amountMinor,
      msisdn_ref: msisdnRef,
      ref,
      posting_id: posting.id,
      state: 'pending',
      created_at: this.clock.nowIso(),
    });
    return payout;
  }

  /**
   * Provider dispatch failed permanently: reverse the clearing posting
   * so the member's money comes back, and mark the payout failed for
   * the admin review queue. Never silently swallows money.
   */
  failPayout(payoutId, reason) {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw err('NOT_FOUND', `No payout ${payoutId}`);
    if (payout.state !== 'pending') return payout;
    this.post({
      entries: [
        { account_id: payout.provider_account_id, amount_minor: -payout.amount_minor },
        { account_id: payout.account_id, amount_minor: payout.amount_minor },
      ],
      purpose: 'payout_reversal',
      ref: payout.ref,
      idempotencyKey: `payout-reversal:${payoutId}`,
    });
    const failed = this.payouts.update(payoutId, {
      state: 'failed',
      failure_reason: reason,
      failed_at: this.clock.nowIso(),
    });
    this.bus.publish('ledger.payout.failed', { payout_id: payoutId, reason });
    return failed;
  }

  /** Provider delivery receipt confirms the payout (webhook-driven). */
  settlePayout(payoutId, providerReceiptRef) {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw err('NOT_FOUND', `No payout ${payoutId}`);
    if (payout.state === 'settled') return payout;
    const settled = this.payouts.update(payoutId, {
      state: 'settled',
      provider_receipt_ref: providerReceiptRef,
      settled_at: this.clock.nowIso(),
    });
    this.bus.publish('ledger.payout.settled', {
      payout_id: payoutId,
      account_id: payout.account_id,
      amount_minor: payout.amount_minor,
    });
    return settled;
  }

  // ── Reconciliation (doc §9.2) ──────────────────────────────────────

  /**
   * Nightly job: match ledger postings to provider settlement files.
   * Any variance above zero raises ledger.reconciliation.variance —
   * a Sev-1 page in production.
   */
  reconcile(providerAccountId, statementLines) {
    const seen = new Set();
    let matched = 0;
    const unmatchedStatement = [];
    for (const line of statementLines) {
      const posting = this.postings.findOne(
        (p) =>
          p.ref === line.ref &&
          !seen.has(p.id) &&
          p.entries.some(
            (e) => e.account_id === providerAccountId && Math.abs(e.amount_minor) === line.amount_minor
          )
      );
      if (posting) {
        seen.add(posting.id);
        matched += 1;
      } else {
        unmatchedStatement.push(line);
      }
    }
    const unmatchedPostings = this.postings.find(
      (p) => p.entries.some((e) => e.account_id === providerAccountId) && !seen.has(p.id)
    );
    const variance =
      unmatchedStatement.reduce((s, l) => s + l.amount_minor, 0) +
      unmatchedPostings.reduce(
        (s, p) =>
          s +
          Math.abs(
            p.entries.find((e) => e.account_id === providerAccountId).amount_minor
          ),
        0
      );
    const report = {
      id: id('rec'),
      provider_account_id: providerAccountId,
      matched,
      unmatched_statement_lines: unmatchedStatement,
      unmatched_postings: unmatchedPostings.map((p) => p.id),
      variance_minor: variance,
      ran_at: this.clock.nowIso(),
    };
    this.reconciliationRuns.insert({ ...report });
    if (variance > 0) {
      this.bus.publish('ledger.reconciliation.variance', {
        variance_minor: variance,
        details: report,
      });
    }
    return report;
  }

  /** Global invariant check (observability: "imbalance" monitor, §16). */
  trialBalance() {
    let total = 0;
    for (const value of this.balances.values()) total += value;
    return { balanced: total === 0, total_minor: total };
  }

  postingsFor(ref) {
    return this.postings.find((p) => p.ref === ref);
  }
}

module.exports = { LedgerService, ACCOUNT_TYPES };
