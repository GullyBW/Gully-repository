'use strict';

const express = require('express');
const { createPlatform } = require('./container');
const { MotseError } = require('./kernel/errors');
const { paginate, applyFieldMask } = require('./kernel/pagination');
const { id } = require('./kernel/ids');
const { AuditLog } = require('./platform/governance/auditLog');

/**
 * API gateway + /v1 surface (doc §7).
 *
 * Gateway responsibilities modelled here: authentication, idempotency
 * enforcement (Idempotency-Key required on every mutation, 48h dedupe),
 * problem-details errors with trace ids, cursor pagination and field
 * masks. Note: the doc writes custom verbs Google-style (:validate);
 * this implementation mounts them as trailing path segments
 * (/items/{id}/validate) — same contract, Express-friendly syntax.
 */
function createApp(platform = createPlatform()) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Trace ids end-to-end (§16 observability).
  app.use((req, res, next) => {
    req.traceId = req.get('X-Trace-Id') || id('trc');
    res.set('X-Trace-Id', req.traceId);
    next();
  });

  // ── Gateway: idempotency enforcement (§7.1) ────────────────────────
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.use('/v1', (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const key = req.get('Idempotency-Key');
    if (!key) return next(new MotseError('IDEMPOTENCY_KEY_REQUIRED'));
    req.idemKey = key;
    const cacheKey = `http:${req.method}:${req.path}:${key}`;
    const cached = platform.idempotency.getCached(cacheKey);
    if (cached) {
      res.set('Idempotent-Replay', 'true');
      return res.status(cached.status).json(cached.body);
    }
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 500) {
        platform.idempotency.putCached(cacheKey, { status: res.statusCode, body });
      }
      return json(body);
    };
    next();
  });

  // ── Gateway: authentication (§7.1) ─────────────────────────────────
  const auth = (req, res, next) => {
    try {
      const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
      const claims = platform.identity.verifyAccess(token, {
        deviceId: req.get('X-Device-Id'),
      });
      req.actor = claims.sub;
      next();
    } catch (e) {
      next(e);
    }
  };
  const authOptional = (req, res, next) => {
    const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
    if (!token) return next();
    return auth(req, res, next);
  };

  const run = (handler) => (req, res, next) => {
    try {
      const result = handler(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (e) {
      next(e);
    }
  };

  app.get('/health', (req, res) =>
    res.json({ ok: true, service: 'motse-core', trial_balance: platform.ledger.trialBalance() })
  );

  // ── Identity (§5) ──────────────────────────────────────────────────
  app.post('/v1/identity/otp', run((req) => platform.identity.requestOtp(req.body.msisdn)));
  app.post('/v1/identity/otp/verify', run((req) =>
    platform.identity.verifyOtp(req.body.msisdn, req.body.code, {
      deviceId: req.get('X-Device-Id'),
      userId: req.body.user_id,
    })
  ));
  app.post('/v1/identity/sessions/refresh', run((req) =>
    platform.identity.refreshSession(req.body.refresh_token)
  ));
  app.post('/v1/identity/users/:id/ward-endorsement', auth, run((req) =>
    platform.identity.endorseWardResidency(req.params.id, req.body.ward_ref, req.actor)
  ));

  // ── Ledger (§9) ────────────────────────────────────────────────────
  app.post('/v1/ledger/accounts', auth, run((req) =>
    platform.ledger.openAccount(req.actor, req.body.type || 'user_wallet')
  ));
  app.post('/v1/ledger/transfers', auth, run((req) =>
    platform.ledger.transfer({
      source: req.body.source,
      dest: req.body.dest,
      amountMinor: req.body.amount_minor,
      purpose: req.body.purpose || 'p2p_transfer',
      ref: req.body.ref || `transfer:${req.idemKey}`,
      idempotencyKey: req.idemKey,
      actorRef: req.actor,
    })
  ));
  app.get('/v1/ledger/accounts/:id/balance', auth, run((req) => ({
    account_id: req.params.id,
    balance_minor: platform.ledger.balance(req.params.id),
  })));

  // ── Heritage (§7.2, §10.1) ─────────────────────────────────────────
  app.post('/v1/heritage/consents', auth, run((req) =>
    platform.heritage.recordConsent({
      subjectRef: req.body.subject_ref,
      spokenAudioRef: req.body.spoken_audio_ref,
      language: req.body.language,
      scope: req.body.scope,
    })
  ));
  app.post('/v1/heritage/items', auth, run((req) =>
    platform.heritage.submit(req.actor, {
      type: req.body.type,
      narratorRef: req.body.narrator_ref,
      morafeRef: req.body.morafe_ref,
      villageRef: req.body.village_ref,
      visibility: req.body.visibility,
      consentRef: req.body.consent_ref,
      mediaRefs: req.body.media_refs,
      title: req.body.title,
    })
  ));
  app.post('/v1/heritage/items/:id/publish', auth, run((req) =>
    platform.heritage.publish(req.params.id, req.actor)
  ));
  app.post('/v1/heritage/items/:id/validate', auth, run((req) =>
    platform.heritage.validate(req.params.id, req.actor, {
      decision: req.body.decision,
      note: req.body.note,
    })
  ));
  app.post('/v1/heritage/items/:id/contest', auth, run((req) =>
    platform.heritage.contest(req.params.id, req.actor, req.body.summary)
  ));
  app.get('/v1/heritage/items/:id', authOptional, run((req) =>
    applyFieldMask(platform.heritage.read(req.params.id, req.actor), req.query.fields)
  ));
  app.get('/v1/heritage/search', run((req) =>
    paginate(applyFieldMask(platform.heritage.publicSearchIndex(), req.query.fields), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));
  app.get('/v1/morafe/:id/feed', authOptional, run((req) =>
    paginate(platform.heritage.feed(req.params.id, req.actor), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));

  // ── Media (§6.3) ───────────────────────────────────────────────────
  app.post('/v1/media/uploads', auth, run((req) =>
    platform.media.createUploadSession(req.actor, {
      type: req.body.type,
      mediaClass: req.body.media_class,
      totalBytes: req.body.total_bytes,
    })
  ));
  app.post('/v1/media/uploads/:id/chunks', auth, run((req) =>
    platform.media.appendChunk(req.params.id, req.body.offset, req.body.bytes || '')
  ));
  app.post('/v1/media/uploads/:id/complete', auth, run((req) =>
    platform.media.completeUpload(req.params.id, {
      contentDigest: req.body.content_digest,
      noDerivativesNoTraining: req.body.no_derivatives_no_training,
    })
  ));
  app.get('/v1/media/:id/url', authOptional, run((req) => {
    const item = platform.media.get(req.params.id);
    const attested =
      item.media_class === 'restricted' && req.actor
        ? platform.identity.attestMembership(
            req.actor,
            (platform.heritage.items.findOne((h) => h.media_refs.includes(item.id)) || {}).morafe_ref
          )
        : false;
    return platform.media.signUrl(req.params.id, {
      identityRef: req.actor,
      membershipAttested: attested,
    });
  }));

  // ── Kgotla (§3.2) ──────────────────────────────────────────────────
  app.post('/v1/kgotla/wards', auth, run((req) => platform.kgotla.createWard(req.body)));
  app.post('/v1/kgotla/wards/:id/notices', auth, run((req) =>
    platform.kgotla.publishNotice(req.params.id, req.actor, req.body)
  ));
  app.get('/v1/kgotla/wards/:id/notices', run((req) =>
    paginate(platform.kgotla.noticesFor(req.params.id), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));
  app.post('/v1/kgotla/wards/:id/letsemas', auth, run((req) =>
    platform.kgotla.createLetsema(req.params.id, req.actor, req.body)
  ));
  app.post('/v1/kgotla/letsemas/:id/join', auth, run((req) =>
    platform.kgotla.joinLetsema(req.params.id, req.actor, {
      channel: 'app',
      idempotencyKey: req.idemKey,
    })
  ));
  app.post('/v1/kgotla/wards/:id/alerts', auth, run((req) =>
    platform.kgotla.publishAlert(req.params.id, req.actor, req.body)
  ));

  // ── Kgetsi (§9.2) ──────────────────────────────────────────────────
  app.post('/v1/kgetsi/campaigns', auth, run((req) =>
    platform.kgetsi.open(req.actor, {
      campaignClass: req.body.class,
      title: req.body.title,
      targetMinor: req.body.target_minor,
      milestones: req.body.milestones,
    })
  ));
  app.post('/v1/kgetsi/campaigns/:id/endorse', auth, run((req) =>
    platform.kgetsi.endorse(req.params.id, req.actor, req.body.note)
  ));
  app.post('/v1/kgetsi/campaigns/:id/live', auth, run((req) =>
    platform.kgetsi.goLive(req.params.id, req.actor)
  ));
  app.post('/v1/kgetsi/campaigns/:id/contributions', auth, run((req) =>
    platform.kgetsi.contribute(req.params.id, {
      sourceAccountId: req.body.source_account_id,
      amountMinor: req.body.amount_minor,
      contributorRef: req.body.anonymous ? null : req.actor,
      idempotencyKey: req.idemKey,
    })
  ));
  app.post('/v1/kgetsi/campaigns/:id/milestones/:m/evidence', auth, run((req) =>
    platform.kgetsi.submitEvidence(req.params.id, req.params.m, req.actor, req.body.evidence_refs)
  ));
  app.post('/v1/kgetsi/campaigns/:id/milestones/:m/approve', auth, run((req) =>
    platform.kgetsi.approveMilestone(req.params.id, req.params.m, req.actor)
  ));
  app.post('/v1/kgetsi/campaigns/:id/milestones/:m/release', auth, run((req) =>
    platform.kgetsi.releaseMilestone(req.params.id, req.params.m, req.actor, {
      destAccountId: req.body.dest_account_id,
      idempotencyKey: req.idemKey,
    })
  ));

  // ── Loeto (§9.3) ───────────────────────────────────────────────────
  app.post('/v1/loeto/experiences', auth, run((req) =>
    platform.loeto.createExperience(req.actor, {
      title: req.body.title,
      priceMinor: req.body.price_minor,
      splitTemplate: req.body.split_template,
    })
  ));
  app.post('/v1/loeto/bookings', auth, run((req) =>
    platform.loeto.book(req.body.experience_id, req.actor, {
      sourceAccountId: req.body.source_account_id,
      idempotencyKey: req.idemKey,
    })
  ));
  app.post('/v1/loeto/bookings/:id/settle', auth, run((req) =>
    platform.loeto.settle(req.params.id, req.actor, { idempotencyKey: req.idemKey })
  ));

  // ── Puo (§7.2) ─────────────────────────────────────────────────────
  app.post('/v1/puo/courses', auth, run((req) => platform.puo.createCourse(req.actor, req.body)));
  app.post('/v1/puo/courses/:id/lessons', auth, run((req) =>
    platform.puo.deriveLesson(req.params.id, req.actor, {
      sourceItemRef: req.body.source_item_ref,
      level: req.body.level,
    })
  ));
  app.post('/v1/puo/threads', auth, run((req) =>
    platform.puo.openThread(req.body.lesson_id, req.actor, {
      teacherRef: req.body.teacher_ref,
      learnerAudioRef: req.body.learner_audio_ref,
      priceMinor: req.body.price_minor,
    })
  ));
  app.post('/v1/puo/threads/:id/corrections', auth, run((req) =>
    platform.puo.submitCorrection(req.params.id, req.actor, {
      teacherAudioRef: req.body.teacher_audio_ref,
      learnerAccountId: req.body.learner_account_id,
      teacherAccountId: req.body.teacher_account_id,
      idempotencyKey: req.idemKey,
    })
  ));

  // ── Letlole (§7.2) ─────────────────────────────────────────────────
  app.post('/v1/trusts', auth, run((req) =>
    platform.letlole.registerTrust(req.actor, {
      name: req.body.name,
      deedDocRef: req.body.deed_doc_ref,
      trustees: req.body.trustees,
      beneficiaries: req.body.beneficiaries,
    })
  ));
  app.post('/v1/trusts/:id/resolutions', auth, run((req) =>
    platform.letlole.proposeResolution(req.params.id, req.actor, req.body)
  ));
  app.post('/v1/trusts/:id/resolutions/:r/sign', auth, run((req) =>
    platform.letlole.signResolution(req.params.id, req.params.r, req.actor, {
      idempotencyKey: req.idemKey,
    })
  ));

  // ── Mafelo (§11) ───────────────────────────────────────────────────
  app.get('/v1/mafelo/packs/:district/manifest', run((req) =>
    platform.mafelo.buildPackManifest(req.params.district)
  ));

  // ── Public transparency APIs (§7.3) — no auth by design ───────────
  app.get('/v1/public/campaigns/:id/ledger', run((req) =>
    platform.kgetsi.publicLedger(req.params.id)
  ));
  app.get('/v1/public/trusts/:id/treasury', run((req) =>
    platform.letlole.publicTreasury(req.params.id)
  ));
  app.get('/v1/public/audit/:objectRef', run((req) => ({
    object_ref: req.params.objectRef,
    entries: platform.audit.chainFor(req.params.objectRef),
    verification: platform.audit.verifyChain(req.params.objectRef),
  })));
  app.get('/v1/public/audit/:objectRef/proof/:entryId', run((req) => {
    const proof = platform.audit.inclusionProof(req.params.objectRef, req.params.entryId);
    return { proof, valid: AuditLog.verifyInclusion(proof) };
  }));

  // ── Offline sync (§8) ──────────────────────────────────────────────
  app.post('/v1/sync/outbox', auth, run((req) => ({
    outcomes: platform.sync.replay(
      (req.body.mutations || []).map((m) => ({ ...m, actor_ref: req.actor }))
    ),
  })));

  // ── Gateway webhooks (§12) ─────────────────────────────────────────
  app.post('/v1/gateway/ussd/session', run((req) =>
    platform.ussd.handle({
      sessionId: req.body.session_id,
      msisdn: req.body.msisdn,
      text: req.body.text,
    })
  ));
  app.post('/v1/gateway/sms/inbound', run((req) =>
    platform.sms.handleInbound(req.body.msisdn, req.body.text, req.body.message_id)
  ));

  // ── Problem-details error envelope (§7.1) ──────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof MotseError) {
      return res.status(error.status).json(error.toProblem(req.traceId));
    }
    return res.status(500).json({
      code: 'INTERNAL',
      message: 'Internal error',
      domain_reason: null,
      retryable: true,
      trace_id: req.traceId,
    });
  });

  return { app, platform };
}

module.exports = { createApp };
