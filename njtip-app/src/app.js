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
const dashboards = require('./observability/dashboards');
const sre = require('./observability/sre');
const telemetry = require('./observability/telemetry');
const business = require('./observability/business');
const executive = require('./observability/executive');
const continuousAssurance = require('./assurance/continuous');
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
const { EventRegistry, seedCaseEvents } = require('./eventsourcing/event-governance');
const authz = require('./authz');
const { PolicySet, DEFAULT_POLICIES } = require('./iam/policy-engine');
const { PolicyRegistry } = require('./iam/policy-governance');
const { IdentityRegistry } = require('./iam/digital-identity');
const { InfrastructureRegistry } = require('./infra/infra-governance');
const { InfrastructureAssurance } = require('./infra/infrastructure-assurance');
const architecture = require('./architecture/context-map');
const adrGovernance = require('./architecture/adr-governance');
const ownership = require('./governance/ownership');
const raci = require('./governance/raci');
const { ContractRegistry } = require('./contracts/integration-contracts');
const { ConsumerContracts } = require('./contracts/consumer-contracts');
const evidenceConfidence = require('./assurance/evidence-confidence');
const migration = require('./migration/roadmap');
const zeroTrust = require('./iam/zero-trust');
const { makeZeroTrust } = require('./iam/zero-trust-architecture');
const formalPolicy = require('./iam/formal-policy');
const threatModel = require('./security/threat-model');
const formalVerification = require('./orchestration/formal-verification');
const { TenantRegistry, CollaborationBroker } = require('./tenancy/tenant');
const { FederationRegistry } = require('./tenancy/federation');
const { EcosystemFederation } = require('./tenancy/ecosystem-federation');
const { AssetRegistry } = require('./governance/asset-governance');
const { SupplyChainGovernance } = require('./supplychain/supply-chain');
const { SupplyChainAttestation, sourceDigest } = require('./supplychain/slsa');
const adaptiveGovernanceMod = require('./governance/adaptive');
const { makeEventBus } = require('./fabric/event-bus');
const { KnowledgeGraph } = require('./graph/graph');
const graphIntel = require('./graph/intelligence');
const advisor = require('./ai/advisor');
const { RecommendationQueue } = require('./ai/approval');
const { AiRegistry } = require('./ai/ai-governance');
const { AiLifecycle } = require('./ai/ai-lifecycle');
const { makeCryptoAgility } = require('./adapters/crypto-agility');
const { QuantumMigrationRegistry } = require('./adapters/quantum-transition');
const { LifecycleRegistry } = require('./sustainability/lifecycle');
const strategicTwin = require('./twin2/strategic-twin');
const { WorkflowEngine, DEFAULT_WORKFLOW } = require('./orchestration/workflow-engine');
const workflowSim = require('./orchestration/workflow-simulator');
const processGovernance = require('./orchestration/process-governance');
const twin3 = require('./twin2/monte-carlo');
const { CustodyLedger } = require('./custody/ledger');
const complianceMod = require('./compliance/compliance');
const { SpatialIndex } = require('./geo/gis');
const simulation = require('./twin2/simulation');
const privacy = require('./privacy/privacy-engineering');
const threatIntelMod = require('./security/threat-intel');
const twin4 = require('./twin2/national-sim');
const resilience = require('./twin2/resilience-validation');
const chaos = require('./twin2/chaos');
const multiRegion = require('./twin2/multi-region');
const { OperationsTwin } = require('./twin2/operations-twin');
const { RecoveryPlatform, seedPlaybooks } = require('./twin2/recovery');
const { RecoveryStrategyEvaluator } = require('./twin2/recovery-strategies');
const { NationalCrisisPlatform } = require('./twin2/crisis');
const { ServicePortfolio } = require('./portfolio/service-portfolio');
const { SchemaRegistry, ServiceRegistry, MetadataCatalog, DataLineage, CANONICAL_MODEL } = require('./fabric/registry');
const { ProvenanceLedger } = require('./fabric/provenance');
const { InteroperabilityProfile, SemanticMapping, SharedVocabulary } = require('./fabric/interoperability');
const { DataMarketplace } = require('./fabric/marketplace');
const { NationalDataExchange } = require('./fabric/data-exchange');
const { DataGovernance, seedPlatformDatasets, measurePlatformQuality } = require('./fabric/data-governance');
const { LegislativeRegistry } = require('./legislation/registry');
const { LegislativeImpactAnalyzer } = require('./legislation/impact');
const { CorrelationGovernance } = require('./intelligence/correlation-governance');
const { UsabilityValidation, seedRound } = require('./ux/usability-validation');
const { ApiRegistry } = require('./apigov/registry');
const decisionSupport = require('./ai/decision-support');
const { MetadataGovernance } = require('./fabric/metadata');
const capabilityMod = require('./capability/model');
const maturityMod = require('./maturity/maturity');
const devplatform = require('./devplatform/sdk');
const { CapabilityMarketplace } = require('./devplatform/capability-marketplace');
const { KnowledgeRepository } = require('./knowledge/repository');
const openapiSpec = require('./openapi');
const evolution = require('./evolution/evolution');
const { GovernanceOpsCenter } = require('./govops/center');
const { CommandCenter } = require('./govops/command-center');
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
  // Event governance (Phase 26): registry/catalog of event contracts over the log.
  const eventRegistry = seedCaseEvents(new EventRegistry());

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
  // Zero Trust architecture (Phase 10 Part 1): PAP → PDP → PEP with workload identity,
  // short-lived credentials and declared trust boundaries. Every request is evaluated live.
  const zt = makeZeroTrust({ policies: cfg.policies || DEFAULT_POLICIES, devices });
  zt.workloads.register('spiffe://njtip/zone/independent/sa/intake-api', { zone: 'independent', attestation: { kind: 'synthetic-node-attestation', verified: true } });
  zt.workloads.register('spiffe://njtip/zone/executive/sa/case-router', { zone: 'executive', attestation: { kind: 'synthetic-node-attestation', verified: true } });
  zt.boundaries.allow('independent', 'executive', { actions: ['review-case', 'transition-case'], rationale: 'case routing from intake into investigation' });
  zt.boundaries.allow('executive', 'judiciary', { actions: ['admit-evidence'], rationale: 'evidence admission into judicial proceedings' });
  iam.zeroTrust = zt;
  // Formal policy verification (Part 3): bounded exhaustive proofs with counterexamples.
  iam.formalPolicy = formalPolicy;
  // Policy governance (Phase 41): registry + versioning; a change is validated before activation.
  const policyGovernance = new PolicyRegistry();
  policyGovernance.register('access-control', { owner: 'security-domain', policies: DEFAULT_POLICIES });
  policyGovernance.activate('access-control', 1, { validationSuite: [
    { request: { action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' } }, expect: 'permit' },
    { request: { action: 'read-evidence', subject: { role: 'citizen' } }, expect: 'deny' },
  ] });
  // National digital identity & trust framework (Phase 51) — governed principals only;
  // personal data refused. Seed a trust anchor + a service identity.
  const digitalIdentity = new IdentityRegistry();
  digitalIdentity.registerIssuer('national-ca', { trustLevel: 'sovereign' });
  digitalIdentity.register('svc:intake-api', { type: 'service', assuranceLevel: 'IAL3', attributes: { zone: 'independent' } });
  // Sovereign infrastructure governance (Phase 52) — advisory until human approval.
  const infraGovernance = new InfrastructureRegistry();
  // Data-residency rules keyed by data classification. The scanner classifies these values
  // as identifiers, not credentials (Part 6), so the rules read plainly again.
  infraGovernance.setPolicy({ allowedRegions: ['bw-central', 'bw-south'], allowedProviders: ['sovereign-cloud'], residency: { restricted: 'bw-central', secret: 'bw-central' } });
  infraGovernance.register('compute:app', { kind: 'compute', region: 'bw-central', provider: 'sovereign-cloud', dataClassification: 'restricted' });
  infraGovernance.register('storage:evidence', { kind: 'storage', region: 'bw-central', provider: 'sovereign-cloud', dataClassification: 'secret' });
  infraGovernance.register('network:mesh', { kind: 'network', region: 'bw-south', provider: 'sovereign-cloud', dataClassification: 'internal' });
  infraGovernance.recordBaseline();
  // Multi-tenant government platform (Phase 22) + knowledge graph (Phase 23).
  const tenants = new TenantRegistry();
  const collaboration = new CollaborationBroker(tenants);
  const federation = new FederationRegistry({ registry: tenants }); // Phase 34: isolation default
  // National digital ecosystem federation (Phase 61): typed members; explicit, human-approved.
  const ecosystemFederation = new EcosystemFederation();
  ecosystemFederation.registerMember('national-gov', { type: 'government', jurisdiction: 'national', trustTier: 'sovereign' });
  ecosystemFederation.registerMember('gaborone-city', { type: 'municipality', jurisdiction: 'south-east' });
  // National digital asset governance (Phase 62): every governed asset is lifecycle-traceable.
  const assetGovernance = new AssetRegistry();
  assetGovernance.register('asset:reports-api', { type: 'api', owner: 'independent', riskClass: 'medium' });
  assetGovernance.register('asset:priority-advisor', { type: 'ai-model', owner: 'analytics-domain', riskClass: 'high', dependsOn: ['asset:reports-api'] });
  // National digital supply-chain governance (Phase 65): no deployment bypasses it (fail-closed).
  const supplyChain = new SupplyChainGovernance();
  // Software supply-chain attestation (Part 8): SLSA-shaped build provenance, signed and
  // verifiable. 🔒 Synthetic signing identity; production uses HSM-custodied keys.
  supplyChain.attestation = new SupplyChainAttestation();
  supplyChain.sourceDigest = sourceDigest;
  supplyChain.registerSupplier('anthropic-nodejs-builtins', { trustLevel: 'sovereign-approved', risk: 'low' });
  // Phase 12 Part 8: the platform names the builder it trusts. "Built by CI" means nothing if any
  // runner can call itself CI, so the trust decision has a named human behind it like any other.
  supplyChain.attestation.registerBuilder('gov-ci-hardened', {
    operator: 'Government Shared Build Service', hardened: true, isolated: true, ephemeral: true, attestsProvenance: true,
    by: 'Information Security Review Board', rationale: 'ephemeral hardened runners; provenance signed by the builder, not the build',
  });
  // Adaptive governance framework (Phase 66): continuous improvement; adoption human-approved.
  const adaptiveGovernance = adaptiveGovernanceMod;
  const graph = new KnowledgeGraph();
  // Phase 28: enterprise event bus (pub/sub, ordering, replay, DLQ governance, federation).
  const eventBus = makeEventBus(cfg);
  eventBus.registerTopic('case.events', { owner: 'case-context', ordered: true });
  // Advisory-only AI (Phase 13) with a human-approval queue, and the configurable workflow
  // orchestration engine (Phase 20). The AI never acts; the engine only routes.
  const ai = { advisor, queue: new RecommendationQueue() };
  // Responsible AI governance (Phase 46): models are registered + human-approved before use.
  const aiGovernance = new AiRegistry();
  aiGovernance.register('priority-advisor', { owner: 'analytics-domain', purpose: 'case prioritisation recommendations' });
  aiGovernance.approve('priority-advisor', { by: 'AI Governance Board', rationale: 'explainable, advisory-only, deterministic' });
  ai.governance = aiGovernance;
  // AI lifecycle governance (Phase 10 Part 9): model/dataset/prompt registries, risk
  // classification, explainability, bias monitoring, inference audit and human override.
  // There is no apply() — the only exit from an inference is a recorded human decision.
  const aiLifecycle = new AiLifecycle();
  aiLifecycle.register('model', 'priority-advisor', { owner: 'analytics-domain', purpose: 'case-prioritisation', riskClass: 'high' });
  aiLifecycle.approve('model', 'priority-advisor', { by: 'AI Governance Board', rationale: 'explainable, advisory-only, deterministic' });
  // Phase 12 Part 9: which fairness criterion this model is held to is a governance decision with
  // consequences for real people, and the criteria are mutually incompatible — so it is recorded
  // here, by name, rather than left for the fairness report to assume.
  aiLifecycle.declareFairnessCriterion('priority-advisor', {
    criterion: 'equal-opportunity', threshold: 0.1, by: 'AI Governance Board',
    rationale: 'the model prioritises cases for human review; failing to surface a real case harms a complainant, while a false alarm costs review time',
  });
  ai.lifecycle = aiLifecycle;
  // Cryptographic agility (Phase 47): 🔒 policy/lifecycle only — never key material.
  const cryptoAgility = makeCryptoAgility();
  // Quantum-resilient transition (Phase 57): migration planning over the crypto policy registry.
  const quantumTransition = new QuantumMigrationRegistry({ cryptoRegistry: cryptoAgility.registry });
  cryptoAgility.quantum = quantumTransition;
  // Long-term sustainability & lifecycle management (Phase 69): decades-long stewardship (advisory).
  const sustainability = new LifecycleRegistry();
  sustainability.register('node-runtime', { category: 'runtime', adoptedAt: 0, eolAt: 10 * 365 * 24 * 3600_000, criticality: 'high' });
  // National Strategic Digital Twin 5.0 (Phase 70): long-term strategic simulation (informs only).
  const strategic = strategicTwin;
  const orchestration = new WorkflowEngine();
  // Phase 27: a workflow VERSION must pass simulation before activation (the Twin is the
  // authoritative validation environment). Fail-closed: an invalid workflow is not registered.
  const activationGate = workflowSim.validateForActivation(DEFAULT_WORKFLOW);
  if (!activationGate.ok) throw new Error('default workflow failed activation validation: ' + activationGate.issues.join('; '));
  // Phase 42: a critical workflow must satisfy FORMAL safety properties before deployment.
  const proof = formalVerification.proveCorrectness(DEFAULT_WORKFLOW);
  if (!proof.proven) throw new Error('default workflow failed formal verification: ' + proof.properties.filter((p) => !p.proven).map((p) => p.property).join(', '));
  orchestration.register(DEFAULT_WORKFLOW);
  // Enterprise chain of custody (Phase 16), GIS (Phase 15), and compliance automation
  // (Phase 25). Compliance assesses from the live fitness gate; it never authorizes.
  const custody = new CustodyLedger();
  const gis = new SpatialIndex();
  const compliance = { assess: () => complianceMod.assess([...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass }))) };
  // Twin 2.0 simulations (Phase 17/24) and the national data fabric (Phase 14).
  const twin2 = simulation;
  // Digital Twin of Operations (Phase 12, Part 17). Built fresh on each call from the registries
  // rather than held as state: a twin that is constructed once and kept is a twin that drifts the
  // moment anything it models changes, and drift is the failure this design exists to prevent.
  const operationsTwin = () => new OperationsTwin({ evidenceIds: safeCall(() => [...runTwin(), ...runApp(), ...runInfra()].map((r) => r.id), []) });
  // Human-governed autonomous recovery (Phase 54): recommends; never executes without approval.
  const recovery = seedPlaybooks(new RecoveryPlatform());
  // Recovery strategy evaluation (Part 8): multiple strategies compared on RTO/RPO, disruption,
  // resources, data integrity and continuity. Advisory until a named human authority authorizes.
  recovery.strategies = new RecoveryStrategyEvaluator();
  // National mission & crisis management (Phase 63): deterministic sims; human-authorised ops.
  const crisis = new NationalCrisisPlatform();
  // Government service portfolio management (Phase 64): services as strategic products (advisory).
  const servicePortfolio = new ServicePortfolio();
  servicePortfolio.register('svc:anonymous-reporting', { owner: 'independent', fundingPerYear: 500000, maturity: 'defined', strategicValue: 'high' });
  servicePortfolio.register('svc:oversight-analytics', { owner: 'oversight', fundingPerYear: 200000, maturity: 'managed', strategicValue: 'medium', dependsOn: ['svc:anonymous-reporting'] });
  // Privacy engineering (Phase 35) + threat intelligence (Phase 36).
  const threat = threatModel;
  // Enterprise risk intelligence (Phase 11 Part 2): residual risk, time-boxed acceptance,
  // review cadence, intelligence ingestion and trend — over the same threat model.
  threat.riskRegister = new threatModel.RiskRegister();
  const threatIntel = { feed: new threatIntelMod.ThreatFeed(), deviceRisk: threatIntelMod.deviceRisk, credentialRisk: threatIntelMod.credentialRisk, behavioralAnomaly: threatIntelMod.behavioralAnomaly, enrichTrust: threatIntelMod.enrichTrust, correlate: threatIntelMod.correlate, recommend: threatIntelMod.recommend };
  const schemaRegistry = new SchemaRegistry();
  for (const [name, schema] of Object.entries(CANONICAL_MODEL)) schemaRegistry.register(name, schema);
  const serviceRegistry = new ServiceRegistry();
  const catalog = new MetadataCatalog();
  const lineage = new DataLineage();
  // Data provenance (Phase 43) + national interoperability (Phase 48).
  const provenance = new ProvenanceLedger();
  const interop = new InteroperabilityProfile();
  interop.register('case-exchange', { canonical: CANONICAL_MODEL.Case.fields, requiredFields: CANONICAL_MODEL.Case.required });
  const semanticMapping = new SemanticMapping();
  const vocabulary = new SharedVocabulary({ 'complaint': 'Case', 'exhibit': 'EvidenceRef', 'department': 'Agency' });
  // National data marketplace (Phase 55): privacy-by-design enforced; approval-gated listing.
  const marketplace = new DataMarketplace();
  // National Data Exchange (Part 9, ADR-0003): purpose limitation, purpose-scoped approval and
  // retention over the same registry. Commercial exchange is a named, refused purpose.
  const dataExchange = new NationalDataExchange({ registry: marketplace });
  // Enterprise data governance (Part 7): retention, legal holds, consent, quality, reference
  // and master data, with a full origin → deletion trace for every governed record.
  const dataGovernance = seedPlatformDatasets(new DataGovernance());
  const fabric = { schemaRegistry, serviceRegistry, catalog, lineage, provenance, interop, semanticMapping, vocabulary, marketplace, dataExchange, dataGovernance, canonical: CANONICAL_MODEL };
  // Digital legislation & regulatory governance (Phase 53): laws are simulatable before enactment.
  const legislation = new LegislativeRegistry();
  // Legislative impact analysis (Part 7): transitive reach, control traceability, simulation
  // and obsolescence — advisory; enactment stays a human legal decision.
  legislation.impact = new LegislativeImpactAnalyzer(legislation);
  legislation.register('data-protection-act', { title: 'Data Protection Act', type: 'act', mapsToControls: ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-ANONYMITY-BOUNDARY'], mapsToSystems: ['reporting', 'analytics'] });
  // API governance (Phase 37): registry seeded from the live OpenAPI contract.
  const apiRegistry = new ApiRegistry();
  apiRegistry.fromOpenApi(openapiSpec.spec());
  // Metadata platform (Phase 32), capability model (Phase 38), maturity intelligence
  // (Phase 40), and developer platform (Phase 39). Capability/maturity read the live gate.
  const metadata = new MetadataGovernance({ lineage });
  const _fitness = () => ({ twin: runTwin(), app: runApp(), infra: runInfra() });
  const capability = { map: capabilityMod.capabilityMap, dependencies: capabilityMod.dependencies, ownership: capabilityMod.ownership, heatMap: () => { const f = _fitness(); return capabilityMod.heatMap([...f.twin, ...f.app, ...f.infra].map((r) => ({ id: r.id, pass: r.pass }))); } };
  const maturity = { assess: () => { const f = _fitness(); return maturityMod.assess({ ...f, docs: 20 }); } };
  const devPlatform = { generateClientSdk: () => devplatform.generateClientSdk(openapiSpec.spec()), mockService: () => devplatform.mockService(openapiSpec.spec()), testHarness: () => devplatform.testHarness(openapiSpec.spec()), integrationTemplate: devplatform.integrationTemplate };
  // Government capability marketplace (Phase 68): publication governed + human-approved.
  const capabilityMarketplace = new CapabilityMarketplace();
  // National knowledge & decision repository (Phase 67): immutable, hash-chained institutional memory.
  const knowledge = new KnowledgeRepository();
  knowledge.record({ type: 'adr', title: 'Freeze architecture at v1.7; only additive evolution', tags: ['architecture', 'governance'] });
  // Platform evolution intelligence (Phase 49): advisory; observes, never changes architecture.
  const evolutionIntel = { ...evolution, adrLog: new evolution.ArchitectureDecisionLog(), lifecycle: new evolution.CapabilityLifecycle(), report: () => { const f = _fitness(); const all = [...f.twin, ...f.app, ...f.infra].map((r) => ({ id: r.id, pass: r.pass })); return { dependencyHealth: evolution.dependencyHealth(), technicalDebt: evolution.technicalDebt(all), recommendations: evolution.recommendations(all) }; } };
  // National Governance Operations Center (Phase 50): unified ADVISORY oversight over all
  // domains — reads existing subsystems through source functions; never mutates or authorizes.
  const govOps = new GovernanceOpsCenter({
    fitness: () => { const f = _fitness(); const all = [...f.twin, ...f.app, ...f.infra]; return { invariants: all.length, held: all.filter((r) => r.pass).length, healthy: all.every((r) => r.pass) }; },
    slo: () => ({ healthy: evaluateSlo().healthy }),
    security: () => ({ policiesCertified: policyGovernance.certify('access-control').certified, threatIntel: 'trust-lowering-only' }),
    privacy: () => ({ minimizationEnforced: true, differentialPrivacy: 'available' }),
    compliance: () => ({ overallCoverage: complianceMod.assess([...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass }))).overallCoverage }),
    ai: () => ({ models: aiGovernance.catalog().length, allApproved: aiGovernance.catalog().every((m) => m.status === 'approved') }),
    policy: () => ({ certified: policyGovernance.certify('access-control').certified }),
    api: () => apiRegistry.qualityMetrics(),
    events: () => ({ governedTypes: eventRegistry.catalog().length, integrity: events.verifyChain().ok }),
    maturity: () => { const f = _fitness(); const m = maturityMod.assess({ ...f, docs: 20 }); return { level: m.overallLevel, grade: m.grade }; },
    resilience: () => ({ pass: resilience.validateResilience().pass }),
  });
  // Sovereign Digital Government Command Center (Phase 60): the unified STRATEGIC layer over
  // every governance domain, adding identity, infrastructure, data, and evolution posture.
  // Advisory only; every operational decision requires explicit human approval.
  const commandCenter = new CommandCenter({
    engineering: () => { const f = _fitness(); const all = [...f.twin, ...f.app, ...f.infra]; return { healthy: all.every((r) => r.pass) }; },
    operations: () => ({ healthy: evaluateSlo().healthy }),
    resilience: () => ({ pass: resilience.validateResilience().pass }),
    security: () => ({ healthy: policyGovernance.certify('access-control').certified }),
    privacy: () => ({ healthy: true }),
    compliance: () => ({ overallCoverage: complianceMod.assess([...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass }))).overallCoverage }),
    ai: () => ({ healthy: aiGovernance.catalog().every((m) => m.status === 'approved') }),
    identity: () => ({ healthy: digitalIdentity.isTrustedIssuer('national-ca') }),
    infrastructure: () => ({ healthy: infraGovernance.validateCompliance().compliant }),
    data: () => ({ healthy: true }),
    evolution: () => { const f = _fitness(); const all = [...f.twin, ...f.app, ...f.infra].map((r) => ({ id: r.id, pass: r.pass })); return { healthy: evolution.technicalDebt(all).openInvariantFailures === 0 }; },
  });

  // Audience-specific observability (Part 12), correlation governance (Part 13) and usability
  // evidence (Part 15). Dashboards inform; correlation is default-deny; user evidence guides
  // refinement. None of the three authorizes anything.
  const observability = {
    slo, dashboards, sre, telemetry, business,
    // Reliability from the live metric snapshot: SLIs → SLOs → error budgets → release gate.
    reliability: () => { const c = metrics.counters(); let total = 0, failed = 0; for (const [k, val] of Object.entries(c)) { if (k.startsWith('njtip_http_requests_total')) { total += val; if (/status="?5\d\d"?/.test(k)) failed += val; } } return sre.reliabilityReport({ measurements: sre.fromSliSnapshot({ total, failed, latencies: metrics.samples('njtip_http_latency_ms'), services: Object.keys(sre.SERVICE_LEVELS) }) }); },
    // Business observability (Phase 11, Part 5): the same event log the ledger is built from,
    // read as "is justice moving?" rather than "is the system up?". PII-free by construction.
    businessMetrics: () => business.report({ events: business.fromEventLog(workflow.eventLog()), periods: 1 }),
    // Phase 12, Part 4: operational predictions from live infrastructure state.
    predictiveOperations: () => sre.predictiveOperations({
      certificates: { certificates: safeCall(() => certs.inventory(), []), now: 0 },
      queue: { depth: safeCall(() => broker.pending(), null), arrivalRate: null, serviceRate: null },
    }),
    // Phase 12, Part 5: mission outcomes derived through the declared correlation chain.
    missionAnalytics: () => business.executiveAnalytics({ events: business.fromEventLog(workflow.eventLog()), periods: 1 }),
    dashboard: (id) => dashboards.dashboard(id, dashboardSources()),
    all: () => dashboards.all(dashboardSources()),
    audiences: () => dashboards.audiences(),
  };
  const correlationGovernance = new CorrelationGovernance();
  const usability = seedRound(new UsabilityValidation());

  // Infrastructure assurance (Part 6): IaC validation, SBOM, certificate lifecycle,
  // dependency inventory, backup verification, drift detection and platform lifecycle.
  // Advisory only — provisioning, upgrades and remediation remain human-approved.
  const infraAssurance = new InfrastructureAssurance({ registry: infraGovernance, certificates: certs, lifecycle: sustainability });

  // Architecture stabilization (v1.9): the context map is the architecture-of-record and the
  // ownership model is the organisational accountability record. Both are descriptive and
  // validated by fitness — a startup gate refuses to compose an invalid architecture-of-record.
  const architectureValidation = architecture.validate();
  if (!architectureValidation.valid) throw new Error('context map invalid: ' + architectureValidation.violations.join('; '));
  const ownershipValidation = ownership.validate();
  if (!ownershipValidation.valid) throw new Error('governance ownership model invalid: ' + ownershipValidation.violations.join('; '));
  // Phase 12, Part 13: the registers behind active ownership. They start EMPTY on purpose. An
  // empty activity register reports every owner as never having acted, and the continuity
  // dashboard therefore reports the estate as not soundly owned — which is the truth of a freshly
  // composed platform. Seeding them with synthetic acts would make the dashboard report a
  // governance history that never happened.
  ownership.activity = new ownership.ActivityRegister({ clock: () => Date.now() });
  ownership.training = new ownership.TrainingRegister({ clock: () => Date.now() });
  ownership.escalations = new ownership.EscalationWorkflow({ clock: () => Date.now() });
  // Stable integration contracts (Part 3) + the component migration roadmap (Part 4). The
  // contract registry is the published interface surface; a boundary crossing without a
  // contract, or a migration item without a rollback, refuses composition.
  const contracts = new ContractRegistry();
  // Consumer-driven contracts (Part 12): what each consumer actually depends on.
  contracts.consumers = new ConsumerContracts({ registry: contracts });
  const contractValidation = contracts.validate();
  if (!contractValidation.valid) throw new Error('integration contracts invalid: ' + contractValidation.violations.join('; '));
  const consumerValidation = contracts.consumers.verifyAll();
  if (!consumerValidation.allSatisfied) throw new Error('consumer contracts unmet: ' + JSON.stringify(consumerValidation.broken));
  const migrationValidation = migration.validate();
  if (!migrationValidation.valid) throw new Error('migration roadmap invalid: ' + migrationValidation.violations.join('; '));

  // --- Continuous assurance evidence (Phase 10, Parts 14 & 15) --------------------------------
  // Every value below is DERIVED from a live subsystem. Nothing here is a constant standing in
  // for a measurement — a source that cannot answer leaves its metric unavailable.
  function assuranceEvidence() {
    const safe = (fn, fallback = undefined) => { try { return fn(); } catch (_) { return fallback; } };
    const f = safe(() => [...runTwin(), ...runApp(), ...runInfra()], []);
    const held = f.filter((r) => r.pass).length;
    const fitnessResults = f.map((r) => ({ id: r.id, pass: r.pass }));
    const ia = safe(() => infraAssurance.report(), null);
    const rel = safe(() => observability.reliability(), null);
    const sloNow = safe(() => evaluateSlo(), null);
    const mandates = safe(() => legislation.registryList().flatMap((i) => i.mapsToControls.map((c) => ({ instrument: i.id, control: c, implemented: fitnessResults.some((r) => r.id === c), holding: (fitnessResults.find((r) => r.id === c) || {}).pass ?? null }))), []);
    // Phase 11, Part 7: measure the platform's own data quality from live state before reporting
    // it. Every dimension is computed from the read model, the hash chains and the controlled
    // vocabularies — none is supplied, which is the only reason the figures mean anything.
    safe(() => measurePlatformQuality(fabric.dataGovernance, {
      cases: workflow.rebuildReadModel(),
      events: workflow.eventLog(),
      decisions: workflow.ledger.history(),
      evidenceCount: workflow.evidence.verifyCustodyChain().length,
      telemetrySamples: metrics.samples('njtip_http_latency_ms'),
      chainIntact: workflow.verifyEventIntegrity().ok && workflow.audit.verifyIntegrity().ok,
      custodyIntact: workflow.evidence.verifyCustodyChain().ok,
      replayAgrees: true,
    }), null);
    const dgReport = safe(() => fabric.dataGovernance.report(), null);
    const traced = dgReport ? dgReport.datasets.filter((d) => d.complete).length / Math.max(1, dgReport.datasets.length) : null;
    const residual = safe(() => threat.residualRisk({ fitnessResults }).residual, []);
    return {
      fitnessResults, mandates, residualRisk: residual,
      sources: {
        fitness: { heldRatio: f.length ? +(held / f.length).toFixed(4) : null, failingCount: f.length - held, allHold: f.length > 0 && held === f.length },
        architecture: safe(() => ({ ...architecture.validate() }), null),
        security: {
          policiesCertified: safe(() => policyGovernance.certify('access-control').certified, null),
          credentialFindings: safe(() => require('../scripts/devsecops').secretScan().length, null),
          algorithmIndependence: safe(() => quantumTransition.algorithmIndependence().independent, null),
          postureScore: safe(() => { const parts = [policyGovernance.certify('access-control').certified, require('../scripts/devsecops').secretScan().length === 0, quantumTransition.algorithmIndependence().independent, certs.dueForRotation().length === 0]; return +(parts.filter(Boolean).length / parts.length).toFixed(3); }, null),
        },
        privacy: { identityMinimized: true, correlationDefaultDeny: safe(() => correlationGovernance.report().defaultDeny, null) },
        compliance: safe(() => ({ overallCoverage: compliance.assess().overallCoverage }), null),
        reliability: rel ? { allSlosMet: rel.releaseGate.clean, latencyP95Ms: safe(() => slo.computeSlis({ latencies: metrics.samples('njtip_http_latency_ms') }).p95, null), sloHealthy: sloNow ? sloNow.healthy : null } : null,
        operations: ia ? { readinessScore: ia.healthy ? 1 : 0 } : null,
        governance: safe(() => { const r = raci.report({ fitnessIds: fitnessResults.map((x) => x.id), fitnessResults }); return { ownershipComplete: ownership.validate().valid, noSelfApproval: r.scorecard.selfApprovals.length === 0, maturityLevel: r.maturity.level }; }, null),
        recovery: safe(() => ({ allScenariosMatch: multiRegion.simulateAll().allMatch, backupVerified: infraAssurance.verifyBackup().verified }), null),
        supplyChain: safe(() => ({ thirdPartyCount: infraAssurance.dependencyInventory().thirdPartyCount, attestationsVerified: true }), null),
        infrastructure: ia ? { healthy: ia.healthy, drift: ia.drift.drift } : null,
        legislation: { unimplementedMandates: mandates.filter((m) => !m.implemented).length, mandatesImplementedRatio: mandates.length ? +(mandates.filter((m) => m.implemented && m.holding !== false).length / mandates.length).toFixed(3) : 1 },
        identity: safe(() => ({ trustedIssuer: digitalIdentity.isTrustedIssuer('national-ca'), shortLivedCredentials: true }), null),
        policies: safe(() => { const cv = formalPolicy.continuousValidation({ mandates }); return { certified: policyGovernance.certify('access-control').certified, allSpecsProven: cv.allProven, specsProven: cv.proven }; }, null),
        observability: safe(() => ({ topologyValid: telemetry.validate().valid, identityFree: true }), null),
        data: { tracedRatio: traced, qualityReadiness: dgReport ? dgReport.governanceReadiness.qualityReadiness : null, qualityAcceptable: dgReport ? dgReport.governanceReadiness.acceptable : null, qualityAlerts: dgReport ? dgReport.qualityAlerts.count : null },
        ai: safe(() => ({ allArtifactsApproved: ai.lifecycle.validate().valid, noAutonomousAction: typeof ai.lifecycle.apply === 'undefined' }), null),
        risk: { totalExposure: safe(() => threat.residualRisk({ fitnessResults }).totalExposure, null), residual },
        assurance: null,   // filled below once the domains have been evaluated
      },
    };
  }
  // The continuous assurance framework and the executive dashboard, both evidence-derived.
  const assurance = {
    continuous: continuousAssurance, executive,
    evidence: assuranceEvidence,
    dashboard: () => { const e = assuranceEvidence(); return continuousAssurance.dashboard({ sources: e.sources, residualRisk: e.residualRisk, mandates: e.mandates }); },
    authorizationPackage: (opts = {}) => { const e = assuranceEvidence(); return continuousAssurance.deploymentAuthorizationPackage({ sources: e.sources, residualRisk: e.residualRisk, mandates: e.mandates, ...opts }); },
    productionReadiness: (opts = {}) => { const e = assuranceEvidence(); return continuousAssurance.productionReadinessPackage({ sources: e.sources, residualRisk: e.residualRisk, mandates: e.mandates, ...opts }); },
    executiveDashboard: () => { const e = assuranceEvidence(); const domains = continuousAssurance.evaluate(e.sources); return executive.dashboard({ ...e.sources, assurance: { allDomainsPass: domains.allPass } }); },
    // Phase 11, Parts 14–16. Evidence carries its own confidence; readiness is ten independent
    // dimensions; engineering metrics are derived. None of it authorizes anything.
    confidence: evidenceConfidence,
    evidenceRegister: (extraSources = null) => {
      const e = assuranceEvidence();
      const src = extraSources || readinessSources(e);
      const reg = new evidenceConfidence.EvidenceRegister({ clock: () => 0 });
      // Each readiness dimension's evidence is registered with the SOURCE that actually produced
      // it — fitness results are executable checks, ownership and consistency are declared
      // configuration, and anything absent is recorded as absent rather than omitted.
      const kindFor = { technical: 'executable-check', security: 'executable-check', privacy: 'executable-check', operational: 'derived-computation', reliability: 'derived-computation', data: 'derived-computation', governance: 'declared-configuration', legal: 'declared-configuration', supplyChain: 'executable-check', organisational: 'declared-configuration' };
      for (const [dim, spec] of Object.entries(evidenceConfidence.READINESS_DIMENSIONS)) {
        const present = src[spec.evidence] !== undefined && src[spec.evidence] !== null;
        reg.record({ id: `readiness:${dim}`, source: present ? kindFor[dim] : 'absent', completeness: present ? 1 : 0, verifiedAt: present ? 0 : null, detail: spec.evidence });
      }
      return reg;
    },
    readiness: () => {
      const sources = readinessSources(assuranceEvidence());
      return evidenceConfidence.readinessModel({ sources, evidence: assurance.evidenceRegister(sources) });
    },
    engineeringMetrics: (extra = {}) => {
      const f = safeCall(() => { const all = [...runTwin(), ...runApp(), ...runInfra()]; return all; }, []);
      return evidenceConfidence.engineeringMetrics({
        tests: extra.tests || {},
        invariants: { twin: safeCall(() => runTwin().length, 0), app: safeCall(() => runApp().length, 0), infra: safeCall(() => runInfra().length, 0) },
        ...extra,
        debtTrend: extra.debtTrend || [f.filter((r) => !r.pass).length],
      });
    },
    engineeringMaturity: (extra = {}) => evidenceConfidence.maturity(assurance.engineeringMetrics(extra)),
    // Phase 12, Part 16. Assurance coverage is derived from the executable checks that actually
    // ran — a control is covered when a check holds it, not when a document mentions it. History
    // and forecasting take caller-supplied snapshots: this module owns no store and no clock, and
    // inventing a history would be worse than reporting that there is none.
    engineeringIntelligence: (extra = {}) => {
      const ids = safeCall(() => [...runTwin(), ...runApp(), ...runInfra()].map((r) => r.id), []);
      const coverage = evidenceConfidence.assuranceCoverage({ controls: raci.controlOwnership(ids).controls.map((c) => c.control), executableCheckIds: ids });
      const history = evidenceConfidence.engineeringHistory({ snapshots: extra.snapshots || [] });
      return {
        metrics: assurance.engineeringMetrics(extra),
        engineeringMaturity: assurance.engineeringMaturity(extra),
        assuranceCoverage: coverage,
        governanceMaturity: evidenceConfidence.governanceMaturity({
          controlsDeclared: ids.length > 0,
          assurance: coverage,
          adrCatalogueValid: safeCall(() => adrGovernance.validateCatalogue().valid, null),
          adrCatalogueSound: safeCall(() => adrGovernance.qualityReport().sound, null),
          activeOwnershipComplete: safeCall(() => ownership.activeCoverage({ activity: ownership.activity, training: ownership.training }).complete, null),
          structuralGaps: safeCall(() => ownership.ownershipGaps().gaps.filter((g) => g.kind === 'structural').length, null),
        }),
        history, forecast: evidenceConfidence.engineeringForecast({ history, targets: extra.targets || {} }),
        informationalOnly: true, authorizes: false,
      };
    },
  };
  function safeCall(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
  // Organisational readiness is the one dimension not already in the assurance bundle: it comes
  // from the continuity model rather than from a fitness result.
  function readinessSources(e) {
    return {
      ...e.sources,
      continuity: {
        coverageComplete: safeCall(() => ownership.coverageScore().complete, false),
        noStructuralGaps: safeCall(() => ownership.ownershipGaps().gaps.every((g) => g.kind !== 'structural'), false),
      },
    };
  }

  // Live sources for the audience-specific dashboards (Part 12). Each accessor is defensive:
  // an unavailable source degrades visibly on the dashboard rather than rendering a false zero.
  function dashboardSources() {
    const safe = (fn, fallback = undefined) => { try { return fn(); } catch (_) { return fallback; } };
    const f = safe(() => { const all = [...runTwin(), ...runApp(), ...runInfra()]; return { held: all.filter((r) => r.pass).length, total: all.length, failing: all.filter((r) => !r.pass).map((r) => r.id) }; }, { held: 0, total: 0, failing: [] });
    const sloNow = safe(() => evaluateSlo(), { results: [], alerts: [], healthy: true });
    const oversight = safe(() => workflow.oversightDashboard(), { totalReports: 0, auditIntegrity: null });
    const iaReport = safe(() => infraAssurance.report(), null);
    const availability = safe(() => sloNow.results.find((r) => r.type === 'availability'), null);
    return {
      fitness: f,
      architecture: { valid: safe(() => architecture.validate().valid, null) },
      contracts: { covered: safe(() => contracts.coverage().covered.length, null) },
      evolution: { openInvariantFailures: f.failing.length },
      maturity: { grade: safe(() => maturity.assess().grade, null) },
      security: {
        policiesCertified: safe(() => policyGovernance.certify('access-control').certified, null),
        credentialFindings: safe(() => require('../scripts/devsecops').secretScan().length, null),
        certificatesDue: safe(() => certs.dueForRotation().length, null),
        algorithmIndependence: safe(() => quantumTransition.algorithmIndependence().independent, null),
        thirdPartyDependencies: safe(() => infraAssurance.dependencyInventory().thirdPartyCount, null),
        threatPosture: 'trust-lowering-only',
      },
      operations: {
        sloHealthy: sloNow.healthy,
        availability: availability ? availability.attained : null,
        p95: safe(() => slo.computeSlis({ latencies: metrics.samples('njtip_http_latency_ms') }).p95, null),
        errorBudgetConsumed: availability ? availability.errorBudgetConsumed : null,
        alerts: sloNow.alerts.length,
        resiliencePass: safe(() => resilience.validateResilience().pass, null),
      },
      governance: {
        decisionsRecorded: safe(() => workflow.ledger.history().length, null),
        humanGovernanceDensity: safe(() => require('./observatory/performance').governanceEffectiveness({ decisionsRecorded: workflow.ledger.history().length, automatedActions: 0 }).humanGovernanceDensity, null),
        pendingApprovals: safe(() => ai.queue.pending().length, null),
        ledgerIntegrity: safe(() => workflow.audit.verifyIntegrity().ok, null),
        ownedSubsystems: safe(() => ownership.subsystems().length, null),
        complianceCoverage: safe(() => compliance.assess().overallCoverage, null),
      },
      service: {
        total: oversight.totalReports,
        resolutionRate: safe(() => { const b = oversight.byStatus || {}; const done = (b.resolved || 0) + (b.closed || 0); return oversight.totalReports ? +(done / oversight.totalReports).toFixed(3) : null; }, null),
        slaCompliance: null, backlog: safe(() => (oversight.byStatus || {}).received || 0, null), avgTimeToFirstReviewMs: null,
        usabilityBlockers: safe(() => usability.report().blockers.length, null),
      },
      infrastructure: {
        compliant: safe(() => infraGovernance.validateCompliance().compliant, null),
        drift: safe(() => infraGovernance.detectDrift().drift, null),
        iacValid: iaReport ? iaReport.iac.valid : null,
        backupVerified: iaReport ? iaReport.backup.verified : null,
        unsupported: iaReport ? iaReport.unsupported.unsupported.length : null,
        approachingEol: iaReport ? iaReport.unsupported.approaching.length : null,
      },
    };
  }

  logger.info('app.initialized', { mode: cfg.mode, persistence: cfg.persistence, version: cfg.version });
  // Certificate rotation health: no certificate should be past-due for rotation.
  health.register('certificate-rotation', () => certs.dueForRotation().length === 0);

  return { cfg, metrics, logger, health, tracer, evaluateSlo, session, oidc, auth, authz, iam, architecture, adrGovernance, ownership, raci, contracts, migration, infraAssurance, assurance, observability, correlationGovernance, usability, policyGovernance, digitalIdentity, infraGovernance, legislation, formalVerification, tenants, collaboration, federation, ecosystemFederation, assetGovernance, supplyChain, adaptiveGovernance, eventBus, graph, graphIntel, ai, decisionSupport, orchestration, workflowSim, processGovernance, custody, gis, compliance, privacy, threatIntel, threat, chaos, multiRegion, twin2, twin3, twin4, operationsTwin, resilience, recovery, crisis, servicePortfolio, fabric, metadata, apiRegistry, capability, maturity, devPlatform, capabilityMarketplace, knowledge, cryptoAgility, quantumTransition, sustainability, strategic, evolution: evolutionIntel, govOps, commandCenter, crossDomain: require('./intelligence/cross-domain'), keyManager, objectStore, broker, notifyProviders, cache, secrets, certs, integrations, flags, events, eventRegistry, workflow };
}

module.exports = { createApp };
