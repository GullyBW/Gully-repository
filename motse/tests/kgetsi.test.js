'use strict';

const { world, freshVerifiedUser, fundedWallet, liveCampaign } = require('./helpers');

describe('Kgetsi campaigns & escrow (§9.2)', () => {
  test('lifecycle gates: no going live without endorsement, no contributions before live', () => {
    const w = world();
    const campaign = w.p.kgetsi.open(w.kabo.id, {
      campaignClass: 'community',
      title: 'Borehole',
      targetMinor: 1000,
      milestones: [{ description: 'all', amount_minor: 1000 }],
    });
    expect(() => w.p.kgetsi.goLive(campaign.id, w.admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    expect(() =>
      w.p.kgetsi.contribute(campaign.id, {
        sourceAccountId: w.kaboWallet.id,
        amountMinor: 100,
        contributorRef: w.kabo.id,
        idempotencyKey: 'early-1',
      })
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
  });

  test('release requires evidence AND two DISTINCT L3 approvers', () => {
    const w = world();
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 50000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'fund-1',
    });
    const dest = w.p.ledger.openAccount('usr_builder', 'user_wallet');

    // No evidence yet → blocked.
    expect(() =>
      w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
        destAccountId: dest.id,
        idempotencyKey: 'rel-0',
      })
    ).toThrow(expect.objectContaining({ code: 'ESCROW_RELEASE_BLOCKED' }));

    w.p.kgetsi.submitEvidence(campaign.id, 'm1', w.kabo.id, ['med_receipt_1']);
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', w.admin.id);

    // Same approver twice is rejected — two distinct L3s required.
    expect(() => w.p.kgetsi.approveMilestone(campaign.id, 'm1', w.admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    // One approval is not enough.
    expect(() =>
      w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
        destAccountId: dest.id,
        idempotencyKey: 'rel-1',
      })
    ).toThrow(expect.objectContaining({ code: 'ESCROW_RELEASE_BLOCKED' }));

    const approver2 = freshVerifiedUser(w.p);
    w.p.identity.grantInstitutional(approver2.id, { institution: 'District office' }, 'system:bootstrap');
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', approver2.id);
    w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
      destAccountId: dest.id,
      idempotencyKey: 'rel-2',
    });
    expect(w.p.ledger.balance(dest.id)).toBe(30000); // 60% milestone
  });

  test('released can never exceed funded, even with approvals in hand', () => {
    const w = world();
    const campaign = liveCampaign(w, { targetMinor: 50000 });
    // Only partially funded: 20000 of 50000.
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 20000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'fund-2',
    });
    w.p.kgetsi.submitEvidence(campaign.id, 'm1', w.kabo.id, ['med_r1']);
    const approver2 = freshVerifiedUser(w.p);
    w.p.identity.grantInstitutional(approver2.id, { institution: 'DO' }, 'system:bootstrap');
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', w.admin.id);
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', approver2.id);
    const dest = w.p.ledger.openAccount('usr_builder2', 'user_wallet');
    // m1 is 30000 but only 20000 funded → ledger-level block.
    expect(() =>
      w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
        destAccountId: dest.id,
        idempotencyKey: 'rel-3',
      })
    ).toThrow(expect.objectContaining({ code: 'ESCROW_RELEASE_BLOCKED' }));
  });

  test('medical class: platform fee forced to 0 and provider-direct payout enforced', () => {
    const w = world();
    const campaign = liveCampaign(w, { campaignClass: 'medical', targetMinor: 40000 });
    expect(campaign.platform_fee_pct).toBe(0);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 40000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'fund-med',
    });
    w.p.kgetsi.submitEvidence(campaign.id, 'm1', w.kabo.id, ['med_invoice']);
    const approver2 = freshVerifiedUser(w.p);
    w.p.identity.grantInstitutional(approver2.id, { institution: 'MoH' }, 'system:bootstrap');
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', w.admin.id);
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', approver2.id);

    // Opener's own wallet as destination → blocked (provider-direct).
    expect(() =>
      w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
        destAccountId: w.kaboWallet.id,
        idempotencyKey: 'rel-med-1',
      })
    ).toThrow(expect.objectContaining({ code: 'ESCROW_RELEASE_BLOCKED' }));

    const hospital = w.p.ledger.openAccount('org_gph', 'user_wallet');
    w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
      destAccountId: hospital.id,
      idempotencyKey: 'rel-med-2',
    });
    expect(w.p.ledger.balance(hospital.id)).toBe(24000);
  });

  test('a dispute freezes release but never refunds (§9.2), and resolution unfreezes', () => {
    const w = world();
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 50000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'fund-3',
    });
    w.p.kgetsi.submitEvidence(campaign.id, 'm1', w.kabo.id, ['med_r']);
    const approver2 = freshVerifiedUser(w.p);
    w.p.identity.grantInstitutional(approver2.id, { institution: 'DO' }, 'system:bootstrap');
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', w.admin.id);
    w.p.kgetsi.approveMilestone(campaign.id, 'm1', approver2.id);

    const dispute = w.p.governance.openDispute(`campaign:${campaign.id}`, w.mma.id, 'fake need?');
    const dest = w.p.ledger.openAccount('usr_b3', 'user_wallet');
    expect(() =>
      w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
        destAccountId: dest.id,
        idempotencyKey: 'rel-4',
      })
    ).toThrow(expect.objectContaining({ code: 'ESCROW_RELEASE_BLOCKED' }));

    // Refunds still process while frozen.
    w.p.kgetsi.refundContribution(campaign.id, {
      destAccountId: w.kaboWallet.id,
      amountMinor: 1000,
      idempotencyKey: 'refund-1',
      actorRef: w.admin.id,
    });
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(51000); // 100000 - 50000 + 1000

    w.p.governance.resolveDispute(dispute.id, 'need verified by ward office', w.admin.id);
    w.p.kgetsi.releaseMilestone(campaign.id, 'm1', w.admin.id, {
      destAccountId: dest.id,
      idempotencyKey: 'rel-5',
    });
    expect(w.p.ledger.balance(dest.id)).toBe(30000);
  });

  test('public ledger projection exposes exactly the money trail (§7.3)', () => {
    const w = world();
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 12345,
      contributorRef: null, // anonymous giving is supported (P10)
      idempotencyKey: 'anon-1',
    });
    const publicLedger = w.p.kgetsi.publicLedger(campaign.id);
    expect(publicLedger.funded_minor).toBe(12345);
    expect(publicLedger.postings).toHaveLength(1);
    expect(publicLedger.milestones).toHaveLength(2);
    // The projection carries no donor identity for anonymous gifts —
    // but the posting itself exists: anonymous spending is impossible.
    expect(JSON.stringify(publicLedger)).not.toContain(w.kabo.id);
  });
});
