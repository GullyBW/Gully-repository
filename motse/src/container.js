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
  const store = new Store();
  const clock = new Clock();
  const bus = new EventBus(clock);
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

  platform.assurance = new AssuranceService({ store, clock, identity, secrets, fraud, audit, bus });
  // Rotation automation: webhook secrets rotate quarterly by policy.
  for (const providerName of platform.payments.providers.keys()) {
    platform.assurance.setRotationPolicy(`webhook:${providerName}`, 90);
  }

  platform.backups = new BackupService({ clock });
  platform.ops = new OpsService({ store, clock, bus, audit, platform });

  // Built last: sees every registered event schema (see module docs).
  platform.metrics = new Metrics();
  platform.logger = new Logger({ clock, sink: logSink });
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

module.exports = { createPlatform };
