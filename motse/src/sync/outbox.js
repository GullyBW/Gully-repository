'use strict';

const { err } = require('../kernel/errors');

/**
 * Offline-first synchronisation (doc §8).
 *
 * Client mutations queue in an on-device outbox with client-generated
 * UUIDs, per-aggregate monotonic sequence numbers, and Idempotency-Keys.
 * This service is the server side of replay:
 *
 *  - strictly ordered per aggregate (sorted by seq before execution);
 *  - tolerant of days-long gaps (replay safety comes from the command
 *    registry routing through the same idempotent services the online
 *    API uses — a mutation lands exactly once);
 *  - true conflicts surface as reconciliation cards, never silent
 *    overwrites; append-only lists merge deterministically.
 */
class OutboxSyncService {
  constructor(platform) {
    this.platform = platform;
    this.applied = new Map(); // mutation client uuid -> recorded outcome

    // Command registry: the SAME service methods the online API calls.
    this.commands = {
      'kgotla.join_letsema': (actor, args) =>
        platform.kgotla.joinLetsema(args.letsema_id, actor, {
          channel: args.channel || 'app-offline',
          idempotencyKey: args.idempotency_key,
        }),
      'kgetsi.contribute': (actor, args) =>
        platform.kgetsi.contribute(args.campaign_id, {
          sourceAccountId: args.source_account_id,
          amountMinor: args.amount_minor,
          contributorRef: actor,
          idempotencyKey: args.idempotency_key,
        }),
      'ledger.transfer': (actor, args) =>
        platform.ledger.transfer({
          source: args.source,
          dest: args.dest,
          amountMinor: args.amount_minor,
          purpose: args.purpose || 'p2p_transfer',
          ref: args.ref || `outbox:${args.idempotency_key}`,
          idempotencyKey: args.idempotency_key,
          actorRef: actor,
        }),
      'lelapa.contribute_goal': (actor, args) =>
        platform.lelapa.contribute(args.goal_id, actor, {
          sourceAccountId: args.source_account_id,
          amountMinor: args.amount_minor,
          idempotencyKey: args.idempotency_key,
        }),
      'heritage.submit': (actor, args) =>
        platform.heritage.submit(actor, {
          type: args.type,
          narratorRef: args.narrator_ref,
          morafeRef: args.morafe_ref,
          villageRef: args.village_ref,
          visibility: args.visibility,
          consentRef: args.consent_ref,
          mediaRefs: args.media_refs,
          title: args.title,
        }),
      // Trivially-mergeable field: last-writer-wins ONLY when the base
      // matches; otherwise a reconciliation card (§8 conflict policy).
      'heritage.update_title': (actor, args) => {
        const item = platform.heritage.items.get(args.item_id);
        if (!item) throw err('NOT_FOUND', `No heritage item ${args.item_id}`);
        if (item.title !== args.base_title && item.title !== args.title) {
          return {
            conflict: true,
            card: {
              kind: 'reconciliation_card',
              item_id: args.item_id,
              field: 'title',
              yours: args.title,
              theirs: item.title,
              base: args.base_title,
            },
          };
        }
        return platform.heritage.items.update(args.item_id, { title: args.title });
      },
    };
  }

  /**
   * Replay a batch. mutations: [{ id (client uuid), aggregate_ref, seq,
   * actor_ref, command, args }]. Returns one outcome per mutation, in a
   * deterministic order (aggregate, then seq).
   */
  replay(mutations) {
    const ordered = [...mutations].sort(
      (a, b) =>
        String(a.aggregate_ref).localeCompare(String(b.aggregate_ref)) || a.seq - b.seq
    );
    const outcomes = [];
    for (const mutation of ordered) {
      outcomes.push(this._applyOne(mutation));
    }
    return outcomes;
  }

  _applyOne(mutation) {
    const { id: clientId, command, actor_ref: actor, args } = mutation;
    if (!clientId) {
      return { id: null, status: 'rejected', error: 'client uuid required' };
    }
    if (this.applied.has(clientId)) {
      // Exactly-once from the client's perspective, no matter how many
      // times the batch is re-sent after a connectivity gap.
      return { ...this.applied.get(clientId), status: 'duplicate' };
    }
    const handler = this.commands[command];
    if (!handler) {
      return { id: clientId, status: 'rejected', error: `unknown command ${command}` };
    }
    let outcome;
    try {
      const result = handler(actor, args || {});
      outcome =
        result && result.conflict
          ? { id: clientId, status: 'conflict', card: result.card }
          : { id: clientId, status: 'applied', result };
    } catch (e) {
      if (e.code === 'IDEMPOTENT_REPLAY') {
        outcome = { id: clientId, status: 'duplicate' };
      } else {
        outcome = {
          id: clientId,
          status: 'rejected',
          error: e.code || 'INTERNAL',
          domain_reason: e.domainReason || e.message,
          retryable: e.retryable === true,
        };
      }
    }
    // Conflicts are NOT memoised: the user resolves the card and the
    // client re-sends; everything else is final for this uuid.
    if (outcome.status !== 'conflict') this.applied.set(clientId, outcome);
    return outcome;
  }
}

module.exports = { OutboxSyncService };
