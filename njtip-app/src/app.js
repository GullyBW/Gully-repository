'use strict';
// Composition root (clean architecture): builds config + adapters + domain workflow.
// This is the ONE place that chooses SYNTHETIC vs PRODUCTION adapters, so the rest of
// the code depends only on ports. Swapping persistence (memory→file→Postgres), auth
// (synthetic→OIDC/FIDO2), or crypto (synthetic→HSM) happens here, not in business logic.
const configMod = require('./config');
const { makeStore } = require('./adapters/store');
const { SessionManager } = require('./adapters/session');
const { Logger, Metrics, Health, Tracer } = require('./adapters/observability');
const slo = require('./observability/slo');
const { NotificationService } = require('./adapters/notifications');
const { makeKeyManager } = require('./adapters/kms');
const { makeObjectStore } = require('./adapters/object-store');
const { makeBroker } = require('./adapters/broker');
const { makeOidcVerifier } = require('./adapters/oidc');
const { makeNotificationProviders } = require('./adapters/notify-providers');
const { makeCache } = require('./adapters/cache');
const { makeSecretsManager } = require('./adapters/secrets');
const { makeCertificateManager } = require('./adapters/certificates');
const { makeIntegrationGateway } = require('./adapters/integrations');
const { makeFeatureFlags } = require('./adapters/flags');
const { Workflow } = require('./workflow');
const { EventStore } = require('./eventsourcing/event-store');
const authz = require('./authz');
const { PolicySet, DEFAULT_POLICIES } = require('./iam/policy-engine');
const zeroTrust = require('./iam/zero-trust');
const { TenantRegistry, CollaborationBroker } = require('./tenancy/tenant');
const { KnowledgeGraph } = require('./graph/graph');
const advisor = require('./ai/advisor');
const { RecommendationQueue } = require('./ai/approval');
const { WorkflowEngine, DEFAULT_WORKFLOW } = require('./orchestration/workflow-engine');
const { CustodyLedger } = require('./custody/ledger');
const complianceMod = require('./compliance/compliance');
const { SpatialIndex } = require('./geo/gis');
const { runTwin, runApp, runInfra } = require('./twin-validate');
const { invariantsHeld } = require('./twin-validate');
const { ZONES } = require('./twin');

function createApp(overrides = {}) {
  const cfg = overrides.config || configMod.load();
  const metrics = new Metrics();
  const logger = new Logger(cfg.logLevel);
  const health = new Health();
  const tracer = new Tracer();
  // SLO evaluation from live metrics (availability + latency error budgets + alerts).
  const evaluateSlo = () => {
    const c = metrics.counters(); let total = 0, failed = 0;
    for (const [k, v] of Object.entries(c)) { if (k.startsWith('njtip_http_requests_total')) { total += v; if (/status="?5\d\d"?/.test(k)) failed += v; } }
    return slo.evaluate(slo.computeSlis({ total, failed, latencies: metrics.samples('njtip_http_latency_ms') }));
  };
  const session = new SessionManager({ secret: cfg.SESSION_SECRET, ttlMs: cfg.sessionTtlMs });
  // OIDC/OAuth2 verifier — an alternative auth port for IdP-issued bearer tokens. The
  // server accepts either a session token or a verified OIDC token (no privilege change).
  const oidc = makeOidcVerifier(cfg);

  // Zone-isolated persistence for the Independent-zone projections + notifications
  // (separate collections → no key collision).
  const statusRepo = makeStore(ZONES.INDEPENDENT, cfg, 'reports');
  const notifications = new NotificationService(makeStore(ZONES.INDEPENDENT, cfg, 'notifications'));
  // Investigator workload counters live in the Executive zone (operational routing).
  const workloadRepo = makeStore(ZONES.EXECUTIVE, cfg, 'workload');

  // Production adapters behind stable ports (swappable at this composition root only):
  // 🔒 key management (encryption at rest), evidence object storage (ciphertext-only),
  // message broker (PII-free outbox), and staff notification providers.
  const keyManager = makeKeyManager(cfg);
  const objectStore = makeObjectStore(keyManager, cfg);
  const broker = makeBroker(cfg);
  const notifyProviders = makeNotificationProviders(cfg);
  const cache = makeCache(cfg);
  const secrets = makeSecretsManager(cfg);
  const certs = makeCertificateManager(cfg);
  const integrations = makeIntegrationGateway(cfg);
  const flags = makeFeatureFlags(cfg);

  // Event store (Phase 11): immutable, hash-chained write-side log. Additive — the read
  // models keep serving queries; every workflow transition also appends a PII-free event.
  const events = new EventStore();

  const workflow = overrides.workflow || new Workflow({
    seed: overrides.seed ?? 1, ledgerFile: overrides.ledgerFile, statusRepo, notifications, metrics, workloadRepo, events,
  });

  health.register('workflow', () => !!workflow);
  health.register('audit-integrity', () => workflow.audit.verifyIntegrity().ok);
  health.register('custody-integrity', () => workflow.evidence.verifyCustodyChain().ok);
  health.register('architecture-invariants', () => { try { return invariantsHeld(); } catch (_) { return false; } });
  health.register('event-log-integrity', () => workflow.verifyEventIntegrity().ok);
  // KMS liveness self-test: encrypt→decrypt a probe (never touches real data).
  health.register('key-management', () => { try { return keyManager.decrypt(keyManager.encrypt(ZONES.EXECUTIVE, 'healthcheck')) === 'healthcheck'; } catch (_) { return false; } });

  const auth = { verify: (token) => session.verify(token) || oidc.verify(token) };
  // National IAM (Phase 12) + Zero Trust (Phase 19): policy-as-data engine (configurable
  // without code), device trust, and break-glass emergency access.
  const policies = new PolicySet(cfg.policies || DEFAULT_POLICIES);
  const devices = new zeroTrust.DeviceRegistry();
  const breakGlass = new zeroTrust.BreakGlass();
  const iam = { policies, devices, breakGlass, trustScore: zeroTrust.trustScore, continuousAuthz: zeroTrust.continuousAuthz };
  // Multi-tenant government platform (Phase 22) + knowledge graph (Phase 23).
  const tenants = new TenantRegistry();
  const collaboration = new CollaborationBroker(tenants);
  const graph = new KnowledgeGraph();
  // Advisory-only AI (Phase 13) with a human-approval queue, and the configurable workflow
  // orchestration engine (Phase 20). The AI never acts; the engine only routes.
  const ai = { advisor, queue: new RecommendationQueue() };
  const orchestration = new WorkflowEngine();
  orchestration.register(DEFAULT_WORKFLOW);
  // Enterprise chain of custody (Phase 16), GIS (Phase 15), and compliance automation
  // (Phase 25). Compliance assesses from the live fitness gate; it never authorizes.
  const custody = new CustodyLedger();
  const gis = new SpatialIndex();
  const compliance = { assess: () => complianceMod.assess([...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass }))) };

  logger.info('app.initialized', { mode: cfg.mode, persistence: cfg.persistence, version: cfg.version });
  // Certificate rotation health: no certificate should be past-due for rotation.
  health.register('certificate-rotation', () => certs.dueForRotation().length === 0);

  return { cfg, metrics, logger, health, tracer, evaluateSlo, session, oidc, auth, authz, iam, tenants, collaboration, graph, ai, orchestration, custody, gis, compliance, keyManager, objectStore, broker, notifyProviders, cache, secrets, certs, integrations, flags, events, workflow };
}

module.exports = { createApp };
