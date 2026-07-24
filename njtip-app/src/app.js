'use strict';
// Composition root (clean architecture): builds config + adapters + domain workflow.
// This is the ONE place that chooses SYNTHETIC vs PRODUCTION adapters, so the rest of
// the code depends only on ports. Swapping persistence (memory→file→Postgres), auth
// (synthetic→OIDC/FIDO2), or crypto (synthetic→HSM) happens here, not in business logic.
const configMod = require('./config');
const { makeStore } = require('./adapters/store');
const { SessionManager } = require('./adapters/session');
const { Logger, Metrics, Health } = require('./adapters/observability');
const { NotificationService } = require('./adapters/notifications');
const { makeKeyManager } = require('./adapters/kms');
const { makeObjectStore } = require('./adapters/object-store');
const { makeBroker } = require('./adapters/broker');
const { makeOidcVerifier } = require('./adapters/oidc');
const { makeNotificationProviders } = require('./adapters/notify-providers');
const { Workflow } = require('./workflow');
const authz = require('./authz');
const { invariantsHeld } = require('./twin-validate');
const { ZONES } = require('./twin');

function createApp(overrides = {}) {
  const cfg = overrides.config || configMod.load();
  const metrics = new Metrics();
  const logger = new Logger(cfg.logLevel);
  const health = new Health();
  const session = new SessionManager({ secret: cfg.SESSION_SECRET, ttlMs: cfg.sessionTtlMs });
  // OIDC/OAuth2 verifier — an alternative auth port for IdP-issued bearer tokens. The
  // server accepts either a session token or a verified OIDC token (no privilege change).
  const oidc = makeOidcVerifier(cfg);

  // Zone-isolated persistence for the Independent-zone projections + notifications
  // (separate collections → no key collision).
  const statusRepo = makeStore(ZONES.INDEPENDENT, cfg, 'reports');
  const notifications = new NotificationService(makeStore(ZONES.INDEPENDENT, cfg, 'notifications'));

  // Production adapters behind stable ports (swappable at this composition root only):
  // 🔒 key management (encryption at rest), evidence object storage (ciphertext-only),
  // message broker (PII-free outbox), and staff notification providers.
  const keyManager = makeKeyManager(cfg);
  const objectStore = makeObjectStore(keyManager, cfg);
  const broker = makeBroker(cfg);
  const notifyProviders = makeNotificationProviders(cfg);

  const workflow = overrides.workflow || new Workflow({
    seed: overrides.seed ?? 1, ledgerFile: overrides.ledgerFile, statusRepo, notifications, metrics,
  });

  health.register('workflow', () => !!workflow);
  health.register('audit-integrity', () => workflow.audit.verifyIntegrity().ok);
  health.register('custody-integrity', () => workflow.evidence.verifyCustodyChain().ok);
  health.register('architecture-invariants', () => { try { return invariantsHeld(); } catch (_) { return false; } });
  // KMS liveness self-test: encrypt→decrypt a probe (never touches real data).
  health.register('key-management', () => { try { return keyManager.decrypt(keyManager.encrypt(ZONES.EXECUTIVE, 'healthcheck')) === 'healthcheck'; } catch (_) { return false; } });

  const auth = { verify: (token) => session.verify(token) || oidc.verify(token) };

  logger.info('app.initialized', { mode: cfg.mode, persistence: cfg.persistence, version: cfg.version });
  return { cfg, metrics, logger, health, session, oidc, auth, authz, keyManager, objectStore, broker, notifyProviders, workflow };
}

module.exports = { createApp };
