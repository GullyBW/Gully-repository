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

  const notifications = new NotificationService(
    { store, clock, bus, identity },
    notificationAdapters
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
  };

  platform.sync = new OutboxSyncService(platform);
  platform.ussd = new UssdGateway(platform);
  platform.sms = new SmsGateway(platform);
  platform.search = new SearchService({ store, clock, bus, platform });
  platform.ai = new AiRegistry({ media, heritage, audit, clock });

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
