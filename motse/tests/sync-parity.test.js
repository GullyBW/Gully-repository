'use strict';

/**
 * Offline suites (doc §17): capture → 7-day gap → replay; conflict
 * fixtures; USSD/app parity assertions.
 */
const { world, liveCampaign } = require('./helpers');

describe('Offline outbox replay (§8)', () => {
  test('a 7-day-old batch replays cleanly and re-sending it changes nothing', () => {
    const w = world();
    const ward = w.ward;
    const letsema = w.p.kgotla.createLetsema(ward.id, w.mma.id, {
      title: 'Molapo clearing',
      date: '2026-07-20',
    });
    const campaign = liveCampaign(w);

    // Mutations captured on-device, then a week offline (clock skew suite).
    const batch = [
      {
        id: 'uuid-1',
        aggregate_ref: `letsema:${letsema.id}`,
        seq: 1,
        command: 'kgotla.join_letsema',
        args: { letsema_id: letsema.id, idempotency_key: 'ob-join-1' },
      },
      {
        id: 'uuid-2',
        aggregate_ref: `campaign:${campaign.id}`,
        seq: 1,
        command: 'kgetsi.contribute',
        args: {
          campaign_id: campaign.id,
          source_account_id: w.kaboWallet.id,
          amount_minor: 800,
          idempotency_key: 'ob-give-1',
        },
      },
      {
        id: 'uuid-3',
        aggregate_ref: `campaign:${campaign.id}`,
        seq: 2,
        command: 'kgetsi.contribute',
        args: {
          campaign_id: campaign.id,
          source_account_id: w.kaboWallet.id,
          amount_minor: 200,
          idempotency_key: 'ob-give-2',
        },
      },
    ];
    w.p.clock.advance(7 * 24 * 3600 * 1000); // the connectivity gap

    const withActor = batch.map((m) => ({ ...m, actor_ref: w.kabo.id }));
    const outcomes = w.p.sync.replay(withActor);
    expect(outcomes.map((o) => o.status)).toEqual(['applied', 'applied', 'applied']);
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(99000);

    // The device never got the ack and re-sends the whole batch.
    const again = w.p.sync.replay(withActor);
    expect(again.map((o) => o.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(99000); // exactly once
  });

  test('replay is strictly ordered per aggregate even if the batch arrives shuffled', () => {
    const w = world();
    const campaign = liveCampaign(w);
    const shuffled = [
      {
        id: 'uuid-b',
        aggregate_ref: `campaign:${campaign.id}`,
        seq: 2,
        actor_ref: w.kabo.id,
        command: 'kgetsi.contribute',
        args: {
          campaign_id: campaign.id,
          source_account_id: w.kaboWallet.id,
          amount_minor: 2,
          idempotency_key: 'ord-2',
        },
      },
      {
        id: 'uuid-a',
        aggregate_ref: `campaign:${campaign.id}`,
        seq: 1,
        actor_ref: w.kabo.id,
        command: 'kgetsi.contribute',
        args: {
          campaign_id: campaign.id,
          source_account_id: w.kaboWallet.id,
          amount_minor: 1,
          idempotency_key: 'ord-1',
        },
      },
    ];
    const outcomes = w.p.sync.replay(shuffled);
    expect(outcomes.map((o) => o.id)).toEqual(['uuid-a', 'uuid-b']); // seq order
  });

  test('true conflicts surface as reconciliation cards, never silent overwrites', () => {
    const w = world();
    const { publishedItem } = require('./helpers');
    const item = publishedItem(w, { title: 'Original title' });
    // Someone else edits the title while our client is offline.
    w.p.heritage.items.update(item.id, { title: 'Edited by cousin' });

    const outcomes = w.p.sync.replay([
      {
        id: 'uuid-c',
        aggregate_ref: `heritage:${item.id}`,
        seq: 1,
        actor_ref: w.mma.id,
        command: 'heritage.update_title',
        args: { item_id: item.id, base_title: 'Original title', title: 'My offline edit' },
      },
    ]);
    expect(outcomes[0].status).toBe('conflict');
    expect(outcomes[0].card).toMatchObject({
      kind: 'reconciliation_card',
      field: 'title',
      yours: 'My offline edit',
      theirs: 'Edited by cousin',
    });
    // Nothing was overwritten.
    expect(w.p.heritage.items.get(item.id).title).toBe('Edited by cousin');
  });
});

describe('USSD / SMS parity (§8, §12, P9)', () => {
  test('a letsema signup from a Nokia brick is indistinguishable from the app server-side', () => {
    const w = world();
    const letsema = w.p.kgotla.createLetsema(w.ward.id, w.mma.id, {
      title: 'Kgotla roof repair',
      date: '2026-08-01',
    });

    // Via app (service call), via USSD, via SMS — three users.
    w.p.kgotla.joinLetsema(letsema.id, w.kabo.id, { channel: 'app', idempotencyKey: 'app-1' });

    const menu = w.p.ussd.handle({ sessionId: 'at-1', msisdn: '+26771888001', text: '' });
    expect(menu.response).toContain('Letsema');
    w.p.ussd.handle({ sessionId: 'at-1', msisdn: '+26771888001', text: '1' });
    const joined = w.p.ussd.handle({
      sessionId: 'at-1',
      msisdn: '+26771888001',
      text: `1*${letsema.short_code}`,
    });
    expect(joined.end).toBe(true);
    expect(joined.response).toContain('Joined');

    const sms = w.p.sms.handleInbound('+26771888002', `LETSEMA JOIN ${letsema.short_code}`, 'msg-1');
    expect(sms.reply).toContain('Joined');

    const participants = w.p.kgotla.letsemas.get(letsema.id).participants;
    expect(participants).toHaveLength(3);
    // Parity: identical participant records except the analytics channel tag.
    const shapes = participants.map((p) => Object.keys(p).sort().join(','));
    expect(new Set(shapes).size).toBe(1);

    // Operator retry of the same USSD input does not double-join.
    w.p.ussd.handle({ sessionId: 'at-1', msisdn: '+26771888001', text: `1*${letsema.short_code}` });
    expect(w.p.kgotla.letsemas.get(letsema.id).participants).toHaveLength(3);
  });

  test('USSD giving debits the same wallet the app sees', () => {
    const w = world();
    const campaign = liveCampaign(w);
    // kabo dials in from his feature phone — same MSISDN, same account.
    const give = w.p.ussd.handle({
      sessionId: 'at-2',
      msisdn: '+26771000002',
      text: `3*${campaign.id}*25`,
    });
    expect(give.end).toBe(true);
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(100000 - 2500);
    expect(w.p.kgetsi.publicLedger(campaign.id).funded_minor).toBe(2500);
  });

  test('notices and civic alerts fan out to ward residents over SMS', () => {
    const w = world();
    w.p.kgotla.publishNotice(w.ward.id, w.headman.id, {
      title: 'Kgotla meeting Saturday',
      body: 'All residents',
    });
    const log = w.p.store.collection('sms_outbound').find();
    expect(log.length).toBeGreaterThanOrEqual(1); // mma is a ward resident
    expect(log[0].body).toContain('NOTICE');
  });

  test('USSD sessions expire after the operator TTL', () => {
    const w = world();
    w.p.ussd.handle({ sessionId: 'at-3', msisdn: '+26771888003', text: '' });
    expect(w.p.ussd.sessions.get('at-3')).toBeDefined();
    w.p.clock.advance(121 * 1000);
    // Next hit re-authenticates rather than reusing the stale session.
    const fresh = w.p.ussd.handle({ sessionId: 'at-3', msisdn: '+26771888003', text: '' });
    expect(fresh.end).toBe(false);
  });
});
