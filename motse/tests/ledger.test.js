'use strict';

/**
 * Money tests (doc §17): property-based checks on the ledger —
 * postings always balance, replay is idempotent, splits sum exactly —
 * plus reconciliation against synthetic provider files including
 * malformed and duplicated records.
 */
const { LedgerService } = require('../src/platform/ledger/ledger.service');
const { world, fundedWallet } = require('./helpers');

describe('Ledger (double entry, §9)', () => {
  test('rejects posting sets that do not sum to zero', () => {
    const w = world();
    expect(() =>
      w.p.ledger.post({
        entries: [
          { account_id: w.kaboWallet.id, amount_minor: -100 },
          { account_id: w.mmaWallet.id, amount_minor: 99 },
        ],
        purpose: 'test',
        ref: 'x',
        idempotencyKey: 'imbalance-1',
      })
    ).toThrow(expect.objectContaining({ code: 'LEDGER_IMBALANCE_REJECTED' }));
  });

  test('replay with the same idempotency key returns the original posting exactly once', () => {
    const w = world();
    const args = {
      source: w.kaboWallet.id,
      dest: w.mmaWallet.id,
      amountMinor: 500,
      purpose: 'p2p',
      ref: 'gift:1',
      idempotencyKey: 'gift-1',
    };
    const first = w.p.ledger.transfer(args);
    const balanceAfterFirst = w.p.ledger.balance(w.mmaWallet.id);
    const replayed = w.p.ledger.transfer(args);
    expect(replayed.id).toBe(first.id);
    expect(w.p.ledger.balance(w.mmaWallet.id)).toBe(balanceAfterFirst);
  });

  test('user wallets can never go negative; provider clearing can', () => {
    const w = world();
    expect(() =>
      w.p.ledger.transfer({
        source: w.kaboWallet.id,
        dest: w.mmaWallet.id,
        amountMinor: 100001, // wallet holds 100000
        purpose: 'p2p',
        ref: 'too-much',
        idempotencyKey: 'over-1',
      })
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
    // provider clearing went negative at world() top-up time — by design
    expect(w.p.ledger.balance(w.providerClearing.id)).toBeLessThan(0);
  });

  test('property: random balanced posting sets keep the trial balance at zero', () => {
    const w = world();
    const wallets = Array.from({ length: 5 }, (_, i) =>
      fundedWallet(w.p, `usr_prop_${i}`, w.providerClearing.id, 1000000)
    );
    for (let round = 0; round < 200; round += 1) {
      const a = wallets[round % wallets.length];
      const b = wallets[(round + 1 + (round % 3)) % wallets.length];
      if (a.id === b.id) continue;
      const amount = 1 + ((round * 7919) % 997);
      w.p.ledger.transfer({
        source: a.id,
        dest: b.id,
        amountMinor: amount,
        purpose: 'prop',
        ref: `prop:${round}`,
        idempotencyKey: `prop:${round}`,
      });
    }
    expect(w.p.ledger.trialBalance()).toEqual({ balanced: true, total_minor: 0 });
  });

  test('property: apportion() always sums exactly and never strays >1 thebe from exact share', () => {
    const templates = [
      [60, 25, 10, 5], // the canonical Loeto split (§9.3)
      [33, 33, 34],
      [1, 99],
      [50, 50],
      [70, 15, 15],
    ];
    for (const pcts of templates) {
      for (const amount of [1, 3, 7, 99, 100, 101, 12345, 999999]) {
        const parts = LedgerService.apportion(amount, pcts);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
        parts.forEach((part, i) => {
          expect(Math.abs(part - (amount * pcts[i]) / 100)).toBeLessThan(1);
        });
      }
    }
  });

  test('executeSplit posts one balanced set with per-beneficiary lines', () => {
    const w = world();
    const guide = w.p.ledger.openAccount('usr_guide', 'user_wallet');
    const homestead = w.p.ledger.openAccount('usr_home', 'user_wallet');
    const trust = w.p.ledger.openAccount('trust_comm', 'community_trust');
    const platform = w.p.ledger.openAccount('motse', 'platform_fees');
    const { lines } = w.p.ledger.executeSplit({
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 10001, // awkward number to force rounding
      template: {
        name: 'loeto_default',
        version: 3,
        shares: [
          { account_id: guide.id, pct: 60 },
          { account_id: homestead.id, pct: 25 },
          { account_id: trust.id, pct: 10 },
          { account_id: platform.id, pct: 5 },
        ],
      },
      ref: 'booking:test',
      idempotencyKey: 'split-1',
    });
    expect(lines.reduce((s, l) => s + l.amount_minor, 0)).toBe(10001);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('reconciliation flags variance on missing, duplicated and malformed provider records', () => {
    const w = world();
    // Two clean postings against the provider account.
    w.p.ledger.providerDeposit({
      providerAccountId: w.providerClearing.id,
      destAccountId: w.kaboWallet.id,
      amountMinor: 700,
      providerTxRef: 'om:1',
      idempotencyKey: 'om-1',
    });
    w.p.ledger.providerDeposit({
      providerAccountId: w.providerClearing.id,
      destAccountId: w.kaboWallet.id,
      amountMinor: 300,
      providerTxRef: 'om:2',
      idempotencyKey: 'om-2',
    });
    const statement = [
      { ref: 'om:1', amount_minor: 700 }, // clean
      { ref: 'om:1', amount_minor: 700 }, // duplicated line
      { ref: 'om:9', amount_minor: 50 }, // provider claims a tx we never saw
      { ref: 'om:2', amount_minor: 999 }, // malformed amount
    ];
    const report = w.p.ledger.reconcile(w.providerClearing.id, statement);
    expect(report.matched).toBe(1);
    expect(report.variance_minor).toBeGreaterThan(0);
    const alarms = w.p.bus.eventsOf('ledger.reconciliation.variance');
    expect(alarms).toHaveLength(1); // the Sev-1 page (§9.2)
  });

  test('payout lifecycle: pending → settled with delivery receipt', () => {
    const w = world();
    const payout = w.p.ledger.requestPayout({
      accountId: w.mmaWallet.id,
      providerAccountId: w.providerClearing.id,
      amountMinor: 2500,
      msisdnRef: 'msisdn:mma',
      ref: 'payout:mma:1',
      idempotencyKey: 'payout-1',
    });
    expect(payout.state).toBe('pending');
    const settled = w.p.ledger.settlePayout(payout.id, 'om-receipt-77');
    expect(settled.state).toBe('settled');
    expect(w.p.bus.eventsOf('ledger.payout.settled')).toHaveLength(1);
    // settling twice is a no-op, not a double payment
    expect(w.p.ledger.settlePayout(payout.id, 'om-receipt-77').state).toBe('settled');
    expect(w.p.bus.eventsOf('ledger.payout.settled')).toHaveLength(1);
  });
});
