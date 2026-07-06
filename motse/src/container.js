'use strict';

const { Store } = require('./kernel/store');
const { Clock } = require('./kernel/clock');
const { EventBus } = require('./kernel/eventBus');
const { IdempotencyRegistry } = require('./kernel/idempotency');
const { AuditLog } = require('./platform/governance/auditLog');
const { IdentityService } = require('./platform/identity/identity.service');
const { LedgerService } = require('./platform/ledger/ledger.service');
const { EscrowService } = require('./platform/ledger/escrow.service');
const { GovernanceService } = require('./platform/governance/governance.service');
const { MediaService } = require('./platform/media/media.service');
const { HeritageService } = require('./modules/heritage/heritage.service');
const { KgotlaService } = require('./modules/kgotla/kgotla.service');
const { KgetsiService } = require('./modules/kgetsi/kgetsi.service');
const { LoetoService } = require('./modules/loeto/loeto.service');
const { PuoService } = require('./modules/puo/puo.service');
const { MafeloService } = require('./modules/mafelo/mafelo.service');
const { LelapaService } = require('./modules/lelapa/lelapa.service');
const { LetloleService } = require('./modules/letlole/letlole.service');
const { MminoService } = require('./modules/mmino/mmino.service');
const { OutboxSyncService } = require('./sync/outbox');
const { UssdGateway } = require('./gateway/ussd');
const { SmsGateway } = require('./gateway/sms');
const { SecretManager } = require('./security/secrets');
const { ReplayGuard } = require('./security/replay');
const { FraudEngine } = require('./security/fraud');
const { RateLimiter } = require('./security/rateLimiter');
const { PaymentService } = require('./payments/payment.service');
const {
  OrangeMoneyProvider,
  MyZakaProvider,
  SmegaProvider,
} = require('./payments/providers');
const { PayPalProvider } = require('./payments/paypal.provider');
const { CardPaymentProvider } = require('./payments/card.provider');
const { CardService } = require('./payments/card.service');
const { GatewayRegistry } = require('./payments/gateways/gateway.registry');
const { GATEWAY_CLASSES } = require('./payments/gateways/adapters');
const { EventStore } = require('./events/event.store');
const { ProjectionRegistry, SEED_PROJECTIONS } = require('./events/projections');
const { QrService } = require('./qr/qr.service');
const { IdentityPlane } = require('./governance/identity.plane');
const { PolicyKernel } = require('./governance/policy.kernel');
const { Provenance } = require('./governance/provenance');
const { GovernedAiGateway } = require('./governance/ai.gateway');
const { DataProductPlane } = require('./governance/data.product.plane');
const { AuditGraph } = require('./governance/audit.graph');
const { CellRegistry } = require('./governance/cell.registry');
const { Certification } = require('./governance/certification');
const { OutboxService } = require('./persistence/outbox');
const { createKv } = require('./distributed/kv');
const { DistributedIdempotency, DistributedRateLimiter, DistributedLock } = require('./distributed/services');
const { Tracer } = require('./observability/tracer');
const { OtelSpanExporter } = require('./observability/otel.exporter');
const { HealthService } = require('./observability/health.service');
const { DependencyHealthEngine } = require('./observability/dependency.health');
const { RuntimeIntelligence } = require('./observability/runtime.intelligence');
const { CapacityPlanner } = require('./observability/capacity.planner');
const { AdaptiveRateLimiter } = require('./security/adaptive.rateLimiter');
const { Resilience } = require('./resilience');
const { ConfigService } = require('./config/config.service');
const { NotificationService } = require('./notifications/notification.service');
const { Metrics } = require('./monitoring/metrics');
const { Logger } = require('./monitoring/logger');
const { MonitoringService } = require('./monitoring/monitoring.service');
const { SearchService } = require('./search/search.service');
const { AiRegistry } = require('./ai/registry');
const { FlagService } = require('./pilot/flags.service');
const { PilotService } = require('./pilot/pilot.service');
const { AnalyticsService } = require('./analytics/analytics.service');
const { AssuranceService } = require('./security/assurance.service');
const { OpsService } = require('./ops/ops.service');
const { BackupService } = require('./ops/backup.service');
const { WorkflowService } = require('./workflow/workflow.service');
const { SEED_WORKFLOWS } = require('./workflow/definitions');
const { PluginManager } = require('./plugins/plugin.manager');
const { AiEvaluator } = require('./ai/evaluation/evaluator');
const { SecurityScorecard } = require('./security/scorecard');
const { DeveloperService } = require('./developer/developer.service');
const { I18n } = require('./i18n/i18n');
const {
  TfIdfSemanticSearchProvider,
  ExtractiveSummarizerProvider,
  MetadataTaggerProvider,
  CooccurrenceRecommenderProvider,
  PhraseTranslatorProvider,
} = require('./ai/providers/local');
const { CloudSpeechToTextProvider, CloudTranslationProvider } = require('./ai/providers/cloud');
const {
  IntegrationRegistry,
  SandboxBankProvider,
  SandboxGovIdentityProvider,
  SandboxGisProvider,
  SandboxEmailProvider,
  SandboxWhatsAppProvider,
  IcsCalendarProvider,
} = require('./integrations/registry');

/**
 * Composition root — the modular monolith (P6). Domains live behind hard
 * interface boundaries in one deployable; Identity, Ledger and Media are
 * modelled as extracted services (their only coupling is the container).
 *
 * Construction order matters only in two places: PaymentService and the
 * domain modules register their event schemas before NotificationService
 * subscribes, and MonitoringService is built LAST so its event counters
 * see every registered schema.
 */
function createPlatform({
  secret = process.env.MOTSE_SECRET || 'motse-dev-secret',
  logSink,
  notificationAdapters,
} = {}) {
  // Observability substrate (Phase 2): one metrics registry + one tracer,
  // threaded through the Foundation so transactions, the outbox and the
  // distributed layer are instrumented. Both default to no-ops if absent.
  const metrics = new Metrics();
  const clock = new Clock();
  // OTLP export bridge (Phase A): OFF unless OTEL_EXPORTER_OTLP_ENDPOINT is set,
  // in which case finished spans are batched to a Jaeger/Tempo/Collector.
  const otel = new OtelSpanExporter({ clock });
  const tracer = new Tracer({ clock, sink: (span) => otel.accept(span) });
  const store = new Store({ metrics });
  const bus = new EventBus(clock);
  // Phase 5 (WS2): the platform Event Store taps the bus BEFORE any domain
  // service publishes, so the immutable log captures every event from boot.
  const eventStore = new EventStore({ store, clock, bus });
  const idempotency = new IdempotencyRegistry(clock);
  const audit = new AuditLog(store, clock);
  const secrets = new SecretManager(clock);
  secrets.seed('platform:token', secret);

  const identity = new IdentityService({ store, clock, audit, secret });
  const ledger = new LedgerService({ store, clock, bus, idempotency, audit });
  const escrow = new EscrowService({ store, clock, ledger });
  const governance = new GovernanceService({ store, clock, identity, audit, bus });
  const media = new MediaService({ store, clock, bus, secret: `${secret}-media` });

  const heritage = new HeritageService({ store, clock, identity, media, audit, bus, governance });
  const kgotla = new KgotlaService({ store, clock, identity, audit, bus });
  const kgetsi = new KgetsiService({ store, clock, identity, ledger, escrow, audit, bus, governance });
  const loeto = new LoetoService({ store, clock, identity, ledger, escrow, bus, audit });
  const puo = new PuoService({ store, clock, identity, heritage, ledger, bus, audit });
  const mafelo = new MafeloService({ store, clock, heritage, identity, secret: `${secret}-pack` });
  const lelapa = new LelapaService({ store, clock, identity, ledger, escrow });
  const letlole = new LetloleService({ store, clock, identity, ledger, audit });
  const mmino = new MminoService({ store, clock, identity, ledger, media });

  // ── Phase 1: payments, security, notifications, search, AI ─────────
  const replayGuard = new ReplayGuard(clock);
  const fraud = new FraudEngine({ store, clock });
  const rateLimiter = new RateLimiter({
    clock,
    capacity: Number(process.env.MOTSE_RATE_CAPACITY || 300),
    refillPerSecond: Number(process.env.MOTSE_RATE_REFILL || 5),
  });

  const payments = new PaymentService({ store, clock, bus, ledger, secrets, replayGuard, fraud, audit });
  payments.registerProvider(new OrangeMoneyProvider({ clock, secrets }, providerOptions('ORANGE')));
  payments.registerProvider(new MyZakaProvider({ clock, secrets }, providerOptions('MYZAKA')));
  payments.registerProvider(new SmegaProvider({ clock, secrets }, providerOptions('SMEGA')));
  // PayPal — the diaspora card/remittance rail (Phase 3, WS1).
  payments.registerProvider(new PayPalProvider({ clock, secrets }, providerOptions('PAYPAL')));

  // ── Phase 4: native card payments (WS1–WS10) ───────────────────────
  // The card provider depends ONLY on a GatewayRegistry, never on a
  // concrete gateway. Gateways, their brand/currency profiles and the
  // failover order are pure configuration (MOTSE_GATEWAY_ORDER), so a new
  // acquirer is a subclass + registration — nothing above changes.
  const gatewayOrder = (process.env.MOTSE_GATEWAY_ORDER || 'stripe,adyen,braintree,peach,dpo,paygate')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const gateways = new GatewayRegistry({ clock, maxAttempts: 3 });
  for (const name of gatewayOrder) {
    const GatewayClass = GATEWAY_CLASSES[name];
    if (!GatewayClass) continue; // unknown gateway in config → skipped
    gateways.register(new GatewayClass({ clock, secrets }, gatewayOptions(name)));
  }
  const cardProvider = new CardPaymentProvider({ clock, secrets }, { gateways });
  payments.registerProvider(cardProvider);

  // Canonical split template (§9.3) available to the admin explorer.
  ledger.registerSplitTemplate({
    name: 'loeto_default',
    version: 1,
    shares: [
      { beneficiary: 'guide', pct: 60 },
      { beneficiary: 'homestead', pct: 25 },
      { beneficiary: 'community_trust', pct: 10 },
      { beneficiary: 'platform', pct: 5 },
    ],
  });

  // ── Phase 2: integrations (constructed early — notifications bridge) ─
  const integrations = new IntegrationRegistry({ clock });
  integrations.register('bank', new SandboxBankProvider({ clock }));
  integrations.register('gov_identity', new SandboxGovIdentityProvider());
  integrations.register('gis', new SandboxGisProvider());
  integrations.register('email', new SandboxEmailProvider({ clock }));
  integrations.register('calendar', new IcsCalendarProvider({ clock }));
  if (process.env.MOTSE_WHATSAPP_TOKEN) {
    integrations.register('whatsapp', new SandboxWhatsAppProvider({ clock }));
  }

  const bridgedAdapters = {
    email: { send: (p) => integrations.get('email').send({ to: p.to, subject: p.subject, body: p.body }) },
    ...(integrations.has('whatsapp')
      ? {
          whatsapp: {
            send: (p) =>
              integrations.get('whatsapp').sendTemplate({ to: p.to, template: 'motse_notify', params: [p.body] }),
          },
        }
      : {}),
    ...notificationAdapters,
  };
  const notifications = new NotificationService(
    { store, clock, bus, identity },
    bridgedAdapters
  );
  notifications.bindLedgerAccounts(ledger.accounts);

  const platform = {
    store,
    clock,
    bus,
    eventStore,
    idempotency,
    audit,
    secrets,
    replayGuard,
    fraud,
    rateLimiter,
    identity,
    ledger,
    escrow,
    governance,
    media,
    heritage,
    kgotla,
    kgetsi,
    loeto,
    puo,
    mafelo,
    lelapa,
    letlole,
    mmino,
    payments,
    notifications,
    integrations,
  };

  platform.sync = new OutboxSyncService(platform);
  platform.ussd = new UssdGateway(platform);
  platform.sms = new SmsGateway(platform);
  platform.search = new SearchService({ store, clock, bus, platform });
  platform.ai = new AiRegistry({ media, heritage, audit, clock });

  // ── Phase 2: production AI providers (local defaults; cloud by env) ─
  platform.ai.register(new TfIdfSemanticSearchProvider());
  platform.ai.register(new ExtractiveSummarizerProvider());
  platform.ai.register(new MetadataTaggerProvider({ knownEntities: ['tsodilo', 'bakalanga', 'bangwato'] }));
  platform.ai.register(new CooccurrenceRecommenderProvider());
  platform.ai.register(new PhraseTranslatorProvider());
  if (process.env.MOTSE_AI_SPEECH_KEY) {
    platform.ai.register(new CloudSpeechToTextProvider({ apiKey: process.env.MOTSE_AI_SPEECH_KEY }));
  }
  if (process.env.MOTSE_AI_TRANSLATE_KEY) {
    platform.ai.register(new CloudTranslationProvider({ apiKey: process.env.MOTSE_AI_TRANSLATE_KEY }));
  }

  // ── Phase 2: pilots, analytics, assurance, ops ─────────────────────
  platform.flags = new FlagService({ store, clock, audit, bus });
  platform.flags.define('module.kgetsi', { description: 'Kgetsi campaigns', defaultValue: true });
  platform.flags.define('module.loeto', { description: 'Loeto tourism', defaultValue: true });
  platform.flags.define('module.mmino', { description: 'Mmino streaming (last phase)', defaultValue: false });
  platform.flags.define('config.data_budget_kb', {
    description: 'Per-screen data budget (P8)',
    defaultValue: 2048,
    kind: 'config',
  });

  platform.analytics = new AnalyticsService({ clock, bus, platform });
  platform.pilots = new PilotService({
    store, clock, identity, kgotla, flags: platform.flags, audit, bus,
  });
  platform.pilots.bindAnalytics(platform.analytics);

  // ── Phase 4: card lifecycle orchestrator (WS5–WS10) ────────────────
  // Sits beside Ledger/Escrow; the Ledger stays the single source of
  // financial truth (CardService only posts through it). Built here so it
  // sees analytics + notifications; registers its own card fraud checks.
  platform.gateways = gateways;
  platform.cardProvider = cardProvider;
  platform.cards = new CardService({
    store, clock, ledger, payments, provider: cardProvider, gateways,
    fraud, audit, bus, notifications, analytics: platform.analytics, replayGuard,
  });

  // ── Phase 5: CQRS projections (WS3) — dashboards read these views ───
  platform.projections = new ProjectionRegistry({ store, clock, eventStore });
  for (const projection of SEED_PROJECTIONS) platform.projections.register(projection);

  // ── Phase 5: QR Code Platform (WS21) — signed, revocable, cross-domain
  platform.qr = new QrService({
    store, clock, secrets, audit, bus, fraud, analytics: platform.analytics,
    identity, payments, cards: platform.cards,
  });

  // ── Phase 6: four governed DPI planes + provenance + audit graph ────
  // Identity Plane exposes only assertions; the Policy Kernel is the sole
  // decision point; the AI Gateway and Data Product Plane never touch raw
  // stores; every governed output is provenance-signed and event-sourced.
  platform.identityPlane = new IdentityPlane({ identity });
  platform.policy = new PolicyKernel({ clock, audit, bus });
  platform.provenance = new Provenance({ clock, secrets });
  platform.aiGateway = new GovernedAiGateway({
    store, clock, identityPlane: platform.identityPlane, policyKernel: platform.policy,
    provenance: platform.provenance, audit, bus, analytics: platform.analytics,
  });
  platform.dataProducts = new DataProductPlane({
    store, clock, identityPlane: platform.identityPlane, policyKernel: platform.policy,
    provenance: platform.provenance, projections: platform.projections, bus,
  });
  platform.auditGraph = new AuditGraph({ eventStore });
  platform.cells = new CellRegistry({ clock, audit, bus, policyKernel: platform.policy });
  platform.cells.register({
    id: process.env.MOTSE_CELL_ID || 'cell-0',
    region: process.env.MOTSE_CELL_REGION || 'bw-central',
    residency: process.env.MOTSE_CELL_RESIDENCY || 'bw',
  });
  platform.certification = new Certification({
    clock, eventStore, ledger, auditGraph: platform.auditGraph, provenance: platform.provenance,
  });

  // ── Foundation F2/F3: transactional outbox + distributed runtime ────
  // Outbox: atomic state+event commit with at-least-once relay (available
  // to critical flows; existing bus.publish paths are unchanged).
  platform.outbox = new OutboxService({ store, clock, bus, metrics, tracer });
  // Distributed layer: in-memory today, Redis-backed when REDIS_URL is set —
  // cross-pod idempotency, rate limiting and locks behind one KV interface.
  platform.kv = createKv({ clock });
  platform.distributed = {
    idempotency: new DistributedIdempotency({ kv: platform.kv, metrics }),
    rateLimiter: new DistributedRateLimiter({
      kv: platform.kv, clock, metrics,
      capacity: Number(process.env.MOTSE_RATE_CAPACITY || 300),
      windowMs: Number(process.env.MOTSE_RATE_WINDOW_MS || 60000),
    }),
    lock: new DistributedLock({ kv: platform.kv, metrics }),
  };
  // Observability handles on the platform (Phase 2/3/A).
  platform.tracer = tracer;
  platform.otel = otel; // OTLP export bridge (stats + manual flush)
  platform.health = new HealthService({ platform, clock });
  // Mission 1: active dependency probes with a per-dependency state machine.
  // The KV probe does a REAL round-trip (validation W6 showed existence-only
  // checks leave readiness green through a Redis outage). Probes read
  // platform.* at probe time, so runtime swaps (chaos, failover) are seen.
  platform.dependencies = new DependencyHealthEngine({ clock })
    .register('redis', {
      probe: async () => {
        const key = `health:probe:${clock.nowMs()}:${Math.random().toString(36).slice(2, 8)}`;
        await platform.kv.setNx(key, '1', 5000);
        await platform.kv.del(key);
        return { detail: platform.kv.constructor.name };
      },
      impact: 'cross-pod idempotency, rate limiting and locks fail closed',
    })
    .register('event_bus', {
      probe: async () => {
        if (bus.schemas.size === 0) throw new Error('no event schemas registered');
        return { detail: `${bus.schemas.size} schemas` };
      },
      impact: 'no domain events flow; projections and notifications stall',
    })
    .register('event_store', {
      probe: async () => ({ detail: `${eventStore.stats().total} events` }),
      impact: 'audit/event-sourced views stop advancing',
    })
    .register('outbox_relay', {
      probe: async () => {
        const s = platform.outbox.stats();
        if (s.pending >= 10000) throw new Error(`backlog ${s.pending} — relay stuck`);
        return { degraded: s.dead > 0, reason: s.dead > 0 ? `${s.dead} dead letters` : null, detail: `pending ${s.pending}` };
      },
      impact: 'staged domain events are not delivered',
    })
    .register('telemetry_exporter', {
      probe: async () => ({
        degraded: platform.otel.enabled && platform.otel.dropped > 0,
        reason: platform.otel.dropped > 0 ? `${platform.otel.dropped} spans dropped` : null,
        detail: platform.otel.enabled ? 'exporting' : 'export disabled',
      }),
      critical: false,
      impact: 'traces stop reaching the collector (requests unaffected)',
    })
    .register('workers', {
      probe: async () => {
        const dead = platform.payments ? platform.payments.retryQueue.deadLetters.length : 0;
        return { degraded: dead > 0, reason: dead > 0 ? `${dead} payment dead letters` : null, detail: 'payment retry worker' };
      },
      critical: false,
      impact: 'payment retries queue up for manual review',
    })
    .register('storage', {
      probe: async () => ({ detail: `${store.collections.size} collections` }),
      impact: 'all reads/writes fail',
    })
    .register('external_apis', {
      probe: async () => ({ detail: platform.payments ? `${platform.payments.providers.size} payment providers` : 'n/a' }),
      critical: false,
      impact: 'collections/payouts to mobile-money operators degrade',
    });
  // Readiness consumes CACHED dependency states synchronously; /health/full
  // and the admin surface refresh them via checkAll().
  platform.health.register('dependencies', () => {
    const v = platform.dependencies.verdict();
    return { healthy: v.healthy, degraded: v.degraded, detail: v.attention.length ? v.attention.join(', ') : 'all healthy' };
  });
  // Mission 2: identity-aware adaptive rate limiting. Anonymous traffic is
  // DELEGATED to platform.rateLimiter (read per-request), so existing
  // anonymous semantics — and runtime limiter swaps — are preserved exactly.
  platform.rateLimiterAdaptive = new AdaptiveRateLimiter({ platform, clock, metrics });
  // Mission 5: runtime intelligence — Node heap/GC/event-loop telemetry with
  // predictive insights. Opt-in sampling (started by the server, not by the
  // container, so tests/imports don't spin a timer). Registered as a
  // dependency and used as the load-shedder's event-loop-lag signal.
  platform.runtime = new RuntimeIntelligence({ clock, metrics });
  platform.dependencies.register('event_loop', {
    probe: async () => {
      const lag = platform.runtime.loopLagMs();
      return { degraded: lag > 100, reason: lag > 100 ? `event-loop p99 ${lag}ms` : null, detail: `p99 ${lag}ms` };
    },
    critical: false,
    impact: 'request latency rises; sustained stalls shed load',
  });
  // Mission 8: resilience — circuit breakers, bulkheads, retries, load
  // shedding, self-healing. The shedder reads the runtime's event-loop lag;
  // the self-healer reacts to dependency-state transitions.
  platform.resilience = new Resilience({ clock, metrics });
  platform.resilience.shedder.lagProvider = () => platform.runtime.loopLagMs();
  platform.resilience.attachHealer({ dependencies: platform.dependencies, logger: null });
  platform.resilience.healer.register('drain_outbox_on_relay_recovery', {
    dependency: 'outbox_relay',
    action: async () => platform.outbox.drain(),
  });
  platform.resilience.healer.register('flush_spans_on_exporter_recovery', {
    dependency: 'telemetry_exporter',
    action: async () => ({ flushed: !!platform.otel.flush() }),
  });
  // Mission 6: distributed configuration platform. Typed, validated,
  // versioned runtime knobs that live-APPLY into the running resilience/
  // observability subsystems with ZERO restart. Each `apply` mutates the
  // already-constructed object (all knobs are plain mutable fields).
  platform.config = new ConfigService({ clock, audit, bus, metrics });
  const posInt = (v) => (Number.isInteger(v) && v > 0) || 'must be a positive integer';
  const ratio01 = (v) => (v >= 0 && v <= 1) || 'must be between 0 and 1';
  platform.config.register('resilience.redis.breaker.failureThreshold', {
    type: 'number', defaultValue: 5, validate: posInt, emergencyManaged: true, safeValue: 3,
    description: 'Failures in the rolling window before the Redis circuit opens',
    apply: (v) => { platform.resilience.breaker('redis').failureThreshold = v; },
  });
  platform.config.register('resilience.redis.breaker.cooldownMs', {
    type: 'number', defaultValue: 10000, validate: posInt,
    description: 'Redis breaker open→half-open cooldown (ms)',
    apply: (v) => { platform.resilience.breaker('redis').cooldownMs = v; },
  });
  platform.config.register('resilience.redis.bulkhead.maxConcurrent', {
    type: 'number', defaultValue: 50, validate: posInt, emergencyManaged: true, safeValue: 20,
    description: 'Max concurrent Redis operations (bulkhead)',
    apply: (v) => { platform.resilience.bulkhead('redis').maxConcurrent = v; },
  });
  platform.config.register('resilience.loadShedding.maxInFlight', {
    type: 'number', defaultValue: 500, validate: posInt, emergencyManaged: true, safeValue: 150,
    description: 'In-flight request cap before shedding normal traffic',
    apply: (v) => { platform.resilience.shedder.maxInFlight = v; },
  });
  platform.config.register('resilience.loadShedding.lagThresholdMs', {
    type: 'number', defaultValue: 500, validate: posInt,
    description: 'Event-loop lag (ms) that triggers load shedding',
    apply: (v) => { platform.resilience.shedder.lagThresholdMs = v; },
  });
  platform.config.register('resilience.retry.budgetRatio', {
    type: 'number', defaultValue: 0.1, validate: ratio01,
    description: 'Retry budget as a fraction of first-attempt calls',
    apply: (v) => { for (const b of platform.resilience.budgets.values()) b.ratio = v; },
  });
  platform.config.register('health.probe.timeoutMs', {
    type: 'number', defaultValue: 1500, validate: posInt,
    description: 'Dependency health-probe timeout (ms)',
    apply: (v) => { platform.dependencies.timeoutMs = v; },
  });
  platform.config.register('telemetry.otel.batchSize', {
    type: 'number', defaultValue: 128, validate: posInt,
    description: 'OTLP exporter span batch size',
    apply: (v) => { platform.otel.batchSize = v; },
  });
  platform.config.register('events.outbox.maxAttempts', {
    type: 'number', defaultValue: 5, validate: posInt,
    description: 'Outbox delivery attempts before dead-lettering',
    apply: (v) => { platform.outbox.maxAttempts = v; },
  });
  // Mission 9: predictive capacity planning over the runtime-intelligence
  // history + event-platform/store growth. Records on a cadence (health cycle).
  platform.capacity = new CapacityPlanner({ clock, platform });
  // Data products over existing CQRS projections (query-side, classified).
  platform.dataProducts.register({ name: 'platform_activity', classification: 'internal', requiredRole: 'platform_admin', description: 'Curated platform event counters' });
  platform.dataProducts.register({ name: 'payments_summary', classification: 'restricted', requiredRole: 'platform_admin', description: 'Aggregate card settlement figures' });
  platform.dataProducts.register({ name: 'qr_activity', classification: 'internal', description: 'QR generation/scan/revocation counts' });

  platform.assurance = new AssuranceService({ store, clock, identity, secrets, fraud, audit, bus });
  // Rotation automation: webhook secrets rotate quarterly by policy. The
  // card provider joins the same loop (webhook:card); gateway webhook
  // secrets rotate through the card admin surface (WS10/WS11).
  for (const providerName of platform.payments.providers.keys()) {
    platform.assurance.setRotationPolicy(`webhook:${providerName}`, 90);
  }

  platform.backups = new BackupService({ clock });
  platform.ops = new OpsService({ store, clock, bus, audit, platform });

  // ── Phase 3: configurable workflow engine (WS4) ────────────────────
  platform.workflows = new WorkflowService({
    store, clock, identity, audit, bus, notifications,
  });
  // Action handlers bridge the engine to real domain services — the
  // business logic stays where it is; the engine only orchestrates.
  platform.workflows.registerHandler('identity.grant_l2', (instance, step, ctx) =>
    identity.endorseWardResidency(ctx.user_ref, ctx.ward_ref, ctx.endorser_ref)
  );
  platform.workflows.registerHandler('heritage.elevate', (instance, step, ctx) =>
    heritage.validate(ctx.item_ref, ctx.custodian_ref, { decision: 'elevate' })
  );
  platform.workflows.registerHandler('governance.grant_seat', (instance, step, ctx) =>
    governance.grantSeat(ctx.council_id, { kind: ctx.kind, holderRef: ctx.holder_ref }, ctx.actor_ref)
  );
  platform.workflows.registerHandler('governance.freeze_seat', (instance, step, ctx) =>
    governance.freezeSeat(ctx.seat_id, ctx.reason || 'succession contested', ctx.actor_ref)
  );
  platform.workflows.registerHandler('kgetsi.release_milestone', (instance, step, ctx) => {
    // The engine's dual-approval gate carries the two distinct approvers;
    // record them at the kgetsi layer (defence in depth — the domain
    // service still enforces its own invariant) then release.
    const gate = instance.step_states.find((s) => s.step_id === 'dual_approval');
    const approvers = (gate ? gate.approvals : [])
      .filter((a) => a.decision === 'approve')
      .map((a) => a.approver_ref);
    for (const approver of approvers) {
      try {
        kgetsi.approveMilestone(ctx.campaign_id, ctx.milestone_id, approver);
      } catch (e) {
        if (e.code !== 'STATE_CONFLICT') throw e; // already recorded — fine
      }
    }
    return kgetsi.releaseMilestone(ctx.campaign_id, ctx.milestone_id, ctx.actor_ref, {
      destAccountId: ctx.dest_account_id,
      idempotencyKey: `wf:${instance.id}:${step.id}`,
    });
  });
  platform.workflows.registerHandler('letlole.execute_resolution', (instance, step, ctx) => ctx);
  platform.workflows.registerHandler('governance.open_election', (instance, step, ctx) => {
    const election = governance.openElection(ctx.council_id, ctx.seat_description, ctx.actor_ref);
    return { context: { election_id: election.id }, election_id: election.id };
  });
  platform.workflows.registerHandler('governance.close_election', (instance, step, ctx) =>
    governance.closeElection(ctx.election_id, ctx.actor_ref, ctx.eligible || 0)
  );
  platform.workflows.registerHandler('governance.resolve_dispute', (instance, step, ctx) =>
    governance.resolveDispute(ctx.dispute_id, ctx.resolution || 'resolved via workflow', ctx.actor_ref)
  );
  for (const definition of SEED_WORKFLOWS) {
    platform.workflows.defineWorkflow(definition, 'system:bootstrap');
  }

  // ── Phase 3: plugin architecture (WS5) ─────────────────────────────
  platform.plugins = new PluginManager({
    store, clock, audit, platform,
    signingSecret: process.env.MOTSE_PLUGIN_SECRET || `${secret}-plugins`,
  });

  // ── Phase 3: AI evaluation (WS9) + security scorecard (WS8) ────────
  platform.aiEvaluator = new AiEvaluator({ ai: platform.ai, clock, audit });
  platform.securityScorecard = new SecurityScorecard({ platform, clock });

  // ── Phase 3: developer platform (WS12) ─────────────────────────────
  platform.developer = new DeveloperService({
    store, clock, audit, bus, secrets,
    rateLimiterFactory: (opts) => new RateLimiter({ clock, ...opts }),
  });

  // ── Phase 3: localization (WS13) — Setswana-first (§4) ─────────────
  platform.i18n = new I18n();
  notifications.bindI18n(platform.i18n, identity);

  // Built last: sees every registered event schema (see module docs).
  platform.metrics = metrics; // the shared registry threaded through the Foundation
  // Structured logs auto-enriched with the active trace context (Phase A):
  // every line carries service + trace_id/span_id when emitted inside a span,
  // so logs join traces in Loki/Elasticsearch/OpenSearch without call-site work.
  platform.logger = new Logger({
    clock,
    sink: logSink,
    context: () => {
      const ctx = tracer.currentContext();
      return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {};
    },
  }).with({ service: process.env.OTEL_SERVICE_NAME || 'motse-core' });
  platform.monitoring = new MonitoringService({
    metrics: platform.metrics,
    logger: platform.logger,
    clock,
    bus,
    platform,
  });

  return platform;
}

/** Live credentials come from env; absent → sandbox mode (like Tirelo). */
function providerOptions(prefix) {
  const key = process.env[`MOTSE_${prefix}_API_KEY`];
  return key
    ? {
        live: true,
        credentials: {
          apiKey: key,
          apiSecret: process.env[`MOTSE_${prefix}_API_SECRET`] || null,
          merchantId: process.env[`MOTSE_${prefix}_MERCHANT_ID`] || null,
        },
      }
    : {};
}

/**
 * Gateway credentials come from env (MOTSE_GATEWAY_<NAME>_API_KEY); absent
 * → sandbox mode. Optional brand/currency overrides let an operator narrow
 * a gateway's routing profile without a code change (WS1/WS2).
 */
function gatewayOptions(name) {
  const prefix = `MOTSE_GATEWAY_${name.toUpperCase()}`;
  const key = process.env[`${prefix}_API_KEY`];
  const brands = process.env[`${prefix}_BRANDS`];
  const currencies = process.env[`${prefix}_CURRENCIES`];
  const options = {};
  if (key) {
    options.live = true;
    options.credentials = { apiKey: key, apiSecret: process.env[`${prefix}_API_SECRET`] || null };
  }
  if (brands) options.supportedBrands = brands.split(',').map((s) => s.trim()).filter(Boolean);
  if (currencies) options.supportedCurrencies = currencies.split(',').map((s) => s.trim()).filter(Boolean);
  return options;
}

module.exports = { createPlatform };
