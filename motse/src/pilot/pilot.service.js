'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Pilot management (Phase 2, WS7): controlled community rollouts.
 *
 * A pilot binds a district's villages/wards to a rollout stage and a
 * flag profile. Stage transitions are audited and gated:
 *   planned → onboarding → live → scaled | paused (paused ⇄ live)
 * Going live REQUIRES at least one enrolled ward and one pilot admin —
 * a community is onboarded by people, not by a config push.
 *
 * Module availability rides the flag service: enrolling a ward sets the
 * pilot's flag profile at ward scope, so features light up per-ward
 * exactly as doc §16 prescribes.
 */
const STAGES = ['planned', 'onboarding', 'live', 'scaled', 'paused'];
const STAGE_TRANSITIONS = {
  planned: ['onboarding'],
  onboarding: ['live', 'paused'],
  live: ['scaled', 'paused'],
  paused: ['live'],
  scaled: ['paused'],
};

class PilotService {
  constructor({ store, clock, identity, kgotla, flags, audit, bus, analytics = null }) {
    this.pilots = store.collection('pilots');
    this.villages = store.collection('pilot_villages');
    this.feedback = store.collection('pilot_feedback');
    this.clock = clock;
    this.identity = identity;
    this.kgotla = kgotla;
    this.flags = flags;
    this.audit = audit;
    this.bus = bus;
    this.analytics = analytics;

    bus.register('pilot.stage.changed', 1, ['pilot_id', 'stage']);
    bus.register('pilot.ward.enrolled', 1, ['pilot_id', 'ward_ref']);
  }

  bindAnalytics(analytics) {
    this.analytics = analytics;
  }

  // ── Pilot lifecycle ────────────────────────────────────────────────

  create({ name, district, flagProfile = {} }, actor) {
    if (!name || !district) throw err('INVALID_ARGUMENT', 'name and district are required');
    const pilot = this.pilots.insert({
      id: id('plt'),
      name,
      district,
      stage: 'planned',
      ward_refs: [],
      morafe_refs: [],
      admins: [],
      flag_profile: { ...flagProfile }, // key -> value applied per enrolled ward
      created_by: actor,
      created_at: this.clock.nowIso(),
      stage_history: [{ stage: 'planned', at: this.clock.nowIso(), by: actor }],
    });
    this.audit.append(actor, 'pilot.created', `pilot:${pilot.id}`, null, { name, district });
    return pilot;
  }

  get(pilotId) {
    const pilot = this.pilots.get(pilotId);
    if (!pilot) throw err('NOT_FOUND', `No pilot ${pilotId}`);
    return pilot;
  }

  advanceStage(pilotId, nextStage, actor) {
    const pilot = this.get(pilotId);
    if (!STAGES.includes(nextStage)) {
      throw err('INVALID_ARGUMENT', `stage must be one of ${STAGES.join('|')}`);
    }
    if (!STAGE_TRANSITIONS[pilot.stage].includes(nextStage)) {
      throw err('STATE_CONFLICT', `Cannot move ${pilot.stage} → ${nextStage}`);
    }
    if (nextStage === 'live') {
      if (pilot.ward_refs.length === 0) {
        throw err('STATE_CONFLICT', 'A pilot needs at least one enrolled ward to go live');
      }
      if (pilot.admins.length === 0) {
        throw err('STATE_CONFLICT', 'A pilot needs at least one administrator to go live');
      }
    }
    const updated = this.pilots.update(pilotId, {
      stage: nextStage,
      stage_history: [...pilot.stage_history, { stage: nextStage, at: this.clock.nowIso(), by: actor }],
    });
    this.audit.append(actor, 'pilot.stage_changed', `pilot:${pilotId}`,
      { stage: pilot.stage }, { stage: nextStage });
    this.bus.publish('pilot.stage.changed', { pilot_id: pilotId, stage: nextStage });
    return updated;
  }

  // ── Community onboarding ───────────────────────────────────────────

  /** Register a village (and its ward if new) under a pilot's district. */
  registerVillage(pilotId, { name, wardName, headmanMsisdn }, actor) {
    const pilot = this.get(pilotId);
    const ward = this.kgotla.createWard({ district: pilot.district, name: wardName || name });
    let headmanRef = null;
    if (headmanMsisdn) {
      const headman = this.identity.findOrCreateByMsisdn(headmanMsisdn);
      this.identity.grantInstitutional(
        headman.id,
        { institution: `Headman office ${ward.name}` },
        actor === 'system:bootstrap' ? actor : actor
      );
      this.identity.grantRole(headman.id, 'headman_office', `ward:${ward.id}`, actor);
      headmanRef = headman.id;
      this.kgotla.wards.update(ward.id, { headman_office_ref: headman.id });
    }
    const village = this.villages.insert({
      id: id('vil'),
      pilot_id: pilotId,
      name,
      ward_ref: ward.id,
      headman_ref: headmanRef,
      registered_at: this.clock.nowIso(),
    });
    this.audit.append(actor, 'pilot.village_registered', `pilot:${pilotId}`, null, {
      village: name,
      ward_ref: ward.id,
    });
    this.enrollWard(pilotId, ward.id, actor);
    return { village, ward };
  }

  /** Enroll an existing ward: applies the pilot's flag profile per-ward. */
  enrollWard(pilotId, wardRef, actor) {
    const pilot = this.get(pilotId);
    if (pilot.ward_refs.includes(wardRef)) return pilot;
    const updated = this.pilots.update(pilotId, { ward_refs: [...pilot.ward_refs, wardRef] });
    for (const [key, value] of Object.entries(pilot.flag_profile)) {
      this.flags.set(key, `ward:${wardRef}`, value, actor);
    }
    this.audit.append(actor, 'pilot.ward_enrolled', `pilot:${pilotId}`, null, { ward_ref: wardRef });
    this.bus.publish('pilot.ward.enrolled', { pilot_id: pilotId, ward_ref: wardRef });
    return updated;
  }

  /**
   * Enroll a whole morafe (Phase 3, WS3): apply the flag profile at
   * morafe scope so every member of that people sees the pilot's
   * modules regardless of which ward they live in.
   */
  enrollMorafe(pilotId, morafeRef, actor) {
    const pilot = this.get(pilotId);
    const morafeRefs = pilot.morafe_refs || [];
    if (morafeRefs.includes(morafeRef)) return pilot;
    const updated = this.pilots.update(pilotId, { morafe_refs: [...morafeRefs, morafeRef] });
    for (const [key, value] of Object.entries(pilot.flag_profile)) {
      this.flags.set(key, `morafe:${morafeRef}`, value, actor);
    }
    this.audit.append(actor, 'pilot.morafe_enrolled', `pilot:${pilotId}`, null, { morafe_ref: morafeRef });
    return updated;
  }

  /**
   * Rollback (Phase 3, WS3): unwind a pilot — remove every flag override
   * it set at ward/morafe scope and move the pilot to 'paused'. The
   * community's data is untouched; only the rollout is reversed. This is
   * the safety valve the brief asks for when a pilot goes wrong.
   */
  rollback(pilotId, actor, reason) {
    const pilot = this.get(pilotId);
    for (const wardRef of pilot.ward_refs) {
      for (const key of Object.keys(pilot.flag_profile)) {
        this.flags.unset(key, `ward:${wardRef}`, actor);
      }
    }
    for (const morafeRef of pilot.morafe_refs || []) {
      for (const key of Object.keys(pilot.flag_profile)) {
        this.flags.unset(key, `morafe:${morafeRef}`, actor);
      }
    }
    const updated = this.pilots.update(pilotId, {
      stage: 'paused',
      rolled_back: { at: this.clock.nowIso(), by: actor, reason: reason || null },
      stage_history: [...pilot.stage_history, { stage: 'paused', at: this.clock.nowIso(), by: actor, note: 'rollback' }],
    });
    this.audit.append(actor, 'pilot.rolled_back', `pilot:${pilotId}`, { stage: pilot.stage }, {
      stage: 'paused',
      reason,
    });
    this.bus.publish('pilot.stage.changed', { pilot_id: pilotId, stage: 'paused' });
    return updated;
  }

  /** Community feedback collection (Phase 3, WS3). */
  submitFeedback(pilotId, { userRef, category = 'general', message, rating }) {
    this.get(pilotId);
    return this.feedback.insert({
      id: id('fbk'),
      pilot_id: pilotId,
      user_ref: userRef || null,
      category, // general | bug | request | support
      message,
      rating: rating || null,
      state: category === 'support' ? 'open' : 'received',
      created_at: this.clock.nowIso(),
    });
  }

  feedbackFor(pilotId) {
    return this.feedback.find((f) => f.pilot_id === pilotId);
  }

  /** Assign a pilot administrator: L3 + pilot_admin(pilot:X) role. */
  assignAdmin(pilotId, userRef, actor) {
    const pilot = this.get(pilotId);
    this.identity.requireLevel(userRef, 'L3');
    if (!pilot.admins.includes(userRef)) {
      this.pilots.update(pilotId, { admins: [...pilot.admins, userRef] });
      this.identity.grantRole(userRef, 'pilot_admin', `pilot:${pilotId}`, actor);
      this.audit.append(actor, 'pilot.admin_assigned', `pilot:${pilotId}`, null, { user_ref: userRef });
    }
    return this.get(pilotId);
  }

  // ── Health & reporting ─────────────────────────────────────────────

  /** Live health snapshot for the pilot dashboard. */
  health(pilotId) {
    const pilot = this.get(pilotId);
    const wardSet = new Set(pilot.ward_refs);
    const residents = this.identity.users.find((u) => wardSet.has(u.ward_ref));
    const byLevel = { L0: 0, L1: 0, L2: 0, L3: 0 };
    for (const user of residents) byLevel[user.level] += 1;
    const letsemas = this.kgotla.letsemas.find((l) => wardSet.has(l.ward_ref));
    const notices = this.kgotla.notices.find((n) => wardSet.has(n.ward_ref));
    return {
      pilot_id: pilotId,
      stage: pilot.stage,
      wards: pilot.ward_refs.length,
      villages: this.villages.count((v) => v.pilot_id === pilotId),
      admins: pilot.admins.length,
      residents: residents.length,
      residents_by_level: byLevel,
      letsemas: letsemas.length,
      letsema_participants: letsemas.reduce((s, l) => s + l.participants.length, 0),
      notices: notices.length,
      flags: Object.keys(pilot.flag_profile),
    };
  }

  /**
   * Live pilot dashboard (Phase 3, WS3): the seven operational metrics
   * the brief names, computed across the pilot's wards.
   */
  liveDashboard(pilotId) {
    const pilot = this.get(pilotId);
    const wardSet = new Set(pilot.ward_refs);
    const residents = this.identity.users.find((u) => wardSet.has(u.ward_ref));
    const residentIds = new Set(residents.map((u) => u.id));

    const verified = residents.filter((u) => u.level !== 'L0' && u.level !== 'L1').length;
    const phoneVerified = residents.filter((u) => u.level !== 'L0').length;

    // Donations & bookings by pilot members.
    const p = this.analytics ? this.analytics.platform : null;
    let donations = 0;
    let bookings = 0;
    let paymentSuccess = null;
    if (p) {
      donations = p.kgetsi.campaigns
        .find()
        .reduce(
          (sum, c) =>
            sum +
            (p.ledger.postingsFor(`campaign:${c.id}`) || []).filter((post) =>
              post.entries.some((e) => {
                const acct = p.ledger.accounts.get(e.account_id);
                return acct && residentIds.has(acct.owner_ref);
              })
            ).length,
          0
        );
      bookings = p.loeto.bookings.find((b) => residentIds.has(b.guest_ref)).length;
      const memberIntents = p.payments.intents.find((i) => residentIds.has(i.actor_ref));
      const completed = memberIntents.filter((i) => i.state === 'completed').length;
      paymentSuccess = memberIntents.length
        ? Math.round((completed / memberIntents.length) * 100)
        : null;
    }
    const support = this.feedback.find(
      (f) => f.pilot_id === pilotId && f.category === 'support'
    );

    return {
      pilot_id: pilotId,
      stage: pilot.stage,
      registration_completion: {
        residents: residents.length,
        phone_verified: phoneVerified,
        completion_pct: residents.length ? Math.round((phoneVerified / residents.length) * 100) : 0,
      },
      identity_verification_rate: {
        verified_l2_plus: verified,
        rate_pct: residents.length ? Math.round((verified / residents.length) * 100) : 0,
      },
      donation_activity: { contributions: donations },
      booking_activity: { bookings },
      offline_sync: { mutations_applied: p ? p.sync.applied.size : 0 },
      payment_success: { success_pct: paymentSuccess },
      support_requests: {
        total: support.length,
        open: support.filter((f) => f.state === 'open').length,
      },
    };
  }

  /** Narrative report for stakeholders: health + stage history + usage. */
  report(pilotId) {
    const pilot = this.get(pilotId);
    const health = this.health(pilotId);
    const usage = this.analytics
      ? this.analytics.pilotUsage(pilot.ward_refs)
      : null;
    return {
      generated_at: this.clock.nowIso(),
      pilot: {
        id: pilot.id,
        name: pilot.name,
        district: pilot.district,
        stage: pilot.stage,
        stage_history: pilot.stage_history,
      },
      health,
      usage,
    };
  }

  list() {
    return this.pilots.find();
  }
}

module.exports = { PilotService, STAGES };
