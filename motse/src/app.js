'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { createPlatform } = require('./container');
const { MotseError } = require('./kernel/errors');
const { paginate, applyFieldMask } = require('./kernel/pagination');
const { id } = require('./kernel/ids');
const { AuditLog } = require('./platform/governance/auditLog');
const { createAdminRouter } = require('./admin/admin.routes');

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
function createApp(platform = createPlatform(), options = {}) {
  const app = express();
  // Security headers (§13.1 client/transport hardening at the edge).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // the admin portal is a self-contained page
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    })
  );
  // Raw body retained for webhook HMAC verification over exact bytes.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  // Trace ids end-to-end (§16 observability).
  app.use((req, res, next) => {
    req.traceId = req.get('X-Trace-Id') || id('trc');
    res.set('X-Trace-Id', req.traceId);
    next();
  });
  // Request metrics + structured logs (§16).
  app.use(platform.monitoring.httpMiddleware());
  // Analytics ingestion + API-abuse telemetry (Phase 2): pure counters
  // on response finish; abuse blocks read like rate limiting.
  app.use((req, res, next) => {
    const abuseKey = req.actor || req.ip || 'anonymous';
    if (req.path.startsWith('/v1') && platform.assurance.isBlocked(abuseKey)) {
      return next(new MotseError('RATE_LIMITED', 'Temporarily blocked for API abuse'));
    }
    res.on('finish', () => {
      platform.analytics.recordRequest(req.originalUrl.split('?')[0], req.actor, res.statusCode);
      platform.assurance.recordApiOutcome(req.actor || req.ip || 'anonymous', res.statusCode);
    });
    return next();
  });
  // Rate limiting / API throttling (§13.1) — token bucket per identity.
  app.use('/v1', platform.rateLimiter.middleware());
  // Maintenance mode (Phase 2, WS10): member mutations pause; reads,
  // health, operator webhooks and the admin surface stay available.
  app.use('/v1', platform.ops.maintenanceMiddleware());

  // ── Gateway: idempotency enforcement (§7.1) ────────────────────────
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.use('/v1', (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    // Operator webhooks authenticate by HMAC + replay windows instead;
    // mobile-money providers do not send Idempotency-Key headers.
    if (req.path.startsWith('/payments/webhooks/')) return next();
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
  app.get('/health/ready', (req, res) => {
    const readiness = platform.monitoring.readiness();
    res.status(readiness.ready ? 200 : 503).json(readiness);
  });
  app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(platform.metrics.render());
  });

  // ── Administration portal + API (Phase 1) ──────────────────────────
  const bootstrapToken =
    options.adminBootstrapToken ||
    process.env.MOTSE_ADMIN_BOOTSTRAP_TOKEN ||
    (process.env.NODE_ENV !== 'production' ? 'dev-bootstrap-token' : null);
  app.use('/v1/admin', createAdminRouter(platform, { auth: (...a) => auth(...a), bootstrapToken }));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'portal.html')));

  app.get('/developers', (req, res) => res.sendFile(path.join(__dirname, 'developer', 'portal.html')));

  // ── Developer platform (Phase 3, WS12) ─────────────────────────────
  // App management is member-authed (an L1+ owner registers apps).
  app.post('/v1/developer/apps', auth, run((req) =>
    platform.developer.createApp(req.actor, {
      name: req.body.name,
      scopes: req.body.scopes,
      rateLimitPerMin: req.body.rate_limit_per_min,
    })
  ));
  app.get('/v1/developer/apps', auth, run((req) => platform.developer.listApps(req.actor)));
  app.post('/v1/developer/apps/:id/revoke', auth, run((req) =>
    platform.developer.revokeApp(req.params.id, req.actor)
  ));
  app.get('/v1/developer/apps/:id/usage', auth, run((req) =>
    platform.developer.usageFor(req.params.id)
  ));
  // Webhook subscriptions are member-authed (the app owner subscribes).
  app.post('/v1/developer/subscriptions', auth, run((req) => {
    const app_ = platform.developer.apps.get(req.body.app_id);
    if (!app_ || app_.owner_ref !== req.actor) {
      throw new MotseError('PERMISSION_DENIED', 'Not your app');
    }
    return platform.developer.subscribe(req.body.app_id, {
      eventTypes: req.body.event_types,
      url: req.body.url,
    });
  }));
  // Public developer API — authenticated by API key + scope, rate-limited.
  const apiKeyAuth = (scope) => (req, res, next) => {
    try {
      req.developerApp = platform.developer.authenticate(req.get('X-Api-Key'), scope);
      next();
    } catch (e) {
      next(e);
    }
  };
  app.get('/v1/partner/campaigns/:id/ledger', apiKeyAuth('public:read'), run((req) =>
    platform.kgetsi.publicLedger(req.params.id)
  ));
  app.get('/v1/partner/search', apiKeyAuth('public:read'), run((req) =>
    platform.search.search(req.query.q, { limit: Number(req.query.limit) || 20 })
  ));
  app.get('/v1/partner/heritage', apiKeyAuth('heritage:read'), run((req) =>
    paginate(platform.heritage.publicSearchIndex(), {
      pageToken: req.query.page_token, pageSize: req.query.page_size,
    })
  ));

  // ── Plugin routes (Phase 3, WS5): /v1/ext/<prefix>/… ──────────────
  // Authenticated, then delegated to enabled plugins' sandboxed routers.
  app.use('/v1/ext', auth, (req, res, next) => platform.plugins.router(req, res, next));

  // ── Identity (§5) ──────────────────────────────────────────────────
  app.post('/v1/identity/otp', run((req) => platform.identity.requestOtp(req.body.msisdn)));
  app.post('/v1/identity/otp/verify', run((req) => {
    try {
      const result = platform.identity.verifyOtp(req.body.msisdn, req.body.code, {
        deviceId: req.get('X-Device-Id'),
        userId: req.body.user_id,
      });
      // Login telemetry: device registration age, impossible travel,
      // account-takeover heuristics (Phase 2 security assurance).
      platform.assurance.recordLogin(result.user.id, {
        deviceId: req.get('X-Device-Id'),
        msisdn: req.body.msisdn,
        geo: req.body.geo,
      });
      return result;
    } catch (e) {
      if (e.code === 'INVALID_ARGUMENT') platform.assurance.recordAuthFailure(req.body.msisdn);
      throw e;
    }
  }));
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

  // ── Payments (Phase 1: Orange Money / MyZaka / Smega) ──────────────
  app.post('/v1/payments/collections', auth, run((req) =>
    platform.payments.collect({
      provider: req.body.provider,
      msisdn: req.body.msisdn,
      amountMinor: req.body.amount_minor,
      currency: req.body.currency, // multi-currency (WS1/WS2); defaults BWP
      destAccountId: req.body.dest_account_id,
      purposeRef: req.body.purpose_ref,
      actorRef: req.actor,
      idempotencyKey: req.idemKey,
    })
  ));
  app.get('/v1/payments/providers', run(() => ({
    providers: platform.payments.capabilityMatrix(),
  })));
  app.get('/v1/payments/select', run((req) => ({
    provider: platform.payments.selectProvider({
      currency: req.query.currency,
      country: req.query.country,
      needs: req.query.needs ? String(req.query.needs).split(',') : [],
    }),
  })));
  // PayPal order lifecycle (WS1): create → (authorize) → capture.
  app.post('/v1/payments/paypal/orders/:id/capture', auth, run((req) => {
    const provider = platform.payments.provider('paypal');
    const webhook = provider.captureOrder(req.params.id);
    // The capture emits the operator's signed webhook; process it through
    // the same verified path as any other provider callback.
    return platform.payments.processWebhook('paypal', webhook.rawBody, webhook.headers);
  }));
  app.post('/v1/payments/paypal/orders/:id/authorize', auth, run((req) =>
    platform.payments.provider('paypal').authorizeOrder(req.params.id)
  ));
  app.post('/v1/payments/payouts', auth, run((req) => {
    // Untrusted devices (root/jailbreak signals) lose payout privileges
    // (§13.1 "root/jailbreak signal degrades privileged actions").
    if (!platform.identity.isDeviceTrusted(req.get('X-Device-Id'))) {
      throw new MotseError('PERMISSION_DENIED', 'Payouts are disabled on this device');
    }
    return platform.payments.payout({
      provider: req.body.provider,
      sourceAccountId: req.body.source_account_id,
      msisdn: req.body.msisdn,
      amountMinor: req.body.amount_minor,
      ref: req.body.ref,
      actorRef: req.actor,
      idempotencyKey: req.idemKey,
      // Real device age feeds the SIM-swap heuristic (Phase 2).
      deviceAgeMs: platform.assurance.deviceAgeMs(req.actor, req.get('X-Device-Id')),
    });
  }));
  app.post('/v1/payments/intents/:id/refund', auth, run((req) =>
    platform.payments.refund({
      intentId: req.params.id,
      amountMinor: req.body.amount_minor, // omit for a full refund; partial needs capability
      actorRef: req.actor,
      idempotencyKey: req.idemKey,
    })
  ));
  app.get('/v1/payments/intents/:id', auth, run((req) => platform.payments.intent(req.params.id)));
  app.post('/v1/payments/webhooks/:provider', run((req) =>
    platform.payments.processWebhook(req.params.provider, req.rawBody, {
      'x-motse-signature': req.get('X-Motse-Signature'),
      'x-motse-timestamp': req.get('X-Motse-Timestamp'),
      'x-motse-nonce': req.get('X-Motse-Nonce'),
    })
  ));

  // ── Phase 4: native card payments (WS11/WS12/WS14) ─────────────────
  // Customer wallet — saved cards (token-only, masked display). No route
  // anywhere accepts a PAN/CVV: the client tokenizes via the gateway's
  // hosted fields and posts only the opaque reference + display metadata.
  app.get('/v1/cards', auth, run((req) => ({ cards: platform.cards.listCards(req.actor) })));
  app.post('/v1/cards', auth, run((req) =>
    platform.cards.saveCard(req.actor, {
      hostedFieldRef: req.body.hosted_field_ref,
      brand: req.body.brand,
      last4: req.body.last4,
      expMonth: req.body.exp_month,
      expYear: req.body.exp_year,
      nickname: req.body.nickname,
      gateway: req.body.gateway,
      networkToken: req.body.network_token,
    })
  ));
  app.patch('/v1/cards/:id', auth, run((req) =>
    platform.cards.updateCard(req.actor, req.params.id, {
      nickname: req.body.nickname,
      expMonth: req.body.exp_month,
      expYear: req.body.exp_year,
    })
  ));
  app.post('/v1/cards/:id/default', auth, run((req) =>
    platform.cards.setDefaultCard(req.actor, req.params.id)
  ));
  app.post('/v1/cards/:id/replace-token', auth, run((req) =>
    platform.cards.replaceToken(req.actor, req.params.id, {
      hostedFieldRef: req.body.hosted_field_ref,
      last4: req.body.last4,
      expMonth: req.body.exp_month,
      expYear: req.body.exp_year,
    })
  ));
  app.delete('/v1/cards/:id', auth, run((req) => platform.cards.deleteCard(req.actor, req.params.id)));

  // Card payment intents — create → (3-D Secure) → capture / void / refund.
  app.post('/v1/cards/intents', auth, run((req) =>
    platform.cards.createIntent(req.actor, {
      amountMinor: req.body.amount_minor,
      currency: req.body.currency,
      destAccountId: req.body.dest_account_id,
      cardId: req.body.card_id,
      token: req.body.token,
      brand: req.body.brand,
      ref: req.body.ref,
      deviceId: req.get('X-Device-Id'),
      country: req.body.country,
      idempotencyKey: req.idemKey,
    })
  ));
  app.post('/v1/cards/intents/:id/3ds', auth, run((req) =>
    platform.cards.complete3DS(req.params.id, { success: req.body.success !== false })
  ));
  app.post('/v1/cards/intents/:id/capture', auth, run((req) =>
    platform.cards.capture(req.params.id, {
      amountMinor: req.body.amount_minor, // omit for a full capture
      idempotencyKey: req.idemKey,
      actorRef: req.actor,
    })
  ));
  app.post('/v1/cards/intents/:id/void', auth, run((req) =>
    platform.cards.voidAuthorization(req.params.id, { actorRef: req.actor })
  ));
  app.post('/v1/cards/intents/:id/refund', auth, run((req) =>
    platform.cards.refund(req.params.id, {
      amountMinor: req.body.amount_minor, // omit for a full refund
      idempotencyKey: req.idemKey,
      actorRef: req.actor,
      reason: req.body.reason,
    })
  ));
  app.get('/v1/cards/intents', auth, run((req) => ({ intents: platform.cards.intentsFor(req.actor) })));
  app.get('/v1/cards/intents/:id', auth, run((req) => platform.cards.myIntent(req.actor, req.params.id)));

  // Subscriptions & recurring (WS7).
  app.post('/v1/cards/subscriptions', auth, run((req) =>
    platform.cards.createSubscription(req.actor, {
      cardId: req.body.card_id,
      amountMinor: req.body.amount_minor,
      currency: req.body.currency,
      destAccountId: req.body.dest_account_id,
      interval: req.body.interval,
      plan: req.body.plan,
      graceDays: req.body.grace_days,
    })
  ));
  app.get('/v1/cards/subscriptions', auth, run((req) => ({
    subscriptions: platform.cards.listSubscriptions(req.actor),
  })));
  app.post('/v1/cards/subscriptions/:id/pause', auth, run((req) =>
    platform.cards.pauseSubscription(req.actor, req.params.id)
  ));
  app.post('/v1/cards/subscriptions/:id/resume', auth, run((req) =>
    platform.cards.resumeSubscription(req.actor, req.params.id)
  ));
  app.post('/v1/cards/subscriptions/:id/cancel', auth, run((req) =>
    platform.cards.cancelSubscription(req.actor, req.params.id)
  ));
  app.patch('/v1/cards/subscriptions/:id', auth, run((req) =>
    platform.cards.changePlan(req.actor, req.params.id, {
      amountMinor: req.body.amount_minor,
      plan: req.body.plan,
    })
  ));

  // Gateway capability discovery (WS14 SDK) — public read, no secrets.
  app.get('/v1/cards/gateways', run(() => platform.cards.gatewayCapabilities()));

  // Secure card webhooks (WS10) — HMAC-verified per gateway. Path sits
  // under /payments/webhooks/ so the gateway idempotency exemption and
  // raw-body capture both apply; verification happens in CardService.
  app.post('/v1/payments/webhooks/cards/:gateway', run((req) =>
    platform.cards.processWebhook(req.params.gateway, req.rawBody, {
      'x-motse-signature': req.get('X-Motse-Signature'),
      'x-motse-timestamp': req.get('X-Motse-Timestamp'),
      'x-motse-nonce': req.get('X-Motse-Nonce'),
    })
  ));

  // ── Phase 5: QR Code Platform (WS21) ───────────────────────────────
  // Generate a signed QR you own (identity/wallet/payment-request/…).
  app.post('/v1/qr', auth, run((req) =>
    platform.qr.generate(req.actor, {
      kind: req.body.kind,
      tenant: req.body.tenant,
      subjectRef: req.body.subject_ref,
      ref: req.body.ref,
      amountMinor: req.body.amount_minor,
      currency: req.body.currency,
      expiresInMs: req.body.expires_in_ms,
      singleUse: req.body.single_use,
      dynamic: req.body.dynamic,
      visibility: req.body.visibility,
      requiredRole: req.body.required_role,
      requiredLevel: req.body.required_level,
      data: req.body.data,
      restricted: req.body.restricted,
    })
  ));
  // Verify a scanned QR (the scanner is the caller, if authenticated).
  app.post('/v1/qr/verify', authOptional, run((req) =>
    platform.qr.verify(req.body.token, {
      scannerRef: req.actor || null,
      tenant: req.body.tenant,
      amountMinor: req.body.amount_minor,
    })
  ));
  // Decode structure only (never trusted) — public.
  app.post('/v1/qr/decode', run((req) => platform.qr.decode(req.body.token)));
  // Pay by scanning a payment QR.
  app.post('/v1/qr/pay', auth, run((req) =>
    platform.qr.payWithQr(req.actor, req.body.token, {
      provider: req.body.provider,
      msisdn: req.body.msisdn,
      cardId: req.body.card_id,
      idempotencyKey: req.idemKey,
    })
  ));
  app.get('/v1/qr', auth, run((req) => ({
    codes: platform.qr.list().filter((c) => c.issued_by === req.actor),
  })));
  app.post('/v1/qr/:id/revoke', auth, run((req) => {
    const code = platform.qr.get(req.params.id);
    if (code.issued_by !== req.actor) throw new MotseError('PERMISSION_DENIED', 'Not your QR');
    return platform.qr.revoke(req.actor, req.params.id, req.body.reason);
  }));

  // ── Notifications ──────────────────────────────────────────────────
  app.get('/v1/notifications', auth, run((req) =>
    paginate(platform.notifications.inboxFor(req.actor).reverse(), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));
  app.post('/v1/notifications/:id/read', auth, run((req) =>
    platform.notifications.markRead(req.params.id, req.actor)
  ));
  app.put('/v1/notifications/preferences/:category', auth, run((req) =>
    platform.notifications.setPreference(req.actor, req.params.category, req.body.channels || {})
  ));

  // ── Search ─────────────────────────────────────────────────────────
  app.get('/v1/search', authOptional, run((req) => {
    const result = platform.search.search(req.query.q, {
      types: req.query.types ? String(req.query.types).split(',') : null,
      readerRef: req.actor || null,
      limit: Number(req.query.limit) || 20,
    });
    platform.analytics.trackSearch(req.query.q); // terms only, no user linkage
    return result;
  }));

  // ── Device trust signals (§13.1) ───────────────────────────────────
  app.post('/v1/identity/devices/signals', auth, run((req) =>
    platform.identity.reportDeviceSignal(req.get('X-Device-Id') || req.body.device_id, req.body)
  ));

  // ── Phase 2: client-facing surface (wallet, browse, family, flags) ─
  app.get('/v1/flags', authOptional, run((req) =>
    platform.flags.snapshotFor(platform.identity, req.actor)
  ));
  app.get('/v1/wallet/accounts', auth, run((req) => platform.ledger.accountsFor(req.actor)));
  app.get('/v1/wallet/history', auth, run((req) =>
    platform.ledger.historyFor(req.actor, Number(req.query.limit) || 50)
  ));
  app.get('/v1/wallet/payouts', auth, run((req) =>
    platform.ledger.payouts.find((p) => {
      const account = platform.ledger.accounts.get(p.account_id);
      return account && account.owner_ref === req.actor;
    })
  ));
  app.get('/v1/payments/intents', auth, run((req) =>
    platform.payments.intents.find((i) => i.actor_ref === req.actor)
  ));
  app.get('/v1/kgetsi/campaigns', run((req) =>
    paginate(platform.kgetsi.listCampaigns({ state: req.query.state }), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));
  app.get('/v1/loeto/experiences', run((req) =>
    paginate(platform.loeto.listExperiences(), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));
  app.get('/v1/loeto/bookings', auth, run((req) => platform.loeto.bookingsFor(req.actor)));
  app.post('/v1/loeto/bookings/:id/review', auth, run((req) =>
    platform.loeto.addReview(req.params.id, req.actor, {
      rating: req.body.rating,
      comment: req.body.comment,
    })
  ));
  app.get('/v1/loeto/bookings/:id/ics', auth, run((req, res) => {
    const booking = platform.loeto.get(req.params.id);
    if (booking.guest_ref !== req.actor) {
      throw new MotseError('PERMISSION_DENIED', 'Not your booking');
    }
    const experience = platform.loeto.experiences.get(booking.experience_id);
    const start = req.query.start || platform.clock.nowIso();
    const { ics } = platform.integrations.get('calendar').createEvent({
      title: `Loeto: ${experience.title}`,
      start,
      end: req.query.end || start,
      location: 'Botswana',
      description: `Booking ${booking.id}`,
    });
    res.set('Content-Type', 'text/calendar');
    res.send(ics);
    return undefined;
  }));
  app.get('/v1/puo/courses', run(() => platform.puo.listCourses()));
  app.post('/v1/puo/lessons/:id/complete', auth, run((req) =>
    platform.puo.markLessonComplete(req.params.id, req.actor)
  ));
  app.get('/v1/puo/progress', auth, run((req) => platform.puo.progressFor(req.actor)));
  app.get('/v1/lelapa/circles', auth, run((req) => platform.lelapa.circlesFor(req.actor)));
  app.post('/v1/lelapa/circles', auth, run((req) =>
    platform.lelapa.createCircle(req.actor, req.body.name)
  ));
  app.get('/v1/lelapa/circles/:id/tree', auth, run((req) =>
    platform.lelapa.familyTree(req.params.id, req.actor)
  ));
  app.post('/v1/lelapa/circles/:id/invitations', auth, run((req) =>
    platform.lelapa.inviteMember(req.params.id, req.actor, {
      msisdn: req.body.msisdn,
      relation: req.body.relation,
      relatedTo: req.body.related_to,
    })
  ));
  app.post('/v1/lelapa/invitations/:id/accept', auth, run((req) =>
    platform.lelapa.acceptInvitation(req.params.id, req.actor)
  ));
  app.post('/v1/lelapa/circles/:id/relations', auth, run((req) =>
    platform.lelapa.setRelation(req.params.id, req.actor, {
      memberRef: req.body.member_ref,
      relation: req.body.relation,
      relatedTo: req.body.related_to,
    })
  ));
  app.post('/v1/lelapa/circles/:id/events', auth, run((req) =>
    platform.lelapa.createFamilyEvent(req.params.id, req.actor, req.body)
  ));
  app.get('/v1/lelapa/circles/:id/events', auth, run((req) =>
    platform.lelapa.familyEvents(req.params.id, req.actor)
  ));

  // Community feedback (Phase 3, WS3): members contribute to their pilot.
  app.post('/v1/pilots/:id/feedback', auth, run((req) =>
    platform.pilots.submitFeedback(req.params.id, {
      userRef: req.actor,
      category: req.body.category,
      message: req.body.message,
      rating: req.body.rating,
    })
  ));

  // ── Progressive Web App (Phase 2, WS2) ─────────────────────────────
  app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'pwa', 'app.html')));
  app.get('/app/manifest.json', (req, res) =>
    res.sendFile(path.join(__dirname, 'pwa', 'manifest.json'))
  );
  app.get('/app/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'pwa', 'sw.js'));
  });

  // ── AI foundation (extension points only) ──────────────────────────
  app.get('/v1/ai/capabilities', run(() => ({
    capabilities: require('./ai/registry').CAPABILITIES.map((capability) => ({
      capability,
      configured: platform.ai.configured(capability),
    })),
  })));
  app.post('/v1/ai/:capability', auth, run((req) =>
    platform.ai.run(req.params.capability, req.body, req.actor)
  ));

  // ── Problem-details error envelope (§7.1) ──────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof MotseError) {
      // Permission auditing: every authz denial is queryable (§13).
      if (error.status === 401 || error.status === 403) {
        platform.store.collection('security_denials').insert({
          id: id('den'),
          actor_ref: req.actor || null,
          code: error.code,
          method: req.method,
          path: req.originalUrl,
          trace_id: req.traceId,
          ts: platform.clock.nowIso(),
        });
        platform.metrics.inc('motse_authz_denials_total', { code: error.code });
      }
      return res.status(error.status).json(error.toProblem(req.traceId));
    }
    platform.logger.error('unhandled', { trace_id: req.traceId, error: error.message });
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
