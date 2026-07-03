'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Kgetsi — campaigns, endorsements, milestones, public ledger (doc §9.2).
 *
 * Campaign states:  draft → endorsed → live → funded → completing → closed | frozen
 * Milestone states: pending → evidence_submitted → approved(dual) → released → receipted
 *
 * Invariants (release gates, enforced here + in the escrow layer):
 *  - released ≤ funded;
 *  - release REQUIRES evidence_refs[] + two distinct L3 approvers;
 *  - medical class: provider-direct payout preferred, platform fee forced to 0;
 *  - freeze blocks release, never refunds.
 */
const CAMPAIGN_CLASSES = ['community', 'institutional', 'individual', 'medical'];

class KgetsiService {
  constructor({ store, clock, identity, ledger, escrow, audit, bus, governance }) {
    this.campaigns = store.collection('campaigns');
    this.clock = clock;
    this.identity = identity;
    this.ledger = ledger;
    this.escrow = escrow;
    this.audit = audit;
    this.bus = bus;
    this.governance = governance;

    bus.register('kgetsi.campaign.live', 1, ['campaign_id']);
    bus.register('kgetsi.contribution.received', 1, ['campaign_id', 'amount_minor']);
    bus.register('kgetsi.milestone.released', 1, ['campaign_id', 'milestone_id', 'amount_minor']);

    // Dispute rings freeze/unfreeze campaign escrows automatically.
    bus.subscribe('governance.dispute.opened', 'kgetsi-freeze', (event) =>
      this._onDispute(event.data.object_ref, true)
    );
    bus.subscribe('governance.dispute.resolved', 'kgetsi-freeze', (event) =>
      this._onDispute(event.data.object_ref, false)
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  open(openerRef, { campaignClass, title, targetMinor, milestones }) {
    this.identity.requireLevel(openerRef, 'L1');
    if (!CAMPAIGN_CLASSES.includes(campaignClass)) {
      throw err('INVALID_ARGUMENT', `class must be one of ${CAMPAIGN_CLASSES.join('|')}`);
    }
    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw err('INVALID_ARGUMENT', 'Campaigns need at least one milestone');
    }
    const totalMilestones = milestones.reduce((s, m) => s + m.amount_minor, 0);
    if (totalMilestones !== targetMinor) {
      throw err('INVALID_ARGUMENT', `Milestones sum to ${totalMilestones}, target is ${targetMinor}`);
    }
    const campaign = this.campaigns.insert({
      id: id('cmp'),
      class: campaignClass,
      opener_ref: openerRef,
      title,
      target_minor: targetMinor,
      // Medical campaigns carry zero platform fee (§9.2).
      platform_fee_pct: campaignClass === 'medical' ? 0 : 5,
      endorsements: [],
      milestones: milestones.map((m, i) => ({
        id: `m${i + 1}`,
        description: m.description,
        amount_minor: m.amount_minor,
        state: 'pending',
        evidence_refs: [],
        approvals: [],
      })),
      state: 'draft',
      escrow_id: null,
      created_at: this.clock.nowIso(),
    });
    this.audit.append(openerRef, 'kgetsi.opened', `campaign:${campaign.id}`, null, {
      class: campaignClass,
      target_minor: targetMinor,
    });
    return campaign;
  }

  /** Endorsement chain: L3 institutional endorsers move draft → endorsed. */
  endorse(campaignId, endorserRef, note) {
    const campaign = this._mustGet(campaignId);
    this.identity.requireLevel(endorserRef, 'L3');
    if (!['draft', 'endorsed'].includes(campaign.state)) {
      throw err('STATE_CONFLICT', `Cannot endorse from ${campaign.state}`);
    }
    if (campaign.endorsements.some((e) => e.endorser_ref === endorserRef)) {
      return campaign;
    }
    const updated = this.campaigns.update(campaignId, {
      endorsements: [
        ...campaign.endorsements,
        { endorser_ref: endorserRef, note: note || null, ts: this.clock.nowIso() },
      ],
      state: 'endorsed',
    });
    this.audit.append(endorserRef, 'kgetsi.endorsed', `campaign:${campaignId}`, null, { note });
    return updated;
  }

  /** Going live opens the ring-fenced escrow (custody account). */
  goLive(campaignId, actorRef) {
    const campaign = this._mustGet(campaignId);
    if (campaign.state !== 'endorsed') {
      throw err('STATE_CONFLICT', 'Campaign must be endorsed before going live');
    }
    const escrow = this.escrow.open(`campaign:${campaignId}`, campaign.opener_ref);
    const updated = this.campaigns.update(campaignId, { state: 'live', escrow_id: escrow.id });
    this.audit.append(actorRef, 'kgetsi.live', `campaign:${campaignId}`, { state: 'endorsed' }, { state: 'live' });
    this.bus.publish('kgetsi.campaign.live', { campaign_id: campaignId });
    return updated;
  }

  /**
   * Give. Anonymous giving is supported (P10): contributorRef may be
   * null — the money trail still exists, only the donor label is absent.
   */
  contribute(campaignId, { sourceAccountId, amountMinor, contributorRef, idempotencyKey }) {
    const campaign = this._mustGet(campaignId);
    if (!['live', 'funded'].includes(campaign.state)) {
      throw err('STATE_CONFLICT', `Campaign not accepting contributions in ${campaign.state}`);
    }
    if (contributorRef) this.identity.requireLevel(contributorRef, 'L1');
    const posting = this.escrow.fund(campaign.escrow_id, {
      sourceAccountId,
      amountMinor,
      contributorRef,
      idempotencyKey,
    });
    const funded = this.escrow.get(campaign.escrow_id).funded_minor;
    if (funded >= campaign.target_minor && campaign.state === 'live') {
      this.campaigns.update(campaignId, { state: 'funded' });
    }
    this.bus.publish('kgetsi.contribution.received', {
      campaign_id: campaignId,
      amount_minor: amountMinor,
      contributor_ref: contributorRef || 'anonymous',
      posting_id: posting.id,
    });
    return posting;
  }

  // ── Milestones (§9.2) ──────────────────────────────────────────────

  submitEvidence(campaignId, milestoneId, submitterRef, evidenceRefs) {
    const { campaign, milestone } = this._milestone(campaignId, milestoneId);
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
      throw err('INVALID_ARGUMENT', 'evidence_refs[] is required');
    }
    if (!['pending', 'evidence_submitted'].includes(milestone.state)) {
      throw err('STATE_CONFLICT', `Cannot submit evidence from ${milestone.state}`);
    }
    this._patchMilestone(campaign, milestoneId, {
      state: 'evidence_submitted',
      evidence_refs: [...milestone.evidence_refs, ...evidenceRefs],
    });
    this.audit.append(submitterRef, 'kgetsi.evidence_submitted', `campaign:${campaignId}#${milestoneId}`,
      null, { evidence_refs: evidenceRefs });
    return this._mustGet(campaignId);
  }

  /** Dual approval: two distinct L3 approvers (§9.2). */
  approveMilestone(campaignId, milestoneId, approverRef) {
    const { campaign, milestone } = this._milestone(campaignId, milestoneId);
    this.identity.requireLevel(approverRef, 'L3');
    if (milestone.state !== 'evidence_submitted' && milestone.state !== 'approved') {
      throw err('ESCROW_RELEASE_BLOCKED', 'Evidence must be submitted before approval');
    }
    if (milestone.approvals.includes(approverRef)) {
      throw err('STATE_CONFLICT', 'Approver already approved — two DISTINCT approvers required');
    }
    const approvals = [...milestone.approvals, approverRef];
    this._patchMilestone(campaign, milestoneId, {
      approvals,
      state: approvals.length >= 2 ? 'approved' : 'evidence_submitted',
    });
    this.audit.append(approverRef, 'kgetsi.milestone_approved', `campaign:${campaignId}#${milestoneId}`,
      null, { approvals: approvals.length });
    return this._mustGet(campaignId);
  }

  /**
   * POST /v1/kgetsi/campaigns/{id}/milestones/{m}:release
   * Ledger-side invariants (released ≤ funded, frozen) enforce again in
   * the escrow layer — defence in depth.
   */
  releaseMilestone(campaignId, milestoneId, actorRef, { destAccountId, idempotencyKey }) {
    const { campaign, milestone } = this._milestone(campaignId, milestoneId);
    if (campaign.state === 'frozen') {
      throw err('ESCROW_RELEASE_BLOCKED', 'Campaign frozen by an open dispute');
    }
    if (milestone.state !== 'approved') {
      throw err('ESCROW_RELEASE_BLOCKED', 'Milestone lacks evidence or dual approval', {
        milestone_state: milestone.state,
        approvals: milestone.approvals.length,
      });
    }
    // Medical class prefers provider-direct payout: destination must be
    // a registered provider account, not the opener's wallet (§9.2).
    if (campaign.class === 'medical') {
      const dest = this.ledger.accounts.get(destAccountId);
      if (!dest || dest.owner_ref === campaign.opener_ref) {
        throw err('ESCROW_RELEASE_BLOCKED', 'Medical releases pay the provider directly');
      }
    }
    const posting = this.escrow.release(campaign.escrow_id, {
      destAccountId,
      amountMinor: milestone.amount_minor,
      ref: `campaign:${campaignId}#${milestoneId}`,
      idempotencyKey,
      actorRef,
    });
    this._patchMilestone(this._mustGet(campaignId), milestoneId, { state: 'released' });
    this.audit.append(actorRef, 'kgetsi.milestone_released', `campaign:${campaignId}#${milestoneId}`,
      null, { amount_minor: milestone.amount_minor, posting_id: posting.id });
    this.bus.publish('kgetsi.milestone.released', {
      campaign_id: campaignId,
      milestone_id: milestoneId,
      amount_minor: milestone.amount_minor,
    });
    this._maybeComplete(campaignId, actorRef);
    return posting;
  }

  receiptMilestone(campaignId, milestoneId, receiptRef, actorRef) {
    const { campaign, milestone } = this._milestone(campaignId, milestoneId);
    if (milestone.state !== 'released') throw err('STATE_CONFLICT', 'Milestone not released');
    this._patchMilestone(campaign, milestoneId, { state: 'receipted', receipt_ref: receiptRef });
    this.audit.append(actorRef, 'kgetsi.milestone_receipted', `campaign:${campaignId}#${milestoneId}`,
      null, { receipt_ref: receiptRef });
    return this._mustGet(campaignId);
  }

  /** Refunds keep processing while frozen (§9.2). */
  refundContribution(campaignId, { destAccountId, amountMinor, idempotencyKey, actorRef }) {
    const campaign = this._mustGet(campaignId);
    return this.escrow.refund(campaign.escrow_id, {
      destAccountId,
      amountMinor,
      ref: `campaign:${campaignId}:refund`,
      idempotencyKey,
      actorRef,
    });
  }

  // ── Public transparency (§7.3) ─────────────────────────────────────

  /**
   * The public campaign ledger: rebuilt from ledger events, exactly the
   * data the app renders — verifiable by journalists and funders.
   */
  publicLedger(campaignId) {
    const campaign = this._mustGet(campaignId);
    const escrowState = campaign.escrow_id ? this.escrow.get(campaign.escrow_id) : null;
    const postings = this.ledger
      .postingsFor(`campaign:${campaignId}`)
      .concat(
        campaign.milestones.flatMap((m) =>
          this.ledger.postingsFor(`campaign:${campaignId}#${m.id}`)
        )
      );
    return {
      campaign_id: campaignId,
      class: campaign.class,
      state: campaign.state,
      target_minor: campaign.target_minor,
      funded_minor: escrowState ? escrowState.funded_minor : 0,
      released_minor: escrowState ? escrowState.released_minor : 0,
      refunded_minor: escrowState ? escrowState.refunded_minor : 0,
      platform_fee_pct: campaign.platform_fee_pct,
      milestones: campaign.milestones.map((m) => ({
        id: m.id,
        description: m.description,
        amount_minor: m.amount_minor,
        state: m.state,
        approvals: m.approvals.length,
        evidence_count: m.evidence_refs.length,
      })),
      postings: postings.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        ts: p.ts,
        entries: p.entries,
      })),
    };
  }

  // ── Internals ──────────────────────────────────────────────────────

  _onDispute(objectRef, freeze) {
    if (!objectRef.startsWith('campaign:')) return;
    const campaignId = objectRef.split(':')[1].split('#')[0];
    const campaign = this.campaigns.get(campaignId);
    if (!campaign || !campaign.escrow_id) return;
    this.escrow.setFrozen(campaign.escrow_id, freeze);
    if (freeze) {
      this.campaigns.update(campaignId, { state: 'frozen', pre_freeze_state: campaign.state });
    } else if (campaign.state === 'frozen') {
      this.campaigns.update(campaignId, { state: campaign.pre_freeze_state || 'live' });
    }
  }

  _maybeComplete(campaignId, actorRef) {
    const campaign = this._mustGet(campaignId);
    const allDone = campaign.milestones.every((m) => ['released', 'receipted'].includes(m.state));
    if (allDone && ['funded', 'live', 'completing'].includes(campaign.state)) {
      this.campaigns.update(campaignId, { state: 'closed' });
      this.audit.append(actorRef, 'kgetsi.closed', `campaign:${campaignId}`, null, { state: 'closed' });
    }
  }

  _patchMilestone(campaign, milestoneId, patch) {
    this.campaigns.update(campaign.id, {
      milestones: campaign.milestones.map((m) => (m.id === milestoneId ? { ...m, ...patch } : m)),
    });
  }

  _milestone(campaignId, milestoneId) {
    const campaign = this._mustGet(campaignId);
    const milestone = campaign.milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw err('NOT_FOUND', `No milestone ${milestoneId}`);
    return { campaign, milestone };
  }

  _mustGet(campaignId) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw err('NOT_FOUND', `No campaign ${campaignId}`);
    return campaign;
  }
}

module.exports = { KgetsiService, CAMPAIGN_CLASSES };
