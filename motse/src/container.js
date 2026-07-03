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

/**
 * Composition root — the modular monolith (P6). Domains live behind hard
 * interface boundaries in one deployable; Identity, Ledger and Media are
 * modelled as extracted services (their only coupling is the container).
 */
function createPlatform({ secret = process.env.MOTSE_SECRET || 'motse-dev-secret' } = {}) {
  const store = new Store();
  const clock = new Clock();
  const bus = new EventBus(clock);
  const idempotency = new IdempotencyRegistry(clock);
  const audit = new AuditLog(store, clock);

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

  const platform = {
    store,
    clock,
    bus,
    idempotency,
    audit,
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
  };

  platform.sync = new OutboxSyncService(platform);
  platform.ussd = new UssdGateway(platform);
  platform.sms = new SmsGateway(platform);
  return platform;
}

module.exports = { createPlatform };
