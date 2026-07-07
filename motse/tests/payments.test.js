'use strict';

/**
 * Botswana payment integrations: Orange Money, MyZaka, BeMobile Smega.
 * Full lifecycle per provider (C2B, B2C, refunds where supported),
 * webhook forgery/replay/duplicate defences, retry handling, secret
 * rotation, daily reconciliation with variance reporting, fraud hooks.
 */
const { world } = require('./helpers');
const { signPayload } = require('../src/security/replay');

const PROVIDERS = ['orange_money', 'myzaka', 'smega'];

describe.each(PROVIDERS)('%s — full payment lifecycle', (providerName) => {
  test('C2B collection: initiate → signed webhook → wallet credited exactly once', () => {
    const w = world();
    const before = w.p.ledger.balance(w.kaboWallet.id);
    const intent = w.p.payments.collect({
      provider: providerName,
      msisdn: '+26771000002',
      amountMinor: 5000,
      destAccountId: w.kaboWallet.id,
      actorRef: w.kabo.id,
      idempotencyKey: `c2b-${providerName}`,
    });
    expect(intent.state).toBe('pending_provider');
    expect(intent.provider_ref).toBeTruthy();

    const provider = w.p.payments.provider(providerName);
    const webhook = provider.sandboxResolve(intent.provider_ref, 'success');
    const settled = w.p.payments.processWebhook(providerName, webhook.rawBody, webhook.headers);
    expect(settled.state).toBe('completed');
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(before + 5000);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);

    // The operator re-sends the same webhook → duplicate, no double credit.
    const again = provider.sandboxResolve(intent.provider_ref, 'success');
    const dupe = w.p.payments.processWebhook(providerName, again.rawBody, again.headers);
    expect(dupe.duplicate).toBe(true);
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(before + 5000);
  });

  test('B2C payout: funds move to clearing immediately; receipt settles, failure reverses', () => {
    const w = world();
    const start = w.p.ledger.balance(w.mmaWallet.id);

    // Success path.
    const ok = w.p.payments.payout({
      provider: providerName,
      sourceAccountId: w.mmaWallet.id,
      msisdn: '+26771000001',
      amountMinor: 3000,
      actorRef: w.mma.id,
      idempotencyKey: `b2c-ok-${providerName}`,
    });
    expect(w.p.ledger.balance(w.mmaWallet.id)).toBe(start - 3000); // in flight = out of wallet
    const okHook = w.p.payments.provider(providerName).sandboxResolve(ok.provider_ref, 'success');
    const done = w.p.payments.processWebhook(providerName, okHook.rawBody, okHook.headers);
    expect(done.state).toBe('completed');
    expect(w.p.ledger.payouts.get(done.ledger_payout_id).state).toBe('settled');

    // Failure path: operator declines → automatic reversal.
    const bad = w.p.payments.payout({
      provider: providerName,
      sourceAccountId: w.mmaWallet.id,
      msisdn: '+26771000001',
      amountMinor: 2000,
      actorRef: w.mma.id,
      idempotencyKey: `b2c-bad-${providerName}`,
    });
    expect(w.p.ledger.balance(w.mmaWallet.id)).toBe(start - 3000 - 2000);
    const badHook = w.p.payments.provider(providerName).sandboxResolve(bad.provider_ref, 'failure');
    const failed = w.p.payments.processWebhook(providerName, badHook.rawBody, badHook.headers);
    expect(failed.state).toBe('failed');
    expect(w.p.ledger.balance(w.mmaWallet.id)).toBe(start - 3000); // money came back
    expect(w.p.ledger.payouts.get(bad.ledger_payout_id).state).toBe('failed');
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });
});

describe('Webhook defences (§13.2)', () => {
  function completedCollection(w, providerName = 'orange_money') {
    const intent = w.p.payments.collect({
      provider: providerName,
      msisdn: '+26771000002',
      amountMinor: 1000,
      destAccountId: w.kaboWallet.id,
      actorRef: w.kabo.id,
      idempotencyKey: `wh-${providerName}-${Math.random()}`,
    });
    return intent;
  }

  test('forged signature is rejected and counted', () => {
    const w = world();
    const intent = completedCollection(w);
    const provider = w.p.payments.provider('orange_money');
    const hook = provider.sandboxResolve(intent.provider_ref, 'success');
    expect(() =>
      w.p.payments.processWebhook('orange_money', hook.rawBody, {
        ...hook.headers,
        'x-motse-signature': 'deadbeef'.repeat(8),
      })
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    expect(w.p.bus.eventsOf('payments.webhook.rejected').map((e) => e.data.reason)).toContain(
      'bad_signature'
    );
  });

  test('tampered body fails verification (signature covers exact bytes)', () => {
    const w = world();
    const intent = completedCollection(w);
    const hook = w.p.payments.provider('orange_money').sandboxResolve(intent.provider_ref, 'success');
    const tampered = hook.rawBody.replace('1000', '9000');
    expect(() =>
      w.p.payments.processWebhook('orange_money', tampered, hook.headers)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  test('nonce replay and stale timestamps are rejected', () => {
    const w = world();
    const provider = w.p.payments.provider('smega');
    const i1 = w.p.payments.collect({
      provider: 'smega', msisdn: '+2677', amountMinor: 500,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'replay-1',
    });
    const hook = provider.sandboxResolve(i1.provider_ref, 'success', { nonce: 'fixed-nonce' });
    w.p.payments.processWebhook('smega', hook.rawBody, hook.headers);

    // Same nonce on a different (valid) webhook → replay rejection.
    const i2 = w.p.payments.collect({
      provider: 'smega', msisdn: '+2677', amountMinor: 500,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'replay-2',
    });
    const hook2 = provider.sandboxResolve(i2.provider_ref, 'success', { nonce: 'fixed-nonce' });
    expect(() => w.p.payments.processWebhook('smega', hook2.rawBody, hook2.headers)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );

    // Stale timestamp (signed 10 minutes ago) → outside replay window.
    const i3 = w.p.payments.collect({
      provider: 'smega', msisdn: '+2677', amountMinor: 500,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'replay-3',
    });
    const hook3 = provider.sandboxResolve(i3.provider_ref, 'success');
    w.p.clock.advance(10 * 60 * 1000);
    expect(() => w.p.payments.processWebhook('smega', hook3.rawBody, hook3.headers)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
  });

  test('webhook amount must match the intent (operator variance ≠ silent acceptance)', () => {
    const w = world();
    const intent = completedCollection(w, 'myzaka');
    const provider = w.p.payments.provider('myzaka');
    const hook = provider.sandboxResolve(intent.provider_ref, 'success');
    const body = JSON.parse(hook.rawBody);
    body.transAmount = 999999;
    const raw = JSON.stringify(body);
    const ts = w.p.clock.nowMs();
    const headers = {
      'x-motse-signature': signPayload(
        w.p.secrets.current(provider.secretName).value, ts, 'nonce-x', raw
      ),
      'x-motse-timestamp': String(ts),
      'x-motse-nonce': 'nonce-x',
    };
    expect(() => w.p.payments.processWebhook('myzaka', raw, headers)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
  });

  test('secret rotation: previous version still verifies; two rotations later it does not', () => {
    const w = world();
    const provider = w.p.payments.provider('orange_money');
    const intent = completedCollection(w);
    const hook = provider.sandboxResolve(intent.provider_ref, 'success'); // signed with v1

    w.p.secrets.rotate(provider.secretName); // v2 current, v1 still verify-valid
    const settled = w.p.payments.processWebhook('orange_money', hook.rawBody, hook.headers);
    expect(settled.state).toBe('completed');

    const intent2 = completedCollection(w);
    const hook2 = provider.sandboxResolve(intent2.provider_ref, 'success'); // signed with v2
    w.p.secrets.rotate(provider.secretName); // v3
    w.p.secrets.rotate(provider.secretName); // v4 — v2 now out of the verify window
    expect(() =>
      w.p.payments.processWebhook('orange_money', hook2.rawBody, hook2.headers)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });
});

describe('Retry handling & operator lookups', () => {
  test('transient initiate failure retries with backoff and eventually dispatches', () => {
    const w = world();
    const provider = w.p.payments.provider('orange_money');
    provider.faults.failNextInitiate = 1;
    const intent = w.p.payments.collect({
      provider: 'orange_money', msisdn: '+2677', amountMinor: 700,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'retry-1',
    });
    expect(intent.state).toBe('retrying');
    expect(w.p.payments.retryQueue.depth()).toBe(1);

    w.p.clock.advance(2100); // first backoff step
    const drained = w.p.payments.drainRetries();
    expect(drained.ran).toBe(1);
    expect(w.p.payments.intent(intent.id).state).toBe('pending_provider');
  });

  test('persistent failures dead-letter after max attempts and degrade readiness', () => {
    const w = world();
    const provider = w.p.payments.provider('myzaka');
    provider.faults.failNextInitiate = 99;
    w.p.payments.collect({
      provider: 'myzaka', msisdn: '+2677', amountMinor: 700,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'dead-1',
    });
    for (let i = 0; i < 6; i += 1) {
      w.p.clock.advance(60000);
      w.p.payments.drainRetries();
    }
    expect(w.p.payments.retryQueue.deadLetters.length).toBe(1);
    expect(w.p.monitoring.readiness().ready).toBe(false); // ops sees it
  });

  test('verify() syncs a stuck intent when the webhook was lost', () => {
    const w = world();
    const provider = w.p.payments.provider('smega');
    const intent = w.p.payments.collect({
      provider: 'smega', msisdn: '+2677', amountMinor: 1200,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'lookup-1',
    });
    // Operator completed it but the webhook never arrived.
    provider.sandboxResolve(intent.provider_ref, 'success');
    const synced = w.p.payments.verify(intent.id);
    expect(synced.state).toBe('completed');
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('balance check reports the operator float', () => {
    const w = world();
    const balance = w.p.payments.provider('orange_money').balanceCheck();
    expect(balance.provider).toBe('orange_money');
    expect(balance.available_minor).toBeGreaterThan(0);
  });
});

describe('Refunds (capability matrix)', () => {
  function completed(w, providerName) {
    const intent = w.p.payments.collect({
      provider: providerName, msisdn: '+2677', amountMinor: 2500,
      destAccountId: w.kaboWallet.id, actorRef: w.kabo.id,
      idempotencyKey: `ref-src-${providerName}`,
    });
    const hook = w.p.payments.provider(providerName).sandboxResolve(intent.provider_ref, 'success');
    return w.p.payments.processWebhook(providerName, hook.rawBody, hook.headers);
  }

  test('Orange Money refund reverses the deposit on the refund webhook', () => {
    const w = world();
    const original = completed(w, 'orange_money');
    const before = w.p.ledger.balance(w.kaboWallet.id);
    const refund = w.p.payments.refund({
      intentId: original.id, actorRef: w.admin.id, idempotencyKey: 'refund-om-1',
    });
    const hook = w.p.payments.provider('orange_money').sandboxResolve(refund.provider_ref, 'success');
    const done = w.p.payments.processWebhook('orange_money', hook.rawBody, hook.headers);
    expect(done.state).toBe('completed');
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(before - 2500);
    expect(w.p.payments.intent(original.id).state).toBe('refunded');
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('MyZaka has no operator refunds — callers are pointed at B2C payouts', () => {
    const w = world();
    const original = completed(w, 'myzaka');
    expect(() =>
      w.p.payments.refund({ intentId: original.id, actorRef: w.admin.id, idempotencyKey: 'refund-mz' })
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('Daily reconciliation & variance reporting (§9.2)', () => {
  test('a clean day reconciles with zero variance; a missing line raises the alarm', () => {
    const w = world();
    const provider = w.p.payments.provider('smega');
    const refs = [];
    for (let i = 0; i < 3; i += 1) {
      const intent = w.p.payments.collect({
        provider: 'smega', msisdn: '+2677', amountMinor: 1000 + i,
        destAccountId: w.kaboWallet.id, idempotencyKey: `rec-${i}`,
      });
      const hook = provider.sandboxResolve(intent.provider_ref, 'success');
      w.p.payments.processWebhook('smega', hook.rawBody, hook.headers);
      refs.push(intent.provider_ref);
    }
    const clean = w.p.payments.reconcileDaily('smega', w.p.clock.nowIso());
    expect(clean.matched).toBe(3);
    expect(clean.variance_minor).toBe(0);

    // The operator "loses" a settled txn from its statement file.
    provider.faults.omitFromStatement.add(refs[0]);
    const dirty = w.p.payments.reconcileDaily('smega', w.p.clock.nowIso());
    expect(dirty.variance_minor).toBeGreaterThan(0);
    expect(w.p.bus.eventsOf('ledger.reconciliation.variance').length).toBeGreaterThan(0);
    // Runs are persisted for the admin explorer.
    expect(w.p.ledger.reconciliationRuns.count()).toBe(2);
  });
});

describe('Edge cases and error surfaces', () => {
  test('unknown provider, unknown intent, unknown destination are NOT_FOUND', () => {
    const w = world();
    expect(() =>
      w.p.payments.collect({
        provider: 'ecocash', msisdn: 'x', amountMinor: 1,
        destAccountId: w.kaboWallet.id, idempotencyKey: 'e-1',
      })
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() =>
      w.p.payments.collect({
        provider: 'smega', msisdn: 'x', amountMinor: 1,
        destAccountId: 'acc_ghost', idempotencyKey: 'e-2',
      })
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => w.p.payments.intent('pin_ghost')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });

  test('a webhook for a provider ref we never issued is rejected and evented', () => {
    const w = world();
    const provider = w.p.payments.provider('orange_money');
    // Forge a structurally valid, correctly signed webhook for a ghost txn.
    const intent = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 10,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'ghost-src',
    });
    const hook = provider.sandboxResolve(intent.provider_ref, 'success');
    const body = JSON.parse(hook.rawBody);
    body.txnid = 'ORANGE_MONEY-not-ours';
    const raw = JSON.stringify(body);
    const ts = w.p.clock.nowMs();
    const headers = {
      'x-motse-signature': signPayload(
        w.p.secrets.current(provider.secretName).value, ts, 'ghost-n', raw
      ),
      'x-motse-timestamp': String(ts),
      'x-motse-nonce': 'ghost-n',
    };
    expect(() => w.p.payments.processWebhook('orange_money', raw, headers)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
    expect(w.p.bus.eventsOf('payments.webhook.rejected').map((e) => e.data.reason)).toContain(
      'unknown_ref'
    );
  });

  test('refunds only apply to completed collections; idempotent by key', () => {
    const w = world();
    const pending = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 100,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'r-pend',
    });
    expect(() =>
      w.p.payments.refund({ intentId: pending.id, idempotencyKey: 'r-1' })
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
    // Idempotent intents: same key returns the same collection.
    const dup = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 100,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'r-pend',
    });
    expect(dup.id).toBe(pending.id);
  });

  test('provider guards: bad amounts, unknown status lookups, refund without a completed original', () => {
    const w = world();
    const provider = w.p.payments.provider('smega');
    expect(() =>
      provider.initiateCollection({ msisdn: 'x', amountMinor: 10.5, ref: 'r' })
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(provider.getStatus('SMEGA-nope')).toBe('unknown');
    expect(provider.verifyTransaction('SMEGA-nope')).toEqual({ found: false });
    expect(() =>
      provider.initiateRefund({ originalProviderRef: 'SMEGA-nope', amountMinor: 5, ref: 'r' })
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
  });

  test('verify() is a no-op for terminal intents and intents the operator has not resolved', () => {
    const w = world();
    const intent = w.p.payments.collect({
      provider: 'myzaka', msisdn: 'x', amountMinor: 10,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'v-1',
    });
    expect(w.p.payments.verify(intent.id).state).toBe('pending_provider'); // still pending remotely
    const hook = w.p.payments.provider('myzaka').sandboxResolve(intent.provider_ref, 'failure');
    w.p.payments.processWebhook('myzaka', hook.rawBody, hook.headers);
    expect(w.p.payments.verify(intent.id).state).toBe('failed'); // terminal → unchanged
  });
});

describe('Fraud hooks on the payment path', () => {
  test('velocity: the 11th rapid operation is denied outright', () => {
    const w = world();
    for (let i = 0; i < 10; i += 1) {
      w.p.payments.collect({
        provider: 'orange_money', msisdn: '+2677', amountMinor: 100,
        destAccountId: w.kaboWallet.id, actorRef: w.kabo.id,
        idempotencyKey: `velocity-${i}`,
      });
    }
    expect(() =>
      w.p.payments.collect({
        provider: 'orange_money', msisdn: '+2677', amountMinor: 100,
        destAccountId: w.kaboWallet.id, actorRef: w.kabo.id,
        idempotencyKey: 'velocity-11',
      })
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  test('large amounts proceed but open a manual review', () => {
    const w = world();
    w.p.payments.collect({
      provider: 'smega', msisdn: '+2677', amountMinor: 600000, // BWP 6,000
      destAccountId: w.kaboWallet.id, actorRef: w.kabo.id,
      idempotencyKey: 'large-1',
    });
    const reviews = w.p.fraud.openReviews();
    expect(reviews.some((r) => r.check === 'large_amount')).toBe(true);
    const closed = w.p.fraud.closeReview(reviews[0].id, 'verified with member', w.admin.id);
    expect(closed.state).toBe('closed');
  });
});
