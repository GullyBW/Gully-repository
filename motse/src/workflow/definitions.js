'use strict';

/**
 * Seed workflow definitions (Phase 3, WS4) for the eight approval flows
 * named in the brief. These mirror the platform's existing hardcoded
 * rules as DATA so administrators can reconfigure steps, thresholds,
 * timeouts and escalation without code changes. Loaded at boot; editable
 * live via the admin API.
 *
 * `scope_from` resolves an approver scope from the instance context
 * (e.g. context.morafe_ref → custodian(morafe:<ref>)).
 */
const SEED_WORKFLOWS = [
  {
    key: 'identity_verification',
    description: 'Ward endorsement to L2 (single headman-office approval)',
    steps: [
      {
        id: 'ward_endorsement',
        name: 'Headman office endorsement',
        type: 'approval',
        approvals_required: 1,
        roles: [{ role: 'headman_office', scope_from: 'ward_ref', scope_prefix: 'ward:' }],
        timeout_ms: 14 * 24 * 3600 * 1000,
        on_timeout: 'escalate',
        escalate_to: { role: 'platform_admin', scope: 'platform' },
      },
      { id: 'apply', name: 'Grant L2', type: 'action', action: 'identity.grant_l2' },
    ],
  },
  {
    key: 'heritage_publication',
    description: 'Optional custodian review before elevation (publication itself never blocks)',
    steps: [
      {
        id: 'custodian_review',
        name: 'Custodian validation',
        type: 'approval',
        approvals_required: 1,
        roles: [{ role: 'custodian', scope_from: 'morafe_ref', scope_prefix: 'morafe:' }],
        timeout_ms: 30 * 24 * 3600 * 1000,
        on_timeout: 'auto_approve', // publication is never gated (§10.1)
      },
      { id: 'apply', name: 'Elevate', type: 'action', action: 'heritage.elevate' },
    ],
  },
  {
    key: 'custodian_appointment',
    description: 'Council seat grant with platform confirmation',
    steps: [
      {
        id: 'council_nominate',
        name: 'Council nomination',
        type: 'approval',
        approvals_required: 1,
        roles: [{ role: 'platform_admin', scope: 'platform' }],
      },
      { id: 'apply', name: 'Grant seat', type: 'action', action: 'governance.grant_seat' },
    ],
  },
  {
    key: 'ring3_succession',
    description: 'Ring-3 succession freeze (immediate on dispute, panel to resolve)',
    steps: [
      { id: 'freeze', name: 'Freeze seat', type: 'action', action: 'governance.freeze_seat' },
      {
        id: 'panel',
        name: 'Ring-2 panel resolution',
        type: 'approval',
        approvals_required: 2,
        roles: [{ role: 'platform_admin', scope: 'platform' }],
        timeout_ms: 90 * 24 * 3600 * 1000,
        on_timeout: 'escalate',
        escalate_to: { role: 'platform_admin', scope: 'platform' },
      },
    ],
  },
  {
    key: 'escrow_milestone_release',
    description: 'Dual distinct L3 approval, then release (mirrors Kgetsi §9.2)',
    steps: [
      {
        id: 'dual_approval',
        name: 'Two distinct L3 approvers',
        type: 'approval',
        approvals_required: 2,
        min_level: 'L3',
        roles: [{ role: 'platform_admin', scope: 'platform' }],
      },
      { id: 'release', name: 'Release milestone', type: 'action', action: 'kgetsi.release_milestone' },
    ],
  },
  {
    key: 'trust_resolution',
    description: 'Trustee quorum e-sign (mirrors Letlole)',
    steps: [
      {
        id: 'quorum',
        name: 'Trustee quorum',
        type: 'approval',
        approvals_required: 2,
        roles: [{ role: 'trustee', scope_from: 'trust_ref', scope_prefix: 'trust:' }],
      },
      { id: 'execute', name: 'Execute resolution', type: 'action', action: 'letlole.execute_resolution' },
    ],
  },
  {
    key: 'election',
    description: 'Elder election open → tally window → close',
    steps: [
      { id: 'open', name: 'Open election', type: 'action', action: 'governance.open_election' },
      { id: 'voting_window', name: 'Voting window', type: 'timer', timeout_ms: 7 * 24 * 3600 * 1000 },
      { id: 'close', name: 'Close and tally', type: 'action', action: 'governance.close_election' },
    ],
  },
  {
    key: 'dispute_resolution',
    description: 'Ring 1 (council, 30d SLA) → Ring 2 panel',
    steps: [
      {
        id: 'ring1',
        name: 'Ring 1 — council',
        type: 'approval',
        approvals_required: 1,
        roles: [{ role: 'custodian', scope_from: 'morafe_ref', scope_prefix: 'morafe:' }],
        timeout_ms: 30 * 24 * 3600 * 1000,
        on_timeout: 'escalate',
        escalate_to: { role: 'platform_admin', scope: 'platform' },
      },
      {
        id: 'ring2',
        name: 'Ring 2 — panel',
        type: 'approval',
        approvals_required: 2,
        roles: [{ role: 'platform_admin', scope: 'platform' }],
        condition: { field: 'escalated', op: 'eq', value: true },
      },
      { id: 'resolve', name: 'Record resolution', type: 'action', action: 'governance.resolve_dispute' },
    ],
  },
];

module.exports = { SEED_WORKFLOWS };
