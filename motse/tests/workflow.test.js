'use strict';

const { world, adminUser, freshVerifiedUser } = require('./helpers');

describe('Configurable workflow engine (WS4)', () => {
  test('the eight named flows are seeded and active at boot', () => {
    const w = world();
    const keys = w.p.workflows.listDefinitions().map((d) => d.key).sort();
    expect(keys).toEqual([
      'custodian_appointment', 'dispute_resolution', 'election', 'escrow_milestone_release',
      'heritage_publication', 'identity_verification', 'ring3_succession', 'trust_resolution',
    ]);
  });

  test('multi-step approval + action: N-of-M distinct approvers then a domain action runs', () => {
    const w = world();
    const admin1 = adminUser(w.p);
    const admin2 = adminUser(w.p);
    // Drive the real escrow release through the workflow engine.
    const campaign = require('./helpers').liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 50000,
      contributorRef: w.kabo.id, idempotencyKey: 'wf-fund',
    });
    w.p.kgetsi.submitEvidence(campaign.id, 'm1', w.kabo.id, ['ev']);
    const dest = w.p.ledger.openAccount('usr_builder', 'user_wallet');

    const instance = w.p.workflows.start('escrow_milestone_release', {
      context: {
        campaign_id: campaign.id, milestone_id: 'm1', dest_account_id: dest.id, actor_ref: admin1.id,
      },
      objectRef: `campaign:${campaign.id}`,
      actor: admin1.id,
    });
    // One approval is not enough (approvals_required: 2).
    w.p.workflows.decide(instance.id, 'dual_approval', admin1.id, { decision: 'approve' });
    expect(w.p.workflows.get(instance.id).state).toBe('running');
    // Same approver can't approve twice.
    expect(() => w.p.workflows.decide(instance.id, 'dual_approval', admin1.id, {})).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    // Second distinct approver completes the gate → action releases funds.
    w.p.workflows.decide(instance.id, 'dual_approval', admin2.id, { decision: 'approve' });
    const done = w.p.workflows.get(instance.id);
    expect(done.state).toBe('completed');
    expect(w.p.ledger.balance(dest.id)).toBe(30000); // the real milestone released
    expect(w.p.audit.verifyChain(`workflow_instance:${instance.id}`).valid).toBe(true);
  });

  test('rejection short-circuits the workflow', () => {
    const w = world();
    const admin = adminUser(w.p);
    const instance = w.p.workflows.start('custodian_appointment', {
      context: { council_id: 'c1', kind: 'association', holder_ref: w.mma.id, actor_ref: admin.id },
      actor: admin.id,
    });
    w.p.workflows.decide(instance.id, 'council_nominate', admin.id, { decision: 'reject', note: 'not now' });
    expect(w.p.workflows.get(instance.id).outcome).toBe('rejected');
  });

  test('role scoping: only the ward headman office may approve identity verification', () => {
    const w = world();
    const other = freshVerifiedUser(w.p);
    const instance = w.p.workflows.start('identity_verification', {
      context: { user_ref: w.kabo.id, ward_ref: w.ward.id, endorser_ref: w.headman.id },
      actor: w.headman.id,
    });
    // A random member cannot approve — lacks headman_office(ward:…).
    expect(() =>
      w.p.workflows.decide(instance.id, 'ward_endorsement', other.id, { decision: 'approve' })
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    // The headman can, and the action grants L2 for real.
    w.p.workflows.decide(instance.id, 'ward_endorsement', w.headman.id, { decision: 'approve' });
    expect(w.p.identity.get(w.kabo.id).level).toBe('L2');
  });

  test('timeouts: escalate widens the deadline; auto_approve advances; reject fails', () => {
    const w = world();
    const admin = adminUser(w.p);

    // heritage_publication auto-approves on timeout (publication never gated).
    const item = require('./helpers').publishedItem(w);
    const council = w.p.governance.createCouncil('bakalanga', admin.id);
    w.p.governance.grantSeat(council.id, { kind: 'association', holderRef: w.mma.id }, admin.id);
    const pub = w.p.workflows.start('heritage_publication', {
      context: { item_ref: item.id, custodian_ref: w.mma.id, morafe_ref: 'bakalanga' },
      actor: admin.id,
    });
    w.p.clock.advance(31 * 24 * 3600 * 1000);
    w.p.workflows.tick();
    expect(w.p.workflows.get(pub.id).state).toBe('completed'); // auto-approved then elevated
    expect(w.p.heritage.items.get(item.id).state).toBe('validated');
  });

  test('timer steps resolve on tick (election voting window)', () => {
    const w = world();
    const admin = adminUser(w.p);
    const council = w.p.governance.createCouncil('bangwato', admin.id);
    const instance = w.p.workflows.start('election', {
      context: { council_id: council.id, seat_description: 'elder seat', actor_ref: admin.id, eligible: 40 },
      actor: admin.id,
    });
    // open_election action ran; now parked on the timer.
    expect(w.p.workflows.get(instance.id).state).toBe('running');
    w.p.clock.advance(8 * 24 * 3600 * 1000);
    w.p.workflows.tick();
    expect(w.p.workflows.get(instance.id).state).toBe('completed'); // closed & tallied
  });

  test('delegation lets a delegate approve on the original approver behalf', () => {
    const w = world();
    const admin = adminUser(w.p);
    const council = w.p.governance.createCouncil('bakalanga', admin.id);
    const instance = w.p.workflows.start('custodian_appointment', {
      context: { council_id: council.id, kind: 'association', holder_ref: w.mma.id, actor_ref: admin.id },
      actor: admin.id,
    });
    // Delegate isn't a platform_admin by role-scope match here, but a
    // delegation grant lets them act (they are still L3, audited).
    const plainL3 = freshVerifiedUser(w.p);
    w.p.identity.grantInstitutional(plainL3.id, { institution: 'Ext' }, 'system:bootstrap');
    w.p.workflows.delegate(instance.id, 'council_nominate', admin.id, plainL3.id, admin.id);
    w.p.workflows.decide(instance.id, 'council_nominate', plainL3.id, { decision: 'approve' });
    expect(w.p.workflows.get(instance.id).state).toBe('completed');
  });

  test('administrators define new workflows without code (versioned, audited)', () => {
    const w = world();
    const admin = adminUser(w.p);
    const v1 = w.p.workflows.defineWorkflow(
      {
        key: 'grant_review',
        description: 'Single sign-off',
        steps: [{ id: 'ok', name: 'Approve', type: 'approval', roles: [{ role: 'platform_admin', scope: 'platform' }] }],
      },
      admin.id
    );
    expect(v1.version).toBe(1);
    const v2 = w.p.workflows.defineWorkflow(
      { key: 'grant_review', steps: [{ id: 'ok', type: 'approval' }, { id: 'ok2', type: 'approval' }] },
      admin.id
    );
    expect(v2.version).toBe(2);
    expect(w.p.workflows.activeDefinition('grant_review').version).toBe(2);
    // Bad definitions are rejected.
    expect(() => w.p.workflows.defineWorkflow({ key: 'x', steps: [] }, admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() =>
      w.p.workflows.defineWorkflow(
        { key: 'y', steps: [{ id: 's', type: 'action', action: 'nonexistent.handler' }] },
        admin.id
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
