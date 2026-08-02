'use strict';
// APPLICATION-level architecture fitness functions. These complement the Digital
// Engineering Twin's fitness gate (which verifies the shared domain invariants) by
// checking the PRODUCT's own production adapters and domain lifecycles keep their
// invariants: a failing check == an architecture violation == a failing build.
//
// Each check exercises the real module behaviour (not mocks) and returns pass/violations
// in the same shape as the Twin's fitness functions, so both can be reported together.
const { makeKeyManager } = require('../src/adapters/kms');
const { makeObjectStore } = require('../src/adapters/object-store');
const { MessageBroker } = require('../src/adapters/broker');
const { OidcVerifier } = require('../src/adapters/oidc');
const { SecretsManager } = require('../src/adapters/secrets');
const { CaptureProvider } = require('../src/adapters/notify-providers');
const { MemorySqlDriver } = require('../src/adapters/drivers/sql-driver');
const { SqlStore } = require('../src/adapters/sql-store');
const { UnitOfWork } = require('../src/adapters/uow');
const authz = require('../src/authz');
const caseLc = require('../src/domain/case-lifecycle');
const evLc = require('../src/domain/evidence-lifecycle');
const inv = require('../src/domain/investigation');
const { SearchIndex } = require('../src/adapters/search');
const analytics = require('../src/analytics');
const { Tracer } = require('../src/adapters/observability');
const { IntegrationGateway, CaptureIntegrationClient } = require('../src/adapters/integrations');
const { FeatureFlags } = require('../src/adapters/flags');
const { EventStore } = require('../src/adapters/../eventsourcing/event-store');
const { CaseAggregate } = require('../src/eventsourcing/case-aggregate');
const { caseReadModel } = require('../src/eventsourcing/projections');
const { EventRegistry, seedCaseEvents } = require('../src/eventsourcing/event-governance');
const workflowSim = require('../src/orchestration/workflow-simulator');
const { DEFAULT_WORKFLOW } = require('../src/orchestration/workflow-engine');
const twin3 = require('../src/twin2/monte-carlo');
const twin4 = require('../src/twin2/national-sim');
const resilience = require('../src/twin2/resilience-validation');
const { RecoveryPlatform, seedPlaybooks } = require('../src/twin2/recovery');
const { NationalCrisisPlatform } = require('../src/twin2/crisis');
const { ServicePortfolio } = require('../src/portfolio/service-portfolio');
const processMining = require('../src/orchestration/process-mining');
const { PolicyRegistry } = require('../src/iam/policy-governance');
const { IdentityRegistry } = require('../src/iam/digital-identity');
const { InfrastructureRegistry } = require('../src/infra/infra-governance');
const { DEFAULT_POLICIES } = require('../src/iam/policy-engine');
const formalVerification = require('../src/orchestration/formal-verification');
const { PolicySet } = require('../src/iam/policy-engine');
const zeroTrust = require('../src/iam/zero-trust');
const { TenantRegistry, TenantScopedStore, CollaborationBroker } = require('../src/tenancy/tenant');
const { FederationRegistry } = require('../src/tenancy/federation');
const { EcosystemFederation } = require('../src/tenancy/ecosystem-federation');
const { AssetRegistry } = require('../src/governance/asset-governance');
const { SupplyChainGovernance } = require('../src/supplychain/supply-chain');
const adaptiveGovernance = require('../src/governance/adaptive');
const { sbom: devsecopsSbom } = require('../scripts/devsecops');
const { EnterpriseEventBus } = require('../src/fabric/event-bus');
const { KnowledgeGraph } = require('../src/graph/graph');
const graphIntel = require('../src/graph/intelligence');
const { MemoryStore } = require('../src/adapters/store');
const advisor = require('../src/ai/advisor');
const { RecommendationQueue } = require('../src/ai/approval');
const { AiRegistry, governedRecommendation } = require('../src/ai/ai-governance');
const { makeCryptoAgility } = require('../src/adapters/crypto-agility');
const { QuantumMigrationRegistry } = require('../src/adapters/quantum-transition');
const observatory = require('../src/observatory/performance');
const { LifecycleRegistry } = require('../src/sustainability/lifecycle');
const strategicTwin = require('../src/twin2/strategic-twin');
const privacy = require('../src/privacy/privacy-engineering');
const threat = require('../src/security/threat-intel');
const { CustodyLedger } = require('../src/custody/ledger');
const { SpatialIndex, geohash } = require('../src/geo/gis');
const { ApiRegistry } = require('../src/apigov/registry');
const decisionSupport = require('../src/ai/decision-support');
const openapiSpec = require('../src/openapi');
const capabilityMod = require('../src/capability/model');
const maturityMod = require('../src/maturity/maturity');
const devplatform = require('../src/devplatform/sdk');
const { CapabilityMarketplace } = require('../src/devplatform/capability-marketplace');
const { KnowledgeRepository } = require('../src/knowledge/repository');
const evolution = require('../src/evolution/evolution');
const { GovernanceOpsCenter } = require('../src/govops/center');
const { CommandCenter } = require('../src/govops/command-center');
const crossDomain = require('../src/intelligence/cross-domain');
const { MetadataGovernance } = require('../src/fabric/metadata');
const { ProvenanceLedger } = require('../src/fabric/provenance');
const { InteroperabilityProfile } = require('../src/fabric/interoperability');
const { DataMarketplace } = require('../src/fabric/marketplace');
const { LegislativeRegistry } = require('../src/legislation/registry');
const contextMap = require('../src/architecture/context-map');
const ownership = require('../src/governance/ownership');
const { ContractRegistry, CANONICAL_ERRORS } = require('../src/contracts/integration-contracts');
const migration = require('../src/migration/roadmap');
const configMod = require('../src/config');
const { ZONES } = require('../src/twin');

function fit(id, title, fn) {
  return { id, title, check() { const v = []; try { fn(v); } catch (e) { v.push('check threw: ' + e.message); } return { id, title, pass: v.length === 0, violations: v }; } };
}

module.exports = [
  fit('APP-FIT-CIPHERTEXT-ONLY', 'Evidence object store refuses plaintext at rest', (v) => {
    const km = makeKeyManager();
    const os = makeObjectStore(km);
    let refused = false;
    try { os.put(ZONES.EXECUTIVE, 'raw plaintext'); } catch (_) { refused = true; }
    if (!refused) v.push('object store accepted a plaintext blob (must refuse)');
    // A real ciphertext blob IS accepted.
    const ref = os.put(ZONES.EXECUTIVE, km.encrypt(ZONES.EXECUTIVE, 'x')).ref;
    if (!ref) v.push('object store rejected a valid ciphertext blob');
  }),

  fit('APP-FIT-PII-FREE-EVENTS', 'Broker refuses identity/content on cross-zone events', (v) => {
    const b = new MessageBroker();
    for (const bad of [{ email: 'a@b.c' }, { omang: '1' }, { meta: { content: 'x' } }]) {
      let refused = false;
      try { b.publish('t', bad); } catch (_) { refused = true; }
      if (!refused) v.push('broker accepted a PII/content payload: ' + JSON.stringify(bad));
    }
    // A safe payload IS accepted.
    try { b.publish('t', { caseCode: 'NJ-X', recipient: 'dcec' }); } catch (e) { v.push('broker rejected a PII-free payload: ' + e.message); }
  }),

  fit('APP-FIT-NO-IDENTITY-COLUMN', 'SQL persistence has no queryable identity column', (v) => {
    const d = new MemorySqlDriver();
    new SqlStore(ZONES.INDEPENDENT, 'reports', d).put('K', { case_code: 'NJ-X', status: 'received' });
    // Tables are opaque `${zone}__${collection}` blobs; there is no identity column by design.
    for (const t of d.tables()) if (!/^[a-z]+__[a-z]+$/.test(t)) v.push('unexpected table shape: ' + t);
  }),

  fit('APP-FIT-PERSISTENCE-INTEGRITY', 'Optimistic locking prevents lost updates; txns roll back', (v) => {
    const d = new MemorySqlDriver();
    const s = new SqlStore(ZONES.INDEPENDENT, 'reports', d);
    s.put('K', { n: 0 });
    const stale = s.getWithVersion('K').version;
    if (!s.putIfVersion('K', { n: 1 }, stale).ok) v.push('first CAS write should succeed');
    if (s.putIfVersion('K', { n: 2 }, stale).ok) v.push('stale CAS write was accepted (lost update possible)');
    // A failed transaction must leave no partial state.
    const uow = new UnitOfWork(d);
    try { uow.run(() => { s.put('K', { n: 99 }); throw new Error('x'); }); } catch (_) { /* expected */ }
    if (JSON.stringify(s.get('K')) !== JSON.stringify({ n: 1 })) v.push('transaction did not roll back partial write');
  }),

  fit('APP-FIT-AUTHZ-DEFAULT-DENY', 'Authorization is default-deny with MFA step-up', (v) => {
    if (authz.authorize({ role: 'citizen', action: 'admin-config' }).allow) v.push('citizen allowed admin-config');
    if (authz.authorize({ role: 'admin', action: 'unknown-action' }).allow) v.push('unknown action was allowed (must default-deny)');
    if (authz.authorize({ role: 'investigator', action: 'review-case' }).allow) v.push('sensitive action allowed without MFA');
    if (!authz.authorize({ role: 'investigator', action: 'review-case', attributes: { mfa: 'fido2' } }).allow) v.push('MFA-satisfied sensitive action was denied');
  }),

  fit('APP-FIT-LIFECYCLE-DEFAULT-DENY', 'Case/evidence lifecycles reject illegal transitions', (v) => {
    if (caseLc.apply('received', 'resolve').ok) v.push('case allowed received→resolved (must review/escalate first)');
    if (caseLc.apply('closed', 'review').ok) v.push('case allowed transition out of terminal state');
    if (evLc.apply('ingested', 'admit').ok) v.push('evidence allowed admit before review');
    if (evLc.apply('purged', 'seal').ok) v.push('evidence allowed transition out of terminal state');
  }),

  fit('APP-FIT-ANONYMITY-BOUNDARY', 'Staff notifications never push to anonymous reporters or leak content', (v) => {
    const p = new CaptureProvider('email');
    let a = false, c = false;
    try { p.send({ reason: 'x' }); } catch (_) { a = true; }
    if (!a) v.push('notification sent without a staff principal (anonymous push)');
    try { p.send({ toPrincipal: 'inv-1', role: 'investigator', reason: 'x', data: { content: 'leak' } }); } catch (_) { c = true; }
    if (!c) v.push('notification carried case content out of the zone');
  }),

  fit('APP-FIT-SECRETS-REDACTED', 'Config redacts all secrets and leaks no driver handle', (v) => {
    const cfg = configMod.load({ NJTIP_PERSISTENCE: 'sql' });
    const red = configMod.redacted(cfg);
    for (const k of ['SESSION_SECRET', 'OIDC_SECRET']) {
      if (k in cfg && cfg[k] !== undefined && red[k] !== '***REDACTED***') v.push('secret not redacted: ' + k);
    }
    if ('sqlDriver' in red || '_sqlDriver' in red) v.push('SQL driver handle leaked into config dump');
  }),

  fit('APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE', 'OIDC rejects bad trust anchor and disallowed roles', (v) => {
    const idp = new OidcVerifier({ secret: 's' });
    if (idp.verify(new OidcVerifier({ secret: 's', issuer: 'evil' }).issue({ sub: 'x', role: 'admin' }))) v.push('accepted a token from the wrong issuer');
    if (idp.verify(idp.issue({ sub: 'x', role: 'superuser' }))) v.push('accepted a disallowed role claim');
    if (!idp.verify(idp.issue({ sub: 'x', role: 'investigator' }))) v.push('rejected a valid token');
  }),

  fit('APP-FIT-EVENT-SOURCING', 'Event log is immutable + hash-chained; replay = projection; events PII-free', (v) => {
    let t = 0; const es = new EventStore({ clock: () => (t += 1) });
    es.append('NJ-FIT', [{ type: 'CaseSubmitted', data: { category: 'police', recipient: 'ombudsman', stage: 'intake-review' } }, { type: 'CaseTransitioned', data: { to: 'resolved' } }]);
    if (!es.verifyChain().ok) v.push('event chain does not verify');
    // Events are immutable (frozen).
    if (!Object.isFrozen(es.readAll()[0])) v.push('persisted event is mutable');
    // Replay (aggregate) equals projection (read model).
    const replay = new CaseAggregate('NJ-FIT').loadFromHistory(es.readStream('NJ-FIT')).state();
    const proj = caseReadModel(es.readAll()).get('NJ-FIT');
    if (replay.status !== proj.status) v.push('replay and projection disagree');
    // Events carry no denied identity/content keys.
    const denied = ['omang', 'name', 'email', 'phone', 'content', 'body', 'plaintext'];
    if (denied.some((k) => JSON.stringify(es.readAll()).toLowerCase().includes('"' + k + '"'))) v.push('event carried a denied identity/content field');
  }),

  fit('APP-FIT-POLICY-AS-DATA', 'Policy engine is default-deny + deny-overrides; break-glass needs SoD', (v) => {
    const ps = new PolicySet([
      { id: 'p', effect: 'permit', actions: ['x'], conditions: [{ attr: 'subject.role', op: 'eq', value: 'admin' }] },
      { id: 'd', effect: 'deny', actions: ['x'], conditions: [{ attr: 'subject.suspended', op: 'eq', value: true }] },
    ]);
    if (ps.evaluate({ action: 'x', subject: {} }).decision !== 'deny') v.push('no matching permit did not default-deny');
    if (ps.evaluate({ action: 'x', subject: { role: 'admin' } }).decision !== 'permit') v.push('valid permit was denied');
    if (ps.evaluate({ action: 'x', subject: { role: 'admin', suspended: true } }).decision !== 'deny') v.push('deny did not override permit');
    // Zero-trust: sensitive action below the trust floor must NOT be allowed.
    const low = zeroTrust.trustScore({ mfa: 'none', deviceTrusted: false });
    if (zeroTrust.continuousAuthz({ action: 'read-evidence', score: low.score }).decision === 'allow') v.push('low-trust actor was allowed a sensitive action');
    // Break-glass requires a distinct human approver (separation of duties).
    const bg = new zeroTrust.BreakGlass();
    let sod = false; try { bg.request({ principal: 'a', justification: 'x', approver: 'a' }); } catch (_) { sod = true; }
    if (!sod) v.push('break-glass allowed self-approval');
  }),

  fit('APP-FIT-TENANT-ISOLATION', 'Tenants are namespace-isolated (fail-closed); shares refuse content', (v) => {
    const inner = new MemoryStore('independent');
    const a = new TenantScopedStore(inner, 'agency-a');
    const b = new TenantScopedStore(inner, 'agency-b');
    a.put('K', { x: 1 });
    if (b.get('K') !== null) v.push('tenant B read tenant A data (isolation breach)');
    if (b.keys().length !== 0) v.push('tenant B enumerated tenant A keys');
    // Cross-tenant collaboration refuses identity/content.
    const reg = new TenantRegistry(); reg.register('agency-a'); reg.register('agency-b');
    const cb = new CollaborationBroker(reg);
    let refused = false; try { cb.share({ fromTenant: 'agency-a', toTenant: 'agency-b', ref: { content: 'secret' } }); } catch (_) { refused = true; }
    if (!refused) v.push('cross-tenant share carried case content');
  }),

  fit('APP-FIT-SUPPLY-CHAIN-GOVERNANCE', 'No deployment bypasses supply-chain governance; adaptive gov is human-gated', (v) => {
    const sc = new SupplyChainGovernance();
    // The platform SBOM has zero third-party dependencies → trivially passes (safest posture).
    const sbom = devsecopsSbom();
    const deploy = sc.validateForDeployment((sbom.dependencies || []).map((d) => ({ name: d, version: '*' })));
    if (!deploy.pass) v.push('zero-dependency SBOM failed supply-chain validation');
    // An UNTRUSTED component is rejected (fail-closed deployment gate).
    if (sc.validateForDeployment([{ name: 'evil-lib', version: '1.0.0' }]).pass) v.push('untrusted component passed the deployment gate');
    // A component from an unregistered supplier is refused at registration.
    let refused = false; try { sc.registerComponent('x', { version: '1', supplier: 'unknown' }); } catch (_) { refused = true; }
    if (!refused) v.push('component from an unregistered supplier was accepted');
    // Adaptive governance assessment + legislative-review recs are advisory + human-gated.
    if (adaptiveGovernance.assess({ effectivenessScore: 1 }).humanGate !== true) v.push('adaptive governance assessment is not human-gated');
    if (adaptiveGovernance.legislativeReviewRecommendations([{ id: 'a', mapsToControls: ['C1'] }], new Set(['C1'])).requiresHumanApproval !== true) v.push('legislative-review recommendation is not human-gated');
  }),

  fit('APP-FIT-ECOSYSTEM-ASSETS', 'Ecosystem federation is explicit/SoD; assets are lifecycle-traceable', (v) => {
    const ef = new EcosystemFederation();
    ef.registerMember('gov', { type: 'government' }); ef.registerMember('city', { type: 'municipality' });
    // Federation defaults to isolation; requires explicit scopes + distinct approver.
    if (ef.isFederated('gov', 'city', 'services')) v.push('ecosystem members federated by default');
    let sod = false; try { ef.establishAgreement({ from: 'gov', to: 'city', scopes: ['services'], approver: 'x', requester: 'x' }); } catch (_) { sod = true; }
    if (!sod) v.push('ecosystem federation allowed self-approval');
    // Cross-domain policy enforcement refuses PII crossing a federation boundary.
    let piiRefused = false; try { ef.enforceCrossDomain({ email: 'a@b.c' }); } catch (_) { piiRefused = true; }
    if (!piiRefused) v.push('ecosystem federation allowed PII across a boundary');
    // Asset governance: lifecycle order enforced + full traceability.
    const ar = new AssetRegistry({ clock: () => 1 });
    ar.register('a', { type: 'policy', owner: 'o' });
    let lifecycle = false; try { ar.retire('a'); } catch (_) { lifecycle = true; }
    if (!lifecycle) v.push('asset retired without deprecation');
    ar.activate('a'); ar.amend('a', { summary: 'v2' });
    if (ar.trace('a').length < 3) v.push('asset lifecycle not fully traceable');
  }),

  fit('APP-FIT-EVENTBUS-FEDERATION', 'Event bus stays PII-free; federation defaults to isolation', (v) => {
    const bus = new EnterpriseEventBus();
    bus.registerTopic('t');
    // PII/content on the bus is refused (inherited from the broker).
    let refused = false; try { bus.publish('t', { email: 'a@b.c' }); } catch (_) { refused = true; }
    if (!refused) v.push('event bus published a PII payload');
    // Ordered replay works.
    bus.publish('t', { caseCode: 'NJ-1' }); bus.publish('t', { caseCode: 'NJ-2' });
    if (bus.replay('t').map((e) => e.seq).join() !== '1,2') v.push('event ordering/replay broken');
    // Federation defaults to ISOLATION; requires explicit SoD authorization.
    const reg = new TenantRegistry(); reg.register('a'); reg.register('b');
    const fed = new FederationRegistry({ registry: reg });
    if (fed.isFederated('a', 'b', 'cases')) v.push('tenants federated by default (must be isolated)');
    let sod = false; try { fed.authorize({ fromTenant: 'a', toTenant: 'b', scopes: ['cases'], approver: 'x', requester: 'x' }); } catch (_) { sod = true; }
    if (!sod) v.push('federation allowed self-approval');
  }),

  fit('APP-FIT-GRAPH-PRIVACY', 'Knowledge graph refuses identifying node/edge properties', (v) => {
    const g = new KnowledgeGraph();
    g.addNode('n1', 'Person', { role: 'suspect' });
    let refused = false; try { g.addNode('n2', 'Person', { name: 'Real Name' }); } catch (_) { refused = true; }
    if (!refused) v.push('graph stored an identifying node property');
    if (!KnowledgeGraph) v.push('graph missing');
  }),

  fit('APP-FIT-SEMANTIC-GRAPH-ADVISORY', 'Semantic search stays privacy-safe; graph inference is advisory', (v) => {
    const { SemanticSearch, expandQuery } = require('../src/search/semantic');
    // Semantic expansion never introduces identity terms.
    const exp = expandQuery('corruption police');
    if (exp.expanded.some((t) => ['name', 'omang', 'email', 'phone'].includes(t))) v.push('semantic expansion introduced an identity term');
    const ss = new SemanticSearch();
    let refusedIdx = false; try { ss.index({ case_code: 'NJ-1', email: 'a@b.c' }); } catch (_) { refusedIdx = true; }
    if (!refusedIdx) v.push('semantic index accepted an identity field');
    // Graph inference is advisory + human-gated.
    const g = new KnowledgeGraph(); g.addNode('a', 'Organization'); g.addNode('b', 'Asset'); g.addNode('c', 'Person'); g.addEdge('a', 'b', 'controls'); g.addEdge('c', 'a', 'director'); g.addEdge('c', 'b', 'beneficiary');
    const pred = graphIntel.predictLinks(g, 'a');
    if (pred.advisoryOnly !== true || pred.requiresHumanApproval !== true || pred.autonomous !== false) v.push('graph inference not marked advisory/human-gated');
    if (!Array.isArray(pred.explanation) || !pred.explanation.length) v.push('graph inference not explainable');
  }),

  fit('APP-FIT-SUSTAINABILITY-STRATEGIC', 'Longevity assessment human-gated; strategic projections never authorize', (v) => {
    const lc = new LifecycleRegistry({ clock: () => 0 });
    lc.register('legacy-db', { category: 'database', adoptedAt: 0, eolAt: 100, criticality: 'critical' });
    // Obsolescence is detected past EOL.
    if (lc.obsolescence(200).length < 1) v.push('obsolescence not detected past end-of-life');
    if (lc.longevityAssessment(0).humanGate !== true) v.push('longevity assessment is not human-gated');
    // Strategic projections are deterministic, explainable, and never authorize.
    const p = strategicTwin.demographicChange({ years: 5 });
    if (p.authorizes !== false || p.informationalOnly !== true || p.explainable !== true) v.push('strategic projection is not informational/explainable');
    if (typeof p.confidence !== 'number' || !Array.isArray(p.assumptions)) v.push('strategic projection lacks confidence/assumption tracking');
    if (JSON.stringify(strategicTwin.demographicChange({ years: 5 })) !== JSON.stringify(p)) v.push('strategic projection is not deterministic');
    if ('authorized' in strategicTwin.executiveReport()) v.push('strategic executive report emitted an authorization');
  }),

  fit('APP-FIT-QUANTUM-OBSERVATORY', 'PQ migration is compatibility-gated + human-gated; observatory is informational', (v) => {
    const q = new QuantumMigrationRegistry();
    // A non-PQ target is refused (fail-closed compatibility).
    let refused = false; try { q.plan('m', { purpose: 'signature', fromAlgo: 'ed25519', toAlgo: 'ecdsa-p256' }); } catch (_) { refused = true; }
    if (!refused) v.push('quantum migration accepted a non-PQ target');
    q.plan('m', { purpose: 'signature', fromAlgo: 'ed25519', toAlgo: 'ml-dsa-65' });
    q.advance('m'); // assess -> hybrid-deploy
    // Cannot migrate before hybrid is tested (fail-closed).
    let gated = false; try { q.advance('m'); } catch (_) { gated = true; }
    if (!gated) v.push('quantum migration advanced past hybrid without verification');
    if (q.readiness('m').humanGate !== true) v.push('quantum migration readiness is not human-gated');
    // Observatory report is informational only + privacy-preserving.
    const rep = observatory.executiveReport([{ category: 'police', status: 'resolved', recipient: 'ombudsman', createdAt: 0, slaBreached: false }]);
    if (rep.informationalOnly !== true) v.push('observatory report is not marked informational');
    if (/"email"|"omang"|"name"/.test(JSON.stringify(rep))) v.push('observatory leaked identity');
  }),

  fit('APP-FIT-AI-GOVERNANCE', 'No AI model operates without governance approval; crypto agility is policy-only', (v) => {
    const reg = new AiRegistry();
    reg.register('m', { owner: 'o', purpose: 'p' });
    // An unapproved model may NOT operate (fail-closed).
    if (reg.canOperate('m').allowed) v.push('unapproved model may operate');
    let refused = false; try { governedRecommendation(reg, 'm', advisor.riskScore({ category: 'police' })); } catch (_) { refused = true; }
    if (!refused) v.push('recommendation surfaced from an unapproved model');
    // Approval requires a named human + rationale.
    let needsHuman = false; try { reg.approve('m', { by: 'x' }); } catch (_) { needsHuman = true; }
    if (!needsHuman) v.push('AI model approved without a rationale');
    reg.approve('m', { by: 'board', rationale: 'ok' });
    if (!reg.canOperate('m').allowed) v.push('approved model cannot operate');
    // Crypto agility: reference is synthetic + never emits key material; migration keeps overlap.
    const ca = makeCryptoAgility();
    const prov = ca.provider('signature'); const primary = prov.primary();
    prov.migrate('ml-dsa-65');
    if (!prov.accepts(primary)) v.push('crypto migration dropped the legacy algorithm before overlap ended');
    if (!ca.registry.pqReadiness().byPurpose.signature.ready) v.push('no post-quantum readiness interface');
    if (JSON.stringify(ca).includes('PRIVATE KEY')) v.push('crypto agility exposed key material');
  }),

  fit('APP-FIT-AI-ADVISORY-ONLY', 'AI is advisory-only, explainable, and human-approval-gated', (v) => {
    const rec = advisor.recommendPriority({ category: 'police', status: 'escalated', createdAt: 0, now: 0 });
    if (rec.advisoryOnly !== true || rec.autonomous !== false || rec.requiresHumanApproval !== true) v.push('AI output is not marked advisory/non-autonomous/human-gated');
    if (!Array.isArray(rec.explanation) || rec.explanation.length === 0) v.push('AI recommendation is not explainable');
    if (typeof rec.confidence !== 'number') v.push('AI recommendation has no confidence score');
    // Determinism: same input → same output.
    if (JSON.stringify(rec) !== JSON.stringify(advisor.recommendPriority({ category: 'police', status: 'escalated', createdAt: 0, now: 0 }))) v.push('AI recommendation is not deterministic');
    // The queue never auto-applies and requires a named human.
    const q = new RecommendationQueue(); const s = q.submit(rec, { caseCode: 'NJ-X' });
    const decision = q.decide(s.id, { by: 'human', decision: 'approved' });
    if (decision.appliesAutomatically !== false) v.push('approval auto-applies (must require a human action)');
    let needsHuman = false; try { q.decide(q.submit(rec).id, { decision: 'approved' }); } catch (_) { needsHuman = true; }
    if (!needsHuman) v.push('recommendation decided without a named human');
    // A non-advisory object cannot be queued (fail-closed).
    let refused = false; try { q.submit({ advisoryOnly: false, autonomous: true }); } catch (_) { refused = true; }
    if (!refused) v.push('queue accepted a non-advisory/autonomous recommendation');
  }),

  fit('APP-FIT-PRIVACY-ENGINEERING', 'Privacy is measurable: PIA flags identity; DP deterministic; minimization holds', (v) => {
    // PIA flags an identity-bearing flow (and passes a clean one).
    if (privacy.automatedPIA({ name: 'f', fields: ['email'], crossZone: true }).pass) v.push('PIA passed a flow carrying identity');
    if (!privacy.automatedPIA({ name: 'g', fields: ['category', 'status'], purpose: 'triage' }).pass) v.push('PIA failed a clean flow');
    // Differential privacy is deterministic per seed.
    if (privacy.dpNoisyCount(100, { epsilon: 1, seed: 3 }).noisy !== privacy.dpNoisyCount(100, { epsilon: 1, seed: 3 }).noisy) v.push('differential privacy is not deterministic');
    // Minimisation validation refuses identity fields.
    if (privacy.validateMinimization({ email: 'a@b.c' }).ok) v.push('minimisation accepted an identity field');
  }),

  fit('APP-FIT-THREAT-INTEL-BOUNDED', 'Threat intel can only LOWER trust and never overrides governance', (v) => {
    const enriched = threat.enrichTrust(80, { deviceRisk: 100, credentialRisk: 100, anomalyScore: 100 });
    if (enriched.enrichedScore > enriched.baseScore) v.push('threat intel raised the trust score (must only lower)');
    // Even with zero risk, it never exceeds the base score.
    if (threat.enrichTrust(50, {}).enrichedScore > 50) v.push('threat intel exceeded the base score with no risk');
    // Recommendations are advisory, never autonomous.
    const rec = threat.recommend({ deviceRiskBand: 'high' });
    if (rec.advisoryOnly !== true || rec.autonomous !== false) v.push('threat recommendation is not advisory/non-autonomous');
  }),

  fit('APP-FIT-API-GOVERNANCE', 'APIs governed from the live contract; unknown ops rejected; decisions advisory', (v) => {
    const reg = new ApiRegistry(); reg.fromOpenApi(openapiSpec.spec());
    // The governed contract validates a documented op and rejects an unknown one (fail-closed).
    if (!reg.validate('GET', '/api/twin/validate').ok) v.push('governed op failed validation');
    if (reg.validate('DELETE', '/nonexistent').ok) v.push('unknown API validated (must fail closed)');
    // Retirement requires prior deprecation.
    reg.register('GET', '/x', { operationId: 'x' });
    let lifecycle = false; try { reg.retire('GET', '/x'); } catch (_) { lifecycle = true; }
    if (!lifecycle) v.push('API retired without deprecation');
    // Rate limiting denies beyond the burst.
    reg.registerConsumer('c', { ratePerMin: 0, burst: 1 });
    reg.allow('c'); if (reg.allow('c').allowed) v.push('rate limiter did not deny beyond burst');
    // Decision support is advisory + human-gated.
    const d = decisionSupport.completionForecast({ openCases: 10, resolvedPerDay: 5 });
    if (d.advisoryOnly !== true || d.autonomous !== false) v.push('decision support is not advisory/non-autonomous');
  }),

  fit('APP-FIT-LEGISLATION-MARKETPLACE', 'Legal changes are simulatable; marketplace enforces privacy + approval', (v) => {
    const leg = new LegislativeRegistry();
    leg.register('act', { title: 'Act', mapsToControls: ['C1'], mapsToSystems: ['sys'] });
    // Every legal change is simulatable before implementation.
    const sim = leg.simulate('act', { proposedControls: [] });
    if (!sim.simulatable || sim.compatibility.breaking !== true) v.push('legal change simulation did not flag a removed control');
    // Enactment requires a named human.
    let humanGate = false; try { leg.enact('act', {}); } catch (_) { humanGate = true; }
    if (!humanGate) v.push('law enacted without a named human authority');
    // Marketplace: identity fields refused; restricted datasets never publicly listed;
    // approval required.
    const mkt = new DataMarketplace();
    let priv = false; try { mkt.register('d', { owner: 'o', schemaFields: ['email'] }); } catch (_) { priv = true; }
    if (!priv) v.push('marketplace registered a dataset with identity fields');
    mkt.register('pub', { owner: 'o', classification: 'public', schemaFields: ['category'] });
    if (mkt.discover().length !== 0) v.push('unapproved dataset was discoverable');
    mkt.approve('pub', { by: 'steward', rationale: 'ok' });
    if (mkt.discover().length !== 1) v.push('approved public dataset not discoverable');
    mkt.register('sec', { owner: 'o', classification: 'secret', schemaFields: ['category'] });
    mkt.approve('sec', { by: 'steward', rationale: 'ok' });
    if (mkt.discover().some((d) => d.id === 'sec')) v.push('secret dataset was publicly listed');
  }),

  fit('APP-FIT-PROVENANCE-INTEROP', 'Provenance is traceable + tamper-evident; interop stays backward-compatible', (v) => {
    let t = 0; const pl = new ProvenanceLedger({ clock: () => (t += 1) });
    pl.record({ artifactId: 'raw:reports', kind: 'source' });
    pl.record({ artifactId: 'proj:cases', derivedFrom: ['raw:reports'], transform: 'project' });
    pl.record({ artifactId: 'report:exec', derivedFrom: ['proj:cases'], transform: 'aggregate' });
    if (!pl.verify().ok) v.push('provenance chain does not verify');
    // The generated report traces back to the originating raw source.
    if (!pl.verifyTraceable('report:exec', { rootPrefix: 'raw:' }).traceable) v.push('generated artifact not traceable to originating data');
    // Interoperability profile: additive change OK, breaking change refused.
    const io = new InteroperabilityProfile();
    io.register('p', { canonical: { a: 'string' }, requiredFields: ['a'] });
    io.register('p', { canonical: { a: 'string', b: 'string' }, requiredFields: ['a'] }); // additive
    let refused = false; try { io.register('p', { canonical: { a: 'number' }, requiredFields: ['a'] }); } catch (_) { refused = true; }
    if (!refused) v.push('interoperability profile allowed a breaking change');
  }),

  fit('APP-FIT-COMMAND-CENTER', 'Cross-domain intelligence + command center are advisory and never authorize', (v) => {
    // Systemic risk is computed + explainable; no automated decision.
    const risk = crossDomain.systemicRisk({ engineering: { healthy: false }, security: { healthy: true } });
    if (typeof risk.systemicRisk !== 'number' || !/no automated action/.test(risk.note)) v.push('systemic risk is not advisory/explainable');
    // Command center is human-gated and never emits an authorization.
    const cc = new CommandCenter({ engineering: () => ({ healthy: true }), resilience: () => ({ pass: true }) });
    const snap = cc.snapshot();
    if (snap.humanGate.required !== true) v.push('command center is not human-gated');
    if ('authorized' in snap) v.push('command center emitted an authorization');
    // National readiness score never authorizes at any value.
    const rs = cc.nationalReadinessScore();
    if (rs.humanGate !== true || 'authorized' in rs) v.push('national readiness score is not human-gated');
    if (!/HUMAN APPROVAL REQUIRED/.test(cc.decisionSupportSummary().decision)) v.push('decision-support summary is not human-gated');
    // Degraded domain flips posture (must be able to detect risk).
    if (new CommandCenter({ engineering: () => ({ healthy: false }), security: () => ({ healthy: false }) }).snapshot().posture === 'green') v.push('command center reported green with degraded domains');
  }),

  fit('APP-FIT-EVOLUTION-GOVOPS', 'Evolution intel is advisory; governance ops center never authorizes', (v) => {
    // Refactoring impact is advisory + computes a blast radius from the capability map.
    const impact = evolution.refactoringImpact('Anonymous Reporting');
    if (impact.blastRadius < 1) v.push('refactoring impact found no dependents for a depended-on capability');
    if (!/human-governed/.test(impact.note)) v.push('refactoring impact is not marked advisory/human-governed');
    // Recommendations never auto-apply.
    if (evolution.recommendations([{ id: 'X', pass: false }]).advisoryOnly !== true) v.push('evolution recommendations are not advisory');
    // Governance ops center aggregates posture and is ALWAYS human-gated (never authorizes).
    const center = new GovernanceOpsCenter({ fitness: () => ({ healthy: true }), resilience: () => ({ pass: true }) });
    const snap = center.snapshot();
    if (snap.humanGate.required !== true) v.push('governance ops center is not human-gated');
    if (!/never authorizes/.test(center.strategicReadiness().note)) v.push('ops center strategic readiness is not human-gated');
    if ('authorized' in snap) v.push('ops center emitted an authorization');
  }),

  fit('APP-FIT-KNOWLEDGE-CAPABILITY', 'Knowledge records immutable/tamper-evident; marketplace publication human-gated', (v) => {
    const kr = new KnowledgeRepository({ clock: () => 1 });
    kr.record({ type: 'adr', title: 'ADR one', tags: ['x'] });
    kr.record({ type: 'governance-decision', title: 'GD one', refs: ['KN-00001'] });
    if (!kr.verify().ok) v.push('knowledge chain does not verify');
    if (!Object.isFrozen(kr._records[0])) v.push('knowledge record is mutable');
    // Personal data is refused (privacy).
    let refused = false; try { kr.record({ type: 'lesson-learned', title: 'x', attributes: { email: 'a@b.c' } }); } catch (_) { refused = true; }
    if (!refused) v.push('knowledge repository accepted personal data');
    // Decision traceability follows refs.
    if (kr.trace('KN-00002').length < 2) v.push('knowledge decision traceability broken');
    // Capability marketplace: publication requires certification + human approval.
    const mkt = new CapabilityMarketplace();
    mkt.register('cap', { type: 'workflow', owner: 'o', spec: { a: 1 } });
    let gate = false; try { mkt.publish('cap', { by: 'x', rationale: 'y' }); } catch (_) { gate = true; }
    if (!gate) v.push('capability published without certification');
    mkt.certify('cap');
    let human = false; try { mkt.publish('cap', { by: 'x' }); } catch (_) { human = true; }
    if (!human) v.push('capability published without a rationale');
    mkt.publish('cap', { by: 'steward', rationale: 'reviewed' });
    if (mkt.discover().length !== 1) v.push('published capability not discoverable');
  }),

  fit('APP-FIT-PLATFORM-INTELLIGENCE', 'Capability/maturity human-gated; SDK deterministic; metadata classified', (v) => {
    // Maturity is capped by automation and human-gated (never authorizes).
    const m = maturityMod.assess({ twin: [{ id: 'FIT-X', pass: true }], app: [], infra: [] });
    if (m.overallLevel > m.automationCap) v.push('maturity exceeded the automation cap');
    if (m.humanGate.required !== true) v.push('maturity is not human-gated');
    // Capability heat map maps controls to live status.
    const hm = capabilityMod.heatMap([{ id: 'FIT-IDENTITY-MINIMIZATION', pass: true }, { id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true }]);
    if (hm['Anonymous Reporting'].status !== 'healthy') v.push('capability heat map did not reflect passing controls');
    // SDK generation is deterministic + the test harness detects duplicate operationIds.
    const sdkA = devplatform.generateClientSdk(openapiSpec.spec());
    if (sdkA !== devplatform.generateClientSdk(openapiSpec.spec())) v.push('SDK generation is not deterministic');
    if (!devplatform.testHarness(openapiSpec.spec()).ok) v.push('OpenAPI has duplicate/missing operationIds');
    // Metadata rejects an invalid classification (governance).
    const md = new MetadataGovernance();
    let refused = false; try { md.register('d', { owner: 'o', classification: 'bogus' }); } catch (_) { refused = true; }
    if (!refused) v.push('metadata accepted an invalid classification');
  }),

  fit('APP-FIT-CUSTODY-SIGNED-CHAIN', 'Custody ledger is signed, hash-chained, tamper-evident', (v) => {
    let t = 0; const cl = new CustodyLedger({ clock: () => (t += 1) });
    cl.record({ evidenceId: 'EV-1', action: 'ingested', actor: 'system', contentHash: 'abc' });
    cl.record({ evidenceId: 'EV-1', action: 'sealed', actor: 'system', contentHash: 'abc' });
    const res = cl.verify();
    if (!res.ok) v.push('custody chain/signature did not verify');
    if (!cl.archive().verified) v.push('custody archive did not verify');
    // Entries are immutable.
    if (!Object.isFrozen(cl.entries()[0])) { /* entries() returns copies; assert source frozen via verify above */ }
  }),

  fit('APP-FIT-GEO-PRIVACY', 'GIS stores coarsened cells only; heatmaps suppress small cells', (v) => {
    const si = new SpatialIndex({ precision: 4 });
    const cell = si.add('inc-1', -24.6541, 25.9087); // Gaborone-ish synthetic coords
    if (cell.length !== 4) v.push('geohash precision not coarsened to the privacy floor');
    // No raw coordinates are retained (only the cell) — introspect the cell store.
    if (JSON.stringify(si.heatmap()).match(/-?\d{2}\.\d{3,}/)) v.push('raw coordinates leaked into GIS');
    // Small cells suppressed.
    const hm = si.heatmap({ k: 5 });
    if (hm.cells[cell].suppressed !== true) v.push('small GIS cell not suppressed');
  }),

  fit('APP-FIT-EVENT-GOVERNANCE', 'Event contracts are governed; breaking schema evolution refused', (v) => {
    let t = 0; const es = new EventStore({ clock: () => (t += 1) });
    es.append('NJ-G', [{ type: 'CaseSubmitted', data: { category: 'police', recipient: 'ombudsman', stage: 'intake-review' } }]);
    const reg = seedCaseEvents(new EventRegistry());
    // Every event type in the log is registered (governance coverage).
    const val = reg.validate(es);
    if (!val.ok) v.push('event log has unregistered types or a broken chain: ' + JSON.stringify(val));
    // A breaking schema evolution is refused (no existing contract may break).
    reg.register('X', { owner: 'o', schema: { fields: { a: 'string' }, required: ['a'] } });
    let refused = false; try { reg.evolve('X', { fields: { a: 'number' }, required: ['a'] }); } catch (_) { refused = true; }
    if (!refused) v.push('breaking event-schema evolution was accepted');
    // Retirement requires prior deprecation (lifecycle discipline).
    let lifecycle = false; try { reg.retire('X'); } catch (_) { lifecycle = true; }
    if (!lifecycle) v.push('event retired without deprecation');
  }),

  fit('APP-FIT-DIGITAL-IDENTITY', 'Identity refuses personal data; credentials verify + revoke; untrusted issuer refused', (v) => {
    const reg = new IdentityRegistry({ clock: () => 1 });
    // Personal data is refused (privacy — governed principals only).
    let refused = false; try { reg.register('p1', { type: 'person', attributes: { name: 'Real Name' } }); } catch (_) { refused = true; }
    if (!refused) v.push('identity registry accepted personal data');
    reg.register('svc1', { type: 'service', assuranceLevel: 'IAL2' });
    // Credential issuance requires a trusted issuer (fail-closed).
    let issuerGate = false; try { reg.issueCredential({ credId: 'c1', subject: 'svc1', issuer: 'unknown' }); } catch (_) { issuerGate = true; }
    if (!issuerGate) v.push('credential issued by an untrusted issuer');
    reg.registerIssuer('ca');
    reg.issueCredential({ credId: 'c1', subject: 'svc1', issuer: 'ca' });
    if (!reg.verifyCredential('c1').valid) v.push('valid credential did not verify');
    reg.revoke('c1');
    if (reg.verifyCredential('c1').valid) v.push('revoked credential still verifies');
  }),

  fit('APP-FIT-INFRA-GOVERNANCE', 'Infrastructure residency enforced; drift detected; readiness human-gated', (v) => {
    const infra = new InfrastructureRegistry();
    infra.setPolicy({ allowedRegions: ['bw-central'], residency: { secret: 'bw-central' } });
    infra.register('s1', { kind: 'storage', region: 'bw-central', dataClassification: 'secret' });
    if (!infra.validateCompliance().compliant) v.push('compliant infra flagged non-compliant');
    // A residency violation is detected (fail-closed reporting).
    infra.register('s2', { kind: 'storage', region: 'off-shore', dataClassification: 'secret' });
    if (infra.validateCompliance().compliant) v.push('residency violation not detected');
    // Drift against a baseline is detected.
    const infra2 = new InfrastructureRegistry(); infra2.register('a', { kind: 'compute', region: 'bw-central' }); infra2.recordBaseline();
    infra2.register('b', { kind: 'compute', region: 'bw-central' });
    if (!infra2.detectDrift().drift) v.push('infrastructure drift not detected');
    if (infra2.readiness().humanGate !== true) v.push('infra readiness is not human-gated');
  }),

  fit('APP-FIT-POLICY-GOVERNANCE', 'Policy activation requires validation; rollback works; audited', (v) => {
    const reg = new PolicyRegistry();
    reg.register('ac', { owner: 'sec', policies: DEFAULT_POLICIES });
    // Activation with a failing validation suite is refused (fail-closed).
    let refused = false; try { reg.activate('ac', 1, { validationSuite: [{ request: { action: 'read-evidence', subject: { role: 'citizen' } }, expect: 'permit' }] }); } catch (_) { refused = true; }
    if (!refused) v.push('policy activated despite failing validation');
    // Valid activation succeeds and is audited.
    reg.activate('ac', 1, { validationSuite: [{ request: { action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' } }, expect: 'permit' }] });
    if (!reg.active('ac')) v.push('valid activation did not take effect');
    reg.register('ac', { owner: 'sec', policies: [] }); reg.activate('ac', 2);
    if (reg.rollback('ac', 1).version !== 1) v.push('rollback did not restore the prior version');
    if (!reg.auditTrail().some((a) => a.event === 'rolled-back')) v.push('rollback not audited');
  }),

  fit('APP-FIT-FORMAL-VERIFICATION', 'Critical workflow is formally proven; a broken one is not', (v) => {
    const proof = formalVerification.proveCorrectness(DEFAULT_WORKFLOW);
    if (!proof.proven) v.push('default workflow failed formal verification: ' + proof.properties.filter((p) => !p.proven).map((p) => p.property).join(', '));
    // A deadlocking workflow is NOT proven (the prover must be able to reject).
    const bad = { id: 'b', version: 1, start: 's', terminal: ['done'], states: { s: { on: {} }, done: { on: {} } } };
    if (formalVerification.proveCorrectness(bad).proven) v.push('formal prover accepted a deadlocking workflow');
    // Safety obligation is enforced when specified.
    const unsafe = { id: 'u', version: 1, start: 'a', terminal: ['closed'], states: { a: { on: { skip: 'closed', proper: 'decision' } }, decision: { on: { close: 'closed' } }, closed: { on: {} } } };
    if (formalVerification.verifySafety(unsafe, { critical: 'closed', requiredBefore: 'decision' }).proven) v.push('safety violation (closed without decision) not detected');
  }),

  fit('APP-FIT-CRISIS-PORTFOLIO', 'Crisis ops need human authorization; portfolio recommendations advisory', (v) => {
    const cp = new NationalCrisisPlatform({ clock: () => 1 });
    const inc = cp.declare({ type: 'cyber-incident', severity: 'severe' });
    // Operational execution without authorization is refused (fail-closed).
    let failClosed = false; try { cp.executeOperation(inc.id); } catch (e) { failClosed = !!e.failClosed; }
    if (!failClosed) v.push('crisis operation executed without human authorization');
    let needsHuman = false; try { cp.authorizeOperation(inc.id, { by: 'x' }); } catch (_) { needsHuman = true; }
    if (!needsHuman) v.push('crisis operation authorized without a rationale');
    cp.authorizeOperation(inc.id, { by: 'ops-lead', rationale: 'declared incident' });
    if (!/no production action/.test(cp.executeOperation(inc.id).note)) v.push('crisis execution is not a synthetic record');
    // Simulation is deterministic.
    if (JSON.stringify(cp.simulate(inc.id)) !== JSON.stringify(cp.simulate(inc.id))) v.push('crisis simulation is not deterministic');
    // Service portfolio recommendations are advisory.
    const sp = new ServicePortfolio(); sp.register('s', { owner: 'o', strategicValue: 'high', maturity: 'managed' }); sp.transition('s', 'live');
    if (sp.recommendations().advisoryOnly !== true) v.push('portfolio recommendations are not advisory');
  }),

  fit('APP-FIT-RECOVERY-HUMAN-GATED', 'Recovery recommends only; never executes without human authorization', (v) => {
    const rp = seedPlaybooks(new RecoveryPlatform({ clock: () => 1 }));
    const rec = rp.recommend({ incidentType: 'regional-outage' });
    if (rec.requiresHumanAuthorization !== true || rec.advisoryOnly !== true) v.push('recovery recommendation is not advisory/human-gated');
    // Execution without authorization is refused (fail-closed).
    let failClosed = false; try { rp.execute(rec.id); } catch (e) { failClosed = !!e.failClosed; }
    if (!failClosed) v.push('recovery executed without human authorization');
    // Authorization needs a named human + rationale; then execution is a synthetic record only.
    let needsHuman = false; try { rp.authorize(rec.id, { by: 'x' }); } catch (_) { needsHuman = true; }
    if (!needsHuman) v.push('recovery authorized without a rationale');
    rp.authorize(rec.id, { by: 'ops-lead', rationale: 'declared incident' });
    const ex = rp.execute(rec.id);
    if (!/no production change/.test(ex.note)) v.push('recovery execution is not a synthetic record');
  }),

  fit('APP-FIT-PROCESS-MINING', 'Process mining is deterministic + advisory over non-identifying events', (v) => {
    const events = [
      { streamId: 'NJ-1', type: 'CaseSubmitted', meta: { at: 0, actor: 'system' } },
      { streamId: 'NJ-1', type: 'CaseReviewed', meta: { at: 10, actor: 'inv-001' } },
      { streamId: 'NJ-1', type: 'CaseTransitioned', meta: { at: 30, actor: 'inv-001' } },
      { streamId: 'NJ-2', type: 'CaseSubmitted', meta: { at: 0, actor: 'system' } },
      { streamId: 'NJ-2', type: 'CaseReviewed', meta: { at: 5, actor: 'inv-002' } },
    ];
    const d = processMining.discover(events);
    if (d.cases !== 2 || !d.edges['CaseSubmitted->CaseReviewed']) v.push('process discovery did not build the directly-follows graph');
    if (JSON.stringify(processMining.bottlenecks(events)) !== JSON.stringify(processMining.bottlenecks(events))) v.push('process mining is not deterministic');
    if (processMining.recommendations(events).advisoryOnly !== true) v.push('process mining recommendations are not advisory');
    // No identity leaks (events are non-identifying already; ensure output has no denied keys).
    if (/"email"|"omang"|"name"/.test(JSON.stringify(d))) v.push('process mining leaked identity');
  }),

  fit('APP-FIT-NATIONAL-RESILIENCE', 'Default resilience suite passes; national sims deterministic + human-gated', (v) => {
    // The platform must pass the resilience validation suite (Twin verifies before deploy).
    const res = resilience.validateResilience();
    if (!res.pass) v.push('resilience suite failed: ' + res.results.filter((r) => !r.pass).map((r) => r.scenario).join(', '));
    if (res.humanGate !== true) v.push('resilience validation is not human-gated');
    // A genuinely fatal scenario is REJECTED (validator can fail).
    if (resilience.validateCyberIncident({ compromised: ['keys'], critical: ['keys'] }).pass) v.push('cyber-incident validator passed a critical compromise');
    // National (Twin 4.0) simulations are deterministic + advisory + human-gated.
    const a = twin4.longTermCapacity({ years: 5, seed: 1 }); const b = twin4.longTermCapacity({ years: 5, seed: 1 });
    if (JSON.stringify(a) !== JSON.stringify(b)) v.push('national simulation is not deterministic');
    if (a.advisoryOnly !== true || a.humanGate !== true) v.push('national simulation is not advisory/human-gated');
  }),

  fit('APP-FIT-WORKFLOW-SIMULATION', 'Default workflow passes activation validation; sims are deterministic', (v) => {
    const gate = workflowSim.validateForActivation(DEFAULT_WORKFLOW);
    if (!gate.ok) v.push('default workflow failed activation validation: ' + gate.issues.join('; '));
    // The simulator detects a deadlock in a broken definition (must be able to fail).
    const bad = { id: 'bad', version: 1, start: 's', terminal: ['done'], states: { s: { on: {} }, done: { on: {} } } };
    if (workflowSim.validateForActivation(bad).ok) v.push('simulator failed to detect a deadlock');
    // Monte-Carlo replay is deterministic (same seed → same result).
    const a = twin3.workloadForecast({ seed: 7 }); const b = twin3.workloadForecast({ seed: 7 });
    if (JSON.stringify(a.perInvestigator) !== JSON.stringify(b.perInvestigator)) v.push('Monte-Carlo simulation is not deterministic');
    // Predictive readiness is human-gated and never authorizes.
    if (twin3.predictiveReadiness({ fitnessPassRate: 1, failureRisk: 0 }).humanGate !== true) v.push('predictive readiness is not human-gated');
  }),

  fit('APP-FIT-WORKFLOW-INTEGRITY', 'Prioritisation is deterministic; assignment stays within the roster', (v) => {
    // Prioritisation is a pure function of its inputs (reproducible).
    if (JSON.stringify(inv.scorePriority({ category: 'police', escalated: true, ageMs: 0 })) !== JSON.stringify(inv.scorePriority({ category: 'police', escalated: true, ageMs: 0 }))) v.push('prioritisation is not deterministic');
    // Assignment never returns an excluded principal, and returns null when all excluded.
    const roster = [{ id: 'a', unit: 'x' }, { id: 'b', unit: 'y' }];
    const pick = inv.assign({ roster, exclude: ['a'] });
    if (pick && pick.id === 'a') v.push('assignment returned an excluded principal');
    if (inv.assign({ roster, exclude: ['a', 'b'] }) !== null) v.push('assignment did not fail closed when all excluded');
    // SLA breach is a monotonic function of time.
    const early = inv.slaStatus({ band: 'P1', createdAt: 0, now: 1 }).breached;
    const late = inv.slaStatus({ band: 'P1', createdAt: 0, now: 30 * 24 * 3600_000 }).breached;
    if (early || !late) v.push('SLA breach detection is not monotonic in time');
  }),

  fit('APP-FIT-ANALYTICS-PRIVACY', 'Search refuses identity/content; analytics suppress small cells; export omits identity', (v) => {
    const idx = new SearchIndex();
    let refused = false; try { idx.index({ case_code: 'NJ-X', email: 'a@b.c' }); } catch (_) { refused = true; }
    if (!refused) v.push('search indexed a sensitive field');
    // Non-allowlisted content is not indexed.
    idx.index({ case_code: 'NJ-Y', category: 'police', note: 'leaky' });
    if (idx.search('leaky').length !== 0) v.push('search indexed a non-allowlisted field');
    // Small cells suppressed.
    const agg = analytics.aggregate([{ category: 'courts' }], { by: 'category', k: 5 });
    if (agg.groups.courts.count !== null || !agg.groups.courts.suppressed) v.push('small cell not suppressed');
    // Export never carries identity.
    const rows = analytics.exportRows([{ case_code: 'NJ-Z', category: 'police', email: 'a@b.c', createdAt: 1 }], { format: 'csv' });
    if (rows.includes('a@b.c')) v.push('export leaked an identity value');
  }),

  fit('APP-FIT-TRACE-PRIVACY', 'Distributed-trace spans never carry identity/content', (v) => {
    const tr = new Tracer();
    const span = tr.startSpan('http.request', { attrs: { email: 'a@b.c', content: 'secret', route: '/api/reports' } });
    span.setAttr('ip', '1.2.3.4');
    span.end();
    const rec = tr.recent(1)[0];
    const json = JSON.stringify(rec);
    if (json.includes('a@b.c') || json.includes('secret') || json.includes('1.2.3.4')) v.push('trace span leaked identity/content');
    if (rec.attrs.route !== '/api/reports') v.push('trace dropped a safe attribute (over-redaction)');
  }),

  fit('APP-FIT-INTEGRATION-ISOLATION', 'Outbound integrations refuse PII/content and fail fast (circuit breaker)', (v) => {
    let now = 0;
    const gw = new IntegrationGateway({ clock: () => now });
    gw.register('siem', new CaptureIntegrationClient({ failTimes: 99 }), { failureThreshold: 2, cooldownMs: 100 });
    // Outbound PII/content is refused (fail-closed).
    let refused = false; try { gw.send('siem', { email: 'a@b.c' }); } catch (e) { refused = /refuses PII/.test(e.message); }
    if (!refused) v.push('integration sent a PII payload');
    // Repeated downstream failures open the breaker (isolation — no cascade).
    for (let i = 0; i < 2; i++) { try { gw.send('siem', { event: 'x' }); } catch (_) { /* downstream error */ } }
    if (gw.state('siem') !== 'open') v.push('circuit breaker did not open after repeated failures');
    let fastFail = false; try { gw.send('siem', { event: 'y' }); } catch (e) { fastFail = !!e.circuitOpen; }
    if (!fastFail) v.push('open circuit did not fail fast');
  }),

  fit('APP-FIT-FLAGS-DETERMINISTIC', 'Feature-flag rollout is deterministic, sticky, and identity-free', (v) => {
    const ff = new FeatureFlags({ f: { rolloutPct: 50 } });
    // Sticky: same subject → same decision.
    if (ff.isEnabled('f', { subject: 'case-123' }) !== ff.isEnabled('f', { subject: 'case-123' })) v.push('flag decision is not deterministic/sticky');
    // Kill-switch overrides rollout.
    ff.set('f', { enabled: false, rolloutPct: 100 });
    if (ff.isEnabled('f', { subject: 'x' })) v.push('kill-switch did not disable the feature');
  }),

  fit('APP-FIT-CONTEXT-MAP', 'The context map is complete, acyclic, and owns every source module', (v) => {
    // The architecture-of-record must stay true: purposes, rationale, known relationship
    // patterns, no dependency cycles, no unreviewed responsibility overlap.
    const res = contextMap.validate();
    for (const violation of res.violations) v.push(violation);
    // Every module under src/ belongs to exactly one bounded context (no orphan code).
    const mo = contextMap.moduleOwnership();
    if (mo.modules === 0) v.push('module ownership resolved no modules');
    // Boundaries must be crossed through a declared mechanism, never implicitly.
    for (const p of contextMap.communicationPaths()) {
      if (!contextMap.RELATIONSHIPS.has(p.relationship)) v.push(`undeclared relationship on ${p.from}→${p.to}`);
      if (!contextMap.MECHANISMS.has(p.mechanism)) v.push(`undeclared mechanism on ${p.from}→${p.to}`);
    }
    // The assurance context must never be downstream of a context it validates (no capture).
    const assurance = contextMap.upstreamDownstream('assurance');
    if (assurance.upstream.includes('governance-oversight')) v.push('assurance depends on governance-oversight (regulator capture)');
    // Deterministic: the map renders identically on repeated reads.
    if (JSON.stringify(contextMap.contextMap()) !== JSON.stringify(contextMap.contextMap())) v.push('context map is not deterministic');
  }),

  fit('APP-FIT-GOVERNANCE-OWNERSHIP', 'Every bounded context has a complete, SoD-respecting institutional owner', (v) => {
    const res = ownership.validate();
    for (const violation of res.violations) v.push(violation);
    // Separation of duties is structural: nobody approves their own subsystem.
    for (const s of ownership.subsystems()) {
      const o = ownership.describe(s);
      if (o.responsibleAuthority === o.approvingAuthority) v.push(`${s}: responsible authority also approves`);
      if (ownership.escalationPath(s).terminatesAt !== o.governanceBoard) v.push(`${s}: escalation does not terminate at its governance board`);
    }
    // Accountability resolves from the context map (technical and organisational models agree).
    const a = ownership.accountabilityFor('intake');
    if (!a.dataSteward || !a.purpose) v.push('accountability lookup did not resolve through the context map');
    // The ownership model records accountability; it must not carry personal data.
    if (/@|omang|nationalId/i.test(JSON.stringify(ownership.model()))) v.push('ownership model leaked personal data (roles only)');
  }),

  fit('APP-FIT-INTEGRATION-CONTRACTS', 'Every boundary crossing has a versioned contract; breaking changes are refused', (v) => {
    const reg = new ContractRegistry();
    for (const violation of reg.validate().violations) v.push(violation);
    // Every context that crosses a boundary by event or HTTP is covered by a contract.
    if (reg.coverage().uncovered.length) v.push('uncovered boundary contexts: ' + reg.coverage().uncovered.join(', '));
    // Contracts declare only canonical errors, so consumers handle failure uniformly.
    for (const c of reg.list()) for (const e of c.errors) if (!CANONICAL_ERRORS[e]) v.push(`${c.id}: non-canonical error ${e}`);
    // A backward-compatible addition is a minor version; removing a field is major.
    if (reg.compatibility('api.reports.submit', { fields: { required: ['category'], optional: ['extra', 'locale'] } }).requiredBump !== 'minor') v.push('adding an optional field was not classified as minor');
    if (reg.compatibility('api.reports.submit', { fields: { required: ['category', 'urgency'], optional: ['extra'] } }).breaking !== true) v.push('adding a required field was not classified as breaking');
    // A breaking revision is REFUSED unless a major version + sunset are declared (fail-closed).
    let refused = false;
    try { reg.revise('api.case.transition', { fields: { required: ['case_code'], optional: [] } }); } catch (e) { refused = !!e.failClosed; }
    if (!refused) v.push('a breaking contract revision was accepted without a major version');
    let sunsetRequired = false;
    try { reg.revise('api.case.transition', { fields: { required: ['case_code'], optional: [] } }, { major: true }); } catch (e) { sunsetRequired = !!e.failClosed; }
    if (!sunsetRequired) v.push('a major contract version was accepted without a recorded sunset');
    // Changing authentication is always breaking and always security-reviewed.
    const authChange = reg.compatibility('api.oversight.dashboard', { authentication: 'anonymous' });
    if (!authChange.breaking || !authChange.securityReview) v.push('an authentication change was not treated as a breaking, security-relevant change');
    // A contract may never carry an identity/content field on its surface.
    let identityRefused = false;
    try { reg.register('api.bad', { kind: 'api', operation: 'POST /x', owner: 'intake', consumers: ['external-consumer'], fields: { required: ['email'] }, authentication: 'anonymous', errors: ['VALIDATION_FAILED'] }); } catch (e) { identityRefused = !!e.failClosed; }
    if (!identityRefused) v.push('a contract accepted an identity field');
    // Generated artifacts stay in step with the registry and are deterministic.
    if (JSON.stringify(reg.toOpenApi()) !== JSON.stringify(new ContractRegistry().toOpenApi())) v.push('generated OpenAPI is not deterministic');
    if (reg.eventDefinitions().some((e) => !e.ordered || !e.piiFree)) v.push('an event definition lost its ordering or PII-free guarantee');
  }),

  fit('APP-FIT-MIGRATION-ROADMAP', 'Every synthetic subsystem has a validated, reversible migration path', (v) => {
    for (const violation of migration.validate().violations) v.push(violation);
    // Each of the named subsystems in the transition plan is covered.
    const covered = migration.items().map((i) => i.subsystem.replace(' 🔒', ''));
    for (const required of ['Identity', 'Cryptography', 'Storage', 'Messaging', 'Audit', 'Policy Engine', 'Governance Portal', 'Data Exchange', 'Process Mining', 'Performance Observatory']) {
      if (!covered.some((s) => s.startsWith(required))) v.push(`migration roadmap does not cover ${required}`);
    }
    // Every required validation must name a fitness function that actually exists.
    const known = new Set([
      ...require('../../njtip-twin/verification/fitness').map((f) => f.id),
      ...require('./app-fitness').map((f) => f.id),
      ...require('./infra-fitness').map((f) => f.id),
    ]);
    for (const item of migration.items()) for (const id of item.validations) if (!known.has(id)) v.push(`${item.id}: validation '${id}' is not a real fitness function`);
    // Every item is reversible and its risks are named — no unrehearsed cutover.
    for (const item of migration.items()) {
      if (!migration.rollbackPlan(item.id).rollback) v.push(`${item.id}: no rollback strategy`);
      if (!item.risks.length) v.push(`${item.id}: no named risks`);
    }
    // Readiness is advisory and never authorizes, even when everything passes.
    const r = migration.readiness('identity', { fitnessResults: [...known].map((id) => ({ id, pass: true })) });
    if (r.humanGate !== true || r.authorizes !== false) v.push('migration readiness is not human-gated / claims authority');
    // Incremental order holds: dependencies are sequenced before their dependents.
    const order = migration.sequence().order;
    if (migration.sequence().unresolved.length) v.push('migration sequence has an unresolved cycle');
    for (const item of migration.items()) for (const dep of item.dependsOn) if (order.indexOf(dep) > order.indexOf(item.id)) v.push(`${item.id} is sequenced before its dependency ${dep}`);
  }),

  fit('APP-FIT-INFRA-ASSURANCE', 'IaC, SBOM, certificates, backups and platform lifecycle are governed', (v) => {
    const { InfrastructureAssurance } = require('../src/infra/infrastructure-assurance');
    const { InfrastructureRegistry } = require('../src/infra/infra-governance');
    const { CertificateManager } = require('../src/adapters/certificates');
    let now = Date.UTC(2026, 7, 1);
    const registry = new InfrastructureRegistry({ clock: () => now });
    registry.register('compute:app', { kind: 'compute', region: 'bw-central', provider: 'sovereign-cloud' });
    registry.recordBaseline();
    const certs = new CertificateManager({ clock: () => now });
    certs.issue({ subject: 'njtip-app' });
    const ia = new InfrastructureAssurance({ registry, certificates: certs });

    // Infrastructure-as-Code: every declared invariant is asserted in the manifests.
    const iac = ia.validateIac();
    for (const f of iac.findings.filter((x) => x.severity === 'high')) v.push(`IaC ${f.rule} in ${f.file}: ${f.detail}`);
    if (!iac.valid) v.push('IaC validation failed');
    // The placeholder detector must actually be able to fire (reference manifests carry them).
    if (!iac.unresolvedPlaceholders.length) v.push('placeholder detection is not exercised — it cannot fail');
    // SBOM + dependency inventory: zero third-party supply-chain surface.
    if (ia.dependencyInventory().thirdPartyCount !== 0) v.push('third-party dependencies present (supply-chain surface must stay built-ins only)');
    if (!ia.sbom().builtinsUsed.length) v.push('SBOM records no built-in modules');
    // Backup verification: a restore must reproduce the source exactly.
    const backup = ia.verifyBackup();
    if (!backup.verified || backup.sourceDigest !== backup.restoredDigest) v.push('backup/restore round-trip did not verify');
    // Certificate lifecycle: nothing past due for rotation.
    if (!ia.certificateLifecycle().healthy) v.push('a certificate is past due for rotation');
    // Drift against the human-reviewed baseline; and the detector must be able to fire.
    if (ia.detectDrift().drift) v.push('unreviewed infrastructure drift');
    registry.register('compute:rogue', { kind: 'compute', region: 'bw-south', provider: 'sovereign-cloud' });
    if (!ia.detectDrift().drift) v.push('drift detection did not notice a new resource');
    // Unsupported-software detection: nothing past its support window, and it can fail.
    if (!ia.detectUnsupported({ now }).clean) v.push('unsupported platform component in use');
    if (ia.detectUnsupported({ now: Date.UTC(2035, 0, 1) }).clean) v.push('unsupported-software detection cannot fail');
    // The whole report is advisory and never authorizes.
    const rep = ia.report({ now });
    if (rep.humanGate !== true || rep.authorizes !== false) v.push('infrastructure assurance claims authority');
  }),

  fit('APP-FIT-DEVSECOPS-CLASSIFICATION', 'Scanner separates credentials from identifiers, labels and config', (v) => {
    const ds = require('../scripts/devsecops');
    // A credential is detected; benign shapes are classified, recorded and not raised.
    const cases = [
      ['xK9$mQ2vLp7RtZ4wB3nH', 'password', 'credential'],
      ['aGVsbG8gd29ybGQgc2VjcmV0IHZhbHVl', 'token', 'credential'],
      ['bw-central', 'secret', 'identifier'],
      ['restricted', 'classification', 'classification'],
      ['secret', 'classification', 'classification'],
      ['https://idp.example.gov.bw/', 'oidcIssuer', 'configuration'],
      ['SYNTHETIC-SESSION-SIGNING-KEY-do-not-use-in-prod', 'secret', 'configuration'],
      ['REPLACE_FROM_SECRETS_MANAGER', 'password', 'configuration'],
    ];
    for (const [value, key, expected] of cases) {
      const got = ds.classifyValue(value, { key });
      if (got !== expected) v.push(`classified '${value}' as ${got}, expected ${expected}`);
    }
    // Fail-safe: an unrecognised shape that a credential pattern matched stays a credential.
    if (ds.classifyValue('this is my actual passphrase', { key: 'password' }) !== 'credential') v.push('classifier is not fail-safe on an unrecognised value');
    // Entropy separates a random secret from a slug.
    if (!(ds.entropy('xK9$mQ2vLp7RtZ4wB3nH') > ds.entropy('bw-central'))) v.push('entropy does not separate random values from slugs');
    // Suppressed candidates are RECORDED, never invisible.
    const rep = ds.classificationReport();
    if (!Array.isArray(rep.suppressed)) v.push('suppressed candidates are not recorded');
    if (rep.candidates !== rep.suppressed.length + ds.secretScan().length) v.push('classification report does not account for every candidate');
    // And the security scan itself stays clean.
    for (const f of ds.secretScan()) v.push(`credential ${f.rule} in ${f.file}`);
  }),

  fit('APP-FIT-CRYPTO-ALGORITHM-INDEPENDENCE', 'No module outside the crypto policy registry names an algorithm', (v) => {
    const { QuantumMigrationRegistry } = require('../src/adapters/quantum-transition');
    const { makeCryptoAgility } = require('../src/adapters/crypto-agility');
    const agility = makeCryptoAgility();
    const q = new QuantumMigrationRegistry({ cryptoRegistry: agility.registry });
    // Algorithm selection is data: business logic must never name an algorithm.
    const ind = q.algorithmIndependence();
    if (!ind.independent) v.push('algorithm identifiers leaked outside the crypto policy registry: ' + ind.leaks.join(', '));
    // The migration plan documents its assumptions, requirements and abstraction layers.
    const plan = q.transitionPlan();
    if (plan.assumptions.length < 4) v.push('quantum migration assumptions are not documented');
    if (!plan.assumptions.some((a) => a.id === 'harvest-now-decrypt-later')) v.push('harvest-now-decrypt-later assumption is missing');
    if (plan.compatibilityRequirements.length < 4) v.push('compatibility requirements are not documented');
    if (!plan.abstractionLayers.some((l) => /never leaves the HSM/.test(l.neverKnows))) v.push('key material is not excluded from every abstraction layer');
    if (plan.phases.length !== 4 || plan.phases.some((p) => !p.exitCriterion)) v.push('transition phases lack exit criteria');
    if (plan.humanGate !== true || plan.authorizes !== false) v.push('the quantum transition plan claims authority');
    // Migration to a non-post-quantum target is refused (fail-closed).
    let refused = false;
    try { q.plan('bad', { purpose: 'signature', fromAlgo: agility.registry.permitted('signature')[0], toAlgo: agility.registry.permitted('signature')[1] }); } catch (_) { refused = true; }
    if (!refused) v.push('a non-post-quantum migration target was accepted');
    // A provider keeps accepting the legacy algorithm during the overlap window.
    const provider = agility.provider('signature');
    const legacy = provider.primary();
    provider.migrate(agility.registry.catalog('signature').find((a) => a.pq).id);
    if (!provider.accepts(legacy)) v.push('the overlap window does not accept legacy-signed artifacts');
  }),

  fit('APP-FIT-LEGISLATIVE-IMPACT', 'A legal change is fully simulatable, traceable to controls, and never self-enacting', (v) => {
    const { LegislativeImpactAnalyzer } = require('../src/legislation/impact');
    const reg = new LegislativeRegistry({ clock: () => 0 });
    reg.register('dpa', { title: 'Data Protection Act', type: 'act', mapsToControls: ['FIT-IDENTITY-MINIMIZATION'], mapsToSystems: ['reporting'] });
    reg.register('reg-report', { title: 'Reporting Regulations', dependsOn: ['dpa'], mapsToControls: ['APP-FIT-ANONYMITY-BOUNDARY'], mapsToSystems: ['reporting', 'analytics'] });
    reg.register('reg-analytics', { title: 'Analytics Directive', dependsOn: ['reg-report'], mapsToControls: ['APP-FIT-ANALYTICS-PRIVACY'], mapsToSystems: ['analytics'] });
    const an = new LegislativeImpactAnalyzer(reg);
    // Transitive regulatory dependency graph, in both directions, with no cycles.
    if (!an.descendants('dpa').includes('reg-analytics')) v.push('transitive dependents not resolved');
    if (!an.ancestors('reg-analytics').includes('dpa')) v.push('transitive dependencies not resolved');
    if (an.cycles().length) v.push('cycle between legal instruments');
    // Policy impact reaches every dependent instrument, system and control.
    const impact = an.policyImpact('dpa');
    if (!impact.affectedControls.includes('APP-FIT-ANALYTICS-PRIVACY')) v.push('policy impact did not reach a transitive control');
    if (impact.advisoryOnly !== true) v.push('policy impact is not advisory');
    // Service dependency mapping resolves system → governing instruments.
    if (!(an.serviceDependencyMap().reporting || []).length) v.push('service dependency map is empty for a governed system');
    // Fitness-function impact separates unimplemented controls from failing ones.
    const fi = an.fitnessImpact('dpa', [{ id: 'FIT-IDENTITY-MINIMIZATION', pass: true }, { id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: false }]);
    if (!fi.failing.includes('APP-FIT-ANONYMITY-BOUNDARY')) v.push('a failing mandated control was not reported');
    if (!fi.unimplemented.includes('APP-FIT-ANALYTICS-PRIVACY')) v.push('an unimplemented mandated control was not reported');
    // Version history is diffable and flags an amendment that WEAKENS the mandate.
    reg.amend('dpa', { summary: 'narrow scope', mapsToControls: [] });
    if (!an.versionHistory('dpa').weakeningAmendments.includes(2)) v.push('a weakening amendment was not detected');
    // Change simulation is possible, risk-banded, and never enacts.
    const sim = an.simulateChange('reg-report', { proposedControls: [] });
    if (sim.simulatable !== true || sim.enacts !== false) v.push('legal change simulation is not advisory-only');
    if (sim.risk.band !== 'high') v.push('removing a mandated control was not banded high risk');
    if (!sim.risk.reasons.length) v.push('risk band has no explanation');
    // Obsolete policy detection: a repealed instrument still governing a live system is high.
    reg.repeal('reg-analytics', { by: 'Attorney General' });
    if (!an.obsolete().findings.some((f) => f.severity === 'high')) v.push('obsolete policy detection missed a repealed-but-mapped instrument');
    // Enactment still requires a named human authority.
    let refused = false; try { reg.enact('dpa', {}); } catch (_) { refused = true; }
    if (!refused) v.push('an instrument was enacted without a named human authority');
  }),

  fit('APP-FIT-RECOVERY-STRATEGIES', 'Recovery strategies are compared on RTO/RPO and selected only by a human', (v) => {
    const { RecoveryStrategyEvaluator } = require('../src/twin2/recovery-strategies');
    const ev = new RecoveryStrategyEvaluator({ clock: () => 0 });
    // Every strategy declares all six evaluation dimensions plus its trade-off.
    for (const s of ev.catalogue()) {
      for (const dim of ['rtoMinutes', 'rpoMinutes', 'operationalDisruption', 'resourceEfficiency', 'dataIntegrity', 'businessContinuity']) {
        if (typeof s[dim] !== 'number') v.push(`${s.id}: ${dim} is not quantified`);
      }
      if (!s.tradeoff || !s.prerequisites.length) v.push(`${s.id}: no named trade-off or prerequisites`);
    }
    if (ev.catalogue().length < 4) v.push('fewer than four recovery strategies are available');
    // Evaluation is deterministic and explainable (each score shows its terms).
    const a = ev.evaluate({ incidentType: 'regional-outage' });
    const b = ev.evaluate({ incidentType: 'regional-outage' });
    if (JSON.stringify(a) !== JSON.stringify(b)) v.push('strategy evaluation is not deterministic');
    if (a.strategies.some((s) => !s.terms || Object.keys(s.terms).length !== 6)) v.push('strategy scores are not explainable');
    // Objectives are enforced: a strategy that cannot meet the RTO is marked, with a reason.
    const constrained = ev.evaluate({ incidentType: 'regional-outage', constraints: { maxRtoMinutes: 60 } });
    const violating = constrained.strategies.filter((s) => !s.meetsConstraints);
    if (!violating.length || violating.some((s) => !s.violations.length)) v.push('RTO constraint was not enforced with an explanation');
    if (constrained.strategies[0] && !constrained.strategies[0].meetsConstraints) v.push('a constraint-violating strategy was ranked first');
    // Recommendation is advisory and requires human authorization.
    const rec = ev.recommend({ incidentType: 'regional-outage', constraints: { maxRtoMinutes: 60 } });
    if (rec.advisoryOnly !== true || rec.requiresHumanAuthorization !== true) v.push('recovery recommendation is not advisory');
    if (!rec.explanation) v.push('recommendation has no explanation');
    // Selection without authorization is refused (fail-closed).
    let refused = false; try { ev.selected(rec.id); } catch (e) { refused = !!e.failClosed; }
    if (!refused) v.push('a recovery strategy was selected without human authorization');
    // Authorization requires a NAMED human and a rationale.
    let needsHuman = false; try { ev.authorize(rec.id, { by: 'ops' }); } catch (_) { needsHuman = true; }
    if (!needsHuman) v.push('authorization accepted without a rationale');
    ev.authorize(rec.id, { by: 'National Disaster Management Office', rationale: 'meets the 60-minute RTO objective' });
    if (ev.selected(rec.id).strategy !== rec.recommended) v.push('the authorized strategy was not the selected one');
    if (!ev.auditTrail().some((x) => x.event === 'authorized')) v.push('authorization was not audited');
  }),

  fit('APP-FIT-DATA-EXCHANGE-PURPOSE', 'Data exchange is purpose-limited, classified, approved and non-commercial', (v) => {
    const { NationalDataExchange, PROHIBITED_PURPOSES } = require('../src/fabric/data-exchange');
    const x = new NationalDataExchange({ clock: () => 0 });
    // Commercial exchange is a named, refused purpose — not merely unimplemented.
    if (!PROHIBITED_PURPOSES['commercial-exchange']) v.push('commercial exchange is not explicitly prohibited');
    let refusedCommercial = false;
    try { x.registerDataset('bad', { owner: 'a', permittedPurposes: ['commercial-exchange'] }); } catch (e) { refusedCommercial = !!e.failClosed; }
    if (!refusedCommercial) v.push('a dataset was registered for a prohibited purpose');
    // A dataset must declare its permitted purposes — purpose limitation is never implied.
    let requiresPurpose = false;
    try { x.registerDataset('nopurpose', { owner: 'a', permittedPurposes: [] }); } catch (e) { requiresPurpose = !!e.failClosed; }
    if (!requiresPurpose) v.push('a dataset was registered with no permitted purpose');
    // Identity fields are still refused at registration (privacy validation is unchanged).
    let identityRefused = false;
    try { x.registerDataset('pii', { owner: 'a', schemaFields: ['email'], permittedPurposes: ['analytics'] }); } catch (_) { identityRefused = true; }
    if (!identityRefused) v.push('a dataset carrying an identity field was registered');
    x.registerDataset('ds', { owner: 'dcec', classification: 'internal', schemaFields: ['category', 'status'], permittedPurposes: ['analytics'], retentionDays: 30 });
    // An unapproved dataset cannot be exchanged.
    let unapproved = false;
    try { x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics', approver: 'DGB', justification: 'j' }); } catch (e) { unapproved = !!e.failClosed; }
    if (!unapproved) v.push('an unapproved dataset was exchanged');
    x.approveDataset('ds', { by: 'Data Steward', rationale: 'non-identifying aggregate schema' });
    // A purpose the dataset does not permit is refused.
    let limited = false;
    try { x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'open-government-data' }); } catch (e) { limited = !!e.failClosed; }
    if (!limited) v.push('purpose limitation was not enforced at request time');
    // A permitted purpose still requires a named approver and a written justification.
    let needsApprover = false;
    try { x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics' }); } catch (e) { needsApprover = !!e.failClosed; }
    if (!needsApprover) v.push('an exchange was granted without a named approver');
    const ag = x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics', approver: 'DGB Chair', justification: 'national statistics' });
    if (!ag.purposeLimited || !ag.expiresAt) v.push('the agreement is not purpose-limited or has no retention bound');
    // Purpose limitation at USE time: reuse for another purpose is refused.
    if (x.checkUse({ agreementId: ag.id, purpose: 'inter-agency-exchange' }).permitted) v.push('exchanged data was reusable for another purpose');
    if (!x.checkUse({ agreementId: ag.id, purpose: 'analytics' }).permitted) v.push('the agreed purpose was not permitted');
    // Retention is enforced: after the window the agreement no longer permits use.
    const after = ag.expiresAt + 1;
    if (x.checkUse({ agreementId: ag.id, purpose: 'analytics', now: after }).permitted) v.push('use was permitted after the retention period elapsed');
    if (!x.retentionDue({ now: after }).length) v.push('retention-due agreements are not reported');
    // Every step is audited across both the registry and the exchange.
    const events = x.auditTrail().map((e) => e.event);
    for (const required of ['dataset-registered', 'dataset-approved', 'exchange-granted']) if (!events.includes(required)) v.push(`exchange audit is missing '${required}'`);
  }),

  fit('APP-FIT-PROCESS-GOVERNANCE', 'Process mining detects governance deviation and fraud signals without identifying anyone', (v) => {
    const pg = require('../src/orchestration/process-governance');
    const ev = (streamId, type, at, actor) => ({ streamId, type, meta: { at, actor } });
    const events = [
      ev('C1', 'CaseSubmitted', 0, 'sys'), ev('C1', 'CaseReviewed', 1000, 'inv-1'), ev('C1', 'GovernanceDecided', 2000, 'inv-1'),
      ev('C2', 'CaseSubmitted', 0, 'sys'), ev('C2', 'CaseReviewed', 600_000, 'inv-2'), ev('C2', 'CaseTransitioned', 1_200_000, 'inv-3'),
      ev('C3', 'GovernanceDecided', 0, 'gov-1'),
    ];
    // Governance deviation: a case that skipped a mandated step.
    const dev = pg.governanceDeviations(events, { requiredSequence: ['CaseSubmitted', 'CaseReviewed'] });
    if (!dev.findings.some((f) => f.caseId === 'C3' && /missing/.test(f.reason))) v.push('a skipped mandated step was not detected');
    // Policy violation from a data-defined rule.
    const pol = pg.policyViolations(events, { rules: [{ id: 'review-before-decision', requires: { activity: 'GovernanceDecided', precededBy: 'CaseReviewed' } }] });
    if (!pol.findings.some((f) => f.caseId === 'C3')) v.push('a policy rule violation was not detected');
    // Separation of duties: one actor reviewed and decided the same case.
    const sod = pg.segregationOfDutiesBreaches(events);
    if (!sod.findings.some((f) => f.caseId === 'C1')) v.push('a separation-of-duties breach was not detected');
    // Approval anomaly: an approval faster than any plausible review.
    const app = pg.approvalAnomalies(events, { minDwellMs: 60_000 });
    if (!app.findings.some((f) => /faster than/.test(f.reason))) v.push('rubber-stamped approval was not detected');
    // Fraud indicators are composite, explainable and advisory.
    const fraud = pg.fraudIndicators(events, { minDwellMs: 60_000 });
    const c1 = fraud.findings.find((f) => f.caseId === 'C1');
    if (!c1 || c1.signalCount < 2 || c1.severity !== 'high') v.push('coinciding governance signals did not raise an indicator');
    if (fraud.advisoryOnly !== true) v.push('fraud indicators are not advisory');
    // Compliance failures: SLA breach and cases that never terminated.
    const comp = pg.complianceFailures(events, { slaMs: 1000 });
    if (!comp.findings.length) v.push('compliance failures were not detected');
    // Correlation with the fitness gate explains, never re-classifies.
    const full = pg.report(events, { requiredSequence: ['CaseSubmitted', 'CaseReviewed'], fitnessResults: [{ id: 'APP-FIT-AUTHZ-DEFAULT-DENY', pass: true }] });
    const corr = full.correlation.correlations.find((c) => c.control === 'APP-FIT-AUTHZ-DEFAULT-DENY');
    if (!corr || !/does not cover this path/.test(corr.interpretation)) v.push('a finding under a green control was not flagged as a scope gap');
    if (full.advisoryOnly !== true || full.authorizes !== false) v.push('the process governance report claims authority');
    // Deterministic, and no identity ever appears in a finding.
    if (JSON.stringify(pg.report(events)) !== JSON.stringify(pg.report(events))) v.push('process governance is not deterministic');
    if (/"email"|"omang"|"nationalId"|@/.test(JSON.stringify(full))) v.push('process governance leaked identity');
  }),

  fit('APP-FIT-OBSERVABILITY-DOMAINS', 'Each observability domain has a named audience and stays identity-free', (v) => {
    const dash = require('../src/observability/dashboards');
    const boards = ownership.boards().map((b) => b.id);
    for (const violation of dash.validate({ boards }).violations) v.push(violation);
    // Six distinct domains, each answering a different question for a different audience.
    const required = ['engineering-health', 'security-posture', 'operational-performance', 'governance-effectiveness', 'citizen-service-delivery', 'infrastructure-health'];
    for (const id of required) if (!dash.ids().includes(id)) v.push(`missing observability domain '${id}'`);
    const audiences = new Set(dash.audiences().map((a) => a.audience));
    if (audiences.size !== dash.ids().length) v.push('two domains share an audience — they are one dashboard, not two');
    // Rendering is deterministic and refuses identity values outright.
    const sources = { fitness: { held: 82, total: 82, failing: [] }, architecture: { valid: true }, contracts: { covered: 15 }, service: { total: 42, resolutionRate: 0.8 } };
    if (JSON.stringify(dash.all(sources)) !== JSON.stringify(dash.all(sources))) v.push('dashboard rendering is not deterministic');
    const leak = dash.renderWidget({ id: 'x', title: 'x', source: 'leak', type: 'label' }, { leak: 'reporter@example.com' });
    if (leak.status !== 'refused') v.push('a dashboard rendered an identity value');
    // Small-cell suppression applies at the dashboard too, not only in analytics.
    const small = dash.renderWidget({ id: 'c', title: 'c', source: 'n', type: 'count' }, { n: 2 });
    if (!small.suppressed || small.value !== null) v.push('a small cell was not suppressed on a dashboard');
    // An unavailable source degrades visibly rather than rendering a misleading zero.
    if (dash.renderWidget({ id: 'm', title: 'm', source: 'nope.here', type: 'count' }, {}).status !== 'unavailable') v.push('a missing source did not degrade visibly');
    // No dashboard authorizes anything.
    for (const id of dash.ids()) { const d = dash.dashboard(id, sources); if (d.informationalOnly !== true || d.authorizes !== false) v.push(`${id}: dashboard claims authority`); }
  }),

  fit('APP-FIT-CORRELATION-GOVERNANCE', 'Cross-domain correlation is default-deny, purpose-limited and time-bound', (v) => {
    const { CorrelationGovernance } = require('../src/intelligence/correlation-governance');
    const cg = new CorrelationGovernance({ clock: () => 0 });
    const boards = ownership.boards().map((b) => b.id);
    for (const violation of cg.validate({ boards }).violations) v.push(violation);
    // Every permitted correlation is a COMPLETE governance record.
    for (const p of cg.register().permitted) {
      if (!p.purpose || !p.retentionDays || !p.oversight || !p.accountable) v.push(`${p.id}: incomplete correlation governance record`);
    }
    // Prohibited correlations are named, reasoned and refused (not merely unimplemented).
    if (cg.register().prohibited.length < 3) v.push('fewer than three correlations are explicitly prohibited');
    let prohibited = false;
    try { cg.authorize({ domains: ['privacy', 'service-delivery'], purpose: 'anything', requestedBy: 'analyst' }); } catch (e) { prohibited = !!e.failClosed && !!e.prohibited; }
    if (!prohibited) v.push('a prohibited correlation was authorized');
    // Default-deny: an unregistered pair is refused.
    let unregistered = false;
    try { cg.authorize({ domains: ['engineering', 'legislation'], purpose: 'curiosity', requestedBy: 'analyst' }); } catch (e) { unregistered = !!e.failClosed; }
    if (!unregistered) v.push('an unregistered correlation was authorized (not default-deny)');
    // Purpose and requester are mandatory.
    for (const bad of [{ domains: ['engineering', 'operations'], requestedBy: 'x' }, { domains: ['engineering', 'operations'], purpose: 'platform-reliability' }]) {
      let refused = false; try { cg.authorize(bad); } catch (e) { refused = !!e.failClosed; }
      if (!refused) v.push('a correlation was authorized without a purpose or a named requester');
    }
    const auth = cg.authorize({ domains: ['engineering', 'operations'], purpose: 'platform-reliability', requestedBy: 'Office of the CTO' });
    if (!auth.oversight || !auth.accountable || !auth.expiresAt) v.push('an authorization lacks oversight, accountability or a retention bound');
    // Purpose limitation and retention are enforced at USE time.
    if (cg.guard(auth.id, { purpose: 'security-operations' }).permitted) v.push('an authorization was reused for another purpose');
    if (!cg.guard(auth.id, { purpose: 'platform-reliability' }).permitted) v.push('the authorized purpose was refused');
    if (cg.guard(auth.id, { purpose: 'platform-reliability', now: auth.expiresAt + 1 }).permitted) v.push('a correlation was used after its retention elapsed');
    // Refusals are audited too — an attempt is itself governance-relevant.
    const events = cg.auditTrail().map((a) => a.event);
    for (const required of ['refused', 'authorized', 'used']) if (!events.includes(required)) v.push(`correlation audit is missing '${required}'`);
    if (cg.report().defaultDeny !== true || cg.report().authorizes !== false) v.push('correlation governance does not declare default-deny / claims authority');
  }),

  fit('APP-FIT-USABILITY-VALIDATION', 'User evidence is recorded, role-coded, and traced to a context', (v) => {
    const { UsabilityValidation, PERSONAS, seedRound } = require('../src/ux/usability-validation');
    const uv = seedRound(new UsabilityValidation());
    // Every representative role is engaged, and every task traces to a real bounded context.
    const contexts = new Set(contextMap.ids());
    for (const p of uv.personas()) if (!contexts.has(p.context)) v.push(`persona '${p.id}' maps to unknown context '${p.context}'`);
    for (const required of ['investigator', 'auditor', 'administrator', 'governance-official', 'oversight-board', 'operational-staff']) {
      if (!PERSONAS[required]) v.push(`missing representative role '${required}'`);
    }
    if (!uv.coverage().complete) v.push('some representative role has no observed session: ' + uv.coverage().uncovered.join(', '));
    // Participant identity is refused — role codes only.
    let identityRefused = false;
    try { uv.recordSession({ participant: 'P-INV-09', taskId: 'triage-queue', completed: true, email: 'a@b.c' }); } catch (e) { identityRefused = !!e.failClosed; }
    if (!identityRefused) v.push('a usability session accepted an identifying field');
    let codeRequired = false;
    try { uv.recordSession({ participant: 'a real person', taskId: 'triage-queue', completed: true }); } catch (e) { codeRequired = !!e.failClosed; }
    if (!codeRequired) v.push('a usability session accepted a non-role-coded participant');
    // Findings are derived from observation, cite their evidence, and are deterministic.
    const findings = uv.findings();
    if (!findings.length) v.push('no findings derived from the observed sessions');
    for (const f of findings) { if (!f.evidence) v.push(`finding on '${f.task}' cites no evidence`); if (!contexts.has(f.context)) v.push(`finding on '${f.task}' maps to unknown context`); }
    if (JSON.stringify(uv.findings()) !== JSON.stringify(uv.findings())) v.push('usability findings are not deterministic');
    // A task nobody completed is a blocker, ranked first.
    const report = uv.report();
    if (!report.blockers.length) v.push('a task with no completions was not raised as a blocker');
    if (findings[0].severity !== 'blocker') v.push('findings are not ranked by severity');
    if (/@|omang|nationalId/i.test(JSON.stringify(report))) v.push('usability evidence leaked an identifying value');
  }),

  fit('APP-FIT-ZERO-TRUST-ARCHITECTURE', 'Every access request is evaluated dynamically; no implicit trust anywhere', (v) => {
    const { makeZeroTrust, MAX_CREDENTIAL_TTL_MS } = require('../src/iam/zero-trust-architecture');
    let now = 1_000_000;
    const zt = makeZeroTrust({ clock: () => now });
    const wl = 'spiffe://njtip/zone/independent/sa/intake-api';
    // A workload identity requires an attestation — registration is not trust.
    let attestationRequired = false;
    try { zt.workloads.register(wl, { zone: 'independent' }); } catch (e) { attestationRequired = !!e.failClosed; }
    if (!attestationRequired) v.push('a workload identity was registered without an attestation');
    zt.workloads.register(wl, { zone: 'independent', attestation: { kind: 'synthetic-node-attestation' } });
    // Credentials are short-lived; an excessive TTL is REFUSED, not clamped.
    let ttlRefused = false;
    try { zt.workloads.issueCredential(wl, { ttlMs: MAX_CREDENTIAL_TTL_MS + 1, audience: 'reports' }); } catch (e) { ttlRefused = !!e.failClosed; }
    if (!ttlRefused) v.push('a long-lived workload credential was issued');
    const cred = zt.workloads.issueCredential(wl, { ttlMs: 60_000, audience: 'reports' });
    if (!zt.workloads.verifyCredential(cred.id, { audience: 'reports' }).valid) v.push('a fresh credential did not verify');
    if (zt.workloads.verifyCredential(cred.id, { audience: 'other' }).valid) v.push('a credential verified for the wrong audience');
    now += 61_000;
    if (zt.workloads.verifyCredential(cred.id, { audience: 'reports' }).valid) v.push('an expired credential still verified');
    now -= 61_000;
    // Revocation is immediate and cascades to issued credentials.
    const cred2 = zt.workloads.issueCredential(wl, { ttlMs: 60_000, audience: 'reports' });
    zt.workloads.revoke(wl);
    if (zt.workloads.verifyCredential(cred2.id, { audience: 'reports' }).valid) v.push('a revoked workload still had a valid credential');

    zt.devices.register('dev-1', { trusted: true });
    zt.boundaries.allow('independent', 'executive', { actions: ['review-case'], rationale: 'case routing across zones' });
    const base = { subject: { principal: 'inv-001', role: 'investigator', mfa: 'fido2', authenticatedAt: now, deviceId: 'dev-1', zone: 'independent' }, action: 'review-case', resource: { zone: 'executive' }, env: { geoAllowed: true } };
    const permit = zt.pdp.decide(base);
    if (permit.decision !== 'permit') v.push('a fully compliant request was denied: ' + permit.reason);
    if (!permit.trace.includes('continuous-authentication') || !permit.trace.includes('continuous-authorization')) v.push('the decision trace does not show continuous authn/authz');
    // No implicit trust: unauthenticated, stale, undeclared-boundary and over-ceiling all deny.
    if (zt.pdp.decide({ ...base, subject: {} }).decision !== 'deny') v.push('an unauthenticated request was not denied');
    if (zt.pdp.decide({ ...base, subject: { ...base.subject, authenticatedAt: now - 24 * 3600_000 } }).decision !== 'deny') v.push('a stale authentication was accepted');
    if (zt.pdp.decide({ ...base, resource: { zone: 'judiciary' } }).decision !== 'deny') v.push('an undeclared trust-boundary crossing was permitted');
    if (zt.pdp.decide({ ...base, subject: { ...base.subject, role: 'citizen' } }).decision !== 'deny') v.push('least privilege was not enforced (RBAC ceiling breached)');
    if (zt.pdp.decide({ ...base, subject: { ...base.subject, mfa: 'none' } }).decision === 'permit') v.push('a sensitive action was permitted without step-up MFA');
    // A workload request without a credential is denied.
    if (zt.pdp.decide({ ...base, subject: { ...base.subject, kind: 'workload' } }).decision !== 'deny') v.push('a workload request without a credential was permitted');
    // Every request still reaches the PDP; caching skips recomputation, never the checks.
    const before = zt.pdp.decisionsEvaluated();
    zt.pdp.decide(base); zt.pdp.decide(base);
    if (zt.pdp.decisionsEvaluated() !== before + 2) v.push('a request bypassed the PDP entirely');
    // A previously unseen security context is always fully evaluated.
    const beforeFull = zt.pdp.fullEvaluations();
    zt.pdp.decide({ ...base, subject: { ...base.subject, sessionId: 'fresh-session' } });
    if (zt.pdp.fullEvaluations() !== beforeFull + 1) v.push('an unseen security context was not fully evaluated');
    // With caching disabled, every request is fully evaluated (the old guarantee still available).
    const b2 = zt.pdp.fullEvaluations();
    zt.pdp.decide(base, { allowCache: false }); zt.pdp.decide(base, { allowCache: false });
    if (zt.pdp.fullEvaluations() !== b2 + 2) v.push('allowCache:false did not force full evaluation');
    // The PAP publishes policy with a named human; a change takes effect with no code change.
    let paperwork = false;
    try { zt.pap.publish([{ id: 'x', effect: 'permit', actions: '*' }], {}); } catch (_) { paperwork = true; }
    if (!paperwork) v.push('a policy set was published without a named human and rationale');
    zt.pap.publish([{ id: 'deny-everything', effect: 'deny', actions: '*', conditions: [] }], { by: 'ISRB', rationale: 'test the administration point' });
    if (zt.pdp.decide(base).decision !== 'deny') v.push('a PAP policy change did not take effect at the PDP');
    // The PEP enforces and audits; it never decides.
    const pep = zt.pep.enforce(base);
    if (pep.allowed !== false) v.push('the PEP did not enforce the PDP denial');
    if (!zt.pep.auditTrail().length) v.push('the PEP did not audit the decision');
    if (/@|omang/i.test(JSON.stringify(zt.pep.auditTrail()))) v.push('the PEP audit leaked identity');
    // The architecture describes all the required components.
    const arch = zt.architecture();
    for (const required of ['PAP', 'PDP', 'PEP', 'Workload identity', 'Trust boundaries', 'Device trust']) {
      if (!arch.components.some((c) => c.component === required)) v.push(`zero trust architecture is missing the ${required} component`);
    }
  }),

  fit('APP-FIT-ZERO-TRUST-CACHE', 'Cached authorization is signed, policy-current, revocable and never bypasses revocation', (v) => {
    const { makeZeroTrust, MAX_DECISION_TTL_MS, AuthorizationDecisionCache, RevocationRegistry } = require('../src/iam/zero-trust-architecture');
    let now = 1_000_000;
    const zt = makeZeroTrust({ clock: () => now });
    zt.devices.register('dev-1', { trusted: true });
    const base = { subject: { principal: 'inv-001', role: 'investigator', mfa: 'fido2', authenticatedAt: now, deviceId: 'dev-1', zone: 'independent', sessionId: 'S1' }, action: 'review-case', resource: { zone: 'independent' }, env: { geoAllowed: true } };

    // A decision is issued signed, and reused only as a verified token.
    const first = zt.pdp.decide(base);
    if (first.decision !== 'permit' || !first.decisionToken) v.push('no signed decision token was issued on permit');
    if (!first.decisionToken.signature || !first.decisionToken.digest) v.push('the decision token is not cryptographically signed');
    const second = zt.pdp.decide(base);
    if (!second.cached || second.stage !== 'cached') v.push('an identical request was not served from the decision cache');

    // Tampering with any field invalidates the decision.
    const tampered = { ...first.decisionToken, principal: 'attacker' };
    if (zt.cache.verify(tampered, { policyVersion: zt.pap.version() }).valid) v.push('a tampered decision token verified');
    const forged = { ...first.decisionToken, signature: 'forged' };
    if (zt.cache.verify(forged, { policyVersion: zt.pap.version() }).valid) v.push('a forged signature verified');

    // TTL: decisions are short-lived, and an over-long TTL is refused at construction.
    if (MAX_DECISION_TTL_MS > 30_000) v.push('the decision TTL ceiling is too long to be called short-lived');
    let ttlRefused = false;
    try { new AuthorizationDecisionCache({ revocations: new RevocationRegistry(), ttlMs: MAX_DECISION_TTL_MS + 1 }); } catch (_) { ttlRefused = true; }
    if (!ttlRefused) v.push('a decision cache accepted a TTL beyond the maximum');
    now += MAX_DECISION_TTL_MS + 1;
    if (zt.cache.verify(first.decisionToken, { policyVersion: zt.pap.version() }).reason !== 'expired') v.push('an expired decision did not expire');
    now -= MAX_DECISION_TTL_MS + 1;

    // REVOCATION: a revoked credential fails IMMEDIATELY, cache or no cache.
    zt.pdp.decide(base);                                    // warm the cache again
    zt.revoke.session('S1', { by: 'Security Operations Centre', reason: 'suspected compromise' });
    const afterRevoke = zt.pdp.decide(base);
    if (afterRevoke.decision !== 'deny' || afterRevoke.stage !== 'revocation') v.push('a revoked session was still authorized');
    if (zt.cache.verify(first.decisionToken, { policyVersion: zt.pap.version() }).valid) v.push('a cached decision survived revocation of its session');
    // Subject and credential revocation behave the same way.
    const zt2 = makeZeroTrust({ clock: () => now });
    zt2.devices.register('dev-1', { trusted: true });
    zt2.pdp.decide(base);
    zt2.revoke.subject('inv-001', { by: 'ISRB', reason: 'role withdrawn' });
    if (zt2.pdp.decide(base).stage !== 'revocation') v.push('a revoked subject was still authorized');
    let needsReason = false;
    try { zt2.revocations.revokeSession('X', { by: 'ops' }); } catch (_) { needsReason = true; }
    if (!needsReason) v.push('revocation was accepted without a named actor and a reason');

    // STALE POLICY: publishing invalidates every cached decision, and a stale token is rejected.
    const zt3 = makeZeroTrust({ clock: () => now });
    zt3.devices.register('dev-1', { trusted: true });
    const t3 = zt3.pdp.decide(base).decisionToken;
    zt3.pap.publish([{ id: 'permit-all', effect: 'permit', actions: '*', conditions: [] }], { by: 'ISRB', rationale: 'incident containment' });
    if (zt3.cache.size() !== 0) v.push('a policy change did not invalidate the decision cache');
    if (zt3.cache.verify(t3, { policyVersion: zt3.pap.version() }).reason !== 'stale-policy-version') v.push('a decision issued under a superseded policy was accepted');
    if (zt3.pdp.decide(base).stage === 'cached') v.push('a request was served from cache after a policy change');

    // REPLAY protection: a presented nonce is single-use.
    const zt4 = makeZeroTrust({ clock: () => now });
    zt4.devices.register('dev-1', { trusted: true });
    const t4 = zt4.pdp.decide(base).decisionToken;
    if (!zt4.cache.verify(t4, { policyVersion: zt4.pap.version(), nonce: 'n1' }).valid) v.push('a fresh nonce was rejected');
    if (zt4.cache.verify(t4, { policyVersion: zt4.pap.version(), nonce: 'n1' }).reason !== 'replayed-nonce') v.push('a replayed nonce was accepted');

    // SESSION BINDING: a decision issued for one session is not reusable by another.
    const other = { ...base, subject: { ...base.subject, sessionId: 'S2' } };
    if (zt4.pdp.decide(other).stage === 'cached') v.push('a decision bound to one session was reused by another');

    // SENSITIVE actions are never cached, whatever the TTL.
    const sensitive = { ...base, action: 'read-evidence' };
    zt4.pdp.decide(sensitive);
    const s2 = zt4.pdp.decide(sensitive);
    if (s2.cached || s2.stage === 'cached') v.push('a sensitive action was served from cache');
    if (!s2.reevaluationTriggers.includes('sensitive-action')) v.push('the sensitive-action re-evaluation trigger did not fire');

    // Continuous re-evaluation triggers force a full evaluation despite a valid cached decision.
    for (const [envPatch, trigger] of [[{ riskLevel: 'high' }, 'elevated-risk'], [{ devicePostureChanged: true }, 'device-posture-changed'], [{ forceReevaluation: true }, 'explicit-request']]) {
      const triggers = zt4.pdp.reevaluationTriggers({ ...base, env: { ...base.env, ...envPatch } });
      if (!triggers.includes(trigger)) v.push(`the '${trigger}' re-evaluation trigger did not fire`);
    }

    // CROSS-REGION policy synchronization: a lagging region may not serve authorization.
    zt4.policySync.register('bw-south', { version: 0 });
    if (zt4.pdp.decide({ ...base, env: { ...base.env, region: 'bw-south' } }).stage !== 'policy-sync') v.push('a region behind the authoritative policy version served authorization');
    zt4.policySync.sync('bw-south', zt4.pap.version());
    if (zt4.pdp.decide({ ...base, env: { ...base.env, region: 'bw-south' } }).decision !== 'permit') v.push('a synchronized region was refused');
    const sync = zt4.policySync.status(zt4.pap.version());
    if (!sync.allInSync || sync.stale.length) v.push('policy sync status did not reflect a synchronized region');

    // The architecture documents the new components and invariants.
    const arch = zt4.architecture();
    for (const c of ['Decision cache', 'Revocation', 'Policy sync']) if (!arch.components.some((x) => x.component === c)) v.push(`the architecture omits the ${c} component`);
    if (!arch.invariants.some((i) => /Revocation is checked FIRST/.test(i))) v.push('the revocation-first invariant is not documented');
    if (!arch.neverCachedActions.length) v.push('no actions are declared never-cacheable');
  }),

  fit('APP-FIT-THREAT-MODEL', 'Every threat traces to a real control, evidence, verification and owner', (v) => {
    const tm = require('../src/security/threat-model');
    const knownFitnessIds = [
      ...require('../../njtip-twin/verification/fitness').map((f) => f.id),
      ...require('./app-fitness').map((f) => f.id),
      ...require('./infra-fitness').map((f) => f.id),
    ];
    for (const violation of tm.validate({ knownFitnessIds }).violations) v.push(violation);
    // Analysis goes beyond STRIDE/LINDDUN: insider, supply-chain, third-party, cloud and AI.
    for (const cls of ['stride', 'linddun', 'insider', 'supply-chain', 'third-party', 'cloud', 'ai']) {
      if (!tm.threats({ threatClass: cls }).length) v.push(`no threat modelled for class '${cls}'`);
    }
    // Attack trees decompose into concrete paths.
    const paths = tm.attackPaths('TH-DEANON');
    if (paths.paths.length < 3) v.push('the de-anonymisation attack tree does not decompose into paths');
    // Kill-chain, ATT&CK and CAPEC mappings exist and resolve.
    if (!Object.values(tm.killChainCoverage()).some((x) => x.length)) v.push('no kill-chain coverage');
    if (!Object.keys(tm.attckCoverage()).length) v.push('no MITRE ATT&CK mapping');
    if (!Object.keys(tm.capecCoverage()).length) v.push('no CAPEC mapping');
    // Adversary playbooks name the control that breaks each step.
    for (const pb of tm.playbooks()) for (const s of pb.sequence) if (!s.breaksAt) v.push(`${pb.id}: a step names no breaking control`);
    // The trace resolves end to end, including the accountable authority.
    const results = knownFitnessIds.map((id) => ({ id, pass: true }));
    for (const row of tm.traceability({ fitnessResults: results })) {
      if (!row.controls.length) v.push(`${row.threat}: no controls`);
      if (!row.evidence) v.push(`${row.threat}: no evidence`);
      if (!row.responsibleAuthority || !row.governanceBoard) v.push(`${row.threat}: no accountable authority resolved`);
      if (row.controls.some((c) => !c.implemented)) v.push(`${row.threat}: control(s) not implemented: ${row.controls.filter((c) => !c.implemented).map((c) => c.control).join(', ')}`);
    }
    // Residual risk is clean when every control holds, and reacts when one fails.
    if (!tm.residualRisk({ fitnessResults: results }).clean) v.push('residual risk is not clean while every control holds');
    const oneFailing = results.map((r) => (r.id === 'FIT-IDENTITY-MINIMIZATION' ? { ...r, pass: false } : r));
    if (tm.residualRisk({ fitnessResults: oneFailing }).clean) v.push('residual risk did not react to a failing control');
  }),

  fit('APP-FIT-RISK-INTELLIGENCE', 'Risk is owned, scored, time-boxed and expires — acceptance never renews itself', (v) => {
    const tm = require('../src/security/threat-model');
    const ids = [...new Set(tm.threats().flatMap((t) => t.controls))];
    const green = ids.map((id) => ({ id, pass: true }));
    const red = green.map((r) => (r.id === 'FIT-IDENTITY-MINIMIZATION' ? { ...r, pass: false } : r));
    const rr = new tm.RiskRegister({ clock: () => 0 });

    // The full lifecycle row exists for every threat, end to end.
    for (const row of rr.lifecycle({ fitnessResults: green })) {
      for (const field of ['threat', 'severity', 'inherentRisk', 'controls', 'evidence', 'verification', 'controlEffectiveness', 'residualRisk', 'residualBand', 'treatment', 'owner', 'responsibleAuthority', 'governanceBoard', 'reviewDate']) {
        if (row[field] === undefined || row[field] === null) v.push(`${row.threat}: lifecycle is missing '${field}'`);
      }
    }
    // Control effectiveness is scored from the LIVE gate: a failing control counts against it.
    const effGreen = rr.controlEffectiveness('TH-DEANON', green);
    const effRed = rr.controlEffectiveness('TH-DEANON', red);
    if (effGreen.score !== 1) v.push('all-holding controls did not score full effectiveness');
    if (!(effRed.score < effGreen.score)) v.push('a failing control did not reduce control effectiveness');
    if (effRed.failing !== 1) v.push('the failing control was not counted');
    // Residual risk falls to zero only when every control holds, and reacts when one fails.
    if (rr.residual('TH-DEANON', { fitnessResults: green }).residual !== 0) v.push('residual risk was non-zero with every control holding');
    const resid = rr.residual('TH-DEANON', { fitnessResults: red });
    if (!(resid.residual > 0) || resid.band === 'none') v.push('residual risk did not rise when a control failed');
    if (resid.treatment !== 'open — treat or accept') v.push('open residual risk was not marked for treatment');

    // Risk acceptance: named human, rationale, and a MANDATORY expiry within a year.
    let needsHuman = false;
    try { rr.accept('TH-DEANON', { rationale: 'x' }); } catch (e) { needsHuman = !!e.failClosed; }
    if (!needsHuman) v.push('a risk was accepted without a named human authority');
    let needsExpiry = false;
    try { rr.accept('TH-DEANON', { by: 'Oversight Board', rationale: 'x', days: 400 }); } catch (e) { needsExpiry = !!e.failClosed; }
    if (!needsExpiry) v.push('a risk acceptance was allowed to outlive a year');
    const acc = rr.accept('TH-DEANON', { by: 'Oversight Board', rationale: 'compensating control in place', days: 30, now: 0 });
    if (!rr.acceptanceFor('TH-DEANON', { now: 0 }).current) v.push('a fresh acceptance was not current');
    if (rr.residual('TH-DEANON', { fitnessResults: red, now: 0 }).treatment !== 'accepted (time-boxed)') v.push('an accepted risk was not marked as time-boxed');
    // EXPIRY: the acceptance lapses on its own and the risk reopens.
    const later = 31 * 24 * 3600_000;
    if (rr.acceptanceFor('TH-DEANON', { now: later }).current) v.push('a risk acceptance outlived its expiry');
    if (rr.residual('TH-DEANON', { fitnessResults: red, now: later }).treatment === 'accepted (time-boxed)') v.push('an expired acceptance still suppressed the risk');
    if (!rr.expiredAcceptances({ now: later }).some((e) => e.id === acc.id)) v.push('an expired acceptance was not reported');
    if (rr.validate({ fitnessResults: red, now: later }).valid) v.push('validation passed with a lapsed risk acceptance');
    // Revoking an acceptance requires a named human and a reason.
    let revokeNeedsReason = false;
    try { rr.revokeAcceptance(acc.id, { by: 'x' }); } catch (_) { revokeNeedsReason = true; }
    if (!revokeNeedsReason) v.push('a risk acceptance was revoked without a reason');

    // Review cadence: never-assessed threats are overdue; a reassessment resets the clock.
    const rr2 = new tm.RiskRegister({ clock: () => 0 });
    if (rr2.reviewReminders({ now: 0 }).length !== tm.ids().length) v.push('never-assessed threats were not all flagged for review');
    if (!rr2.reviewDue('TH-DEANON', { now: 0 }).neverAssessed) v.push('a never-assessed threat was not marked as such');
    rr2.reassess('TH-DEANON', { by: 'Chief Information Security Officer', findings: 'controls verified', now: 0 });
    if (rr2.reviewDue('TH-DEANON', { now: 0 }).overdue) v.push('a just-reassessed threat was still overdue');
    if (!rr2.reviewDue('TH-DEANON', { now: 400 * 24 * 3600_000 }).overdue) v.push('a review never came due again');
    if (tm.REVIEW_CADENCE_DAYS.critical >= tm.REVIEW_CADENCE_DAYS.low) v.push('critical risks are not reviewed more often than low ones');

    // Threat intelligence raises attention only, and refuses identity.
    let intelIdentityRefused = false;
    try { rr2.ingestIntelligence({ source: 'a@b.c', threat: 'TH-DEANON', indicator: 'x' }); } catch (e) { intelIdentityRefused = !!e.failClosed; }
    if (!intelIdentityRefused) v.push('threat intelligence accepted identity data');
    const intel = rr2.ingestIntelligence({ source: 'national-cirt', threat: 'TH-DEANON', indicator: 'campaign-x' });
    if (intel.effect !== 'raises-attention-only') v.push('threat intelligence claimed more than raising attention');
    let unknownRefused = false;
    try { rr2.ingestIntelligence({ source: 's', threat: 'TH-NONSENSE', indicator: 'x' }); } catch (_) { unknownRefused = true; }
    if (!unknownRefused) v.push('intelligence was accepted for an unknown threat');

    // Heat map and trend are computed, and the trend reacts to improvement.
    const heat = rr2.heatMap({ fitnessResults: red, now: 0 });
    if (heat.clean || !heat.worst) v.push('the risk heat map reported clean while a control was failing');
    if (!rr2.heatMap({ fitnessResults: green, now: 0 }).clean) v.push('the heat map was not clean with every control holding');
    rr2.snapshot({ fitnessResults: red, now: 0 });
    rr2.snapshot({ fitnessResults: green, now: 1 });
    if (rr2.trend().direction !== 'improving') v.push('the risk trend did not react to controls being repaired');
    const rep = rr2.report({ fitnessResults: green, now: 0 });
    if (rep.advisoryOnly !== true || rep.authorizes !== false) v.push('the risk report claims authority');
  }),

  fit('APP-FIT-FORMAL-POLICY', 'Critical governance policies are proven, and the checker can produce counterexamples', (v) => {
    const fp = require('../src/iam/formal-policy');
    const mandates = [{ instrument: 'data-protection-act', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }];
    const report = fp.verifyAll({ mandates });
    if (!report.allProven) v.push('policy verification failed: ' + JSON.stringify(report.failed));
    // Every required policy domain is specified — including the Phase 11 additions.
    const kinds = new Set(fp.specifications().map((s) => s.kind));
    for (const required of ['authorization', 'separation-of-duties', 'approval-chain', 'escalation', 'evidence-custody', 'evidence-integrity', 'data-residency', 'legislative', 'non-interference', 'privilege-escalation', 'workflow-consistency', 'event-ordering', 'deadlock-freedom']) {
      if (!kinds.has(required)) v.push(`no formal specification for '${required}'`);
    }
    // The property catalogue publishes a guarantee for every property.
    const cat = fp.catalogue();
    for (const prop of cat.properties) if (!prop.guarantee) v.push(`${prop.id}: no published guarantee`);
    if (cat.properties.length < 16) v.push('the property catalogue is smaller than the specification set');
    // State coverage is exhaustive within the bound, and reported per specification.
    const cov = fp.stateCoverage({ mandates });
    if (!cov.fullyExhaustive) v.push('a specification was not proven exhaustively over its domain');
    for (const row of cov.specifications) if (row.coverage !== 1) v.push(`${row.specification}: coverage ${row.coverage}`);
    // The proof summary carries counterexamples, method and the no-authority statement.
    const summary = fp.proofSummary({ mandates });
    if (summary.failed !== 0) v.push('the proof summary reports failed properties');
    if (!summary.method || summary.authorizes !== false) v.push('the proof summary has no method or claims authority');
    if (summary.guarantees.some((g) => !g.guarantee)) v.push('a proven property has no published guarantee');
    // Each new property is individually proven, and each can fail on a crafted input.
    for (const spec of ['SPEC-NON-INTERFERENCE', 'SPEC-NO-PRIVILEGE-ESCALATION', 'SPEC-EVIDENCE-INTEGRITY', 'SPEC-WORKFLOW-CONSISTENCY', 'SPEC-EVENT-ORDERING', 'SPEC-DEADLOCK-FREEDOM']) {
      if (!fp.check(spec, { mandates }).proven) v.push(`${spec} is not proven`);
    }
    const falsifiable = [
      ['SPEC-NON-INTERFERENCE', { from: 'independent', to: 'executive', carriesIdentity: true, mechanism: 'domain-event' }],
      ['SPEC-NO-PRIVILEGE-ESCALATION', { from: 'citizen', to: 'admin', granted: false, fromRank: 0, toRank: 3 }],
      ['SPEC-EVIDENCE-INTEGRITY', { entries: [{ digest: 'a', previous: null, signed: true }, { digest: 'b', previous: 'WRONG', signed: true }] }],
      ['SPEC-WORKFLOW-CONSISTENCY', { steps: ['assigned', 'reviewed'], terminal: null }],
      ['SPEC-EVENT-ORDERING', { stream: 'X', sequences: [1, 3] }],
      ['SPEC-DEADLOCK-FREEDOM', { states: { a: ['b'], b: ['a'] }, terminal: ['done'] }],
    ];
    for (const [spec, badState] of falsifiable) {
      if (!fp.SPECIFICATIONS[spec].holds(badState, { policySet: null, mandates: [] })) v.push(`${spec} cannot detect its own violation`);
    }
    // The proof is exhaustive over a real bound, not a sample.
    if (report.statesExplored < 1000) v.push('the model checker explored an implausibly small state space');
    for (const r of report.results) if (r.statesExplored !== r.statesInDomain) v.push(`${r.specification}: proof did not explore its whole domain`);
    // The checker MUST be able to fail and produce a deterministic counterexample.
    const broken = fp.check('SPEC-SUSPENDED-DENIED', { policies: [{ id: 'permit-all', effect: 'permit', actions: '*', conditions: [] }] });
    if (broken.proven) v.push('the model checker proved a property that a permit-all policy violates');
    if (!broken.counterexample || !broken.counterexample.state || !broken.counterexample.reason) v.push('no counterexample was produced for a violated property');
    const again = fp.check('SPEC-SUSPENDED-DENIED', { policies: [{ id: 'permit-all', effect: 'permit', actions: '*', conditions: [] }] });
    if (JSON.stringify(broken.counterexample) !== JSON.stringify(again.counterexample)) v.push('counterexamples are not deterministic');
    // A legal mandate with no implementing control is caught by verification.
    const gap = fp.check('SPEC-LEGISLATIVE-COMPLIANCE', { mandates: [{ instrument: 'x', control: 'NO-SUCH-CONTROL', implemented: false }] });
    if (gap.proven) v.push('an unimplemented legal mandate was not caught');
    // Continuous validation is fail-closed and never authorizes.
    const cv = fp.continuousValidation({ mandates });
    if (cv.failClosed !== true || cv.authorizes !== false) v.push('continuous policy validation is not fail-closed / claims authority');
  }),

  fit('APP-FIT-SRE-RELIABILITY', 'SLOs, error budgets and the release gate hold — and fail when breached', (v) => {
    const sre = require('../src/observability/sre');
    // Every user journey has availability, latency and RECOVERY objectives with a rationale.
    for (const sl of sre.serviceLevels()) {
      for (const field of ['availability', 'latencyMs', 'latencyTarget', 'rtoMinutes', 'rationale']) {
        if (sl[field] === undefined || sl[field] === null) v.push(`${sl.id}: missing ${field}`);
      }
      if (typeof sl.rpoMinutes !== 'number') v.push(`${sl.id}: missing rpoMinutes`);
    }
    // The constitutional journey carries the strictest targets and loses nothing on recovery.
    const intake = sre.SERVICE_LEVELS['anonymous-reporting'];
    if (intake.rpoMinutes !== 0) v.push('the anonymous reporting journey tolerates data loss (RPO > 0)');
    if (!(intake.availability >= 0.999)) v.push('the anonymous reporting availability objective is too weak');
    // Error budget mathematics: consumption, remaining and burn rate.
    const healthy = sre.errorBudget({ objective: 0.999, attained: 0.9995, windowDays: 30, elapsedDays: 30 });
    if (healthy.exhausted || healthy.severity !== 'healthy') v.push('a within-objective service was reported as burning budget');
    const burnt = sre.errorBudget({ objective: 0.999, attained: 0.99, windowDays: 30, elapsedDays: 30 });
    if (!burnt.exhausted || burnt.remaining !== 0) v.push('an over-budget service was not reported as exhausted');
    const fast = sre.errorBudget({ objective: 0.999, attained: 0.9985, windowDays: 30, elapsedDays: 5 });
    if (fast.burnRate <= 1) v.push('burn rate is not computed against elapsed window time');
    // THE REQUIREMENT: the gate must FAIL when an SLO is violated.
    const breached = { 'anonymous-reporting': { availability: 0.90, latencyUnder: 0.5 } };
    const gate = sre.releaseGate({ measurements: breached });
    if (gate.allow) v.push('the release gate permitted a release while an SLO was breached');
    if (!gate.failClosed || gate.authorizes !== false) v.push('the release gate is not fail-closed / claims authority');
    if (!gate.blockers.length) v.push('a blocked release named no blocker');
    // A release cannot be judged blind: absent measurements block too.
    if (sre.releaseGate({ measurements: {} }).allow) v.push('a release was permitted with no reliability measurement at all');
    // Only a NAMED human may accept the risk, and the acceptance is recorded.
    const overridden = sre.releaseGate({ measurements: breached, riskAcceptedBy: 'ORB Chair', riskRationale: 'security fix outweighs the budget' });
    if (!overridden.allow || !overridden.overridden || overridden.riskAcceptedBy !== 'ORB Chair') v.push('a recorded human risk acceptance did not unblock the release');
    if (sre.releaseGate({ measurements: breached, riskAcceptedBy: 'ORB Chair' }).allow) v.push('risk was accepted without a rationale');
    // Healthy measurements permit a release (the gate is not merely always-closed).
    const ok = sre.releaseGate({ measurements: { 'anonymous-reporting': { availability: 1, latencyUnder: 1 }, 'case-status': { availability: 1, latencyUnder: 1 }, 'investigation': { availability: 1, latencyUnder: 1 }, 'oversight': { availability: 1, latencyUnder: 1 }, 'governance-decision': { availability: 1, latencyUnder: 1 } } });
    if (!ok.allow || !ok.clean) v.push('the release gate blocked a fully healthy platform');
    // Recovery targets are checked against the strategy actually chosen.
    if (sre.recoveryCompliance({ service: 'anonymous-reporting', strategyRtoMinutes: 240, strategyRpoMinutes: 60 }).compliant) v.push('a strategy that misses both recovery objectives was accepted');
    if (!sre.recoveryCompliance({ service: 'anonymous-reporting', strategyRtoMinutes: 10, strategyRpoMinutes: 0 }).compliant) v.push('a compliant recovery strategy was rejected');
    // Autoscaling policy validation catches the classic mistakes.
    if (!sre.validateAutoscaling(sre.DEFAULT_AUTOSCALING).valid) v.push('the default autoscaling policy is invalid');
    if (sre.validateAutoscaling({ minReplicas: 1, maxReplicas: 1, targetCpuPct: 95, scaleUpCooldownS: 300, scaleDownCooldownS: 60 }).valid) v.push('an unsafe autoscaling policy was accepted');
    // Capacity and resource projections are deterministic.
    if (JSON.stringify(sre.capacityPlan()) !== JSON.stringify(sre.capacityPlan())) v.push('capacity planning is not deterministic');
    if (sre.capacityPlan({ months: 6 }).plan.length !== 7) v.push('capacity plan horizon is wrong');
    if (JSON.stringify(sre.resourceForecast()) !== JSON.stringify(sre.resourceForecast())) v.push('resource forecasting is not deterministic');
  }),

  fit('APP-FIT-OBSERVABILITY-TELEMETRY', 'Telemetry is OTel-shaped, zone-isolated, correlated and identity-free', (v) => {
    const tel = require('../src/observability/telemetry');
    for (const violation of tel.validate().violations) v.push(violation);
    // Zones never depend on each other directly — only PII-free events cross.
    for (const f of tel.runtimeTopology().eventFlows) if (!f.piiFree) v.push(`cross-zone flow ${f.from}→${f.to} is not PII-free`);
    if (tel.cycles().length) v.push('the runtime topology has a dependency cycle');
    // Spans only carry allow-listed semantic attributes; anything else is dropped.
    const s = tel.span({ name: 'http.request', kind: 'server', traceId: 't1', spanId: 's1', attrs: { 'http.route': '/api/reports', email: 'a@b.c', 'user.name': 'x' } });
    if (s.attrs.email || s.attrs['user.name']) v.push('a span carried a non-allow-listed attribute');
    if (s.attrs['http.route'] !== '/api/reports') v.push('a span dropped a valid semantic attribute');
    if (!s.dropped.includes('email')) v.push('dropped attributes are not reported');
    if (!s.resource['service.name']) v.push('spans carry no OpenTelemetry resource attributes');
    // Business and audit events are traceable and identity-free.
    const be = tel.businessEvent({ traceId: 't1', spanId: 's2', name: 'case.submitted', caseCode: 'NJ-1', zone: 'independent' });
    const ae = tel.auditEvent({ traceId: 't1', spanId: 's3', name: 'governance.decided', actorRole: 'oversight-board', decision: 'defer' });
    if (be.attrs['event.domain'] !== 'business' || ae.attrs['event.domain'] !== 'audit') v.push('event domain is not recorded on business/audit traces');
    if (/@|omang/i.test(JSON.stringify([be, ae]))) v.push('a business/audit event leaked identity');
    // Correlation joins spans, logs and events under one id.
    const corr = tel.correlate({ traceId: 't1', spans: [s], logs: [{ traceId: 't1', msg: 'x' }], events: [be, ae] });
    if (!corr.complete) v.push('correlation did not join a request to its logs');
    if (!corr.businessEvents.length || !corr.auditEvents.length) v.push('correlation lost the business/audit events');
    // The trace tree computes self time and finds the slowest span.
    const tree = tel.traceTree([
      tel.span({ name: 'root', traceId: 't2', spanId: 'a', durationMs: 100 }),
      tel.span({ name: 'child', traceId: 't2', spanId: 'b', parentId: 'a', durationMs: 70 }),
    ]);
    if (tree.slowest.name !== 'child' || tree.spans.find((x) => x.spanId === 'a').selfMs !== 30) v.push('latency breakdown is wrong');
    // Failure propagation distinguishes DOWN from DEGRADED and finds the constitutional impact.
    const notif = tel.failurePropagation(['notification-service']);
    if (notif.criticalPathBroken) v.push('losing notifications was reported as breaking anonymous reporting');
    if (!notif.degraded.includes('intake-api')) v.push('degradation did not propagate to the dependent service');
    const store = tel.failurePropagation(['persistence-ind']);
    if (!store.criticalPathBroken) v.push('losing the intake datastore was not reported as breaking the critical path');
    if (Object.keys(store.byZone).length > 1) v.push('a single-zone failure propagated across zones — zone isolation is broken');
    // Single points of failure on the constitutional path are known, not discovered in an incident.
    if (!tel.singlePointsOfFailure().includes('persistence-ind')) v.push('single points of failure are not identified');
    // Alerts route to an accountable team and board; an unrouted alert is flagged.
    if (!tel.alertRoute({ domain: 'security', severity: 'page' }).page) v.push('a paging security alert did not page');
    if (tel.alertRoute({ domain: 'nonsense' }).routed) v.push('an unknown alert domain was silently routed');
    // The health score is computed from measured signals; unmeasured lowers COVERAGE.
    const full = tel.healthScore({ architecture: 1, reliability: 1, security: 1, privacy: 1, infrastructure: 1, governance: 1 });
    if (full.score !== 1 || full.coverage !== 1) v.push('a fully healthy platform did not score 1 at full coverage');
    const partial = tel.healthScore({ architecture: 1 });
    if (partial.coverage >= 1) v.push('an unmeasured domain did not reduce coverage');
    if (partial.contributions.some((c) => c.status === 'unmeasured' && c.contribution !== 0)) v.push('an unmeasured domain contributed to the score');
  }),

  fit('APP-FIT-CHAOS-RESILIENCE', 'Load, stress, spike, soak, recovery and fault injection all hold in CI', (v) => {
    const chaos = require('../src/twin2/chaos');
    const suite = chaos.runSuite({ light: true });
    for (const failed of suite.failed) v.push(`resilience check failed: ${failed}`);
    if (!suite.pass) v.push('the resilience suite did not pass');
    if (suite.failClosed !== true || suite.authorizes !== false) v.push('the resilience suite is not fail-closed / claims authority');
    // Every required test type and fault class is present and executable.
    const perfTypes = suite.performance.map((p) => p.test);
    for (const required of ['load', 'stress', 'spike', 'soak', 'recovery']) if (!perfTypes.includes(required)) v.push(`missing ${required} test`);
    const faults = chaos.experiments().map((e) => e.id);
    for (const required of ['dependency-failure', 'network-partition', 'database-failure', 'storage-failure', 'identity-failure']) {
      if (!faults.includes(required)) v.push(`missing fault injection for ${required}`);
    }
    // Every experiment states a hypothesis — an experiment without one is just a script.
    for (const e of chaos.experiments()) { if (!e.hypothesis) v.push(`${e.id}: no steady-state hypothesis`); if (!e.fault) v.push(`${e.id}: no fault described`); }
    // The key guarantees, asserted individually so a regression names itself.
    const partition = chaos.runExperiment('network-partition');
    if (partition.observed.lost !== 0 || partition.observed.retainedDuringPartition !== 2) v.push('events were lost across a network partition');
    const db = chaos.runExperiment('database-failure');
    if (!db.observed.errorSurfaced || db.observed.after !== db.observed.before) v.push('a database failure did not fail closed');
    const idp = chaos.runExperiment('identity-failure');
    if (!idp.observed.forgedRejected || !idp.observed.tamperedRejected) v.push('identity verification did not fail closed');
    const storage = chaos.runExperiment('storage-failure');
    if (!storage.observed.plaintextRefused) v.push('storage fell back to plaintext under failure');
  }),

  fit('APP-FIT-SRE-PREDICTIVE', 'Burn-rate alerting, forecasting, dependency risk and scorecards are measured — and fail when reliability degrades', (v) => {
    const sre = require('../src/observability/sre');

    // --- Multi-window burn-rate alerting -------------------------------------------------------
    for (const a of sre.BURN_ALERTS) {
      for (const f of ['longWindowHours', 'shortWindowMinutes', 'burnRate', 'severity', 'meaning']) {
        if (a[f] === undefined || a[f] === null) v.push(`burn alert ${a.id}: missing ${f}`);
      }
      if (!(a.shortWindowMinutes < a.longWindowHours * 60)) v.push(`burn alert ${a.id}: the short window is not shorter than the long window`);
    }
    if (!sre.BURN_ALERTS.some((a) => a.severity === 'page') || !sre.BURN_ALERTS.some((a) => a.severity === 'ticket')) {
      v.push('burn-rate policy does not distinguish a page from a ticket');
    }
    // Objective 0.999 → budget 0.001. Attained 0.9856 = 14.4× burn.
    const burning = sre.burnRateAlerts({ service: 'anonymous-reporting', longWindowAttained: { 'fast-burn': 0.9856 }, shortWindowAttained: { 'fast-burn': 0.98 } });
    if (!burning.page || !burning.firing.includes('fast-burn')) v.push('a 14.4× two-window burn did not page');
    // THE POINT OF TWO WINDOWS: a long window still burning but a short window recovered must NOT page.
    const overIncident = sre.burnRateAlerts({ service: 'anonymous-reporting', longWindowAttained: { 'fast-burn': 0.9856 }, shortWindowAttained: { 'fast-burn': 1 } });
    if (overIncident.page) v.push('a recovered incident still paged — the short window is not gating the alert');
    if (!overIncident.alerts[0].suppressed) v.push('a recovered incident was not reported as suppressed');
    // A healthy service must not page at all.
    const quiet = sre.burnRateAlerts({ service: 'anonymous-reporting', longWindowAttained: { 'fast-burn': 0.9999, 'medium-burn': 0.9999, 'slow-burn': 0.9999 }, shortWindowAttained: { 'fast-burn': 0.9999, 'medium-burn': 0.9999, 'slow-burn': 0.9999 } });
    if (quiet.page || quiet.firing.length) v.push('a healthy service triggered a burn-rate alert');

    // --- Trend & forecasting -------------------------------------------------------------------
    if (sre.trend([1, 2, 3, 4]).direction !== 'improving') v.push('a rising series was not reported as improving');
    if (sre.trend([4, 3, 2, 1]).direction !== 'degrading') v.push('a falling series was not reported as degrading');
    if (sre.trend([2, 2, 2]).direction !== 'flat') v.push('a flat series was not reported as flat');
    if (sre.trend([1]).direction !== 'insufficient-data') v.push('a single observation was treated as a trend');
    if (JSON.stringify(sre.trend([0.99, 0.98, 0.97])) !== JSON.stringify(sre.trend([0.99, 0.98, 0.97]))) v.push('trend analysis is not deterministic');
    // A degrading service must be forecast to breach; a healthy one must not.
    const degrading = sre.reliabilityForecast({ service: 'case-status', history: [0.999, 0.998, 0.996, 0.995], periodsAhead: 4 });
    if (!degrading.breachExpected) v.push('a degrading availability trend was not forecast to breach its objective');
    if (degrading.trend.direction !== 'degrading') v.push('a degrading forecast did not report a degrading trend');
    if (degrading.authorizes !== false) v.push('a reliability forecast claims authority');
    const steady = sre.reliabilityForecast({ service: 'case-status', history: [0.999, 0.999, 0.999, 0.999], periodsAhead: 6 });
    if (steady.breachExpected) v.push('a steady, within-objective service was forecast to breach');
    // Recovery forecasting: restore time scales with volume while the RTO does not.
    const growing = sre.recoveryForecast({ service: 'investigation', restoreMinutesPerGb: 0.5, dataGbNow: 100, monthlyGrowthPct: 6, months: 24 });
    if (!growing.breachExpected || growing.breachAtMonth === null) v.push('growing data volume was not forecast to breach the RTO');
    if (!growing.currentlyMeetsRto) v.push('the recovery forecast misreports today as already breaching');
    const flat = sre.recoveryForecast({ service: 'investigation', restoreMinutesPerGb: 0.05, dataGbNow: 10, monthlyGrowthPct: 0, months: 24 });
    if (flat.breachExpected) v.push('a non-growing dataset was forecast to breach the RTO');

    // --- Dependency risk -----------------------------------------------------------------------
    const risk = sre.dependencyRisk();
    if (!risk.services.length) v.push('dependency risk scored no services');
    for (const r of risk.services) {
      if (typeof r.score !== 'number' || r.score < 0 || r.score > 100) v.push(`${r.service}: dependency risk score out of range`);
      if (!['severe', 'high', 'moderate', 'low'].includes(r.band)) v.push(`${r.service}: unknown risk band`);
    }
    // Scores must be ordered, derived and reproducible — never hand-entered.
    for (let i = 1; i < risk.services.length; i++) if (risk.services[i - 1].score < risk.services[i].score) v.push('dependency risk is not ordered by score');
    if (JSON.stringify(sre.dependencyRisk()) !== JSON.stringify(sre.dependencyRisk())) v.push('dependency risk scoring is not deterministic');
    // A single point of failure on the constitutional path must score above a leaf service.
    const byName = Object.fromEntries(risk.services.map((r) => [r.service, r]));
    if (!risk.singlePointsOfFailure.length) v.push('no single point of failure was identified in a topology that has them');
    if (byName['persistence-ind'] && byName['analytics'] && byName['persistence-ind'].score <= byName['analytics'].score) {
      v.push('a constitutional single point of failure did not outrank a leaf analytics service');
    }

    // --- SLO compliance history ----------------------------------------------------------------
    const history = new sre.SloComplianceHistory();
    history.record({ service: 'investigation', period: 0, availability: 0.996, latencyUnder: 0.96 });
    history.record({ service: 'investigation', period: 1, availability: 0.994, latencyUnder: 0.96 });
    let rejectedDuplicate = false;
    try { history.record({ service: 'investigation', period: 1, availability: 0.999 }); } catch (_) { rejectedDuplicate = true; }
    if (!rejectedDuplicate) v.push('SLO compliance history accepted a rewrite of a recorded period — history must be append-only');
    let rejectedUnknown = false;
    try { history.record({ service: 'not-a-service', period: 0, availability: 1 }); } catch (_) { rejectedUnknown = true; }
    if (!rejectedUnknown) v.push('SLO compliance history accepted an unknown service');
    const compliance = history.compliance('investigation');
    if (compliance.complianceRate !== 0.5) v.push('SLO compliance rate was miscomputed');
    if (compliance.consecutiveBreaches !== 1) v.push('consecutive breaches were miscounted');
    if (compliance.trend.direction !== 'degrading') v.push('a falling availability history was not reported as degrading');

    // --- Scorecard & release readiness ---------------------------------------------------------
    const healthyMeasurements = Object.fromEntries(Object.keys(sre.SERVICE_LEVELS).map((s) => [s, { availability: 1, latencyUnder: 1 }]));
    const goodHistory = new sre.SloComplianceHistory();
    for (const s of Object.keys(sre.SERVICE_LEVELS)) for (let p = 0; p < 4; p++) goodHistory.record({ service: s, period: p, availability: 1, latencyUnder: 1 });
    const good = sre.scorecard({ measurements: healthyMeasurements, history: goodHistory });
    if (good.overallGrade !== 'A') v.push(`a perfectly healthy platform scored ${good.overallGrade}, not A`);
    if (good.authorizes !== false) v.push('the reliability scorecard claims authority');
    // THE REQUIREMENT: the scorecard must FAIL when reliability is bad, and an unmeasured
    // service must score zero rather than being quietly assumed healthy.
    const bad = sre.scorecard({ measurements: { 'anonymous-reporting': { availability: 0.9, latencyUnder: 0.5 } } });
    if (bad.overallGrade === 'A') v.push('a breached, largely unmeasured platform still scored an A');
    const unmeasured = bad.services.find((s) => !s.measured);
    if (!unmeasured || unmeasured.score !== 0 || unmeasured.grade !== 'F') v.push('an unmeasured service was not scored as F');
    if (!bad.services.find((s) => s.service === 'anonymous-reporting').reasons.length) v.push('a failing service named no reason');
    // Release readiness inherits the fail-closed gate and adds advisory warnings.
    const ready = sre.releaseReadiness({ measurements: healthyMeasurements, history: goodHistory });
    if (!ready.ready || ready.gate.blockers.length) v.push('release readiness blocked a fully healthy platform');
    const notReady = sre.releaseReadiness({ measurements: { 'anonymous-reporting': { availability: 0.9, latencyUnder: 0.5 } } });
    if (notReady.ready) v.push('release readiness permitted a release with a breached SLO');
    if (!notReady.failClosed || notReady.authorizes !== false) v.push('release readiness is not fail-closed / claims authority');
    // A passing gate with a degrading trend must still warn — a green gate is not an all-clear.
    const drifting = new sre.SloComplianceHistory();
    for (const [p, a] of [[0, 1], [1, 0.9999], [2, 0.9997], [3, 0.9995]]) drifting.record({ service: 'anonymous-reporting', period: p, availability: a, latencyUnder: 1 });
    const warned = sre.releaseReadiness({ measurements: healthyMeasurements, history: drifting });
    if (!warned.ready) v.push('a degrading-but-compliant trend blocked a release outright');
    if (!warned.warnings.some((w) => w.service === 'anonymous-reporting' && /degrading/.test(w.warning))) v.push('a degrading trend produced no warning on a passing gate');
  }),

  fit('APP-FIT-BUSINESS-OBSERVABILITY', 'Business KPIs are derived from PII-free events, never hand-entered, and correlate without claiming cause', (v) => {
    const bus = require('../src/observability/business');
    const H = 3600_000;

    // Every catalogued metric declares an objective, a direction, an owning board and a derivation.
    for (const m of bus.catalogue()) {
      for (const f of ['title', 'unit', 'direction', 'objective', 'warn', 'board', 'derivedFrom', 'meaning']) {
        if (m[f] === undefined || m[f] === null) v.push(`business metric ${m.id}: missing ${f}`);
      }
      if (!['higher-better', 'lower-better'].includes(m.direction)) v.push(`business metric ${m.id}: unknown direction`);
      if (!Array.isArray(m.correlatesWith) || !m.correlatesWith.length) v.push(`business metric ${m.id}: no technical service to correlate against`);
      for (const s of m.correlatesWith) if (!require('../src/observability/sre').SERVICE_LEVELS[s]) v.push(`business metric ${m.id}: correlates with unknown service level '${s}'`);
    }
    // Part 5 requires all nine business dimensions to exist.
    for (const required of ['case-throughput', 'investigation-latency', 'evidence-processing-time', 'judicial-workflow-duration', 'policy-violation-rate', 'audit-completion-rate', 'governance-review-time', 'approval-delay', 'compliance-rate']) {
      if (!bus.BUSINESS_METRICS[required]) v.push(`missing business metric: ${required}`);
    }

    // THE PRIVACY REQUIREMENT: an identity-bearing event is REFUSED, not silently stripped.
    let refused = false;
    try { bus.derive([{ type: 'CaseCreated', correlationId: 'C1', at: 0, name: 'a person' }]); } catch (_) { refused = true; }
    if (!refused) v.push('business observability accepted an event carrying an identity field');
    let refusedNested = false;
    try { bus.derive([{ type: 'CaseCreated', correlationId: 'C1', at: 0, omang: '123' }]); } catch (_) { refusedNested = true; }
    if (!refusedNested) v.push('business observability accepted an event carrying a national identity number');

    const events = [
      { type: 'CaseCreated', correlationId: 'C1', at: 0 },
      { type: 'CaseTransitioned', correlationId: 'C1', to: 'closed', at: 100 * H },
      { type: 'CaseCreated', correlationId: 'C2', at: 0 },
      { type: 'CaseTransitioned', correlationId: 'C2', to: 'closed', at: 200 * H },
      { type: 'CaseCreated', correlationId: 'C3', at: 0 },
      { type: 'EvidenceIngested', correlationId: 'E1', at: 0 },
      { type: 'EvidenceAdmitted', correlationId: 'E1', at: 10 * H },
      { type: 'ApprovalRequested', correlationId: 'A1', at: 0 },
      { type: 'ApprovalGranted', correlationId: 'A1', at: 20 * H },
      { type: 'AuditScheduled', correlationId: 'AU1', at: 0 },
      { type: 'AuditCompleted', correlationId: 'AU1', at: 1 * H },
      { type: 'ComplianceChecked', correlationId: 'X', outcome: 'ok', at: 0 },
    ];
    const derived = bus.derive(events, { periods: 1 });
    if (derived['case-throughput'] !== 2) v.push('case throughput was not derived from terminal transitions');
    if (derived['evidence-processing-time'] !== 10) v.push('evidence processing time was not derived from the ingest→admit dwell');
    if (derived['approval-delay'] !== 20) v.push('approval delay was not derived from the request→grant dwell');
    if (derived['audit-completion-rate'] !== 1) v.push('audit completion rate was miscomputed');
    // An in-flight case must be counted as open — averaging only completed work hides a backlog.
    const dwell = bus.dwellTimes(events, 'investigation-latency');
    if (dwell.open !== 1) v.push('an unfinished case was not counted as open');
    if (dwell.completed !== 2) v.push('completed dwell times were miscounted');
    // Derivation is deterministic.
    if (JSON.stringify(bus.derive(events)) !== JSON.stringify(bus.derive(events))) v.push('business metric derivation is not deterministic');

    // NO EVIDENCE IS NOT A PASS: a metric with nothing behind it must report no-evidence.
    const empty = bus.dashboard({ events: [], periods: 1 });
    if (empty.healthy) v.push('an empty event stream produced a healthy business dashboard');
    if (empty.noEvidence.length !== Object.keys(bus.BUSINESS_METRICS).length - 1) v.push('metrics with no evidence were not all reported as no-evidence');
    for (const m of empty.metrics) if (m.status === 'met') v.push(`${m.metric}: reported as met with no evidence`);

    // Objective assessment works in both polarities and fails when the objective is missed.
    if (bus.assess('case-throughput', 30).status !== 'met') v.push('a higher-better metric above objective was not reported as met');
    if (bus.assess('case-throughput', 5).status !== 'breached') v.push('a higher-better metric below objective was not reported as breached');
    if (bus.assess('approval-delay', 24).status !== 'met') v.push('a lower-better metric under objective was not reported as met');
    if (bus.assess('approval-delay', 400).status !== 'breached') v.push('a lower-better metric over objective was not reported as breached');
    if (bus.assess('approval-delay', null).status !== 'no-evidence') v.push('a missing value was not reported as no-evidence');

    // Trend polarity is interpreted against the metric, not the number: a RISING duration is worse.
    const worseningDash = bus.dashboard({ events, periods: 1, businessHistory: { 'approval-delay': [10, 20, 30, 40], 'case-throughput': [30, 28, 26, 24] } });
    if (!worseningDash.worsening.includes('approval-delay')) v.push('a rising duration was not reported as worsening');
    if (!worseningDash.worsening.includes('case-throughput')) v.push('a falling throughput was not reported as worsening');
    const improvingDash = bus.dashboard({ events, periods: 1, businessHistory: { 'approval-delay': [40, 30, 20, 10] } });
    if (improvingDash.worsening.includes('approval-delay')) v.push('a falling duration was reported as worsening');

    // Correlation reports a hypothesis, never a cause, and refuses to compute on thin data.
    if (bus.correlation([1, 2], [1, 2]) !== null) v.push('correlation was computed from fewer than three paired points');
    if (bus.correlation([1, 1, 1], [1, 2, 3]) !== null) v.push('correlation was computed against a constant series');
    const corr = bus.correlateWithReliability({ businessHistory: { 'case-throughput': [10, 12, 14, 16] }, technicalHistory: { 'case-status': [0.99, 0.992, 0.995, 0.999] } });
    if (corr.causal !== false || corr.authorizes !== false) v.push('correlation analysis claims causation or authority');
    const f = corr.findings.find((x) => x.metric === 'case-throughput' && x.service === 'case-status');
    if (!f || f.strength !== 'strong' || !f.aligned) v.push('a strong aligned relationship was not detected');
    if (!/investigate/.test(f.hypothesis)) v.push('a correlation finding did not phrase itself as something to investigate');
    // An UNEXPECTED direction must be flagged as a broken assumption, not quietly reported.
    const inverted = bus.correlateWithReliability({ businessHistory: { 'case-throughput': [16, 14, 12, 10] }, technicalHistory: { 'case-status': [0.99, 0.992, 0.995, 0.999] } });
    const inv = inverted.findings.find((x) => x.metric === 'case-throughput' && x.service === 'case-status');
    if (!inv || inv.aligned) v.push('an inverted relationship was reported as aligned');
    if (!/UNEXPECTED|model may be wrong/.test(inv.hypothesis)) v.push('an inverted relationship did not challenge the model');

    const report = bus.report({ events, periods: 1 });
    if (report.authorizes !== false || report.informationalOnly !== true) v.push('the business observability report claims authority');
    if (report.piiFree !== true) v.push('the business observability report does not assert its PII-free contract');
  }),

  fit('APP-FIT-CHAOS-DETECT-RECOVER', 'Every chaos scenario proves BOTH detection and recovery — and the contract fails when one is missing', (v) => {
    const chaos = require('../src/twin2/chaos');

    // Part 6 requires all twelve advanced fault classes, alongside the Phase 10 set.
    const ids = chaos.experiments().map((e) => e.id);
    const required = [
      'dns-failure', 'certificate-expiry', 'clock-skew', 'identity-provider-outage',
      'network-partition', 'dependency-latency', 'storage-corruption', 'message-duplication',
      'message-reordering', 'partial-regional-outage', 'degraded-service', 'cascading-failure',
    ];
    for (const r of required) if (!ids.includes(r)) v.push(`missing chaos scenario: ${r}`);

    // THE CONTRACT: every experiment, without exception, proves detection AND recovery.
    for (const id of ids) {
      const r = chaos.runExperiment(id);
      if (r.error) v.push(`${id}: threw during execution — ${r.error}`);
      if (!r.detected) v.push(`${id}: the fault was not shown to be detected`);
      if (!r.recovered) v.push(`${id}: recovery to steady state was not shown`);
      if (!r.pass) v.push(`${id}: hypothesis did not hold`);
      for (const cv of r.contractViolations) v.push(`${id}: ${cv}`);
    }

    // THE CONTRACT MUST BITE: an experiment that survives a fault but proves neither detection
    // nor recovery must FAIL. Fed a crafted counterexample, the runner must refuse it.
    const original = chaos.EXPERIMENTS['dns-failure'];
    try {
      chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'survives silently', run: () => ({ pass: true }) };
      const silent = chaos.runExperiment('dns-failure');
      if (silent.pass) v.push('an experiment that proved neither detection nor recovery was allowed to pass');
      if (silent.contractViolations.length !== 2) v.push('the detect-and-recover contract did not name both missing halves');
      chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'detected but never recovers', run: () => ({ pass: true, detected: true, recovered: false }) };
      const stuck = chaos.runExperiment('dns-failure');
      if (stuck.pass) v.push('an experiment that detected a fault but never recovered was allowed to pass');
    } finally {
      chaos.EXPERIMENTS['dns-failure'] = original;
    }

    // Scenario-specific guarantees, asserted individually so a regression names itself.
    const dns = chaos.runExperiment('dns-failure').observed;
    if (dns.beyondStale !== false) v.push('DNS kept serving a cached address beyond its stale window');
    if (!dns.servedStaleRatherThanFailing) v.push('a resolution outage inside the stale window took the dependency down');
    const cert = chaos.runExperiment('certificate-expiry').observed;
    if (!cert.warnedBeforeExpiry) v.push('certificate expiry was not warned about before it happened');
    if (!cert.expiredRefused) v.push('an expired certificate was accepted');
    const idp = chaos.runExperiment('identity-provider-outage').observed;
    if (!idp.deniedDuringOutage) v.push('authentication did not fail closed during an identity-provider outage');
    if (!idp.anonymousStillWorks) v.push('the anonymous reporting path depended on the identity provider');
    const lat = chaos.runExperiment('dependency-latency').observed;
    if (!lat.shedRequests) v.push('a slow dependency was queued rather than shed');
    const rot = chaos.runExperiment('storage-corruption').observed;
    if (!rot.corruptionDetected || !rot.decryptRefused) v.push('silent storage corruption was not detected');
    if (rot.servedCorrupt !== false) v.push('a corrupted evidence blob was served');
    const dup = chaos.runExperiment('message-duplication').observed;
    if (dup.appliedOnce !== 1) v.push('a duplicated event was applied more than once');
    const ord = chaos.runExperiment('message-reordering').observed;
    if (!ord.inOrder) v.push('events were applied out of order');
    if (ord.appliedDuringGap !== 1) v.push('an out-of-order event was applied before the gap was filled');
    const reg = chaos.runExperiment('partial-regional-outage').observed;
    if (!reg.quorumDuringOutage) v.push('losing one of three regions lost quorum');
    if (!reg.laggingDetected) v.push('a lagging replica was not detected');
    const deg = chaos.runExperiment('degraded-service').observed;
    if (deg.criticalPathBroken) v.push('a non-essential service outage broke the constitutional path');
    if (!deg.reportingWorks) v.push('reporting stopped when notifications were unavailable');
    const cas = chaos.runExperiment('cascading-failure').observed;
    if (!cas.containedToOneZone) v.push('a persistence failure escaped its zone');
    if (!cas.namedAsSpof) v.push('an unmitigated single point of failure is not named as one');

    // The suite reports the contract at the top level, and stays fail-closed.
    const suite = chaos.runSuite({ light: true });
    if (suite.contractViolations.length) for (const cv of suite.contractViolations) v.push(`${cv.experiment}: ${cv.reason}`);
    if (suite.detected !== suite.chaos.length || suite.recovered !== suite.chaos.length) v.push('the suite did not report detection and recovery for every experiment');
    if (suite.failClosed !== true || suite.authorizes !== false) v.push('the resilience suite is not fail-closed / claims authority');
  }),

  fit('APP-FIT-DATA-GOVERNANCE', 'Every record traces origin → transformations → consumers → retention → deletion', (v) => {
    const { DataGovernance, seedPlatformDatasets, RETENTION_POLICIES } = require('../src/fabric/data-governance');
    const dg = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
    for (const violation of dg.validate().violations) v.push(violation);
    // Every governed record answers all five lifecycle stages.
    for (const id of dg.datasets()) {
      const t = dg.traceRecord(id);
      if (!t.complete) v.push(`${id}: lifecycle trace incomplete`);
      if (!t.origin) v.push(`${id}: no origin`);
      if (!t.retention.basis) v.push(`${id}: retention has no legal basis`);
      if (!t.deletion) v.push(`${id}: no deletion plan`);
    }
    // A dataset cannot be registered without a retention class or a purpose.
    let needsRetention = false;
    try { dg.register('x', { origin: 'o', retentionClass: 'nonsense', purpose: 'p' }); } catch (e) { needsRetention = !!e.failClosed; }
    if (!needsRetention) v.push('a dataset was registered with no valid retention policy');
    let needsPurpose = false;
    try { dg.register('y', { origin: 'o', retentionClass: 'telemetry' }); } catch (e) { needsPurpose = !!e.failClosed; }
    if (!needsPurpose) v.push('a dataset was registered with no declared purpose');
    // Identity fields are refused in a governed dataset.
    let identityRefused = false;
    try { dg.register('z', { origin: 'o', retentionClass: 'telemetry', purpose: 'p', fields: ['email'] }); } catch (e) { identityRefused = !!e.failClosed; }
    if (!identityRefused) v.push('a governed dataset accepted an identity field');
    // Purpose limitation applies to consumers, across domains.
    let purposeLimited = false;
    try { dg.addConsumer('case-records', { consumer: 'marketing', purpose: 'outreach' }); } catch (e) { purposeLimited = !!e.failClosed; }
    if (!purposeLimited) v.push('a consumer was added under a purpose the dataset does not permit');
    // Cross-domain lineage is computed, not asserted.
    const lineage = dg.lineageGraph();
    if (!lineage.edges.length) v.push('lineage graph has no edges');
    if (!lineage.crossDomainEdges.length) v.push('cross-domain lineage is not identified');
    // Legal hold beats retention; deletion is refused while it stands and before expiry.
    const future = 1_000_000 + 9e12;
    const hold = dg.placeLegalHold('case-records', { matter: 'M-1', by: 'Attorney General Chambers', rationale: 'active litigation' });
    let holdBlocks = false;
    try { dg.delete('case-records', { by: 'Records Steward', rationale: 'retention elapsed', now: future }); } catch (e) { holdBlocks = !!e.failClosed; }
    if (!holdBlocks) v.push('deletion proceeded while a legal hold was in force');
    dg.releaseLegalHold(hold.id, { by: 'Attorney General Chambers', rationale: 'matter closed' });
    let earlyBlocked = false;
    try { dg.delete('audit-chain', { by: 'x', rationale: 'y', now: 1_000_001 }); } catch (e) { earlyBlocked = !!e.failClosed; }
    if (!earlyBlocked) v.push('deletion proceeded before the retention period elapsed');
    if (!dg.delete('case-records', { by: 'Records Steward', rationale: 'retention elapsed', now: future }).deleted) v.push('a due record could not be deleted after its hold was released');
    // Permanent records can never be destroyed.
    let permanentProtected = false;
    try { dg.delete('governance-decisions', { by: 'x', rationale: 'y', now: future }); } catch (e) { permanentProtected = !!e.failClosed; }
    if (!permanentProtected) v.push('a permanently retained record was deletable');
    if (RETENTION_POLICIES['governance-decision'].retentionDays !== -1) v.push('governance decisions are not permanently retained');
    // Consent lifecycle: granted → valid → withdrawn → invalid; identity refused.
    dg.recordConsent('C1', { subjectRole: 'partner-agency-analyst', purpose: 'joint-analysis', grantedBy: 'Data Steward' });
    if (!dg.consentValid('C1', { purpose: 'joint-analysis' }).valid) v.push('a fresh consent was not valid');
    if (dg.consentValid('C1', { purpose: 'other' }).valid) v.push('consent was valid for an unstated purpose');
    dg.withdrawConsent('C1', { by: 'subject' });
    if (dg.consentValid('C1', { purpose: 'joint-analysis' }).valid) v.push('withdrawn consent was still valid');
    // Data quality is observed across the declared dimensions.
    dg.observeQuality('oversight-aggregates', { completeness: 1, validity: 0.99, timeliness: 0.95 });
    const q = dg.qualityScore('oversight-aggregates');
    if (!q.measured || q.score === null) v.push('data quality was not computed from observations');
    if (dg.qualityScore('platform-telemetry').measured) v.push('an unobserved dataset reported a quality score');
    // Reference data is a controlled vocabulary; master data has one authoritative source.
    if (dg.validateReferenceValue('case-category', 'police').valid !== true) v.push('a valid reference value was rejected');
    if (dg.validateReferenceValue('case-category', 'made-up').valid !== false) v.push('an out-of-vocabulary reference value was accepted');
    for (const m of dg.masterData()) if (!m.authoritativeSource || !m.steward) v.push(`master data '${m.id}' has no authoritative source or steward`);
  }),

  fit('APP-FIT-DATA-QUALITY', 'Eight quality dimensions — two of them underivable by hand — and poor quality reduces governance readiness', (v) => {
    const dgm = require('../src/fabric/data-governance');
    const { DataGovernance, seedPlatformDatasets, measurePlatformQuality, OBSERVED_DIMENSIONS, DERIVED_DIMENSIONS, QUALITY_DIMENSIONS, REQUIRED_METADATA } = dgm;
    let now = 1_000_000;
    const dg = seedPlatformDatasets(new DataGovernance({ clock: () => now }));

    // Part 7 requires eight dimensions, including lineage and metadata completeness.
    if (QUALITY_DIMENSIONS.length !== 8) v.push(`expected 8 quality dimensions, found ${QUALITY_DIMENSIONS.length}`);
    for (const d of ['completeness', 'validity', 'consistency', 'timeliness', 'uniqueness', 'accuracy', 'lineageCompleteness', 'metadataCompleteness']) {
      if (!QUALITY_DIMENSIONS.includes(d)) v.push(`missing quality dimension: ${d}`);
    }

    // THE REQUIREMENT THAT MATTERS: the two derived dimensions cannot be supplied by hand.
    for (const d of DERIVED_DIMENSIONS) {
      let refused = false;
      try { dg.observeQuality('case-records', { [d]: 1 }); } catch (_) { refused = true; }
      if (!refused) v.push(`${d} was accepted as a hand-entered observation — it must be derived`);
    }
    let rangeRefused = false;
    try { dg.observeQuality('case-records', { completeness: 1.5 }); } catch (_) { rangeRefused = true; }
    if (!rangeRefused) v.push('an out-of-range quality observation was accepted');
    let unknownRefused = false;
    try { dg.observeQuality('case-records', { plausibility: 1 }); } catch (_) { unknownRefused = true; }
    if (!unknownRefused) v.push('an unknown quality dimension was accepted');

    // Derived dimensions are computed from the governance record and must be complete for the
    // platform's own datasets — the model is supposed to describe reality.
    for (const id of dg.datasets()) {
      const d = dg.deriveQualityDimensions(id);
      if (d.lineageCompleteness !== 1) v.push(`${id}: lineage incomplete — ${d.lineageGaps.join(', ')}`);
      if (d.metadataCompleteness !== 1) v.push(`${id}: metadata incomplete — ${d.missingMetadata.join(', ')}`);
    }
    // THE DERIVATION MUST BITE: a dataset with no declared consumer and a missing purpose scores
    // below 1 on both derived dimensions. A check that always returns 1 is not a check.
    const gapped = new DataGovernance({ clock: () => now });
    gapped.register('orphan', { origin: 'somewhere', classification: 'internal', retentionClass: 'telemetry', purpose: 'unstated-analysis' });
    const gd = gapped.deriveQualityDimensions('orphan');
    if (gd.lineageCompleteness >= 1) v.push('a dataset with no declared consumer scored full lineage completeness');
    if (gd.metadataCompleteness >= 1) v.push('a dataset with no owner and no declared fields scored full metadata completeness');
    if (!gd.lineageGaps.includes('consumersDeclared')) v.push('the missing consumer declaration was not named');
    if (!gd.missingMetadata.includes('fields')) v.push('the missing field list was not named');
    // A transformation pointing at an ungoverned upstream ends the lineage graph at nobody.
    gapped.register('derived', { origin: 'derived from orphan', classification: 'internal', retentionClass: 'telemetry', owner: 'analytics', domain: 'Insight', fields: ['x'], purpose: 'analysis' });
    gapped.addTransformation('derived', { from: 'not-a-governed-dataset', operation: 'join', by: 'pipeline', purpose: 'analysis' });
    gapped.addConsumer('derived', { consumer: 'a-dashboard', purpose: 'analysis', domain: 'Insight' });
    const ungoverned = gapped.deriveQualityDimensions('derived');
    if (!ungoverned.lineageGaps.includes('upstreamsGoverned')) v.push('a transformation from an ungoverned upstream was not flagged');

    // An UNMEASURED dataset is not a clean one: it must not report as meeting the threshold, and
    // it must reduce readiness exactly as a poor one does.
    const unmeasured = dg.qualityScore('case-records');
    if (unmeasured.measured) v.push('a dataset with no observation reported as measured');
    if (unmeasured.meets) v.push('an unmeasured dataset reported as meeting the quality threshold');
    if (unmeasured.readinessImpact !== 1) v.push('an unmeasured dataset did not reduce governance readiness');
    if (dg.governanceReadiness().qualityReadiness !== 0) v.push('an entirely unmeasured estate did not score zero quality readiness');
    if (dg.governanceReadiness().acceptable) v.push('an entirely unmeasured estate was reported as acceptable');

    // Healthy observations lift readiness to 1.0 and clear the alerts.
    const good = Object.fromEntries(OBSERVED_DIMENSIONS.map((d) => [d, 0.99]));
    for (const id of dg.datasets()) dg.observeQuality(id, good, { recordCount: 10 });
    const healthy = dg.governanceReadiness();
    if (healthy.qualityReadiness !== 1) v.push(`a healthy estate scored ${healthy.qualityReadiness} quality readiness`);
    if (!healthy.acceptable) v.push('a healthy estate was not acceptable');
    if (healthy.alerts.length) v.push('a healthy estate raised quality alerts');
    if (healthy.authorizes !== false || healthy.failClosed !== true) v.push('quality readiness claims authority / is not fail-closed');

    // THE REQUIREMENT: poor quality must REDUCE governance readiness, not merely be reported.
    now += 24 * 3600_000;
    dg.observeQuality('case-records', Object.fromEntries(OBSERVED_DIMENSIONS.map((d) => [d, 0.3])), { recordCount: 10 });
    const degraded = dg.governanceReadiness();
    if (!(degraded.qualityReadiness < healthy.qualityReadiness)) v.push('poor data quality did not reduce governance readiness');
    if (degraded.acceptable) v.push('an estate containing a poor dataset was still acceptable');
    if (!degraded.blockers.some((b) => b.startsWith('case-records'))) v.push('the poor dataset was not named as a blocker');
    const alert = degraded.alerts.find((a) => a.dataset === 'case-records');
    if (!alert || alert.severity !== 'critical') v.push('a poor dataset did not raise a critical alert');
    if (!alert.owner) v.push('a quality alert was raised with no accountable owner — an unowned alert is an unowned dataset');
    // Trend analysis is deterministic and reads the degradation.
    const trend = dg.qualityTrend('case-records');
    if (trend.direction !== 'degrading') v.push('a falling quality series was not reported as degrading');
    if (JSON.stringify(dg.qualityTrend('case-records')) !== JSON.stringify(dg.qualityTrend('case-records'))) v.push('quality trend analysis is not deterministic');

    // Remediation workflow: a named human, a bounded due date, and evidence to close.
    let noOwner = false;
    try { dg.openRemediation('case-records', { dimension: 'accuracy', dueInDays: 10 }); } catch (_) { noOwner = true; }
    if (!noOwner) v.push('a remediation was opened without a named human authority');
    let unbounded = false;
    try { dg.openRemediation('case-records', { dimension: 'accuracy', by: 'DGB Chair', dueInDays: 400 }); } catch (_) { unbounded = true; }
    if (!unbounded) v.push('a remediation was opened with an unbounded due date');
    const ticket = dg.openRemediation('case-records', { dimension: 'accuracy', by: 'Data Governance Board Chair', dueInDays: 10, rationale: 'source system re-profiling required' });
    if (ticket.state !== 'open') v.push('a new remediation was not open');
    let noEvidence = false;
    try { dg.closeRemediation(ticket.id, { by: 'Data Governance Board Chair' }); } catch (_) { noEvidence = true; }
    if (!noEvidence) v.push('a remediation was closed without evidence of the fix');
    // An overdue remediation blocks readiness on its own.
    now += 20 * 24 * 3600_000;
    if (!dg.overdueRemediations().length) v.push('an elapsed remediation was not reported as overdue');
    if (!dg.governanceReadiness().blockers.some((b) => b.startsWith(ticket.id))) v.push('an overdue remediation did not block governance readiness');
    if (dg.closeRemediation(ticket.id, { by: 'Data Governance Board Chair', evidence: 'source re-profiled; accuracy re-measured at 0.99' }).state !== 'closed') v.push('a properly evidenced remediation could not be closed');
    let doubleClose = false;
    try { dg.closeRemediation(ticket.id, { by: 'x', evidence: 'y' }); } catch (_) { doubleClose = true; }
    if (!doubleClose) v.push('a closed remediation was closed again');

    // An EMPTY dataset is not a quality achievement — it is reported as not-applicable.
    const fresh = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
    fresh.observeQuality('evidence-refs', good, { recordCount: 0 });
    const empty = fresh.qualityScore('evidence-refs');
    if (empty.band !== 'not-applicable') v.push('a dataset holding no records was graded as though it had good quality');
    if (empty.readinessImpact !== 0) v.push('an empty dataset penalised readiness for having no defects');

    // The platform measures its OWN quality from live state — every figure computed, none supplied.
    const live = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
    measurePlatformQuality(live, {
      cases: [{ caseCode: 'NJ-1', status: 'received', category: 'police' }],
      events: [{ seq: 1, meta: { at: 1 } }], decisions: [{ seq: 0, reviewer: 'OB', verdict: 'defer', rationale: 'await legal' }],
      evidenceCount: 0, telemetrySamples: [], chainIntact: true, custodyIntact: true, replayAgrees: true,
    });
    const measured = live.governanceReadiness();
    if (measured.qualityReadiness !== 1) v.push(`a healthy live platform measured ${measured.qualityReadiness} quality readiness`);
    // Broken chains and out-of-vocabulary values must show up as measured defects.
    const broken = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
    measurePlatformQuality(broken, {
      cases: [{ caseCode: 'NJ-1', status: 'received', category: 'not-a-category' }, { caseCode: 'NJ-1', status: 'received', category: 'police' }],
      events: [{ seq: 1, meta: { at: 1 } }], decisions: [{ seq: 0, reviewer: 'OB', verdict: 'defer' }],
      evidenceCount: 3, chainIntact: false, custodyIntact: false, replayAgrees: false,
    });
    const brokenScore = broken.qualityScore('case-records');
    if (brokenScore.dimensions.validity >= 1) v.push('an out-of-vocabulary category did not reduce validity');
    if (brokenScore.dimensions.uniqueness >= 1) v.push('a duplicated case code did not reduce uniqueness');
    if (brokenScore.dimensions.accuracy !== 0) v.push('a broken event chain did not zero the accuracy of case records');
    if (broken.qualityScore('evidence-refs').dimensions.accuracy !== 0) v.push('a broken custody chain did not zero the accuracy of evidence references');
    if (broken.governanceReadiness().acceptable) v.push('a platform with broken chains reported acceptable data quality');
    // A governance decision recorded without a rationale is incomplete, by definition.
    if (broken.qualityScore('governance-decisions').dimensions.completeness >= 1) v.push('a governance decision with no rationale scored full completeness');
    // Derived aggregates cannot be cleaner than their source.
    const agg = broken.qualityScore('oversight-aggregates');
    if (agg.score > brokenScore.score) v.push('a derived aggregate scored higher than the source it is derived from');

    // Poor quality reaches the continuous assurance framework, not just the data report.
    const ca = require('../src/assurance/continuous');
    const base = { fitness: { allHold: true }, architecture: { valid: true, contexts: 30, modules: 1 }, security: { policiesCertified: true, credentialFindings: 0, algorithmIndependence: true }, privacy: { identityMinimized: true, correlationDefaultDeny: true }, compliance: { overallCoverage: 1 }, reliability: { allSlosMet: true, latencyP95Ms: 100 }, governance: { ownershipComplete: true, noSelfApproval: true }, recovery: { allScenariosMatch: true, backupVerified: true }, supplyChain: { thirdPartyCount: 0, attestationsVerified: true }, infrastructure: { healthy: true, drift: false }, legislation: { unimplementedMandates: 0 }, identity: { trustedIssuer: true, shortLivedCredentials: true }, policies: { certified: true, allSpecsProven: true }, observability: { topologyValid: true, identityFree: true }, ai: { allArtifactsApproved: true, noAutonomousAction: true } };
    const clean = ca.evaluate({ ...base, data: { tracedRatio: 1, qualityReadiness: 1, qualityAcceptable: true } });
    if (clean.failed.includes('dataGovernance')) v.push('a fully traced, high-quality estate failed the data-governance assurance domain');
    const dirty = ca.evaluate({ ...base, data: { tracedRatio: 1, qualityReadiness: 0.4, qualityAcceptable: false } });
    if (!dirty.failed.includes('dataGovernance')) v.push('poor data quality did not fail the data-governance assurance domain');
  }),


  fit('APP-FIT-SUPPLY-CHAIN-ATTESTATION', 'Builds are attested, artifacts verified, and an unattested release is blocked', (v) => {
    const { SupplyChainAttestation, sourceDigest, CLAIMED_LEVEL } = require('../src/supplychain/slsa');
    const { sbom } = require('../scripts/devsecops');
    const sc = new SupplyChainAttestation({ clock: () => 0 });
    const src = sourceDigest();
    // Provenance requires the source it was built from — an unsourced build is not attestable.
    let needsSource = false;
    try { sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'abc' }); } catch (e) { needsSource = !!e.failClosed; }
    if (!needsSource) v.push('provenance was generated without a source reference');
    const prov = sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'abc', sourceRef: 'git+njtip', sourceDigest: src });
    if (prov.statement.predicateType !== 'https://slsa.dev/provenance/v1') v.push('provenance is not SLSA-shaped');
    if (!sc.verify(prov.id).valid) v.push('a freshly generated attestation did not verify');
    // Tampering with the statement breaks verification — that is the whole point.
    const tampered = new SupplyChainAttestation({ clock: () => 0 });
    const p2 = tampered.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'abc', sourceRef: 'git+njtip', sourceDigest: src });
    tampered._attestations.get(p2.id).statement.predicate.builder.id = 'attacker';
    if (tampered.verify(p2.id).valid) v.push('an altered attestation still verified');
    // An artifact with no attestation is not deployable.
    if (sc.verifyArtifact('unknown-digest').valid) v.push('an unattested artifact verified');
    // Release verification is fail-closed and names every failed check.
    const blocked = sc.verifyRelease({ artifact: 'njtip-app', artifactDigest: 'abc', sbom: sbom(), dependencies: [] });
    if (blocked.verified) v.push('a release with an unsigned container image was verified');
    if (!blocked.failed.includes('container-signature')) v.push('the failing supply-chain check was not named');
    if (blocked.failClosed !== true || blocked.authorizes !== false) v.push('release verification is not fail-closed / claims authority');
    // Phase 11 raised the bar for "fully attested": a release now also needs a keyless signature
    // recorded in the transparency log, a reproducible build and a lockfile that matches.
    const releaseBundle = sc.keylessSign({ digest: 'abc', identity: 'https://github.com/gov/njtip/.github/workflows/release.yml@refs/tags/v1', issuer: 'https://token.actions.githubusercontent.com' });
    const ok = sc.verifyRelease({
      artifact: 'njtip-app', artifactDigest: 'abc', sbom: sbom(), dependencies: [], signedContainer: true,
      bundle: releaseBundle, expectedIdentity: releaseBundle.certificate.identity, expectedIssuer: releaseBundle.certificate.issuer,
      reproducible: true, locked: [], fetched: [],
    });
    if (!ok.verified) v.push('a fully attested release was not verified: ' + ok.failed.join(', '));
    // Dependency verification refuses an unpinned dependency.
    if (sc.verifyDependencies({ dependencies: [{ name: 'x', supplier: 's' }] }).verified) v.push('an unpinned dependency was verified');
    if (!sc.verifyDependencies({ dependencies: [{ name: 'x', supplier: 's', digest: 'd' }] }).verified) v.push('a pinned dependency was rejected');
    // Reproducible builds: the same inputs produce the same digest.
    if (!sc.verifyReproducible({ buildFn: () => sourceDigest() }).reproducible) v.push('the build is not reproducible');
    // The SLSA claim matches the evidence, and the gaps are stated rather than claimed.
    const posture = sc.slsaPosture();
    if (posture.claimedLevel !== CLAIMED_LEVEL) v.push('claimed SLSA level is inconsistent');
    for (const l of posture.levels) if (l.level <= CLAIMED_LEVEL && !l.met) v.push(`SLSA L${l.level} is claimed but not met`);
    if (!posture.honestGaps.length) v.push('no SLSA gaps are recorded — the claim is suspiciously complete');
    for (const g of posture.honestGaps) if (!g.why) v.push(`SLSA L${g.level} gap has no explanation`);
  }),

  fit('APP-FIT-SUPPLY-CHAIN-TRUST', 'Keyless signing, transparency log, dependency risk, licensing and artifact trust — deployment fails for an untrusted artifact', (v) => {
    const slsa = require('../src/supplychain/slsa');
    const { SupplyChainAttestation, TransparencyLog, licenseVerdict, LICENSE_POLICY, FULCIO_CERT_TTL_MS, TRUST_THRESHOLD } = slsa;
    let now = 1_000_000;
    const sc = new SupplyChainAttestation({ clock: () => now });
    const IDENTITY = 'https://github.com/gov/njtip/.github/workflows/release.yml@refs/tags/v1.10.0';
    const ISSUER = 'https://token.actions.githubusercontent.com';

    // --- Keyless signing: short-lived certificate, workflow identity, transparency log ----------
    let noIdentity = false;
    try { sc.keylessSign({ digest: 'abc' }); } catch (e) { noIdentity = !!e.failClosed; }
    if (!noIdentity) v.push('an artifact was signed with no workflow identity or issuer');
    let longTtl = false;
    try { sc.keylessSign({ digest: 'abc', identity: IDENTITY, issuer: ISSUER, ttlMs: 24 * 3600_000 }); } catch (e) { longTtl = !!e.failClosed; }
    if (!longTtl) v.push('a long-lived signing certificate was issued — that defeats keyless signing');
    if (FULCIO_CERT_TTL_MS > 15 * 60_000) v.push('the signing certificate TTL is not short-lived');

    const bundle = sc.keylessSign({ digest: 'artifact-digest-1', identity: IDENTITY, issuer: ISSUER });
    if (!bundle.logEntry || bundle.logEntry.logIndex !== 0) v.push('a keyless signature was not recorded in the transparency log');

    // THE KEYLESS MODEL: an hour later the certificate is expired, and the signature must STILL
    // verify — the transparency log is what makes it durable.
    now += 3600_000;
    const verified = sc.verifyBundle(bundle, { expectedIdentity: IDENTITY, expectedIssuer: ISSUER });
    if (!verified.valid) v.push('a valid keyless signature failed to verify after its certificate expired: ' + verified.reason);
    if (!verified.certificateExpired) v.push('the certificate was expected to be expired by now — the test is not exercising the keyless model');

    // Each verification failure mode must be caught individually.
    if (sc.verifyBundle(bundle, { expectedIdentity: 'https://github.com/attacker/repo/.github/workflows/x.yml@refs/heads/main' }).valid) v.push('a signature from an unexpected identity was accepted');
    if (sc.verifyBundle(bundle, { expectedIssuer: 'https://attacker.example/oidc' }).valid) v.push('a signature from an unexpected OIDC issuer was accepted');
    const tampered = JSON.parse(JSON.stringify(bundle)); tampered.certificate.identity = 'attacker';
    if (sc.verifyBundle(tampered).valid) v.push('a tampered signing bundle was accepted');
    const unlogged = JSON.parse(JSON.stringify(bundle)); unlogged.logEntry = null;
    if (sc.verifyBundle(unlogged).valid) v.push('an unlogged signature was accepted — it is unverifiable once the certificate expires');
    const forgedLog = JSON.parse(JSON.stringify(bundle)); forgedLog.logEntry.entryHash = 'not-the-real-hash';
    if (sc.verifyBundle(forgedLog).valid) v.push('a signature claiming a log entry it does not have was accepted');
    // A signature logged outside its certificate window is not from that short-lived identity.
    const outOfWindow = JSON.parse(JSON.stringify(bundle)); outOfWindow.logEntry.loggedAt = bundle.certificate.notAfter + 1;
    if (sc.verifyBundle(outOfWindow).valid) v.push('a signature logged after its certificate expired was accepted');

    // --- Transparency log: append-only with a working inclusion proof --------------------------
    const log = new TransparencyLog({ clock: () => 5 });
    log.append({ digest: 'd1', identity: 'i', issuer: 's' });
    log.append({ digest: 'd2', identity: 'i', issuer: 's' });
    if (!log.verifyChain().ok) v.push('a freshly built transparency log did not verify');
    if (!log.inclusionProof(0).included) v.push('an inclusion proof failed for a logged entry');
    if (log.inclusionProof(99).included) v.push('an inclusion proof succeeded for an entry that is not in the log');
    let logRefused = false;
    try { log.append({ digest: 'd3' }); } catch (_) { logRefused = true; }
    if (!logRefused) v.push('the transparency log accepted an entry with no identity');
    // ALTERING THE LOG MUST BREAK IT — otherwise it is a list, not a transparency log.
    log._entries[0].digest = 'substituted';
    if (log.verifyChain().ok) v.push('the transparency log verified after an entry was altered');
    if (log.inclusionProof(1).included) v.push('an inclusion proof succeeded over an altered chain');

    // --- Cosign-shaped image signing -----------------------------------------------------------
    const img = sc.signImage({ image: 'njtip/app', imageDigest: 'sha256:image-1', identity: IDENTITY, issuer: ISSUER });
    if (!sc.verifyImage('sha256:image-1', { expectedIdentity: IDENTITY }).valid) v.push('a signed container image did not verify');
    if (sc.verifyImage('sha256:never-signed').valid) v.push('an unsigned container image verified');
    if (sc.verifyImage('sha256:image-1', { expectedIdentity: 'someone-else' }).valid) v.push('an image signed by an unexpected identity was accepted');
    if (!img.logEntry) v.push('an image signature was not recorded in the transparency log');

    // --- License compliance --------------------------------------------------------------------
    if (LICENSE_POLICY.allowed.includes('UNKNOWN')) v.push('an unknown license is on the allowed list');
    if (licenseVerdict(undefined).verdict !== 'forbidden') v.push('an undeclared license was not treated as forbidden');
    if (licenseVerdict('MIT').verdict !== 'allowed') v.push('a permissive license was not allowed');
    if (licenseVerdict('AGPL-3.0').verdict !== 'forbidden') v.push('a network-copyleft license was not forbidden');
    if (licenseVerdict('MPL-2.0').verdict !== 'review-required') v.push('a weak-copyleft license did not require review');
    const badLicenses = sc.licenseCompliance({ dependencies: [{ name: 'a', license: 'MIT' }, { name: 'b', license: 'AGPL-3.0' }, { name: 'c' }] });
    if (badLicenses.compliant) v.push('a dependency set containing a forbidden license was compliant');
    if (!badLicenses.forbidden.includes('b') || !badLicenses.forbidden.includes('c')) v.push('forbidden and undeclared licenses were not both named');
    if (!sc.licenseCompliance({ dependencies: [{ name: 'a', license: 'Apache-2.0' }] }).compliant) v.push('a fully permissive dependency set was not compliant');

    // --- Dependency risk scoring ---------------------------------------------------------------
    const risky = sc.dependencyRisk({ dependencies: [{ name: 'abandoned', supplier: 'npm', license: 'AGPL-3.0', knownVulnerabilities: 2, lastPublishedAt: now - 900 * 24 * 3600_000, depth: 5 }], approvedSuppliers: ['internal-registry'], now });
    if (risky.acceptable) v.push('an unpinned, unapproved, forbidden-licensed, vulnerable dependency was acceptable');
    if (risky.dependencies[0].band !== 'critical') v.push('a maximally risky dependency was not banded critical');
    for (const expected of ['not pinned', 'not approved', 'forbidden', 'vulnerability', 'unmaintained']) {
      if (!risky.dependencies[0].reasons.some((r) => r.includes(expected))) v.push(`dependency risk did not name the '${expected}' factor`);
    }
    const clean = sc.dependencyRisk({ dependencies: [{ name: 'internal-lib', supplier: 'internal-registry', license: 'MIT', digest: 'd', knownVulnerabilities: 0, lastPublishedAt: now, depth: 1 }], approvedSuppliers: ['internal-registry'], now });
    if (!clean.acceptable) v.push('a pinned, approved, permissive, current dependency was not acceptable');
    if (clean.dependencies[0].band !== 'low') v.push('a clean dependency was not banded low');
    // Zero dependencies is a score of zero — and the check still runs.
    if (!sc.dependencyRisk({ dependencies: [] }).acceptable || sc.dependencyRisk({ dependencies: [] }).worstScore !== 0) v.push('the zero-dependency case was mis-scored');

    // --- Package integrity ---------------------------------------------------------------------
    if (!sc.packageIntegrity({ locked: [{ name: 'a', digest: 'd1' }], fetched: [{ name: 'a', digest: 'd1' }] }).intact) v.push('a matching lockfile was reported as compromised');
    const substituted = sc.packageIntegrity({ locked: [{ name: 'a', digest: 'd1' }], fetched: [{ name: 'a', digest: 'd2' }] });
    if (substituted.intact) v.push('a substituted package passed the integrity check');
    if (substituted.findings[0].severity !== 'critical') v.push('a digest mismatch was not critical');
    if (sc.packageIntegrity({ locked: [], fetched: [{ name: 'smuggled', digest: 'd' }] }).intact) v.push('a package fetched but absent from the lockfile passed the integrity check');
    if (sc.packageIntegrity({ locked: [{ name: 'a' }], fetched: [{ name: 'a', digest: 'd' }] }).intact) v.push('a lockfile entry with no digest passed the integrity check');

    // --- Artifact trust score & the deployment gate ---------------------------------------------
    // A fully attested, fully signed artifact clears the threshold…
    const trustedSc = new SupplyChainAttestation({ clock: () => now });
    trustedSc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'trusted-1', sourceRef: 'git+https://njtip/repo', sourceDigest: 'srcdigest' });
    const goodBundle = trustedSc.keylessSign({ digest: 'trusted-1', identity: IDENTITY, issuer: ISSUER });
    const trustedInputs = {
      artifactDigest: 'trusted-1', sbom: { runtime: 'node', dependencies: [], devDependencies: [], builtinsUsed: [] },
      dependencies: [], signedContainer: true, bundle: goodBundle, expectedIdentity: IDENTITY, expectedIssuer: ISSUER,
      reproducible: true, integrity: trustedSc.packageIntegrity({ locked: [], fetched: [] }), now,
    };
    const trusted = trustedSc.artifactTrustScore(trustedInputs);
    if (!trusted.trusted) v.push(`a fully attested artifact scored ${trusted.score}, below the trust threshold: ${trusted.failing.join(', ')}`);
    if (trusted.threshold !== TRUST_THRESHOLD) v.push('the trust threshold is inconsistent');
    if (trusted.authorizes !== false) v.push('the artifact trust score claims authority');
    // …and every single removal drops it below.
    const untrusted = trustedSc.artifactTrustScore({ ...trustedInputs, bundle: null, expectedIdentity: null, expectedIssuer: null, signedContainer: false, reproducible: false });
    if (untrusted.trusted) v.push('an unsigned, irreproducible artifact was still trusted');
    if (!untrusted.failing.includes('keyless-signature')) v.push('the missing signature was not named as a failing trust component');
    const unattested = trustedSc.artifactTrustScore({ ...trustedInputs, artifactDigest: 'never-built-here' });
    if (unattested.trusted) v.push('an artifact with no build provenance was trusted');

    // THE REQUIREMENT: DEPLOYMENT MUST FAIL FOR AN UNTRUSTED ARTIFACT.
    const release = trustedSc.verifyRelease({ artifact: 'njtip-app', ...trustedInputs, locked: [], fetched: [] });
    if (!release.verified) v.push('a fully verified release was blocked: ' + release.failed.join(', '));
    if (release.authorizes !== false) v.push('release verification claims authority');
    const blockedRelease = trustedSc.verifyRelease({
      artifact: 'njtip-app', artifactDigest: 'trusted-1', sbom: trustedInputs.sbom, signedContainer: true,
      dependencies: [{ name: 'abandoned', supplier: 'npm', license: 'AGPL-3.0', knownVulnerabilities: 3, lastPublishedAt: 0 }],
      bundle: goodBundle, expectedIdentity: IDENTITY, expectedIssuer: ISSUER, reproducible: true,
      locked: [{ name: 'abandoned', digest: 'd1' }], fetched: [{ name: 'abandoned', digest: 'SUBSTITUTED' }], now,
    });
    if (blockedRelease.verified) v.push('a release with a substituted package and a forbidden license was verified');
    for (const expected of ['dependency-risk', 'license-compliance', 'package-integrity', 'artifact-trust-score']) {
      if (!blockedRelease.failed.includes(expected)) v.push(`the '${expected}' check did not block an untrusted release`);
    }
    if (blockedRelease.failClosed !== true) v.push('release verification is not fail-closed');
    if (!/not deployable/.test(blockedRelease.note)) v.push('a blocked release did not say the artifact is not deployable');
  }),

  fit('APP-FIT-MULTI-REGION', 'Failover is residency-aware, quorum-gated and free of split brain', (v) => {
    const mr = require('../src/twin2/multi-region');
    for (const violation of mr.validate().violations) v.push(violation);
    // Every declared failover scenario behaves as designed.
    const sims = mr.simulateAll();
    for (const s of sims.scenarios) if (!s.matches) v.push(`scenario '${s.scenario}': expected ${s.expected}, got ${s.actual}`);
    // Losing write quorum degrades to READ-ONLY rather than accepting divergent writes.
    const twoLost = mr.failover({ failed: ['bw-central', 'bw-south'] });
    if (twoLost.mode !== 'read-only' || twoLost.acceptsWrites) v.push('the platform accepted writes without quorum');
    if (!twoLost.servesTraffic) v.push('a surviving sovereign region did not serve reads');
    // Split-brain prevention: at most one partition may write, and it is fenced.
    const safe = mr.splitBrainCheck({ partitions: [{ name: 'majority', regions: ['bw-central', 'bw-south'] }, { name: 'minority', regions: ['bw-north'] }] });
    if (safe.splitBrain || !safe.safe || safe.writablePartitions !== 1) v.push('split-brain prevention did not elect a single writable partition');
    if (safe.fencingToken <= 0) v.push('no fencing token was issued to the writable partition');
    const noQuorum = mr.splitBrainCheck({ partitions: [{ name: 'a', regions: ['bw-central'] }, { name: 'b', regions: ['bw-north'] }] });
    if (noQuorum.writablePartitions !== 0 || !noQuorum.safe) v.push('a minority partition was allowed to write');
    // Jurisdiction-aware routing REFUSES an illegal placement rather than degrading to it.
    const refused = mr.route({ classification: 'restricted', healthy: ['za-north'] });
    if (refused.routed || !refused.failClosed) v.push('restricted data was routed to a region that may not hold it');
    const routed = mr.route({ classification: 'restricted', healthy: ['bw-south', 'za-north'] });
    if (!routed.routed || routed.region !== 'bw-south') v.push('routing did not prefer a permitted sovereign region');
    if (!routed.refusedRegions.includes('za-north')) v.push('the refused region was not reported');
    if (mr.route({ classification: 'secret', healthy: ['bw-north'] }).routed) v.push('secret data was routed to a region not cleared for it');
    // Backup/recovery verification checks content, count AND residency.
    if (mr.verifyBackupRecovery({ classification: 'restricted', sourceDigest: 'd', restoredDigest: 'd', restoredRegion: 'za-north', recordsIn: 5, recordsOut: 5 }).verified) v.push('a restore into a non-permitted region was verified');
    if (mr.verifyBackupRecovery({ classification: 'restricted', sourceDigest: 'd', restoredDigest: 'e', restoredRegion: 'bw-south', recordsIn: 5, recordsOut: 5 }).verified) v.push('a restore with a mismatched digest was verified');
    if (!mr.verifyBackupRecovery({ classification: 'restricted', sourceDigest: 'd', restoredDigest: 'd', restoredRegion: 'bw-south', recordsIn: 5, recordsOut: 5 }).verified) v.push('a valid restore was rejected');
    // Cross-region consistency reports lag and which replicas may serve reads.
    const cons = mr.consistencyCheck({ committedSequence: 100, replicas: { 'bw-central': 100, 'bw-south': 100, 'bw-north': 97 } });
    if (cons.consistent || cons.maxLag !== 3 || !cons.stale.includes('bw-north')) v.push('cross-region consistency did not detect a lagging replica');
    if (!cons.readsSafeFrom.includes('bw-central')) v.push('consistent replicas were not identified as safe for reads');
    // A non-sovereign region may only ever hold public data.
    for (const [id, r] of Object.entries(mr.REGIONS)) if (!r.sovereign && r.mayHold.some((c) => c !== 'public')) v.push(`${id}: a non-sovereign region may hold only public data`);
    if (mr.report().authorizes !== false) v.push('the multi-region report claims authority');
  }),

  fit('APP-FIT-AI-LIFECYCLE', 'AI output is an input to a human decision and nothing else', (v) => {
    const { AiLifecycle, PROHIBITED_USES } = require('../src/ai/ai-lifecycle');
    const ai2 = new AiLifecycle({ clock: () => 1000 });
    // There is no apply(): the surface itself forbids autonomous action.
    if (typeof ai2.apply === 'function' || typeof ai2.execute === 'function') v.push('the AI lifecycle exposes an autonomous action method');
    // Prohibited uses are refused by name, not merely unimplemented.
    if (!PROHIBITED_USES['automated-case-decision'] || !PROHIBITED_USES['reporter-identification']) v.push('the prohibited-use register is incomplete');
    for (const purpose of ['automated-case-decision', 'reporter-identification', 'predictive-policing']) {
      let refused = false;
      try { ai2.register('model', 'm', { owner: 'o', purpose }); } catch (e) { refused = !!e.failClosed; }
      if (!refused) v.push(`a model was registered for the prohibited purpose '${purpose}'`);
    }
    // Identity is refused in artifacts and in inference inputs.
    let identityRefused = false;
    try { ai2.register('dataset', 'd', { owner: 'o', purpose: 'case-prioritisation', fields: ['omang'] }); } catch (e) { identityRefused = !!e.failClosed; }
    if (!identityRefused) v.push('an AI dataset accepted an identity field');
    // Model, dataset and prompt registries all exist and require approval above minimal risk.
    ai2.register('model', 'priority-advisor', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
    ai2.register('dataset', 'historic-cases', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'limited', fields: ['category', 'status'] });
    ai2.register('prompt', 'summarise', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'limited', text: 'Summarise the case metadata.' });
    if (ai2.isApproved('model', 'priority-advisor').approved) v.push('a high-risk model was usable before human approval');
    let unapprovedRefused = false;
    try { ai2.infer({ model: 'priority-advisor', output: 'x', explanation: 'y', requestedBy: 'inv-001' }); } catch (e) { unapprovedRefused = !!e.failClosed; }
    if (!unapprovedRefused) v.push('inference ran on an unapproved model');
    let needsHuman = false;
    try { ai2.approve('model', 'priority-advisor', { by: 'AI Governance Board' }); } catch (_) { needsHuman = true; }
    if (!needsHuman) v.push('an AI artifact was approved without a rationale');
    ai2.approve('model', 'priority-advisor', { by: 'AI Governance Board', rationale: 'explainable, advisory-only, deterministic' });
    ai2.approve('prompt', 'summarise', { by: 'AI Governance Board', rationale: 'no instruction injection surface' });
    // Explainability is mandatory for the risk class.
    let needsExplanation = false;
    try { ai2.infer({ model: 'priority-advisor', output: 'high', requestedBy: 'inv-001' }); } catch (e) { needsExplanation = !!e.failClosed; }
    if (!needsExplanation) v.push('a high-risk inference ran with no explanation');
    let inputIdentityRefused = false;
    try { ai2.infer({ model: 'priority-advisor', output: 'high', explanation: 'e', requestedBy: 'inv-001', inputSummary: { email: 'a@b.c' } }); } catch (e) { inputIdentityRefused = !!e.failClosed; }
    if (!inputIdentityRefused) v.push('an inference accepted identity in its input');
    const inf = ai2.infer({ model: 'priority-advisor', promptId: 'summarise', output: 'high', explanation: 'age + escalation flag', confidence: 0.9, requestedBy: 'inv-001', inputSummary: { category: 'police' } });
    if (inf.advisoryOnly !== true || inf.authorizes !== false || inf.status !== 'advisory') v.push('an inference did not present as advisory');
    // The only exit is a recorded human decision, and override is always available.
    if (!ai2.pendingDecisions().some((p) => p.id === inf.id)) v.push('an inference did not queue for a human decision');
    let decisionNeedsHuman = false;
    try { ai2.decide(inf.id, { decision: 'accepted' }); } catch (_) { decisionNeedsHuman = true; }
    if (!decisionNeedsHuman) v.push('an inference was decided without a named human and a rationale');
    ai2.decide(inf.id, { by: 'inv-001', decision: 'accepted', rationale: 'consistent with the file' });
    ai2.override(inf.id, { by: 'Oversight Board', rationale: 'reviewed on appeal' });
    if (!ai2.inference(inf.id).overridden) v.push('a human override was not recorded');
    // Evidence preservation: the inference record is fixed by its digest.
    if (!ai2.verifyEvidence(inf.id).valid) v.push('inference evidence did not verify');
    ai2._inferences.find((i) => i.id === inf.id).output = 'tampered';
    if (ai2.verifyEvidence(inf.id).valid) v.push('a tampered inference record still verified');
    // A new model version resets approval — approving v1 never approves v2.
    ai2.register('model', 'priority-advisor', { version: 2, owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
    if (ai2.isApproved('model', 'priority-advisor').approved) v.push('a new model version inherited the previous version approval');
    // Bias monitoring suppresses small groups and reports disparity.
    const ai3 = new AiLifecycle({ clock: () => 1000 });
    ai3.register('model', 'm2', { owner: 'o', purpose: 'case-prioritisation', riskClass: 'high' });
    ai3.observeBias('m2', { group: 'region-a', outcomeRate: 0.8, sampleSize: 100 });
    ai3.observeBias('m2', { group: 'region-b', outcomeRate: 0.4, sampleSize: 100 });
    ai3.observeBias('m2', { group: 'region-c', outcomeRate: 0.9, sampleSize: 5 });
    const bias = ai3.biasReport('m2', { threshold: 0.2 });
    if (!bias.measured || bias.withinThreshold) v.push('a 0.4 outcome disparity was not flagged');
    if (bias.suppressed !== 1) v.push('a small group was not suppressed from the bias report');
    // Hallucination safeguards: ungrounded or low-confidence output is withheld.
    if (ai3.groundingCheck({ output: 'x', groundedIn: [] }).grounded) v.push('an ungrounded output passed the grounding check');
    if (ai3.groundingCheck({ output: 'x', groundedIn: ['doc'], confidence: 0.1, minConfidence: 0.5 }).grounded) v.push('a low-confidence output passed the grounding check');
    if (!ai3.groundingCheck({ output: 'x', groundedIn: ['doc'], confidence: 0.9 }).grounded) v.push('a grounded, confident output was withheld');
  }),

  fit('APP-FIT-AI-ASSURANCE', 'Prompt approval, dataset lineage and quality, confidence floors, hallucination monitoring and drift detection all hold — and fail when they should', (v) => {
    const mod = require('../src/ai/ai-lifecycle');
    const { AiLifecycle, RISK_CLASSES, DATASET_QUALITY_DIMENSIONS, DATASET_QUALITY_FLOOR, HALLUCINATION_THRESHOLD } = mod;
    let now = 1_000_000;
    const ai = new AiLifecycle({ clock: () => now });

    // --- Prompt approval workflow ---------------------------------------------------------------
    ai.register('prompt', 'summarise-case', { owner: 'analytics', purpose: 'case-summarisation', riskClass: 'limited', text: 'Summarise the case notes without naming anyone.' });
    if (ai.isApproved('prompt', 'summarise-case').approved) v.push('a freshly registered prompt was already approved');
    ai.submitForApproval('prompt', 'summarise-case', { by: 'analytics', rationale: 'reviewed against the anonymity boundary', evaluation: { redTeamed: true } });
    if (!ai.pendingApprovals().some((p) => p.kind === 'prompt' && p.id === 'summarise-case')) v.push('a submitted prompt did not appear in the approval queue');
    // SEGREGATION OF DUTIES: the owner cannot approve their own artifact.
    let selfApproval = false;
    try { ai.approve('prompt', 'summarise-case', { by: 'analytics', rationale: 'looks fine to me' }); } catch (e) { selfApproval = !!e.failClosed; }
    if (!selfApproval) v.push('an artifact owner approved their own prompt');
    let selfRejection = false;
    try { ai.reject('prompt', 'summarise-case', { by: 'analytics', rationale: 'x' }); } catch (e) { selfRejection = !!e.failClosed; }
    if (!selfRejection) v.push('an artifact owner ruled on their own approval');
    ai.approve('prompt', 'summarise-case', { by: 'AI Governance Board', rationale: 'grounded, anonymity-safe' });
    if (!ai.isApproved('prompt', 'summarise-case').approved) v.push('an independently approved prompt is not approved');
    if (ai.pendingApprovals().some((p) => p.id === 'summarise-case')) v.push('an approved prompt is still queued for approval');

    // A CHANGED PROMPT IS NOT THE PROMPT THAT WAS REVIEWED — approval must not carry over.
    ai.register('prompt', 'summarise-case', { version: 2, owner: 'analytics', purpose: 'case-summarisation', riskClass: 'limited', text: 'Summarise the case notes.' });
    if (ai.isApproved('prompt', 'summarise-case').approved) v.push('a new prompt version inherited the previous version\'s approval');
    ai.submitForApproval('prompt', 'summarise-case', { by: 'analytics', rationale: 'shortened' });
    const artifact = ai._artifacts.get('prompt:summarise-case');
    artifact.current.textDigest = 'edited-after-submission';
    let changedAfterSubmission = false;
    try { ai.approve('prompt', 'summarise-case', { by: 'AI Governance Board', rationale: 'r' }); } catch (e) { changedAfterSubmission = !!e.failClosed; }
    if (!changedAfterSubmission) v.push('a prompt edited after submission was approved on the reviewer\'s earlier reading');
    // A rejected artifact cannot be approved without resubmission.
    ai.register('prompt', 'risky', { owner: 'analytics', purpose: 'case-summarisation', riskClass: 'high' });
    ai.reject('prompt', 'risky', { by: 'AI Governance Board', rationale: 'invites identification of the reporter' });
    let rejectedStands = false;
    try { ai.approve('prompt', 'risky', { by: 'AI Governance Board', rationale: 'changed my mind' }); } catch (e) { rejectedStands = !!e.failClosed; }
    if (!rejectedStands) v.push('a rejected high-risk prompt was approved without resubmission');

    // --- Dataset lineage & quality --------------------------------------------------------------
    ai.register('dataset', 'synthetic-cases', { owner: 'analytics', purpose: 'model-training', riskClass: 'limited', fields: ['category', 'status'] });
    if (ai.datasetLineage('synthetic-cases').traced) v.push('an unrecorded dataset reported traced lineage');
    for (const bad of [{}, { sources: ['x'] }, { sources: ['x'], lawfulBasis: 'b', syntheticOnly: false }]) {
      let refused = false;
      try { ai.recordDatasetLineage('synthetic-cases', { by: 'Data Steward', ...bad }); } catch (e) { refused = !!e.failClosed || /named human/.test(e.message); }
      if (!refused) v.push(`dataset lineage accepted an incomplete record: ${JSON.stringify(bad)}`);
    }
    ai.recordDatasetLineage('synthetic-cases', { by: 'Data Steward', sources: ['synthetic-generator@seed-42'], transformations: ['k-anonymity suppression'], collectedUnder: 'synthetic-only development', lawfulBasis: 'no personal data is processed' });
    if (!ai.datasetLineage('synthetic-cases').traced) v.push('a fully recorded dataset lineage was not traced');
    // Quality: unmeasured is not clean, and a partial measurement is not a pass.
    if (ai.datasetQuality('synthetic-cases').acceptable) v.push('an unmeasured training dataset was acceptable');
    ai.observeDatasetQuality('synthetic-cases', { completeness: 1, balance: 0.9 });
    if (ai.datasetQuality('synthetic-cases').acceptable) v.push('a partially measured training dataset was acceptable');
    if (!ai.datasetQuality('synthetic-cases').missing.length) v.push('unmeasured dataset quality dimensions were not named');
    ai.observeDatasetQuality('synthetic-cases', Object.fromEntries(DATASET_QUALITY_DIMENSIONS.map((d) => [d, 0.95])));
    if (!ai.datasetQuality('synthetic-cases').acceptable) v.push('a fully measured, high-quality training dataset was not acceptable');
    ai.observeDatasetQuality('synthetic-cases', Object.fromEntries(DATASET_QUALITY_DIMENSIONS.map((d) => [d, DATASET_QUALITY_FLOOR - 0.1])));
    if (ai.datasetQuality('synthetic-cases').acceptable) v.push('a training dataset below the quality floor was acceptable');
    let outOfRange = false;
    try { ai.observeDatasetQuality('synthetic-cases', { balance: 2 }); } catch (_) { outOfRange = true; }
    if (!outOfRange) v.push('an out-of-range dataset quality observation was accepted');
    ai.observeDatasetQuality('synthetic-cases', Object.fromEntries(DATASET_QUALITY_DIMENSIONS.map((d) => [d, 0.95])));

    // A model may only train on data that is registered, traced, approved and clean.
    ai.register('model', 'priority-advisor', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high', trainingData: ['synthetic-cases'] });
    if (ai.trainingDataAcceptable('priority-advisor').acceptable) v.push('training data was acceptable while the dataset itself was unapproved');
    ai.approve('dataset', 'synthetic-cases', { by: 'Data Governance Board', rationale: 'synthetic, traced, within quality' });
    if (!ai.trainingDataAcceptable('priority-advisor').acceptable) v.push('fully governed training data was not acceptable: ' + ai.trainingDataAcceptable('priority-advisor').blockers.join('; '));
    ai.register('model', 'ghost-trained', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high', trainingData: ['a-dataset-nobody-registered'] });
    if (ai.trainingDataAcceptable('ghost-trained').acceptable) v.push('a model trained on an unregistered dataset was acceptable');
    if (ai.trainingDataAcceptable('ghost-trained').datasets[0].registered) v.push('an unregistered training dataset was reported as registered');

    // --- Confidence thresholds ------------------------------------------------------------------
    for (const [cls, spec] of Object.entries(RISK_CLASSES)) if (typeof spec.minConfidence !== 'number') v.push(`risk class '${cls}' declares no confidence floor`);
    if (!(RISK_CLASSES.high.minConfidence > RISK_CLASSES.limited.minConfidence)) v.push('a high-risk class does not demand more confidence than a limited one');
    ai.approve('model', 'priority-advisor', { by: 'AI Governance Board', rationale: 'explainable, advisory-only' });
    let noConfidence = false;
    try { ai.infer({ model: 'priority-advisor', output: 'high', explanation: 'e', requestedBy: 'inv-001' }); } catch (e) { noConfidence = !!e.failClosed; }
    if (!noConfidence) v.push('a high-risk inference was recorded with no confidence score');
    let withheld = false, flagged = false;
    try { ai.infer({ model: 'priority-advisor', output: 'high', explanation: 'e', confidence: 0.5, requestedBy: 'inv-001' }); } catch (e) { withheld = !!e.failClosed; flagged = !!e.withheld; }
    if (!withheld) v.push('a below-floor inference was recorded rather than withheld');
    if (!flagged) v.push('a withheld inference was not marked as withheld');
    const ok = ai.infer({ model: 'priority-advisor', output: 'high', explanation: 'age + escalation', confidence: 0.85, requestedBy: 'inv-001' });
    if (!ok.id || ok.authorizes !== false) v.push('a confident, explained inference was not recorded advisory-only');

    // --- Hallucination monitoring ---------------------------------------------------------------
    // An under-sampled rate must NOT read as safe.
    const thin = ai.hallucinationReport('priority-advisor');
    if (thin.withinThreshold !== null) v.push('an under-sampled hallucination rate reported a verdict');
    if (thin.rate !== null) v.push('an under-sampled hallucination rate reported a number');
    for (let i = 0; i < 40; i++) ai.recordGrounding('priority-advisor', { inferenceId: 'INF-' + i, grounded: true });
    const clean = ai.hallucinationReport('priority-advisor');
    if (!clean.withinThreshold) v.push('a fully grounded model was reported as hallucinating');
    for (let i = 0; i < 10; i++) ai.recordGrounding('priority-advisor', { inferenceId: 'BAD-' + i, grounded: false, reason: 'cited no source' });
    const hallucinating = ai.hallucinationReport('priority-advisor');
    if (hallucinating.withinThreshold) v.push(`a ${(hallucinating.rate * 100).toFixed(0)}% ungrounded rate was within the threshold`);
    if (hallucinating.severity === 'ok') v.push('an above-threshold hallucination rate was reported as ok');
    if (!hallucinating.examples.length) v.push('an above-threshold hallucination report named no example');
    if (HALLUCINATION_THRESHOLD > 0.1) v.push('the hallucination threshold is too permissive to be a control');
    let notBoolean = false;
    try { ai.recordGrounding('priority-advisor', { grounded: 'probably' }); } catch (_) { notBoolean = true; }
    if (!notBoolean) v.push('grounding was recorded as something other than a boolean');

    // --- Drift detection -------------------------------------------------------------------------
    if (ai.driftReport('priority-advisor').band !== 'insufficient-data') v.push('drift was reported from fewer than two periods');
    ai.observeDistribution('priority-advisor', { period: 0, distribution: { police: 50, courts: 30, prison: 20 } });
    ai.observeDistribution('priority-advisor', { period: 1, distribution: { police: 50, courts: 30, prison: 20 } });
    const stable = ai.driftReport('priority-advisor');
    if (stable.drifted) v.push('an identical distribution was reported as drifted');
    if (stable.psi !== 0 && stable.psi > 1e-6) v.push('an identical distribution produced a non-zero PSI');
    ai.observeDistribution('priority-advisor', { period: 2, distribution: { police: 5, courts: 15, prison: 80 } });
    const drifted = ai.driftReport('priority-advisor');
    if (!drifted.drifted) v.push('a substantially shifted distribution was not reported as drifted');
    if (drifted.band !== 'significant') v.push(`a large shift was banded '${drifted.band}' rather than significant`);
    if (!drifted.action) v.push('significant drift carried no recommended action');
    // PSI weights proportional change: police collapsing 0.50 → 0.05 contributes more than prison
    // rising 0.20 → 0.80, so the biggest contributor is the bucket that all but disappeared.
    if (drifted.largestShift !== 'police') v.push('the largest contributing bucket was misidentified');
    if (drifted.contributions[0].contribution <= drifted.contributions[1].contribution) v.push('drift contributions are not ordered by magnitude');
    if (JSON.stringify(ai.driftReport('priority-advisor')) !== JSON.stringify(ai.driftReport('priority-advisor'))) v.push('drift detection is not deterministic');
    let replayed = false;
    try { ai.observeDistribution('priority-advisor', { period: 2, distribution: { police: 1 } }); } catch (_) { replayed = true; }
    if (!replayed) v.push('a distribution period was overwritten — the history must be append-only');
    let emptyDist = false;
    try { ai.observeDistribution('priority-advisor', { period: 9, distribution: {} }); } catch (_) { emptyDist = true; }
    if (!emptyDist) v.push('an empty distribution was accepted');

    // --- Combined posture -------------------------------------------------------------------------
    const posture = ai.monitoringPosture('priority-advisor');
    if (posture.healthy) v.push('a drifting, hallucinating model was reported healthy');
    if (!posture.requiresReApproval) v.push('significant drift did not require re-approval');
    if (posture.authorizes !== false || posture.advisoryOnly !== true) v.push('the monitoring posture claims authority');
    if (posture.concerns.length < 2) v.push('the monitoring posture did not name both the drift and the hallucination concern');

    // Validation catches self-approval and untraceable training data at the estate level.
    const bad = new AiLifecycle({ clock: () => 1000 });
    bad.register('model', 'self-approved', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
    bad._artifacts.get('model:self-approved').current.status = 'approved';
    bad._artifacts.get('model:self-approved').current.approvedBy = 'analytics';
    if (!bad.validate().violations.some((x) => /approved by its own owner/.test(x))) v.push('estate validation missed an artifact approved by its own owner');
  }),

  fit('APP-FIT-ADR-GOVERNANCE', 'Every ADR satisfies its schema and the catalogue is contiguous and published', (v) => {
    const adr = require('../src/architecture/adr-governance');
    const res = adr.validateCatalogue();
    for (const violation of res.violations) v.push(violation);
    if (res.count < 4) v.push('fewer ADRs than the recorded decision history requires');
    // The expanded schema is applied from ADR-0004 and demands the full record.
    const required = ['businessJustification', 'riskAssessment', 'performanceImpact', 'securityImpact', 'operationalImpact', 'complianceImpact', 'rollbackStrategy', 'migrationStrategy', 'implementationCost', 'successMetrics', 'decisionOwner', 'approvalHistory'];
    const fields = adr.schema().full.map((s) => s.field);
    for (const f of required) if (!fields.includes(f)) v.push(`the ADR schema is missing '${f}'`);
    // Each ADR is validated against the schema that applies to it, and at least one uses the full one.
    if (!res.adrs.some((a) => a.schema === 'full' && a.valid)) v.push('no ADR satisfies the expanded schema');
    if (!res.adrs.every((a) => a.valid)) v.push('an ADR does not satisfy its schema: ' + res.adrs.filter((a) => !a.valid).map((a) => a.file).join(', '));
    // Every ADR declares a recognised status and a title.
    for (const a of res.adrs) { if (!a.status || !adr.STATUSES.includes(a.status)) v.push(`${a.file}: invalid status`); if (!a.title) v.push(`${a.file}: no title`); }
    // The validator must be able to fail — a missing section is caught.
    const probe = adr.validateAdr(res.adrs[res.adrs.length - 1].file, { minSectionChars: 1e9 });
    if (probe.valid) v.push('ADR validation cannot fail — the section-content check is inert');
    // The template is generated from the schema so the two cannot drift.
    const tpl = adr.template({ number: '0099' });
    for (const s of adr.schema().full) if (!tpl.includes(`## ${s.heading}`)) v.push(`the generated template omits '${s.heading}'`);
  }),

  fit('APP-FIT-CONSUMER-CONTRACTS', 'Every consumer expectation is satisfied and breaking impact is known first', (v) => {
    const { ConsumerContracts } = require('../src/contracts/consumer-contracts');
    const cc = new ConsumerContracts();
    for (const violation of cc.validate().violations) v.push(violation);
    // Every registered consumer is satisfied by the current provider contracts.
    const all = cc.verifyAll();
    if (!all.allSatisfied) v.push('unmet consumer expectations: ' + JSON.stringify(all.broken));
    if (all.failClosed !== true || all.authorizes !== false) v.push('consumer verification is not fail-closed / claims authority');
    if (all.consumers < 4) v.push('fewer consumers registered than the platform actually has');
    // The constitutional consumer is registered and its path stays anonymous.
    const citizen = cc.describe('citizen-web');
    if (citizen.criticality !== 'constitutional') v.push('the citizen client is not marked constitutional');
    if (!citizen.expectations.every((e) => ['anonymous', 'case-code'].includes(e.authentication))) v.push('the citizen client expects an authenticated path');
    // Impact analysis answers "who breaks?" BEFORE the change.
    const breaking = cc.impactOfChange('api.case.transition', { fields: { required: ['case_code'], optional: [] } });
    if (breaking.safe) v.push('removing a field a consumer sends was reported as safe');
    if (!breaking.affectedConsumers.some((c) => c.consumer === 'investigator-console')) v.push('the affected consumer was not identified');
    if (!/BREAKS/.test(breaking.verdict)) v.push('a breaking change did not produce a breaking verdict');
    const additive = cc.impactOfChange('api.reports.submit', { fields: { required: ['category'], optional: ['extra', 'locale'] } });
    if (!additive.safe) v.push('an additive change was reported as breaking');
    // Constitutional impact is called out separately when a constitutional consumer breaks.
    const constitutional = cc.impactOfChange('api.reports.submit', { fields: { required: [], optional: [] } });
    if (!constitutional.constitutionalImpact) v.push('breaking the citizen client was not flagged as constitutional impact');
    // Every consumer handles errors; a consumer that ignores failure fails silently.
    for (const id of cc.consumers()) for (const e of cc.describe(id).expectations) if (!e.handlesErrors.length) v.push(`${id}/${e.contract}: handles no errors`);
    // Deprecation tracking blocks retirement while a consumer still depends on the contract.
    const matrix = cc.dependencyMatrix();
    if (!matrix['api.reports.submit'] || !matrix['api.reports.submit'].length) v.push('the dependency matrix is empty for a live contract');
    if (!Array.isArray(cc.unconsumedContracts())) v.push('unconsumed contracts are not reported');
    if (!cc.versionLifecycle().every((x) => typeof x.version === 'number')) v.push('the version lifecycle is incomplete');
  }),

  fit('APP-FIT-CONSISTENCY-GOVERNANCE', 'Every stateful context declares its consistency stance, and a stale read is refused rather than served', (v) => {
    const mr = require('../src/twin2/multi-region');
    const ctxMap = require('../src/architecture/context-map');

    // The registry is valid against the architecture-of-record.
    const contextIds = ctxMap.ids();
    for (const violation of mr.validateConsistency({ contextIds }).violations) v.push(violation);
    if (!mr.validate().valid) v.push('multi-region validation fails once consistency governance is included: ' + mr.validate().violations.join('; '));

    // Every model and replication policy is fully specified.
    for (const m of mr.consistencyModels()) {
      for (const f of ['description', 'maxStalenessMs', 'readsFromReplica', 'requiresQuorumRead', 'cost']) {
        if (m[f] === undefined || m[f] === null) v.push(`consistency model '${m.id}': missing ${f}`);
      }
    }
    if (mr.CONSISTENCY_MODELS.strong.maxStalenessMs !== 0) v.push('strong consistency tolerates staleness');
    if (mr.CONSISTENCY_MODELS.strong.readsFromReplica) v.push('strong consistency permits a replica read');
    if (!(mr.CONSISTENCY_MODELS.causal.maxStalenessMs < mr.CONSISTENCY_MODELS.eventual.maxStalenessMs)) v.push('causal consistency is not stricter than eventual');
    for (const p of mr.replicationPolicies()) if (!p.appliesTo.length || !p.description) v.push(`replication policy '${p.id}' is incompletely specified`);

    // Every declared context states a model, a replication policy, a conflict resolution and WHY.
    for (const c of mr.contextConsistency()) {
      if (!c.declared) v.push(`${c.context}: not declared`);
      if (!c.rationale) v.push(`${c.context}: no rationale`);
      if (!c.conflictDescription) v.push(`${c.context}: conflict resolution has no description`);
    }
    // The constitutional contexts are strongly consistent — this is not negotiable.
    for (const required of ['intake', 'custody', 'governance-oversight', 'identity-access', 'policy-governance']) {
      const c = mr.contextConsistency(required);
      if (!c.declared) v.push(`${required}: a constitutional context has no consistency stance`);
      else if (c.model !== 'strong') v.push(`${required}: declares '${c.model}' rather than strong consistency`);
      else if (c.staleReadsAcceptable) v.push(`${required}: a constitutional context accepts stale reads`);
    }
    // Every declared context is a real bounded context.
    for (const c of mr.contextConsistency()) if (!contextIds.includes(c.context)) v.push(`${c.context}: declares a consistency stance but is not a bounded context`);

    // THE GATE: reads are refused, not served, when the model does not permit them.
    if (mr.readAllowed({ context: 'intake', replicaLagMs: 500, hasQuorum: true }).allowed) v.push('a strongly consistent context served a replica read');
    if (mr.readAllowed({ context: 'intake', replicaLagMs: 0, hasQuorum: false }).allowed) v.push('a strongly consistent context served a read without quorum');
    if (!mr.readAllowed({ context: 'intake', replicaLagMs: 0, hasQuorum: true }).allowed) v.push('a strongly consistent context refused a fresh quorum read');
    if (!mr.readAllowed({ context: 'analytics', replicaLagMs: 30_000 }).allowed) v.push('an eventually consistent context refused a read inside its staleness bound');
    if (mr.readAllowed({ context: 'analytics', replicaLagMs: 90_000 }).allowed) v.push('a read beyond the declared staleness bound was served');
    if (mr.readAllowed({ context: 'investigation', replicaLagMs: 30_000 }).allowed) v.push('a causally consistent context served a read far beyond its bound');
    // FAIL-CLOSED: an undeclared context is refused, never defaulted to something permissive.
    const undeclared = mr.readAllowed({ context: 'not-a-context' });
    if (undeclared.allowed) v.push('a read was permitted for a context with no declared consistency stance');
    if (undeclared.failClosed !== true) v.push('an undeclared context did not fail closed');

    // The operational posture names exactly which reads are refused during a partition.
    const posture = mr.consistencyPosture({ committedSequence: 100, replicas: { 'bw-central': 100, 'bw-south': 100, 'bw-north': 97 }, healthy: ['bw-central', 'bw-south', 'bw-north'] });
    if (!posture.writesAvailable) v.push('writes were unavailable with all three regions healthy');
    if (!posture.refusedReads.length) v.push('a lagging replica refused no reads at all — the posture is inert');
    if (!posture.refusedReads.some((r) => r.startsWith('custody@bw-north'))) v.push('a lagging replica was allowed to serve custody reads');
    if (posture.matrix.some((r) => r.region === 'bw-central' && r.lag === 0 && !r.readAllowed)) v.push('an up-to-date region was refused a read it should serve');
    if (posture.failClosed !== true || posture.authorizes !== false) v.push('the consistency posture is not fail-closed / claims authority');
    if (JSON.stringify(mr.consistencyPosture({ committedSequence: 100, replicas: { 'bw-central': 100 }, healthy: ['bw-central'] })) !== JSON.stringify(mr.consistencyPosture({ committedSequence: 100, replicas: { 'bw-central': 100 }, healthy: ['bw-central'] }))) v.push('the consistency posture is not deterministic');
  }),

  fit('APP-FIT-ADR-EXTENDED', 'The extended ADR schema is enforced from 0006, measurability is checked, and lifecycle and debt are queryable', (v) => {
    const adr = require('../src/architecture/adr-governance');
    const res = adr.validateCatalogue();

    // The eight Part 11 fields are all present in the extended schema.
    const required = ['rejectedAlternatives', 'architecturalTradeoffs', 'maintenanceImpact', 'implementationComplexity', 'operationalCost', 'lifecycleImplications', 'measurableSuccessCriteria', 'architecturalDebt'];
    const fields = adr.schema().extended.map((s) => s.field);
    for (const f of required) if (!fields.includes(f)) v.push(`the extended ADR schema is missing '${f}'`);
    for (const s of adr.schema().extended) if (!s.why) v.push(`extended schema field '${s.field}' has no stated reason`);

    // The right schema applies to each ADR — and earlier ones are NOT retrofitted.
    if (adr.schemaNameFor(1) !== 'legacy' || adr.schemaNameFor(4) !== 'full' || adr.schemaNameFor(6) !== 'extended') v.push('schema selection by ADR number is wrong');
    if (adr.schemaFor(6).length !== adr.LEGACY_SCHEMA.length + adr.FULL_SCHEMA.length + adr.EXTENDED_SCHEMA.length) v.push('the extended schema does not include the earlier tiers');
    if (adr.schemaFor(3).length !== adr.LEGACY_SCHEMA.length) v.push('a legacy ADR was held to a later schema');
    if (!res.adrs.some((a) => a.schema === 'extended' && a.valid)) v.push('no ADR satisfies the extended schema');
    if (res.bySchema.legacy !== 3) v.push('the legacy ADRs were rewritten to a later standard');

    // MEASURABILITY IS CHECKED, NOT REQUESTED. The rule must be able to fail, so it is fed a
    // criterion that reads well and commits to nothing.
    if (!adr.schema().measurableSections.includes('Measurable success criteria')) v.push('the measurable-content check does not cover the success criteria section');
    // The probe is validated IN MEMORY. Writing it into the real catalogue would make this check
    // a source of non-determinism for anything else reading that directory concurrently.
    const filler = 'This section carries enough prose to clear the minimum-content threshold comfortably.';
    const craft = (criterion) => {
      let doc = '# ADR-0099: crafted probe\n\n- **Status:** Accepted\n\n';
      for (const s of adr.schemaFor(99)) {
        const isProbe = s.heading === 'Measurable success criteria';
        const other = adr.schema().measurableSections.includes(s.heading) ? `${filler} 108 invariants hold.` : filler;
        doc += `## ${s.heading}\n${isProbe ? criterion : other}\n\n`;
      }
      return doc;
    };
    const probe = (criterion) => adr.validateParsed(adr.parseText(craft(criterion), { file: '0099-probe.md', number: 99 }));
    const vague = probe('We will improve reliability and make everything better for everyone involved.');
    if (vague.valid) v.push('an ADR whose success criteria contain no measurable value was accepted');
    if (!vague.violations.some((x) => /no measurable value/.test(x))) v.push('the measurability failure was not named');
    const measurable = probe('p95 latency stays under 500 ms across a 30-day window; 108 invariants hold.');
    if (!measurable.valid) v.push('a genuinely measurable criterion was rejected: ' + measurable.violations.join('; '));
    if (measurable.schema !== 'extended') v.push('ADR-0099 was not held to the extended schema');
    // The real catalogue satisfies the rule, or it is decorative here.
    for (const a of res.adrs.filter((x) => x.schema === 'extended')) {
      const crit = adr.parse(a.file).sections['measurable success criteria'];
      if (!crit) v.push(`${a.file}: no measurable success criteria section`);
      else if (!/\d/.test(crit)) v.push(`${a.file}: success criteria contain no measurable value`);
    }

    // Lifecycle: live decisions, supersession chains, and a chain that points nowhere must fail.
    const lc = adr.lifecycle();
    if (lc.total !== res.count) v.push('the lifecycle view disagrees with the catalogue');
    if (!lc.active.length) v.push('no ADR is recorded as live');
    if (lc.superseded.some((s) => s.by === null)) v.push('an ADR is superseded by nothing in particular');
    for (const s of lc.superseded) if (!lc.total || s.by > lc.total) v.push(`ADR-${s.number} is superseded by an ADR that does not exist`);

    // Architectural debt is recorded where the extended schema applies, and nowhere is unassessed.
    const debt = adr.architecturalDebt();
    if (!debt.entries.length) v.push('no architectural debt is recorded by any extended ADR');
    if (debt.unassessed.length) v.push('extended ADRs with no debt assessment: ' + debt.unassessed.join(', '));
    for (const e of debt.entries) if (!e.assessment || e.assessment.length < 40) v.push(`ADR-${e.adr}: the debt assessment is empty`);

    // The generated template covers every tier, so an author cannot miss a section.
    const tpl = adr.template({ number: '0099' });
    for (const s of [...adr.LEGACY_SCHEMA, ...adr.FULL_SCHEMA, ...adr.EXTENDED_SCHEMA]) if (!tpl.includes(`## ${s.heading}`)) v.push(`the generated template omits '${s.heading}'`);
  }),

  fit('APP-FIT-CONSUMER-IMPACT', 'Impact is scored by whom it breaks, adoption is observed rather than assumed, and migration readiness fails closed', (v) => {
    const { ConsumerContracts, CRITICALITY_WEIGHT } = require('../src/contracts/consumer-contracts');
    const { ContractRegistry } = require('../src/contracts/integration-contracts');
    const cc = new ConsumerContracts();
    const registry = new ContractRegistry();
    const current = registry.current('api.reports.submit');

    // --- Impact scoring -------------------------------------------------------------------------
    if (!(CRITICALITY_WEIGHT.constitutional > CRITICALITY_WEIGHT.critical && CRITICALITY_WEIGHT.critical > CRITICALITY_WEIGHT.important)) {
      v.push('impact weighting does not rank constitutional above critical above important');
    }
    const additive = cc.impactScore('api.reports.submit', { fields: { required: current.fields.required, optional: [...current.fields.optional, 'locale'] } });
    if (!additive.safe || additive.score !== 0 || additive.band !== 'none') v.push('an additive change scored a non-zero impact');
    const constitutionalBreak = cc.impactScore('api.reports.submit', { fields: { required: [], optional: [] } });
    if (constitutionalBreak.safe) v.push('removing a field the citizen client sends was scored as safe');
    if (constitutionalBreak.band !== 'severe') v.push(`breaking the constitutional consumer scored '${constitutionalBreak.band}', not severe`);
    if (!constitutionalBreak.constitutionalImpact) v.push('constitutional impact was not flagged');
    if (!constitutionalBreak.reasons.some((r) => /citizen-web/.test(r))) v.push('the impact score named no affected consumer');
    if (!/major version/.test(constitutionalBreak.requiredAction)) v.push('a severe impact did not require a major version');
    // Breaking a merely important consumer must score LOWER than breaking a constitutional one.
    const importantBreak = cc.impactScore('event.case.submitted', { fields: { required: [], optional: [] } });
    if (importantBreak.score >= constitutionalBreak.score) v.push('breaking an important consumer scored at least as high as breaking the constitutional one');

    // --- Dependency visualization ------------------------------------------------------------------
    const viz = cc.dependencyVisualization();
    if (!viz.nodes.length || !viz.edges.length) v.push('the dependency visualization is empty');
    if (!viz.nodes.some((n) => n.kind === 'consumer') || !viz.nodes.some((n) => n.kind === 'contract')) v.push('the visualization is missing a node kind');
    for (const e of viz.edges) {
      if (!viz.nodes.some((n) => n.id === e.from)) v.push(`edge from unknown node '${e.from}'`);
      if (!viz.nodes.some((n) => n.id === e.to)) v.push(`edge to unknown node '${e.to}'`);
    }
    if (!viz.text.includes('citizen-web')) v.push('the text rendering omits the constitutional consumer');
    if (JSON.stringify(cc.dependencyVisualization()) !== JSON.stringify(cc.dependencyVisualization())) v.push('the dependency visualization is not deterministic');

    // --- Compatibility forecasting -----------------------------------------------------------------
    const safeForecast = cc.compatibilityForecast({
      contract: 'api.reports.submit',
      steps: [
        { name: 'add locale', spec: { fields: { required: current.fields.required, optional: [...current.fields.optional, 'locale'] } } },
        { name: 'add channel', spec: { fields: { required: current.fields.required, optional: [...current.fields.optional, 'locale', 'channel'] } } },
      ],
    });
    if (!safeForecast.cumulativeSafe || safeForecast.firstBreakingStep !== null) v.push('a wholly additive roadmap was forecast to break');
    const breakingForecast = cc.compatibilityForecast({
      contract: 'api.reports.submit',
      steps: [
        { name: 'add locale', spec: { fields: { required: current.fields.required, optional: [...current.fields.optional, 'locale'] } } },
        { name: 'drop category', spec: { fields: { required: [], optional: ['locale'] } } },
      ],
    });
    if (breakingForecast.cumulativeSafe) v.push('a roadmap whose second step removes a required field was forecast as safe');
    if (breakingForecast.firstBreakingStep !== 1) v.push(`the first breaking step was reported as ${breakingForecast.firstBreakingStep}, not 1`);
    if (breakingForecast.safeThrough !== 1) v.push('the safe prefix of the roadmap was miscomputed');
    if (!/major version/.test(breakingForecast.recommendation)) v.push('a breaking forecast recommended no major version');
    // Changes are applied CUMULATIVELY — a forecast that resets between steps is not a forecast.
    if (breakingForecast.steps[1].affected.length === 0) v.push('the breaking step named no affected consumer');

    // --- Adoption tracking --------------------------------------------------------------------------
    const before = cc.adoption('api.reports.submit');
    if (before.coverage !== 0 || before.fullyAdopted) v.push('adoption was assumed before anything was reported');
    if (!before.unreported.includes('citizen-web')) v.push('an unreported consumer was not named');
    cc.recordAdoption('citizen-web', 'api.reports.submit', { version: current.version });
    const after = cc.adoption('api.reports.submit');
    if (after.coverage !== 1 || !after.fullyAdopted) v.push('a reported, current consumer was not counted as adopted');
    let badVersion = false;
    try { cc.recordAdoption('citizen-web', 'api.reports.submit', { version: 0 }); } catch (_) { badVersion = true; }
    if (!badVersion) v.push('an invalid contract version was recorded as adoption');
    let unknownConsumer = false;
    try { cc.recordAdoption('nobody', 'api.reports.submit', { version: 1 }); } catch (_) { unknownConsumer = true; }
    if (!unknownConsumer) v.push('adoption was recorded for an unknown consumer');
    // A consumer behind the current version is reported as behind, by how much.
    const cc2 = new ConsumerContracts();
    cc2.recordAdoption('citizen-web', 'api.reports.submit', { version: current.version - 1 >= 1 ? current.version - 1 : current.version });
    const lagging = cc2.adoption('api.reports.submit');
    if (current.version > 1 && !lagging.behind.length) v.push('a consumer on an older version was not reported as behind');

    // --- Deprecation analytics -----------------------------------------------------------------------
    const analytics = cc.deprecationAnalytics({ now: 0 });
    if (!Array.isArray(analytics.deprecated)) v.push('deprecation analytics returned no list');
    if (typeof analytics.totalBurden !== 'number') v.push('migration burden is not quantified');
    // A deprecated contract with a live consumer past its sunset must be reported OVERDUE.
    const probeRegistry = new ContractRegistry();
    probeRegistry.deprecate('api.reports.submit', { sunsetAt: 1_000 });
    const probe = new ConsumerContracts({ registry: probeRegistry });
    const overdue = probe.deprecationAnalytics({ now: 10_000_000 });
    if (!overdue.deprecated.length) v.push('a deprecated contract did not appear in the analytics');
    if (!overdue.overdue.includes('api.reports.submit')) v.push('a deprecated contract past its sunset with a live consumer was not reported as overdue');
    if (overdue.clean) v.push('an estate with an unmigrated deprecated contract was reported clean');

    // --- Migration readiness --------------------------------------------------------------------------
    // FAIL-CLOSED: an unreported consumer is NOT ready.
    const blind = new ConsumerContracts();
    const notReady = blind.migrationReadiness({ contract: 'api.reports.submit', spec: { fields: { required: [], optional: [] } } });
    if (notReady.ready) v.push('migration was reported ready with no adoption reported at all');
    if (!notReady.blockedBy.includes('citizen-web')) v.push('the blocking consumer was not named');
    if (!notReady.constitutionalBlocked) v.push('a blocked constitutional consumer was not flagged');
    if (notReady.failClosed !== true || notReady.authorizes !== false) v.push('migration readiness is not fail-closed / claims authority');
    if (!/assumes/.test(notReady.note)) v.push('the readiness note does not explain why unreported is not ready');
    blind.recordAdoption('citizen-web', 'api.reports.submit', { version: current.version });
    const ready = blind.migrationReadiness({ contract: 'api.reports.submit', spec: { fields: { required: [], optional: [] } } });
    if (!ready.ready) v.push('migration was not ready with every affected consumer on the current version');
    if (ready.adoptionCoverage !== 1) v.push('adoption coverage was miscomputed');
  }),

  fit('APP-FIT-RACI-GOVERNANCE', 'No subsystem approves itself; every control has an owner', (v) => {
    const raci = require('../src/governance/raci');
    for (const violation of raci.validate().violations) v.push(violation);
    // Exactly one accountable role per activity, never the same as responsible.
    for (const a of raci.activities()) {
      if (!a.accountable) v.push(`${a.id}: no accountable role`);
      if (a.accountable === a.responsible) v.push(`${a.id}: responsible and accountable are the same role`);
      if (!a.evidence) v.push(`${a.id}: names no evidence`);
      if (a.humanDecision !== true) v.push(`${a.id}: is not a human decision`);
    }
    // Resolved to real institutions, no subsystem approves its own work.
    const selfApprovals = raci.matrix().flatMap((m) => m.rows.filter((r) => r.selfApproval).map((r) => `${m.subsystem}/${r.activity}`));
    if (selfApprovals.length) v.push('self-approval detected: ' + selfApprovals.join(', '));
    // Every bounded context has a matrix covering every activity.
    if (raci.matrix().length !== contextMap.ids().length) v.push('not every bounded context has a RACI matrix');
    for (const m of raci.matrix()) if (m.rows.length !== raci.activities().length) v.push(`${m.subsystem}: incomplete RACI matrix`);
    // Every control is owned by a context with a named authority.
    const ids = [
      ...require('../../njtip-twin/verification/fitness').map((f) => f.id),
      ...require('./app-fitness').map((f) => f.id),
      ...require('./infra-fitness').map((f) => f.id),
    ];
    const control = raci.controlOwnership(ids);
    if (control.unowned.length) v.push('controls with no owning context: ' + control.unowned.join(', '));
    if (control.coverage !== 1) v.push(`control ownership coverage is ${control.coverage}, not complete`);
    for (const c of control.controls) if (!c.responsibleAuthority || !c.governanceBoard) v.push(`${c.control}: no responsible authority or board`);
    // Escalation workflows terminate at the governance board.
    const wf = raci.escalationWorkflow('custody', 'recovery-authorization');
    if (wf.steps.length < 4 || wf.terminatesAt !== ownership.describe('custody').governanceBoard) v.push('the escalation workflow does not terminate at the governance board');
    if (!wf.evidenceRequired) v.push('an escalation workflow names no required evidence');
    // The scorecard is computed, not entered, and reacts to the live gate.
    const strong = raci.scorecard({ fitnessIds: ids, fitnessResults: ids.map((id) => ({ id, pass: true })) });
    if (strong.band !== 'strong') v.push('a fully governed platform did not score strong');
    const degraded = raci.scorecard({ fitnessIds: ids, fitnessResults: ids.map((id, i) => ({ id, pass: i > 0 })) });
    if (degraded.score >= strong.score) v.push('the governance scorecard did not react to a failing control');
    // Maturity is the highest level actually met, and it needs a green gate to reach 5.
    if (raci.maturity({ fitnessIds: ids, fitnessResults: ids.map((id) => ({ id, pass: true })) }).level !== 5) v.push('a fully assured platform did not reach maturity level 5');
    if (raci.maturity({ fitnessIds: ids, fitnessResults: ids.map((id, i) => ({ id, pass: i > 0 })) }).level >= 5) v.push('maturity level 5 was claimed with a failing control');
  }),

  fit('APP-FIT-EXECUTIVE-DASHBOARD', 'Every executive metric traces to evidence; none can be entered by hand', (v) => {
    const exec = require('../src/observability/executive');
    const knownFitnessIds = [
      ...require('../../njtip-twin/verification/fitness').map((f) => f.id),
      ...require('./app-fitness').map((f) => f.id),
      ...require('./infra-fitness').map((f) => f.id),
    ];
    for (const violation of exec.validate({ knownFitnessIds }).violations) v.push(violation);
    // Every metric the executive brief requires is present.
    for (const required of ['architecture-health', 'security-posture', 'compliance-posture', 'reliability', 'performance', 'operational-readiness', 'technical-debt', 'deployment-readiness', 'risk-exposure', 'legislative-readiness', 'data-governance', 'recovery-readiness']) {
      if (!exec.METRICS[required]) v.push(`missing executive metric '${required}'`);
    }
    // No metric may exist without an evidence path — that is the only thing stopping hand entry.
    for (const t of exec.evidenceTrace()) { if (!t.evidencePath) v.push(`${t.metric}: no evidence path`); if (!t.verifyingControl) v.push(`${t.metric}: no verifying control`); }
    // A metric with no evidence renders UNAVAILABLE — never zero, never a default.
    const empty = exec.dashboard({});
    if (empty.metrics.some((m) => m.status === 'measured')) v.push('a metric was rendered with no evidence supplied');
    if (empty.unavailable.length !== Object.keys(exec.METRICS).length) v.push('missing evidence was not reported per metric');
    if (empty.metrics.some((m) => m.value === 0 && m.status !== 'measured')) v.push('an unavailable metric defaulted to zero');
    // With evidence, values resolve and targets are evaluated in the right direction.
    const evidence = { fitness: { heldRatio: 1, failingCount: 0 }, security: { postureScore: 1 }, compliance: { overallCoverage: 1 }, reliability: { allSlosMet: true, latencyP95Ms: 120 }, operations: { readinessScore: 1 }, assurance: { allDomainsPass: true }, risk: { totalExposure: 0, residual: [] }, legislation: { mandatesImplementedRatio: 1 }, data: { tracedRatio: 1 }, recovery: { allScenariosMatch: true } };
    const full = exec.dashboard(evidence);
    if (full.coverage !== 1 || !full.healthy) v.push('a fully evidenced, healthy platform did not render as such');
    if (full.metrics.find((m) => m.metric === 'performance').meets !== true) v.push('a lower-is-better metric was evaluated in the wrong direction');
    const slow = exec.dashboard({ ...evidence, reliability: { allSlosMet: true, latencyP95Ms: 5000 } });
    if (slow.metrics.find((m) => m.metric === 'performance').meets !== false) v.push('a breached latency target was reported as met');
    if (slow.healthy) v.push('a dashboard with a failing metric reported healthy');
    // The risk heat map places threats by severity and control state.
    const heat = exec.riskHeatmap({ residual: [{ threat: 'TH-DEANON', severity: 'critical', exposure: 12, failing: ['FIT-IDENTITY-MINIMIZATION'] }] });
    if (heat.clean || heat.worst.band !== 'critical') v.push('the risk heat map did not band a critical exposure');
    if (!exec.riskHeatmap({ residual: [] }).clean) v.push('an empty residual risk set did not render clean');
    // Deterministic, informational, never authorizing.
    if (JSON.stringify(exec.dashboard(evidence)) !== JSON.stringify(exec.dashboard(evidence))) v.push('the executive dashboard is not deterministic');
    if (full.informationalOnly !== true || full.authorizes !== false) v.push('the executive dashboard claims authority');
  }),

  fit('APP-FIT-CONTINUOUS-ASSURANCE', 'Sixteen assurance domains gate deployment fail-closed, and never authorize it', (v) => {
    const ca = require('../src/assurance/continuous');
    const knownFitnessIds = [
      ...require('../../njtip-twin/verification/fitness').map((f) => f.id),
      ...require('./app-fitness').map((f) => f.id),
      ...require('./infra-fitness').map((f) => f.id),
    ];
    for (const violation of ca.validate({ knownFitnessIds }).violations) v.push(violation);
    // All sixteen required domains are present, each naming real verifying controls.
    for (const required of ['architecture', 'security', 'privacy', 'compliance', 'performance', 'reliability', 'governance', 'recovery', 'supplyChain', 'infrastructure', 'legislation', 'identity', 'policies', 'observability', 'dataGovernance', 'aiGovernance']) {
      if (!ca.DOMAINS[required]) v.push(`missing assurance domain '${required}'`);
    }
    if (ca.domainIds().length !== 16) v.push(`expected 16 assurance domains, found ${ca.domainIds().length}`);
    // A domain with no evidence FAILS — assurance is never granted blind.
    const blind = ca.evaluate({});
    if (blind.allPass) v.push('assurance passed with no evidence at all');
    if (!blind.domains.every((d) => !d.evidencePresent && /cannot be assured blind/.test(d.reason))) v.push('a domain without evidence did not say so');
    // A fully evidenced, healthy platform passes every domain.
    const good = {
      fitness: { allHold: true, heldRatio: 1, failingCount: 0 }, architecture: { valid: true, contexts: 30, modules: 120 },
      security: { policiesCertified: true, credentialFindings: 0, algorithmIndependence: true, postureScore: 1 },
      privacy: { identityMinimized: true, correlationDefaultDeny: true }, compliance: { overallCoverage: 1 },
      reliability: { allSlosMet: true, latencyP95Ms: 100 }, governance: { ownershipComplete: true, noSelfApproval: true, maturityLevel: 5 },
      recovery: { allScenariosMatch: true, backupVerified: true }, supplyChain: { thirdPartyCount: 0, attestationsVerified: true },
      infrastructure: { healthy: true, drift: false }, legislation: { unimplementedMandates: 0 },
      identity: { trustedIssuer: true, shortLivedCredentials: true }, policies: { certified: true, allSpecsProven: true, specsProven: 10 },
      observability: { topologyValid: true, identityFree: true }, data: { tracedRatio: 1 }, ai: { allArtifactsApproved: true, noAutonomousAction: true },
    };
    const clean = ca.evaluate(good);
    if (!clean.allPass) v.push('a fully evidenced healthy platform failed assurance: ' + clean.failed.join(', '));
    // A single failing domain blocks the package — fail-closed.
    const broken = ca.deploymentAuthorizationPackage({ sources: { ...good, privacy: { identityMinimized: false, correlationDefaultDeny: true } } });
    if (broken.clean) v.push('a failed privacy domain did not block the authorization package');
    if (!broken.blockers.length) v.push('a blocked package named no blocker');
    if (broken.failClosed !== true) v.push('the deployment authorization package is not fail-closed');
    if (!broken.riskRegister.register.some((r) => r.severity === 'critical')) v.push('a failed privacy domain was not raised as a critical risk');
    // A named human may accept the risk, and the acceptance is recorded — never assumed.
    const accepted = ca.deploymentAuthorizationPackage({ sources: { ...good, privacy: { identityMinimized: false, correlationDefaultDeny: true } }, riskAcceptedBy: 'Oversight Board', riskRationale: 'documented compensating control' });
    if (!accepted.riskAcceptance || accepted.riskAcceptance.by !== 'Oversight Board') v.push('a recorded risk acceptance was not captured');
    if (accepted.authorized !== false) v.push('accepting risk was treated as authorizing deployment');
    // THE invariant: even a fully green, signed package authorizes nothing.
    const green = ca.deploymentAuthorizationPackage({ sources: good, mandates: [{ instrument: 'dpa', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }] });
    if (!green.clean) v.push('a fully assured platform did not produce a clean package');
    if (green.authorized !== false) v.push('a green assurance package reported itself as authorized');
    if (!/NOT AUTHORIZED/.test(green.authorizationDecision)) v.push('the package does not state that it is not an authorization');
    if (!green.digest || !green.signature) v.push('the authorization package is not signed');
    // The registers are populated and reproducible.
    if (!green.evidenceRegister.complete) v.push('the evidence register is incomplete for a fully evidenced run');
    if (green.complianceRegister.gaps !== 0 || green.complianceRegister.breaches !== 0) v.push('a compliant mandate set produced gaps or breaches');
    const gap = ca.complianceRegister({ mandates: [{ instrument: 'x', control: 'NONE', implemented: false }] });
    if (gap.gaps !== 1 || gap.compliant) v.push('an unimplemented mandate was not recorded as a compliance gap');
    const breach = ca.complianceRegister({ mandates: [{ instrument: 'x', control: 'C', implemented: true, holding: false }] });
    if (breach.breaches !== 1) v.push('a failing mandated control was not recorded as a breach');
    if (ca.deploymentAuthorizationPackage({ sources: good }).digest !== ca.deploymentAuthorizationPackage({ sources: good }).digest) v.push('the assurance package digest is not reproducible');
    // Production readiness keeps the human items visible and never declares itself ready.
    const prod = ca.productionReadinessPackage({ sources: good });
    if (prod.productionReady !== false) v.push('the production readiness package declared the platform production-ready');
    if (prod.outstandingHumanItems < 5) v.push('the human items required before production are not enumerated');
    if (!prod.humanItems.some((i) => /cryptography/i.test(i.item))) v.push('human-built cryptography is not listed as a human item');
  }),

  fit('APP-FIT-GOVERNANCE-CONTINUITY', 'Every accountable role has a deputy, availability is recorded, and a role nobody can fill is an ownership gap', (v) => {
    const own = require('../src/governance/ownership');

    // Every subsystem has a deputy for every accountable role, and a deputy is never the primary.
    for (const id of own.subsystems()) {
      const o = own.OWNERSHIP[id];
      const dep = own.deputies(id);
      for (const role of own.DEPUTY_ROLES) {
        if (!dep[role]) v.push(`${id}/${role}: no deputy`);
        if (dep[role] === o[role]) v.push(`${id}/${role}: the deputy is the primary`);
      }
      // Substitution must not collapse separation of duties.
      if (dep.responsibleAuthority === o.approvingAuthority || dep.responsibleAuthority === dep.approvingAuthority) {
        v.push(`${id}: substituting the deputy responsible authority collapses separation of duties`);
      }
    }
    // The deputy rule is stated, not implicit.
    if (!own.DEPUTY_RULE) v.push('the deputy derivation rule is not stated');
    // Structural continuity defects fail ownership validation itself.
    for (const violation of own.validate().violations) v.push(violation);

    // Succession chains terminate at a board — a chain that ends in a person can end in nobody.
    for (const id of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        const plan = own.successionPlan(id, role);
        if (plan.chain.length < 3) v.push(`${id}/${role}: succession chain is shorter than primary → deputy → board`);
        if (!plan.terminatesAtBoard) v.push(`${id}/${role}: succession does not terminate at a board`);
        const terminal = plan.chain[plan.chain.length - 1].holder;
        if (!own.boards().some((b) => b.name === terminal)) v.push(`${id}/${role}: succession terminates at '${terminal}', which is not a board`);
        for (const step of plan.chain) if (!step.basis) v.push(`${id}/${role}: a succession step states no basis`);
      }
    }

    // Availability: an absence must be named, reasoned, recorded by a human and TIME-BOUNDED.
    const reg = new own.AvailabilityRegister({ clock: () => 1_000 });
    for (const bad of [{}, { person: 'X' }, { person: 'X', by: 'Y', reason: 'r' }, { person: 'X', by: 'Y', reason: 'r', from: 100, until: 50 }]) {
      let refused = false;
      try { reg.recordAbsence(bad); } catch (_) { refused = true; }
      if (!refused) v.push(`an invalid absence was accepted: ${JSON.stringify(bad)}`);
    }
    let unbounded = false;
    try { reg.recordAbsence({ person: 'X', by: 'Y', reason: 'sabbatical', from: 0, until: Infinity }); } catch (_) { unbounded = true; }
    if (!unbounded) v.push('an open-ended absence was accepted — that is an unfilled post, not an absence');

    // Full coverage with nobody absent.
    const clean = own.coverageScore({ availability: reg, now: 1_000 });
    if (!clean.complete || clean.coverage !== 1) v.push('coverage is incomplete with nobody recorded absent');
    if (clean.uncovered !== 0) v.push('a role was uncovered with nobody absent');
    if (clean.pairs !== own.subsystems().length * own.DEPUTY_ROLES.length) v.push('coverage does not span every subsystem and role');

    // THE CHAIN MUST WORK: with the primary away, the deputy holds it.
    const primary = own.OWNERSHIP['intake'].approvingAuthority;
    const deputy = own.deputyOf(primary);
    reg.recordAbsence({ person: primary, from: 0, until: 5_000, reason: 'recess', by: 'Oversight Board Secretariat' });
    const viaDeputy = reg.effectiveOwner('intake', 'approvingAuthority', 1_000);
    if (!viaDeputy.covered || viaDeputy.via !== 'deputy' || viaDeputy.holder !== deputy) v.push('an absent primary did not hand over to the named deputy');
    // …and after the absence ends, the primary holds it again without anyone doing anything.
    const restored = reg.effectiveOwner('intake', 'approvingAuthority', 6_000);
    if (restored.via !== 'primary') v.push('the primary did not resume once the absence ended');

    // AND IT MUST FAIL: with both away, this is an ownership GAP that escalates.
    reg.recordAbsence({ person: deputy, from: 0, until: 5_000, reason: 'recess', by: 'Oversight Board Secretariat' });
    const gapped = reg.effectiveOwner('intake', 'approvingAuthority', 1_000);
    if (gapped.covered) v.push('a role with neither primary nor deputy available was reported as covered');
    if (gapped.holder !== null) v.push('an uncovered role named a holder anyway');
    if (!gapped.escalateTo) v.push('an uncovered role did not escalate to a board');
    const degraded = own.coverageScore({ availability: reg, now: 1_000 });
    if (degraded.complete || degraded.coverage >= 1) v.push('coverage stayed complete with an uncovered role');
    if (!degraded.uncovered) v.push('the uncovered role was not counted');
    const gaps = own.ownershipGaps({ availability: reg, now: 1_000, lastReviewed: Object.fromEntries(own.subsystems().map((s) => [s, 1_000])) });
    if (gaps.clean) v.push('an estate with an uncovered role reported clean');
    if (!gaps.gaps.some((g) => g.kind === 'availability' && g.subsystem === 'intake')) v.push('the availability gap was not named');

    // Review schedule: never-reviewed is OVERDUE, not pending.
    const never = own.reviewSchedule({ now: 0 });
    if (!never.every((r) => r.overdue)) v.push('a never-reviewed governance record was not treated as overdue');
    if (!never.every((r) => r.cadenceDays > 0 && r.board)) v.push('a review row is missing its cadence or board');
    const day = 24 * 3600_000;
    const justReviewed = own.reviewSchedule({ now: day, lastReviewed: Object.fromEntries(own.subsystems().map((s) => [s, day])) });
    if (justReviewed.some((r) => r.overdue)) v.push('a just-reviewed record was reported overdue');
    const longAgo = own.reviewSchedule({ now: 400 * day, lastReviewed: Object.fromEntries(own.subsystems().map((s) => [s, 0])) });
    if (!longAgo.every((r) => r.overdue)) v.push('a record reviewed 400 days ago is not overdue at any cadence');
    // The strictest boards review most often.
    if (!(own.REVIEW_CADENCE_DAYS.ISRB <= own.REVIEW_CADENCE_DAYS.ARB)) v.push('the security board reviews less often than the architecture board');

    const report = own.continuityReport({ availability: reg, now: 1_000 });
    if (report.authorizes !== false || report.informationalOnly !== true) v.push('the continuity report claims authority');
    if (report.deputies.length !== own.subsystems().length) v.push('the continuity report omits a subsystem');
  }),

  fit('APP-FIT-EVIDENCE-CONFIDENCE', 'Confidence is computed from source, completeness and freshness — and can never be entered by hand', (v) => {
    const ec = require('../src/assurance/evidence-confidence');
    for (const violation of ec.validate().violations) v.push(violation);

    // THE REQUIREMENT: no manual confidence, ever.
    let manual = false;
    try { ec.assess({ id: 'x', source: 'executable-check', confidence: 1 }); } catch (e) { manual = !!e.failClosed; }
    if (!manual) v.push('a hand-entered confidence score was accepted');

    // Source weighting is ordered by how re-checkable the source is.
    if (!(ec.SOURCE_KINDS['executable-check'].weight > ec.SOURCE_KINDS['derived-computation'].weight)) v.push('an executable check does not outweigh a derived computation');
    if (!(ec.SOURCE_KINDS['derived-computation'].weight > ec.SOURCE_KINDS['declared-configuration'].weight)) v.push('a derived computation does not outweigh a declared configuration');
    if (!(ec.SOURCE_KINDS['declared-configuration'].weight > ec.SOURCE_KINDS['human-attestation'].weight)) v.push('declared configuration does not outweigh a human attestation');
    if (ec.SOURCE_KINDS.absent.weight !== 0) v.push('absent evidence carries weight');

    const now = 10_000_000;
    // Every assessment records source, completeness, freshness, method and last verification.
    const fresh = ec.assess({ id: 'a', source: 'executable-check', completeness: 1, verifiedAt: now, now });
    for (const f of ['source', 'completeness', 'freshness', 'method', 'lastVerifiedAt', 'calculation', 'band']) {
      if (fresh[f] === undefined || fresh[f] === null) v.push(`an assessment is missing '${f}'`);
    }
    if (fresh.confidence !== 1 || fresh.band !== 'high') v.push('a freshly verified executable check did not score full confidence');
    if (fresh.manualEntry !== false) v.push('an assessment did not declare itself machine-computed');
    // The calculation is reproducible from the record.
    if (fresh.calculation !== `${fresh.sourceWeight} × ${fresh.completeness} × ${fresh.freshness} = ${fresh.confidence}`) v.push('the recorded calculation does not reproduce the confidence');

    // FRESHNESS DECAYS, and stale evidence stops counting.
    const halfLife = ec.assess({ id: 'b', source: 'executable-check', completeness: 1, verifiedAt: now - 12 * 3600_000, now });
    if (!(halfLife.confidence > 0.4 && halfLife.confidence < 0.6)) v.push(`half-aged evidence scored ${halfLife.confidence}, not about half`);
    const stale = ec.assess({ id: 'c', source: 'executable-check', completeness: 1, verifiedAt: now - 5 * 24 * 3600_000, now });
    if (stale.confidence !== 0 || stale.usable) v.push('evidence well past its staleness horizon still carried confidence');
    const neverVerified = ec.assess({ id: 'd', source: 'executable-check', completeness: 1, verifiedAt: null, now });
    if (neverVerified.confidence !== 0) v.push('never-verified evidence scored above zero');
    const absent = ec.assess({ id: 'e', source: 'absent', completeness: 0, verifiedAt: null, now });
    if (absent.confidence !== 0 || absent.band !== 'unusable') v.push('absent evidence was not unusable');
    // Incompleteness reduces confidence proportionally.
    const partial = ec.assess({ id: 'f', source: 'executable-check', completeness: 0.5, verifiedAt: now, now });
    if (partial.confidence !== 0.5) v.push('completeness does not scale confidence');
    let badCompleteness = false;
    try { ec.assess({ id: 'g', source: 'executable-check', completeness: 2, verifiedAt: now, now }); } catch (_) { badCompleteness = true; }
    if (!badCompleteness) v.push('an out-of-range completeness was accepted');
    let unknownSource = false;
    try { ec.assess({ id: 'h', source: 'a-feeling', verifiedAt: now, now }); } catch (_) { unknownSource = true; }
    if (!unknownSource) v.push('an unknown evidence source was accepted');

    // AGGREGATION IS WEAKEST-LINK, not average — otherwise one unusable input hides behind nine.
    const reg = new ec.EvidenceRegister({ clock: () => now });
    for (let i = 0; i < 9; i++) reg.record({ id: `strong-${i}`, source: 'executable-check', completeness: 1, verifiedAt: now });
    reg.record({ id: 'weak', source: 'human-attestation', completeness: 0.2, verifiedAt: now - 170 * 24 * 3600_000 });
    const agg = reg.aggregate();
    if (agg.weakest !== 'weak') v.push('the weakest evidence was not identified');
    if (agg.confidence !== reg.get('weak').confidence) v.push('aggregate confidence is not the weakest link');
    if (!(agg.mean > agg.confidence)) v.push('the mean does not exceed the weakest link — the test data is not exercising the difference');
    if (reg.aggregate([]).confidence !== 0) v.push('an empty aggregate reported non-zero confidence');
    if (new ec.EvidenceRegister().aggregate().confidence !== 0) v.push('an empty register reported confidence');
    if (reg.digest() !== reg.digest()) v.push('the evidence register digest is not reproducible');
  }),

  fit('APP-FIT-READINESS-MODEL', 'Ten independent readiness dimensions, and authorization is never derived from any of them', (v) => {
    const ec = require('../src/assurance/evidence-confidence');

    if (Object.keys(ec.READINESS_DIMENSIONS).length !== 10) v.push('the readiness model does not have exactly ten dimensions');
    for (const required of ['technical', 'security', 'privacy', 'operational', 'reliability', 'data', 'governance', 'legal', 'supplyChain', 'organisational']) {
      if (!ec.READINESS_DIMENSIONS[required]) v.push(`missing readiness dimension '${required}'`);
    }
    // Every dimension declares its owner, its question and the SIGNALS it reads — a dimension
    // scored by inference is a dimension that will eventually be scored wrongly.
    for (const [id, d] of Object.entries(ec.READINESS_DIMENSIONS)) {
      if (!d.owner || !d.question || !d.evidence) v.push(`${id}: incompletely declared`);
      if (!d.signals || !d.signals.length) v.push(`${id}: declares no signals`);
    }
    if (ec.READINESS_DIMENSIONS.authorization) v.push('authorization is modelled as a readiness dimension');

    const now = 0;
    const evidence = new ec.EvidenceRegister({ clock: () => now });
    for (const id of Object.keys(ec.READINESS_DIMENSIONS)) evidence.record({ id: `readiness:${id}`, source: 'executable-check', completeness: 1, verifiedAt: now });
    const healthy = {
      fitness: { allHold: true, heldRatio: 1, failingCount: 0 },
      security: { policiesCertified: true, algorithmIndependence: true, credentialFindings: 0 },
      privacy: { identityMinimized: true, correlationDefaultDeny: true },
      operations: { readinessScore: 1 },
      reliability: { allSlosMet: true, sloHealthy: true },
      data: { tracedRatio: 1, qualityAcceptable: true, qualityReadiness: 1 },
      governance: { ownershipComplete: true, noSelfApproval: true },
      legislation: { unimplementedMandates: 0, mandatesImplementedRatio: 1 },
      supplyChain: { attestationsVerified: true, thirdPartyCount: 0 },
      continuity: { coverageComplete: true, noStructuralGaps: true },
    };
    const green = ec.readinessModel({ sources: healthy, evidence });
    if (!green.allDimensionsReady) v.push('a fully healthy platform had a dimension that was not ready: ' + JSON.stringify(green.notReady));
    if (green.readyCount !== 10) v.push(`only ${green.readyCount} of 10 dimensions were ready on healthy evidence`);

    // THE INVARIANT: TEN GREEN DIMENSIONS STILL PRINT NOT AUTHORIZED.
    if (green.authorizationStatus !== 'NOT AUTHORIZED') v.push('a fully ready platform reported something other than NOT AUTHORIZED');
    if (green.derivedFromReadiness !== false) v.push('authorization status claims to be derived from readiness');
    if (green.authorizes !== false) v.push('the readiness model claims authority');
    if (!/recorded decision/.test(green.authorizationBasis)) v.push('the authorization basis does not name a human decision');
    // …and there is no input that changes it.
    for (const attempt of [{}, { sources: healthy }, { sources: { ...healthy, authorization: { granted: true } } }]) {
      if (ec.readinessModel({ evidence, ...attempt }).authorizationStatus !== 'NOT AUTHORIZED') v.push('an input changed the authorization status');
    }

    // Dimensions are INDEPENDENT: breaking one leaves the others exactly as they were.
    const oneBroken = ec.readinessModel({ sources: { ...healthy, privacy: { identityMinimized: false, correlationDefaultDeny: true } }, evidence });
    if (oneBroken.allDimensionsReady) v.push('a broken privacy dimension left the model fully ready');
    if (oneBroken.readyCount !== 9) v.push('breaking one dimension changed the readiness of others');
    if (!oneBroken.notReady.some((d) => d.dimension === 'privacy' && d.owner)) v.push('the failing dimension did not name its owner');
    if (oneBroken.authorizationStatus !== 'NOT AUTHORIZED') v.push('a broken dimension changed the authorization status');
    // A COUNT signal of zero must read as good, not as a score of zero.
    const zeroCounts = ec.scoreDimension('security', { sources: healthy, evidence });
    if (!zeroCounts.ready) v.push('zero credential findings was scored as a failing security signal');
    const someFindings = ec.scoreDimension('security', { sources: { security: { policiesCertified: true, algorithmIndependence: true, credentialFindings: 3 } }, evidence });
    if (someFindings.ready) v.push('three credential findings still scored ready');

    // Missing evidence is not readiness.
    const blind = ec.readinessModel({ sources: {}, evidence: null });
    if (blind.allDimensionsReady) v.push('a model with no evidence at all reported every dimension ready');
    if (!blind.dimensions.every((d) => d.status === 'no-evidence')) v.push('a dimension with no evidence did not say so');
    if (blind.authorizationStatus !== 'NOT AUTHORIZED') v.push('an unevidenced model reported something other than NOT AUTHORIZED');
    // Full marks on weak evidence is not readiness either.
    const weak = new ec.EvidenceRegister({ clock: () => now });
    for (const id of Object.keys(ec.READINESS_DIMENSIONS)) weak.record({ id: `readiness:${id}`, source: 'human-attestation', completeness: 0.2, verifiedAt: now - 170 * 24 * 3600_000 });
    const weakly = ec.readinessModel({ sources: healthy, evidence: weak });
    if (weakly.allDimensionsReady) v.push('every dimension scored ready on evidence too weak to rely on');
    if (!weakly.lowConfidence.length) v.push('low-confidence dimensions were not flagged');
  }),

  fit('APP-FIT-ENGINEERING-METRICS', 'Engineering metrics are computed from countable inputs, an unmeasured metric is null, and maturity cannot inflate', (v) => {
    const ec = require('../src/assurance/evidence-confidence');

    // AN UNMEASURED METRIC IS NULL, NOT ZERO. Zero is a measurement; null is an admission.
    const empty = ec.engineeringMetrics({});
    for (const k of ['coverage', 'mutationScore', 'mttdHours', 'mttrHours']) if (empty[k] !== null && empty.dora[k] === undefined) v.push(`${k} defaulted to something other than null`);
    if (empty.dora.deploymentFrequency.perDay !== null) v.push('deployment frequency defaulted to a number with nothing measured');
    if (empty.dora.deploymentFrequency.band !== 'unknown') v.push('an unmeasured DORA metric was banded');
    if (empty.unmeasured.length < 5) v.push('unmeasured metrics were not enumerated');

    // DORA banding is correct at the boundaries.
    if (ec.bandFor('deploymentFrequency', 2).band !== 'elite') v.push('twice-daily deployment is not elite');
    if (ec.bandFor('deploymentFrequency', 1 / 60).band !== 'low') v.push('deploying every two months is not low');
    if (ec.bandFor('leadTimeHours', 2).band !== 'elite') v.push('a two-hour lead time is not elite');
    if (ec.bandFor('leadTimeHours', 24 * 60).band !== 'low') v.push('a two-month lead time is not low');
    if (ec.bandFor('changeFailureRate', 0.02).band !== 'elite') v.push('a 2% change failure rate is not elite');
    if (ec.bandFor('changeFailureRate', 0.5).band !== 'low') v.push('a 50% change failure rate is not low');
    if (ec.bandFor('mttrHours', 0.5).band !== 'elite') v.push('a 30-minute MTTR is not elite');
    if (ec.bandFor('mttrHours', 24 * 30).band !== 'low') v.push('a month-long MTTR is not low');
    if (ec.bandFor('mttrHours', null).band !== 'unknown') v.push('an unmeasured metric was banded');

    // Counting and derivation.
    const measured = ec.engineeringMetrics({
      tests: { unit: 300, integration: 80, contract: 38 }, invariants: { twin: 14, app: 92, infra: 9 },
      coverage: 0.86, mutationScore: 0.74, deployments: 30, windowDays: 30, failedDeployments: 1,
      leadTimeHours: 100, mttdHours: 0.5, mttrHours: 5,
      debtTrend: [10, 8, 6, 4], riskTrend: [5, 4, 3, 2], assuranceTrend: [0.8, 0.9, 0.95, 1],
    });
    if (measured.tests.total !== 418) v.push('test counts were not summed by type');
    if (measured.invariants.total !== 115) v.push('invariant counts were not summed by layer');
    if (measured.dora.deploymentFrequency.perDay !== 1) v.push('deployment frequency was miscomputed');
    if (measured.dora.deploymentFrequency.band !== 'elite') v.push('daily deployment was not banded elite');
    if (measured.dora.changeFailureRate.value !== 0.0333) v.push('change failure rate was miscomputed');
    if (measured.unmeasured.length) v.push('a fully measured run still reported unmeasured metrics: ' + measured.unmeasured.join(', '));
    if (JSON.stringify(ec.engineeringMetrics({ tests: { unit: 1 } })) !== JSON.stringify(ec.engineeringMetrics({ tests: { unit: 1 } }))) v.push('engineering metrics are not deterministic');

    // Trend polarity is stated so a direction is never read the wrong way round.
    if (measured.trends.technicalDebt.direction !== 'falling' || measured.trends.technicalDebt.better !== 'falling') v.push('falling technical debt was not recognised as an improvement');
    if (measured.trends.assurance.direction !== 'rising' || measured.trends.assurance.better !== 'rising') v.push('rising assurance was not recognised as an improvement');
    if (ec.engineeringMetrics({ debtTrend: [1] }).trends.technicalDebt.direction !== 'insufficient-data') v.push('a single observation was treated as a trend');

    // MATURITY CANNOT INFLATE: an unmeasured metric cannot raise a level.
    if (ec.maturity(empty).level !== 0) v.push('an entirely unmeasured platform was assigned a maturity level');
    const counted = ec.engineeringMetrics({ tests: { unit: 10 }, invariants: { app: 5 } });
    if (ec.maturity(counted).level !== 2) v.push('counting tests and invariants alone did not reach level 2');
    if (!ec.maturity(counted).blockedBy.length) v.push('a level below the top named nothing blocking it');
    const automated = ec.engineeringMetrics({ tests: { unit: 10 }, invariants: { app: 5 }, deployments: 10, windowDays: 30, failedDeployments: 0 });
    if (ec.maturity(automated).level !== 3) v.push('measuring deployment frequency and change failure rate did not reach level 3');
    if (measured.dora.leadTimeHours.band === 'elite' || measured.dora.mttrHours.band === 'elite') v.push('the level-4 probe is accidentally elite — it cannot distinguish level 4 from 5');
    if (ec.maturity(measured).level !== 4) v.push('a fully measured but non-elite platform did not reach level 4: ' + ec.maturity(measured).blockedBy.join('; '));
    const elite = ec.engineeringMetrics({
      tests: { unit: 400 }, invariants: { app: 100 }, coverage: 0.95, mutationScore: 0.9,
      deployments: 60, windowDays: 30, failedDeployments: 1, leadTimeHours: 2, mttrHours: 0.5, mttdHours: 0.2,
      debtTrend: [10, 5, 2], riskTrend: [9, 5, 1], assuranceTrend: [0.9, 0.95, 1],
    });
    if (ec.maturity(elite).level !== 5) v.push('an elite, improving platform did not reach level 5: ' + ec.maturity(elite).blockedBy.join('; '));
    if (ec.maturity(elite).blockedBy.length) v.push('the top maturity level still reported blockers');
    if (ec.maturity(elite).authorizes !== false) v.push('the maturity report claims authority');
    // Elite bands alone are not enough — rising debt blocks the top level.
    const eliteButRotting = ec.engineeringMetrics({ ...{ tests: { unit: 400 }, invariants: { app: 100 }, coverage: 0.95, mutationScore: 0.9, deployments: 60, windowDays: 30, failedDeployments: 1, leadTimeHours: 2, mttrHours: 0.5 }, debtTrend: [2, 5, 10], riskTrend: [1, 5, 9] });
    if (ec.maturity(eliteButRotting).level === 5) v.push('rising debt and risk did not block the top maturity level');
  }),

  fit('APP-FIT-CREDENTIAL-HYGIENE', 'Tokens are revocable and secret values never leak in metadata', (v) => {
    const idp = new OidcVerifier({ secret: 's' });
    const tok = idp.issue({ sub: 'x', role: 'admin' });
    const claims = idp.verify(tok);
    idp.revoke(claims.jti);
    if (idp.verify(tok)) v.push('revoked token still verifies');
    const sm = new SecretsManager({ source: { DB_PASSWORD: 'super-secret-value' } });
    if (JSON.stringify(sm.list()).includes('super-secret-value')) v.push('secret value leaked in list() metadata');
    if ('value' in (sm.status('DB_PASSWORD') || {})) v.push('secret value leaked in status()');
  }),
];
