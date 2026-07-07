'use strict';

const { world, publishedItem, fundedWallet } = require('./helpers');

describe('Loeto bookings & splits (§9.3)', () => {
  function experienceWorld() {
    const w = world();
    const guide = w.p.ledger.openAccount('usr_guide', 'user_wallet');
    const homestead = w.p.ledger.openAccount('usr_homestead', 'user_wallet');
    const communityTrust = w.p.ledger.openAccount('trust_khama', 'community_trust');
    const platformFees = w.p.ledger.openAccount('motse', 'platform_fees');
    const experience = w.p.loeto.createExperience(w.mma.id, {
      title: 'Tsodilo rock art walk',
      priceMinor: 35001, // awkward on purpose — rounding must still sum
      splitTemplate: {
        name: 'loeto_default',
        version: 1,
        shares: [
          { account_id: guide.id, pct: 60, label: 'guide' },
          { account_id: homestead.id, pct: 25, label: 'homestead' },
          { account_id: communityTrust.id, pct: 10, label: 'community trust' },
          { account_id: platformFees.id, pct: 5, label: 'platform' },
        ],
      },
    });
    return { w, experience, guide, homestead, communityTrust, platformFees };
  }

  test('booking creates escrow; settlement executes the split atomically with visible lines', () => {
    const { w, experience, guide, homestead, communityTrust, platformFees } = experienceWorld();
    const booking = w.p.loeto.book(experience.id, w.kabo.id, {
      sourceAccountId: w.kaboWallet.id,
      idempotencyKey: 'book-1',
    });
    expect(booking.state).toBe('paid');
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(100000 - 35001);

    const settled = w.p.loeto.settle(booking.id, w.mma.id, { idempotencyKey: 'settle-1' });
    expect(settled.state).toBe('settled');
    const total = settled.split_lines.reduce((s, l) => s + l.amount_minor, 0);
    expect(total).toBe(35001); // splits sum exactly (§17 money tests)
    expect(w.p.ledger.balance(guide.id)).toBe(21001); // 60% + rounding remainder
    expect(w.p.ledger.balance(homestead.id)).toBe(8750);
    expect(w.p.ledger.balance(communityTrust.id)).toBe(3500);
    expect(w.p.ledger.balance(platformFees.id)).toBe(1750);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
    // Every beneficiary sees their line (§9.3).
    expect(settled.split_lines.map((l) => l.label)).toEqual([
      'guide',
      'homestead',
      'community trust',
      'platform',
    ]);
  });

  test('settlement is idempotent and cancellation refunds in full', () => {
    const { w, experience } = experienceWorld();
    const b1 = w.p.loeto.book(experience.id, w.kabo.id, {
      sourceAccountId: w.kaboWallet.id,
      idempotencyKey: 'book-2',
    });
    w.p.loeto.settle(b1.id, w.mma.id, { idempotencyKey: 'settle-2' });
    expect(() => w.p.loeto.settle(b1.id, w.mma.id, { idempotencyKey: 'settle-2b' })).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );

    const b2 = w.p.loeto.book(experience.id, w.kabo.id, {
      sourceAccountId: w.kaboWallet.id,
      idempotencyKey: 'book-3',
    });
    const before = w.p.ledger.balance(w.kaboWallet.id);
    w.p.loeto.cancel(b2.id, w.kabo.id, {
      destAccountId: w.kaboWallet.id,
      idempotencyKey: 'cancel-1',
    });
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(before + 35001);
    expect(w.p.loeto.get(b2.id).state).toBe('cancelled');
  });

  test('a split template that does not sum to 100 can never take a booking', () => {
    const w = world();
    expect(() =>
      w.p.loeto.createExperience(w.mma.id, {
        title: 'bad math tour',
        priceMinor: 1000,
        splitTemplate: {
          name: 'broken',
          version: 1,
          shares: [{ account_id: 'acc_x', pct: 99 }],
        },
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('Puo lessons & correction payouts (§7.2)', () => {
  test('lessons are derivations that inherit restriction from the source (P5)', () => {
    const w = world();
    const course = w.p.puo.createCourse(w.mma.id, { title: 'Ikalanga 101', language: 'ik', level: 'A1' });
    const restrictedSource = publishedItem(w, { visibility: 'members' });
    const lesson = w.p.puo.deriveLesson(course.id, w.mma.id, {
      sourceItemRef: restrictedSource.id,
      level: 'A1',
    });
    expect(lesson.source_item_ref).toBe(restrictedSource.id); // reference, not copy
    expect(lesson.visibility).toBe('members');
    // Non-member learner cannot read the lesson: the source's gate follows it.
    expect(() => w.p.puo.readLesson(lesson.id, w.kabo.id)).toThrow(
      expect.objectContaining({ code: 'MEMBERSHIP_REQUIRED' })
    );
  });

  test('a non-member teacher cannot even derive from a restricted item (fail closed)', () => {
    const w = world();
    const course = w.p.puo.createCourse(w.mma.id, { title: 'X', language: 'tn', level: 'A1' });
    // Transfer course to kabo is not possible; make kabo a teacher instead.
    const restricted = publishedItem(w, { visibility: 'members' });
    // kabo (not a bakalanga member) with his own course:
    w.p.identity.endorseWardResidency(w.kabo.id, w.ward.id, w.headman.id); // L2 for course creation
    const kaboCourse = w.p.puo.createCourse(w.kabo.id, { title: 'Y', language: 'tn', level: 'A1' });
    expect(() =>
      w.p.puo.deriveLesson(kaboCourse.id, w.kabo.id, { sourceItemRef: restricted.id, level: 'A1' })
    ).toThrow(expect.objectContaining({ code: 'MEMBERSHIP_REQUIRED' }));
  });

  test('teacher correction triggers the payout posting on shared rails', () => {
    const w = world();
    const course = w.p.puo.createCourse(w.mma.id, { title: 'Setswana', language: 'tn', level: 'A2' });
    const source = publishedItem(w);
    const lesson = w.p.puo.deriveLesson(course.id, w.mma.id, { sourceItemRef: source.id, level: 'A2' });
    const thread = w.p.puo.openThread(lesson.id, w.kabo.id, {
      teacherRef: w.mma.id,
      learnerAudioRef: 'med_learner_take',
      priceMinor: 1500,
    });
    const updated = w.p.puo.submitCorrection(thread.id, w.mma.id, {
      teacherAudioRef: 'med_teacher_reply',
      learnerAccountId: w.kaboWallet.id,
      teacherAccountId: w.mmaWallet.id,
      idempotencyKey: 'corr-1',
    });
    expect(updated.state).toBe('corrected');
    expect(w.p.ledger.balance(w.mmaWallet.id)).toBe(101500);
    expect(w.p.bus.eventsOf('puo.correction.paid')).toHaveLength(1);
  });
});

describe('Lelapa life-event ledgers & Letlole trusts', () => {
  test('savings goals are real escrows; the goal ledger shows real postings (P3)', () => {
    const w = world();
    const circle = w.p.lelapa.createCircle(w.kabo.id, 'Ba ga Mokoena');
    w.p.lelapa.addMember(circle.id, w.mma.id, w.kabo.id);
    const goal = w.p.lelapa.createSavingsGoal(circle.id, w.kabo.id, {
      name: 'wedding',
      targetMinor: 20000,
    });
    w.p.lelapa.contribute(goal.id, w.kabo.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 5000,
      idempotencyKey: 'goal-1',
    });
    w.p.lelapa.contribute(goal.id, w.mma.id, {
      sourceAccountId: w.mmaWallet.id,
      amountMinor: 7000,
      idempotencyKey: 'goal-2',
    });
    const ledgerView = w.p.lelapa.goalLedger(goal.id);
    expect(ledgerView.funded_minor).toBe(12000);
    expect(ledgerView.postings).toHaveLength(2);
  });

  test('trust resolutions execute distributions only at trustee quorum, on the audit log', () => {
    const w = world();
    const trusteeB = w.p.identity.registerAnonymous('dev-tb');
    const trust = w.p.letlole.registerTrust(w.admin.id, {
      name: 'Khama Rhino Trust',
      deedDocRef: 'doc_deed',
      trustees: [w.admin.id, trusteeB.id, w.headman.id],
    });
    // Fund the treasury.
    w.p.ledger.providerDeposit({
      providerAccountId: w.providerClearing.id,
      destAccountId: trust.treasury_account_id,
      amountMinor: 90000,
      providerTxRef: 'grant:1',
      idempotencyKey: 'grant-1',
    });
    const beneficiary = w.p.ledger.openAccount('usr_beneficiary', 'user_wallet');
    const resolution = w.p.letlole.proposeResolution(trust.id, w.admin.id, {
      title: 'Q3 distribution',
      body: 'Pay school fees',
      kind: 'distribution',
      distribution: { dest_account_id: beneficiary.id, amount_minor: 30000 },
    });
    expect(resolution.quorum).toBe(2);
    w.p.letlole.signResolution(trust.id, resolution.id, w.admin.id);
    expect(w.p.ledger.balance(beneficiary.id)).toBe(0); // one signature: nothing moves
    const executed = w.p.letlole.signResolution(trust.id, resolution.id, trusteeB.id);
    expect(executed.state).toBe('executed');
    expect(w.p.ledger.balance(beneficiary.id)).toBe(30000);
    // Signatures are on the hash-chained audit log (§7.2 :sign).
    expect(w.p.audit.verifyChain(`resolution:${resolution.id}`).valid).toBe(true);

    // Opt-in public treasury (§7.3).
    expect(() => w.p.letlole.publicTreasury(trust.id)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
    w.p.letlole.setTreasuryPublic(trust.id, w.admin.id, true);
    expect(w.p.letlole.publicTreasury(trust.id).balance_minor).toBe(60000);
  });
});
