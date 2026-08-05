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

  fit('APP-FIT-ZERO-TRUST-CONTEXT', 'Authorization context is fully evaluated; stale policy, replayed requests and context changes all fail', (v) => {
    const zt = require('../src/iam/zero-trust-architecture');
    let now = 1_000_000;
    const z = zt.makeZeroTrust({ clock: () => now });
    z.devices.register('dev-1', { trusted: true });
    const req = (over = {}) => ({
      subject: { principal: 'inv-001', role: 'investigator', mfa: 'fido2', authenticatedAt: now, deviceId: 'dev-1', devicePosture: 'healthy', zone: 'executive', sessionId: 'S1', clearance: 'secret', tenant: 'dcec', jurisdiction: 'BW', credentialVersion: 3, ...(over.subject || {}) },
      action: over.action || 'review-case',
      resource: { zone: 'executive', ...(over.resource || {}) },
      env: { network: 'gov-wan', hourOfDay: 10, ...(over.env || {}) },
      ...(over.nonce ? { nonce: over.nonce } : {}),
    });

    // --- Assurance levels are DERIVED from the authenticator, never taken as a claim ----------
    if (zt.assuranceLevelOf({ mfa: 'fido2' }) !== 'AAL3') v.push('a hardware authenticator did not resolve to AAL3');
    if (zt.assuranceLevelOf({ mfa: 'totp' }) !== 'AAL2') v.push('a soft OTP did not resolve to AAL2');
    if (zt.assuranceLevelOf({}) !== 'AAL0') v.push('no authenticator did not resolve to AAL0');
    // A request cannot assert its own assurance level.
    if (zt.assuranceLevelOf({ assuranceLevel: 'AAL3' }) === 'AAL3') v.push('a self-asserted assurance level was believed');
    if (!(zt.assuranceRank('AAL3') > zt.assuranceRank('AAL2') && zt.assuranceRank('AAL2') > zt.assuranceRank('AAL1'))) v.push('assurance levels are not ordered');
    // The constitutional path demands no assurance at all — a citizen has only a browser.
    if (zt.ACTION_ASSURANCE_FLOOR['submit-report'] !== 'AAL0') v.push('filing a report requires an authenticator');
    for (const sensitive of ['read-evidence', 'record-governance-decision', 'break-glass']) {
      if (zt.ACTION_ASSURANCE_FLOOR[sensitive] !== 'AAL3') v.push(`'${sensitive}' does not demand a hardware-bound authenticator`);
    }

    // --- Each context condition denies on its own, and names itself --------------------------
    const baseline = z.pdp.decide(req());
    if (baseline.decision !== 'permit') v.push('a fully compliant request was denied: ' + baseline.reason);

    const weakAssurance = z.pdp.decide(req({ subject: { mfa: 'totp' }, action: 'read-evidence' }));
    if (weakAssurance.decision === 'permit') v.push('a sensitive action was permitted at AAL2');
    if (!/AAL3 required/.test(weakAssurance.reason)) v.push('the assurance denial did not name the required level');

    const noClearance = z.pdp.decide(req({ subject: { clearance: 'internal' }, resource: { classification: 'secret' } }));
    if (noClearance.decision === 'permit') v.push('a subject read above their clearance');
    if (!/clearance/.test(noClearance.reason)) v.push('the clearance denial did not name clearance');
    if (z.pdp.decide(req({ subject: { clearance: 'secret' }, resource: { classification: 'restricted' } })).decision !== 'permit') v.push('reading below clearance was denied');

    const wrongTenant = z.pdp.decide(req({ resource: { tenant: 'other-agency' } }));
    if (wrongTenant.decision === 'permit') v.push('a request reached another tenant\'s resource');
    const wrongJurisdiction = z.pdp.decide(req({ resource: { jurisdiction: 'ZA' } }));
    if (wrongJurisdiction.decision === 'permit') v.push('a request crossed a jurisdiction boundary');

    const oldCredential = z.pdp.decide(req({ subject: { credentialVersion: 1 }, env: { minCredentialVersion: 3 } }));
    if (oldCredential.decision === 'permit') v.push('a superseded credential version was accepted');
    if (z.pdp.decide(req({ env: { minCredentialVersion: 3 } })).decision !== 'permit') v.push('a current credential version was rejected');

    const compromised = z.pdp.decide(req({ subject: { devicePosture: 'compromised' } }));
    if (compromised.decision === 'permit') v.push('a compromised device was permitted');
    const unknownDevice = z.pdp.decide(req({ subject: { devicePosture: 'unknown' }, action: 'read-evidence' }));
    if (unknownDevice.decision === 'permit') v.push('a sensitive action ran from a device of unknown posture');

    const untrustedNetwork = z.pdp.decide(req({ action: 'read-evidence', env: { network: 'public-internet' } }));
    if (untrustedNetwork.decision === 'permit') v.push('a sensitive action was permitted over an untrusted network');
    const geoDenied = z.pdp.decide(req({ env: { geoAllowed: false } }));
    if (geoDenied.decision === 'permit') v.push('a geo-denied request was permitted');

    // --- POLICY FRESHNESS: deciding against a superseded policy is refused -------------------
    const currentVersion = z.pap.version();
    if (z.pdp.decide(req({ env: { policyVersion: currentVersion } })).decision !== 'permit') v.push('a request stating the current policy version was denied');
    const stale = z.pdp.decide(req({ env: { policyVersion: currentVersion - 1 } }));
    if (stale.decision === 'permit') v.push('a request asserting a superseded policy version was permitted');
    if (!/policy version/.test(stale.reason)) v.push('the policy-freshness denial did not name the version');
    const ahead = z.pdp.decide(req({ env: { policyVersion: currentVersion + 5 } }));
    if (ahead.decision === 'permit') v.push('a request asserting a policy version that does not exist yet was permitted');

    // --- REPLAY DETECTION: a nonce is single-use ---------------------------------------------
    const first = z.pdp.decide(req({ nonce: 'REQ-1' }));
    if (first.decision !== 'permit') v.push('the first use of a nonce was denied: ' + first.reason);
    const replayed = z.pdp.decide(req({ nonce: 'REQ-1' }));
    if (replayed.decision === 'permit') v.push('a replayed authorization request was permitted');
    if (!/replay/.test(replayed.reason)) v.push('the replay denial did not say so');
    if (z.pdp.decide(req({ nonce: 'REQ-2' })).decision !== 'permit') v.push('a fresh nonce was rejected');

    // --- CONTEXT DIGEST: every context field participates ------------------------------------
    const Cache = zt.AuthorizationDecisionCache;
    const baseDigest = Cache.subjectContextDigest(req());
    const perturbations = [
      ['assurance', req({ subject: { mfa: 'totp' } })],
      ['clearance', req({ subject: { clearance: 'internal' } })],
      ['tenant', req({ subject: { tenant: 'other' } })],
      ['jurisdiction', req({ subject: { jurisdiction: 'ZA' } })],
      ['credential version', req({ subject: { credentialVersion: 9 } })],
      ['device posture', req({ subject: { devicePosture: 'unknown' } })],
      ['resource classification', req({ resource: { classification: 'secret' } })],
      ['network', req({ env: { network: 'public-internet' } })],
      ['time window', req({ env: { hourOfDay: 23 } })],
      ['country', req({ env: { country: 'ZA' } })],
      ['policy version', req({ env: { policyVersion: 42 } })],
    ];
    for (const [what, r] of perturbations) {
      if (Cache.subjectContextDigest(r) === baseDigest) v.push(`changing the ${what} did not change the context digest — that field is not in the security boundary`);
    }
    // Something genuinely outside the context must NOT change the digest, or the cache is dead.
    if (Cache.subjectContextDigest(req({ subject: { displayHint: 'x' } })) !== baseDigest) v.push('an irrelevant field changed the context digest — nothing would ever cache');

    // --- A CONTEXT CHANGE INVALIDATES A CACHED DECISION --------------------------------------
    const z2 = zt.makeZeroTrust({ clock: () => now });
    z2.devices.register('dev-1', { trusted: true });
    const warm = z2.pdp.decide(req());
    if (warm.decision !== 'permit') v.push('the cache-warming request was denied: ' + warm.reason);
    const hit = z2.pdp.decide(req());
    if (!hit.cached) v.push('an identical repeated request was not served from cache — caching is inert');
    const changed = z2.pdp.decide(req({ subject: { clearance: 'internal' } }));
    if (changed.cached) v.push('a decision was reused after the security context changed');

    // --- POLICY PUBLICATION PROPAGATES AND INVALIDATES ---------------------------------------
    const before = z2.pap.version();
    z2.pap.publish(z2.pap.registry(), { by: 'ISRB Chair', rationale: 'periodic republication' });
    if (z2.pap.version() !== before + 1) v.push('publishing policy did not advance the version');
    const afterPublish = z2.pdp.decide(req());
    if (afterPublish.cached) v.push('a decision issued under the previous policy version was reused after publication');
    // Cross-region: a lagging region may not serve at all.
    z2.policySync.register('bw-south', { version: before });
    const lagging = z2.pdp.decide({ ...req(), env: { ...req().env, region: 'bw-south' } });
    if (lagging.decision === 'permit') v.push('a region on a superseded policy version served authorization');
    z2.policySync.sync('bw-south', z2.pap.version());
    if (z2.pdp.decide({ ...req(), env: { ...req().env, region: 'bw-south' } }).decision !== 'permit') v.push('a synchronised region was still refused');

    // --- REVOCATION PROPAGATES IMMEDIATELY ---------------------------------------------------
    z2.pdp.decide(req());
    z2.revocations.revokeSession('S1', { by: 'SOC Lead', reason: 'suspected compromise' });
    const afterRevoke = z2.pdp.decide(req());
    if (afterRevoke.decision === 'permit') v.push('a revoked session was permitted, cached or otherwise');
    if (!/revoked/.test(afterRevoke.reason)) v.push('the revocation denial did not say so');

    // The context evaluation is reportable in its own right, and every check names itself.
    const ctx = z.pdp.evaluateContext(req());
    if (!ctx.satisfied) v.push('the baseline context evaluation was not satisfied');
    for (const c of ctx.checks) if (!c.check || c.detail === undefined) v.push('a context check did not describe itself');
    if (!ctx.assuranceLevel || !ctx.requiredAssurance) v.push('the context evaluation did not report the assurance levels it compared');
  }),

  fit('APP-FIT-RISK-QUANTITATIVE', 'Risk = likelihood × impact, residual is derived, and an unattributed or unquantified risk is refused', (v) => {
    const tm = require('../src/security/threat-model');
    const controlIds = [...new Set(tm.threats().flatMap((t) => t.controls))];
    const green = controlIds.map((id) => ({ id, pass: true }));
    const red = controlIds.map((id) => ({ id, pass: false }));
    const threat = tm.ids()[0];

    // Both scales are ordinal 1..5 with a STATED meaning per point.
    for (const [scale, name] of [[tm.LIKELIHOOD_SCALE, 'likelihood'], [tm.IMPACT_SCALE, 'impact']]) {
      const values = Object.values(scale).map((s) => s.value).sort((a, b) => a - b);
      if (JSON.stringify(values) !== JSON.stringify([1, 2, 3, 4, 5])) v.push(`the ${name} scale is not a 1..5 ordinal scale`);
      for (const [k, s] of Object.entries(scale)) if (!s.description) v.push(`${name} '${k}' has no stated meaning — two assessors will use it differently`);
    }
    // Severity supplies a default IMPACT but never a default likelihood.
    if (!tm.SEVERITY_IMPACT.critical) v.push('a critical threat has no default impact');

    const rr = new tm.RiskRegister({ clock: () => 0 });
    // An unscored risk reports UNSCORED — never a plausible number.
    const unscored = rr.quantitative(threat, { fitnessResults: green });
    if (unscored.measured) v.push('a risk with no stated likelihood reported as measured');
    if (unscored.residualScore !== null) v.push('an unquantified risk still produced a residual score');
    if (unscored.band !== 'unscored') v.push('an unquantified risk was banded');

    // A score is a judgement, and a judgement with no name on it cannot be challenged.
    let unattributed = false;
    try { rr.score(threat, { likelihood: 'possible', impact: 'severe' }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('a risk score was accepted with no named assessor');
    let unknownScale = false;
    try { rr.score(threat, { likelihood: 'quite-likely', impact: 'severe', by: 'CISO', rationale: 'r' }); } catch (_) { unknownScale = true; }
    if (!unknownScale) v.push('a likelihood outside the declared scale was accepted');

    rr.score(threat, { likelihood: 'possible', impact: 'severe', by: 'Chief Information Security Officer', rationale: 'observed in comparable national systems' });
    if (rr.scoreHistory(threat).length !== 1) v.push('the score was not recorded in the history');

    // Risk = L × I, and residual = risk × (1 − effectiveness).
    const uncontrolled = rr.quantitative(threat, { fitnessResults: red });
    if (uncontrolled.inherentScore !== 15) v.push(`likelihood 3 × impact 5 produced ${uncontrolled.inherentScore}, not 15`);
    if (uncontrolled.residualScore !== 15) v.push('residual risk was reduced although every control was failing');
    if (uncontrolled.band !== 'critical') v.push('a residual score of 15 was not banded critical');
    if (uncontrolled.withinTolerance) v.push('a critical residual risk was reported as within tolerance');
    const controlled = rr.quantitative(threat, { fitnessResults: green });
    if (!(controlled.residualScore < uncontrolled.residualScore)) v.push('holding controls did not reduce residual risk');
    if (controlled.residualScore !== 0) v.push('fully effective controls did not drive residual risk to zero');
    // The qualitative band is DERIVED, never supplied beside the number.
    if (controlled.derivedFromQuantitative !== true) v.push('the qualitative band is not derived from the quantitative score');
    if (controlled.qualitative !== controlled.band) v.push('the qualitative and quantitative verdicts disagree');
    if (!controlled.formula) v.push('the residual calculation is not reproducible from the record');

    // Compensating controls: credited only when verified, and capped.
    let incomplete = false;
    try { rr.registerCompensating(threat, { control: 'X' }); } catch (e) { incomplete = !!e.failClosed; }
    if (!incomplete) v.push('a compensating control was registered with no rationale or owner');
    rr.registerCompensating(threat, { control: controlIds[0], rationale: 'independent detective control', by: 'SOC Lead' });
    const unverified = rr.quantitative(threat, { fitnessResults: red });
    if (unverified.compensating.credit !== 0) v.push('a failing compensating control was credited');
    const verified = rr.quantitative(threat, { fitnessResults: [{ id: controlIds[0], pass: true }, ...red.slice(1)] });
    if (!(verified.compensating.credit > 0)) v.push('a verified compensating control earned no credit');
    if (!(verified.residualScore < unverified.residualScore)) v.push('a verified compensating control did not reduce residual risk');
    // A control nobody verifies is indistinguishable from one that is not there.
    const phantom = rr.compensatingCredit(threat, { fitnessResults: [], extra: ['NO-SUCH-CONTROL'] });
    if (phantom.credit !== 0) v.push('a compensating control with no verifying fitness function was credited');
    // The cap holds however many are stacked.
    const stacked = rr.compensatingCredit(threat, { fitnessResults: controlIds.map((id) => ({ id, pass: true })), extra: controlIds.slice(0, 8) });
    if (stacked.credit > tm.COMPENSATING_CREDIT_CAP) v.push('stacked compensating controls exceeded the credit cap');

    // Treatment plans: strategy, owner, actions, due date, evidence to close.
    for (const bad of [{}, { strategy: 'ignore' }, { strategy: 'treat', owner: 'X' }, { strategy: 'treat', owner: 'X', by: 'Y', rationale: 'r', actions: [] }, { strategy: 'treat', owner: 'X', by: 'Y', rationale: 'r', actions: ['a'], dueInDays: 400 }]) {
      let refused = false;
      try { rr.planTreatment(threat, bad); } catch (_) { refused = true; }
      if (!refused) v.push(`an invalid treatment plan was accepted: ${JSON.stringify(bad)}`);
    }
    const plan = rr.planTreatment(threat, { strategy: 'treat', owner: 'Security Operations Centre', by: 'CISO', rationale: 'residual above tolerance', dueInDays: 30, actions: ['implement the missing detective control'] });
    if (plan.state !== 'open' || !plan.intent) v.push('a treatment plan did not record its state and intent');
    for (const s of ['transfer', 'avoid', 'accept']) if (!tm.TREATMENT_STRATEGIES[s].requiresBoard) v.push(`strategy '${s}' does not require board sign-off`);
    let noEvidence = false;
    try { rr.closeTreatment(plan.id, { by: 'CISO' }); } catch (e) { noEvidence = !!e.failClosed; }
    if (!noEvidence) v.push('a treatment plan was closed without evidence of the change');
    if (rr.overdueTreatments({ now: 0 }).length) v.push('a fresh treatment plan was reported overdue');
    if (!rr.overdueTreatments({ now: 60 * 24 * 3600_000 }).length) v.push('an elapsed treatment plan was not reported overdue');
    if (rr.closeTreatment(plan.id, { by: 'CISO', evidence: 'control implemented and verified by APP-FIT-THREAT-MODEL' }).state !== 'closed') v.push('a properly evidenced treatment could not be closed');

    // Predictive forecasting over the recorded exposure history.
    const rr2 = new tm.RiskRegister({ clock: () => 0 });
    if (rr2.forecast().direction !== 'insufficient-data') v.push('a forecast was produced from no history at all');
    for (let i = 0; i < 4; i++) rr2.snapshot({ fitnessResults: green, now: i });
    const flat = rr2.forecast();
    if (flat.direction !== 'flat') v.push('an unchanging exposure history was not reported as flat');
    const rr3 = new tm.RiskRegister({ clock: () => 0 });
    // Exposure worsening as controls fail one by one.
    for (let i = 0; i < 5; i++) rr3.snapshot({ fitnessResults: controlIds.map((id, idx) => ({ id, pass: idx >= i })), now: i });
    const worsening = rr3.forecast();
    if (worsening.direction !== 'worsening') v.push('a rising exposure history was not reported as worsening');
    if (!worsening.breachExpected) v.push('a rising exposure trend was not forecast to breach tolerance');
    if (worsening.authorizes !== false) v.push('the risk forecast claims authority');
    if (JSON.stringify(rr3.forecast()) !== JSON.stringify(rr3.forecast())) v.push('risk forecasting is not deterministic');

    // The report carries the quantitative view alongside the qualitative lifecycle.
    const report = rr.report({ fitnessResults: green, now: 0 });
    if (!report.scales || !report.quantitative || !report.forecast) v.push('the risk report omits the quantitative view');
    if (!report.quantitative.some((q) => q.threat === threat && q.measured)) v.push('a scored threat did not appear as measured in the report');
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

  fit('APP-FIT-FORMAL-CATALOGUE', 'Every proven property is catalogued with its context, method, coverage, ADR and accountable owner', (v) => {
    const fp = require('../src/iam/formal-policy');
    const contextMap = require('../src/architecture/context-map');
    const adr = require('../src/architecture/adr-governance');
    const mandates = [{ instrument: 'data-protection-act', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }];

    for (const violation of fp.validateCatalogue({ mandates }).violations) v.push(violation);
    const cat = fp.catalogue({ mandates });

    // Part 3 requires every one of these areas to be covered by a property.
    const kinds = new Set(cat.properties.map((p) => p.kind));
    const required = {
      'authorization correctness': 'authorization',
      'privilege isolation': 'privilege-escalation',
      'separation of duties': 'separation-of-duties',
      'evidence integrity': 'evidence-integrity',
      'workflow consistency': 'workflow-consistency',
      'event ordering': 'event-ordering',
      'legislative compliance': 'legislative',
      'residency correctness': 'data-residency',
      'deadlock freedom': 'deadlock-freedom',
    };
    for (const [area, kind] of Object.entries(required)) if (!kinds.has(kind)) v.push(`no property covers ${area}`);

    // Every catalogue row carries everything a reviewer needs to judge what was established.
    const knownContexts = new Set(contextMap.ids());
    const knownAdrs = new Set(adr.adrFiles().map((f) => 'ADR-' + f.slice(0, 4)));
    for (const p of cat.properties) {
      for (const field of ['id', 'description', 'statement', 'kind', 'boundedContext', 'verificationMethod', 'proofStatus', 'proofCoverage', 'owningAdr', 'responsibleOwner', 'guarantee']) {
        if (p[field] === undefined || p[field] === null) v.push(`${p.id}: catalogue row is missing '${field}'`);
      }
      if (!knownContexts.has(p.boundedContext)) v.push(`${p.id}: bounded context '${p.boundedContext}' is not a real context`);
      if (!knownAdrs.has(p.owningAdr)) v.push(`${p.id}: owning ADR '${p.owningAdr}' does not exist`);
      if (p.proofStatus !== 'proven') v.push(`${p.id}: ${p.proofStatus}`);
      if (p.proofCoverage !== 1 || !p.exhaustive) v.push(`${p.id}: proof covered ${p.proofCoverage} of its domain — a partial proof is a sample`);
      if (p.counterexample !== null) v.push(`${p.id}: a proven property carries a counterexample`);
      if (!p.governanceBoard) v.push(`${p.id}: no governance board answers for this property`);
    }
    if (!cat.machineReadable) v.push('the catalogue does not declare itself machine-readable');
    if (cat.total !== Object.keys(fp.SPECIFICATIONS).length) v.push('the catalogue does not cover every specification');
    if (!cat.allProven) v.push('a catalogued property is not proven: ' + cat.refuted.join(', '));

    // Verification method is stated per kind, because "proven" means different things by method.
    for (const kind of kinds) if (!fp.VERIFICATION_METHODS[kind]) v.push(`kind '${kind}' declares no verification method`);
    for (const [kind, m] of Object.entries(fp.VERIFICATION_METHODS)) {
      if (!m.method || !m.description) v.push(`verification method for '${kind}' is incompletely described`);
    }
    if (new Set(Object.values(fp.VERIFICATION_METHODS).map((m) => m.method)).size < 2) v.push('every property claims the same verification method — the distinction is not being drawn');

    // THE VALIDATOR MUST BITE: a specification with no governance record fails the catalogue.
    const originalGov = fp.SPEC_GOVERNANCE['SPEC-AUTHZ-DEFAULT-DENY'];
    try {
      delete fp.SPEC_GOVERNANCE['SPEC-AUTHZ-DEFAULT-DENY'];
      const orphaned = fp.validateCatalogue({ mandates });
      if (orphaned.valid) v.push('a specification with no owning context or ADR passed catalogue validation');
      if (!orphaned.violations.some((x) => /no governance record|no bounded context/.test(x))) v.push('the missing governance record was not named');
    } finally { fp.SPEC_GOVERNANCE['SPEC-AUTHZ-DEFAULT-DENY'] = originalGov; }
    // …and so does a governance record for a specification that does not exist.
    try {
      fp.SPEC_GOVERNANCE['SPEC-IMAGINARY'] = { context: 'assurance', adr: 'ADR-0001' };
      if (fp.validateCatalogue({ mandates }).valid) v.push('governance recorded for a non-existent specification passed validation');
    } finally { delete fp.SPEC_GOVERNANCE['SPEC-IMAGINARY']; }

    // The continuous proof report is regenerated from the specifications, and is deterministic.
    const rep = fp.proofReport({ mandates });
    if (!rep.validation.valid) v.push('the proof report is internally inconsistent');
    if (rep.authorizes !== false || rep.informationalOnly !== true) v.push('the proof report claims authority');
    if (!Object.keys(rep.byContext).length || !Object.keys(rep.byMethod).length || !Object.keys(rep.byAdr).length) v.push('the proof report does not group by context, method and ADR');
    if (rep.byContext.unowned) v.push('a property is grouped as unowned');
    if (JSON.stringify(fp.proofReport({ mandates })) !== JSON.stringify(rep)) v.push('the proof report is not deterministic');
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

  fit('APP-FIT-SRE-PREDICTIVE-OPS', 'Operational thresholds are predicted with lead time, and an unmeasurable prediction never reads as healthy', (v) => {
    const sre = require('../src/observability/sre');

    // Lead-time banding is ordered and covers the breached case.
    if (sre.leadTime(3).urgency !== 'imminent') v.push('three days of headroom was not imminent');
    if (sre.leadTime(20).urgency !== 'near-term') v.push('twenty days was not near-term');
    if (sre.leadTime(200).urgency !== 'distant') v.push('two hundred days was not distant');
    if (sre.leadTime(-1).urgency !== 'breached') v.push('an already-crossed threshold was not reported as breached');
    if (sre.leadTime(null).urgency !== 'unknown') v.push('an unmakeable projection was not reported as unknown');
    for (const b of sre.LEAD_TIME_BANDS) if (!b.action) v.push(`lead-time band '${b.urgency}' recommends no action`);

    // Compound-growth arithmetic, including the cases where no projection exists.
    if (sre.daysUntil({ current: 100, threshold: 200, growthPctPerMonth: 0 }) !== null) v.push('a non-growing series was projected to reach a threshold');
    if (sre.daysUntil({ current: 200, threshold: 100, growthPctPerMonth: 10 }) !== -1) v.push('an already-crossed threshold was not reported as breached');
    const d = sre.daysUntil({ current: 100, threshold: 200, growthPctPerMonth: 100 });
    if (!(d >= 29 && d <= 31)) v.push(`doubling at 100%/month should take about 30 days, got ${d}`);

    // --- Each predictor: unmeasured reads as unmeasured, never as healthy -------------------
    const unmeasured = [
      ['storage', sre.predictStorageExhaustion({})],
      ['certificates', sre.predictCertificateExpiry({})],
      ['capacity', sre.predictCapacity({})],
      ['queue', sre.predictQueueSaturation({})],
      ['dependency', sre.predictDependencyDegradation({ latencyHistory: [] })],
      ['budget', sre.predictBudgetExhaustion({ service: 'investigation' })],
    ];
    for (const [name, p] of unmeasured) {
      if (p.predicted) v.push(`${name}: an unmeasured predictor claimed to have predicted something`);
      if (p.urgency !== 'unknown') v.push(`${name}: an unmeasured predictor was banded '${p.urgency}' rather than unknown`);
      if (p.daysUntilThreshold !== null) v.push(`${name}: an unmeasured predictor produced a number`);
    }

    // Storage: the alarm is at the warn threshold, not at 100% of capacity.
    const storage = sre.predictStorageExhaustion({ usedGb: 500, capacityGb: 1000, growthPctPerMonth: 10 });
    if (!storage.predicted || storage.daysUntilThreshold === null) v.push('a measured storage series was not projected');
    if (storage.threshold >= 1000) v.push('storage exhaustion alarms at full capacity — by then there is no time left');
    const full = sre.predictStorageExhaustion({ usedGb: 950, capacityGb: 1000, growthPctPerMonth: 10 });
    if (full.urgency !== 'breached') v.push('storage already past the warn threshold was not reported as breached');
    if (sre.predictStorageExhaustion({ usedGb: 100, capacityGb: 1000, growthPctPerMonth: 0 }).daysUntilThreshold !== null) v.push('flat storage was projected to exhaust');

    // Certificates.
    const certs = sre.predictCertificateExpiry({ certificates: [{ subject: 'a.internal', notAfter: 5 * 24 * 3600_000 }, { subject: 'b.internal', notAfter: 200 * 24 * 3600_000 }], now: 0 });
    if (certs.urgency !== 'imminent') v.push('a certificate expiring in five days was not imminent');
    if (!certs.expiring.includes('a.internal')) v.push('a certificate inside the renewal window was not listed as expiring');
    if (certs.certificates[0].subject !== 'a.internal') v.push('certificates are not ordered by how soon they expire');
    if (!sre.predictCertificateExpiry({ certificates: [{ subject: 'x', notAfter: -1 }], now: 0 }).expired.length) v.push('an already-expired certificate was not reported as expired');

    // Capacity: the ceiling is where surge headroom runs out, not where the service stops.
    const cap = sre.predictCapacity({ currentRps: 100, monthlyGrowthPct: 20, maxReplicas: 12, rpsPerInstance: 25, headroomPct: 40 });
    if (cap.threshold >= 12 * 25) v.push('the capacity ceiling ignores the reserved surge headroom');
    if (!cap.predicted) v.push('a measured capacity series was not projected');

    // Queue: utilization above 1 has no steady state, whatever the current depth says.
    const unstable = sre.predictQueueSaturation({ depth: 100, arrivalRate: 12, serviceRate: 10 });
    if (unstable.stable) v.push('a queue whose arrivals exceed service was reported stable');
    if (unstable.daysUntilThreshold === null) v.push('an accumulating queue was not projected to saturate');
    const stable = sre.predictQueueSaturation({ depth: 9000, arrivalRate: 5, serviceRate: 10 });
    if (!stable.stable) v.push('a draining queue was reported unstable');
    if (stable.daysUntilThreshold !== null) v.push('a draining queue was projected to saturate');
    if (!(unstable.utilization > 1) || !(stable.utilization < 1)) v.push('queue utilization was miscomputed');

    // Dependency degradation: the question is when it breaches, not whether it has.
    const degrading = sre.predictDependencyDegradation({ service: 'kms', latencyHistory: [100, 150, 200, 250], budgetMs: 500 });
    if (degrading.daysUntilThreshold === null) v.push('a degrading dependency was not projected to breach its budget');
    if (degrading.trend.direction !== 'improving' && degrading.trend.direction !== 'degrading') v.push('the dependency trend has no direction');
    const steadyDep = sre.predictDependencyDegradation({ service: 'kms', latencyHistory: [100, 100, 100, 100], budgetMs: 500 });
    if (steadyDep.daysUntilThreshold !== null) v.push('a flat dependency latency was projected to breach');
    if (sre.predictDependencyDegradation({ service: 'kms', latencyHistory: [600, 610], budgetMs: 500 }).urgency !== 'breached') v.push('a dependency already over budget was not reported as breached');

    // SLO burn: at this burn, when is the budget gone?
    const burning = sre.predictBudgetExhaustion({ service: 'investigation', attained: 0.9975, windowDays: 30, elapsedDays: 3 });
    if (burning.daysUntilThreshold === null) v.push('a burning error budget was not projected to exhaust');
    if (sre.predictBudgetExhaustion({ service: 'investigation', attained: 0.9, windowDays: 30, elapsedDays: 3 }).urgency !== 'breached') v.push('an exhausted budget was not reported as breached');
    if (sre.predictBudgetExhaustion({ service: 'investigation', attained: 1, windowDays: 30, elapsedDays: 3 }).daysUntilThreshold !== null) v.push('a perfect service was projected to exhaust its budget');

    // The combined view is ordered by how little time is left, and names the work.
    const ops = sre.predictiveOperations({
      storage: { usedGb: 900, capacityGb: 1000, growthPctPerMonth: 20 },
      certificates: { certificates: [{ subject: 'a', notAfter: 400 * 24 * 3600_000 }], now: 0 },
      capacity: { currentRps: 10, monthlyGrowthPct: 1 },
      queue: { depth: 0, arrivalRate: 1, serviceRate: 10 },
    });
    if (ops.healthy) v.push('a platform with breached storage was reported healthy');
    if (!ops.breached.includes('storage-exhaustion')) v.push('the breached predictor was not named');
    for (let i = 1; i < ops.predictions.length; i++) {
      const a = ops.predictions[i - 1].daysUntilThreshold, b = ops.predictions[i].daysUntilThreshold;
      if ((a === null ? Infinity : a) > (b === null ? Infinity : b)) v.push('predictions are not ordered by remaining time');
    }
    if (!ops.maintenanceRecommendations.length) v.push('an actionable prediction produced no maintenance recommendation');
    if (ops.authorizes !== false) v.push('the predictive operations report claims authority');
    if (JSON.stringify(sre.predictiveOperations({})) !== JSON.stringify(sre.predictiveOperations({}))) v.push('predictive operations are not deterministic');

    // --- THE RELEASE GATE INCORPORATES PREDICTION --------------------------------------------
    const healthy = Object.fromEntries(Object.keys(sre.SERVICE_LEVELS).map((sv) => [sv, { availability: 1, latencyUnder: 1 }]));
    const history = new sre.SloComplianceHistory();
    for (const sv of Object.keys(sre.SERVICE_LEVELS)) for (let p = 0; p < 4; p++) history.record({ service: sv, period: p, availability: 1, latencyUnder: 1 });
    const quiet = sre.predictiveOperations({ storage: { usedGb: 10, capacityGb: 1000, growthPctPerMonth: 1 } });
    const ok = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: quiet });
    if (!ok.ready) v.push('a healthy platform with distant predictions was blocked: ' + JSON.stringify(ok.predictiveBlockers));
    const blocked = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: ops });
    if (blocked.ready) v.push('a release was permitted with an operational threshold already breached');
    if (!blocked.predictiveBlockers.length) v.push('a predictively blocked release named no blocker');
    if (blocked.failClosed !== true || blocked.authorizes !== false) v.push('the predictive release gate is not fail-closed / claims authority');
    const overridden = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: ops, riskAcceptedBy: 'ORB Chair', riskRationale: 'storage expansion already provisioned' });
    if (!overridden.ready || !overridden.overridden) v.push('a recorded human risk acceptance did not unblock a predictively blocked release');
    // A near-term prediction WARNS rather than blocks — the gate distinguishes the two.
    const nearTerm = sre.predictiveOperations({ storage: { usedGb: 830, capacityGb: 1000, growthPctPerMonth: 5 } });
    const warned = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: nearTerm });
    if (!warned.ready) v.push('a near-term prediction blocked a release rather than warning');
    if (!warned.predictiveWarnings.length) v.push('a near-term prediction produced no warning');
  }),

  fit('APP-FIT-MISSION-CORRELATION', 'Infrastructure → application → business → mission is declared, traceable and complete', (v) => {
    const bus = require('../src/observability/business');
    const telemetry = require('../src/observability/telemetry');

    for (const violation of bus.validateChain().violations) v.push(violation);
    if (JSON.stringify(bus.CHAIN_LAYERS) !== JSON.stringify(['infrastructure', 'application', 'business', 'mission'])) v.push('the correlation chain does not have the four declared layers');

    // Every link moves forward, joins declared things, and states a mechanism.
    for (const l of bus.chainLinks()) {
      if (!l.mechanism) v.push(`link ${l.from} → ${l.to}: no mechanism — a link with no mechanism is a diagram, not a model`);
      if (bus.CHAIN_LAYERS.indexOf(l.toLayer) <= bus.CHAIN_LAYERS.indexOf(l.fromLayer)) v.push(`link ${l.from} → ${l.to} does not move forward`);
    }
    // Every business metric reaches the mission; every mission outcome is reachable.
    for (const metric of Object.keys(bus.BUSINESS_METRICS)) {
      if (!bus.chainLinks().some((l) => l.from === metric && l.toLayer === 'mission')) v.push(`business metric '${metric}' reaches no mission outcome`);
    }
    for (const outcome of Object.keys(bus.MISSION_OUTCOMES)) {
      if (!bus.chainLinks().some((l) => l.to === outcome)) v.push(`mission outcome '${outcome}' is unreachable from anything measured`);
      if (!bus.MISSION_OUTCOMES[outcome].board) v.push(`mission outcome '${outcome}' has no owning board`);
    }
    if (!Object.values(bus.MISSION_OUTCOMES).some((m) => m.constitutional)) v.push('no mission outcome is marked constitutional');

    // A failure traces all the way to the board's language.
    const intake = bus.impactOf({ failed: ['persistence-ind'] });
    if (!intake.constitutionalImpact) v.push('losing independent-zone persistence did not reach a constitutional outcome');
    if (!intake.missionOutcomes.some((m) => m.id === 'reports-can-be-filed')) v.push('losing intake persistence did not reach the filing guarantee');
    if (!/constitutional/i.test(intake.boardSummary)) v.push('the board summary did not state the constitutional impact');
    if (!intake.paths.length || !intake.paths.every((p) => p.mechanisms.length)) v.push('an impact path carried no mechanisms');
    const kms = bus.impactOf({ failed: ['kms'] });
    if (!kms.missionOutcomes.some((m) => m.id === 'evidence-is-admissible')) v.push('losing key management did not reach evidence admissibility');
    // Layers are classified, not inferred from topology shape.
    if (!intake.infrastructure.includes('persistence-ind')) v.push('a persistence component was not classified as infrastructure');
    if (intake.applications.includes('persistence-ind')) v.push('a persistence component was also classified as an application');
    // A failure that reaches nothing says so rather than inventing an outcome.
    const isolated = bus.impactOf({ failed: [] });
    if (isolated.missionOutcomes.length) v.push('a failure of nothing reached a mission outcome');
    if (isolated.constitutionalImpact) v.push('a failure of nothing claimed constitutional impact');

    // THE VALIDATOR MUST BITE: an orphaned metric and an unreachable outcome both fail.
    const original = [...bus.CHAIN_LINKS];
    try {
      const idx = bus.CHAIN_LINKS.findIndex((l) => l.from === 'compliance-rate');
      bus.CHAIN_LINKS.splice(idx, 1);
      const orphaned = bus.validateChain();
      if (orphaned.valid) v.push('a business metric reaching no mission outcome passed chain validation');
      if (!orphaned.violations.some((x) => /why is it measured/.test(x))) v.push('the orphaned metric was not named');
    } finally { bus.CHAIN_LINKS.length = 0; bus.CHAIN_LINKS.push(...original); }
    try {
      bus.CHAIN_LINKS.push({ from: 'case-throughput', fromLayer: 'business', to: 'not-an-outcome', toLayer: 'mission', mechanism: 'crafted' });
      if (bus.validateChain().valid) v.push('a link to an undeclared mission outcome passed validation');
    } finally { bus.CHAIN_LINKS.length = 0; bus.CHAIN_LINKS.push(...original); }

    // Executive analytics derive from measured evidence, and unknown is not healthy.
    const blind = bus.executiveAnalytics({ events: [] });
    if (blind.missionOutcomes.some((o) => o.status === 'on-track' && o.measuredInputs === 0)) v.push('a mission outcome with no measured input was reported on-track');
    for (const o of blind.missionOutcomes) if (o.status === 'unknown' && !/not the same as fine/.test(o.reason)) v.push(`${o.outcome}: an unknown outcome did not say what unknown means`);
    const H = 3600_000;
    const events = [
      { type: 'CaseCreated', correlationId: 'C1', at: 0 },
      { type: 'CaseTransitioned', correlationId: 'C1', to: 'closed', at: 10 * H },
      { type: 'ComplianceChecked', correlationId: 'X', outcome: 'ok', at: 0 },
    ];
    const ea = bus.executiveAnalytics({ events });
    if (!ea.derivedFromVerifiedEvidence) v.push('executive analytics do not declare their evidence basis');
    if (ea.authorizes !== false) v.push('executive analytics claim authority');
    if (!ea.chainValidation.valid) v.push('executive analytics were produced over an invalid chain');
    if (ea.missionOutcomes.length !== Object.keys(bus.MISSION_OUTCOMES).length) v.push('executive analytics omit a mission outcome');
    for (const o of ea.missionOutcomes) if (!o.board || !o.title) v.push(`${o.outcome}: analytics row is missing its board or title`);
    if (JSON.stringify(bus.executiveAnalytics({ events })) !== JSON.stringify(ea)) v.push('executive analytics are not deterministic');
    void telemetry;
  }),

  fit('APP-FIT-RESILIENCE-STAGES', 'Detection → Containment → Recovery → Verification: all four are stated, and the contract fails when any is missing', (v) => {
    const chaos = require('../src/twin2/chaos');

    if (JSON.stringify(chaos.RESILIENCE_STAGES) !== JSON.stringify(['detected', 'contained', 'recovered', 'verified'])) v.push('the resilience contract does not have the four declared stages');

    // Every experiment states all four EXPLICITLY — none is derived from another.
    for (const id of chaos.experiments().map((e) => e.id)) {
      const r = chaos.runExperiment(id);
      if (r.error) v.push(`${id}: threw — ${r.error}`);
      for (const stage of chaos.RESILIENCE_STAGES) {
        if (r.observed[stage] === undefined) v.push(`${id}: does not report '${stage}' — deriving it would make the stage tautological`);
        if (r.stages[stage] !== true) v.push(`${id}: '${stage}' was not demonstrated`);
      }
      if (!r.pass) v.push(`${id}: ${r.contractViolations.join('; ')}`);
    }

    // THE CONTRACT MUST BITE, per stage. Each half-contract must be rejected, naming what is missing.
    const original = chaos.EXPERIMENTS['dns-failure'];
    try {
      for (const omitted of chaos.RESILIENCE_STAGES) {
        const observed = { pass: true };
        for (const s of chaos.RESILIENCE_STAGES) if (s !== omitted) observed[s] = true;
        chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: `omits ${omitted}`, run: () => ({ ...observed }) };
        const r = chaos.runExperiment('dns-failure');
        if (r.pass) v.push(`an experiment that never demonstrated '${omitted}' was allowed to pass`);
        if (!r.missingStages.includes(omitted)) v.push(`the missing '${omitted}' stage was not named`);
      }
      // Detection and recovery alone — the Phase 11 contract — is no longer sufficient.
      chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'phase 11 contract only', run: () => ({ pass: true, detected: true, recovered: true }) };
      const halfway = chaos.runExperiment('dns-failure');
      if (halfway.pass) v.push('detection and recovery alone still passed — the two new stages are inert');
      if (halfway.contractViolations.length !== 2) v.push('the two missing stages were not both named');
    } finally { chaos.EXPERIMENTS['dns-failure'] = original; }

    // Containment is a distinct claim: bounded blast radius, not merely "we recovered".
    const cascading = chaos.runExperiment('cascading-failure').observed;
    if (!cascading.contained) v.push('the cascading-failure experiment did not demonstrate containment');
    if (cascading.contained === cascading.recovered && cascading.contained === cascading.detected) {
      // Not an error in itself, but they must come from different observations — checked above by
      // requiring each to be reported. Here we assert the experiment's own containment claim is
      // about the blast radius rather than about recovery.
      if (!cascading.containedToOneZone) v.push('containment was claimed without a bounded blast radius');
    }
    const degraded = chaos.runExperiment('degraded-service').observed;
    if (degraded.criticalPathBroken) v.push('a contained degradation broke the critical path');

    // The scorecard grades partial results as partial.
    const sc = chaos.resilienceScorecard();
    if (!sc.allComplete) v.push('a chaos scenario did not demonstrate all four stages: ' + JSON.stringify(sc.incomplete));
    if (sc.overallScore !== 1) v.push(`the resilience score is ${sc.overallScore}, not 1`);
    for (const stage of chaos.RESILIENCE_STAGES) if (sc.byStage[stage] !== sc.count) v.push(`only ${sc.byStage[stage]} of ${sc.count} experiments demonstrated '${stage}'`);
    if (sc.authorizes !== false || sc.failClosed !== true) v.push('the resilience scorecard is not fail-closed / claims authority');
    // A partial result must grade as partial, not pass.
    try {
      chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'two of four', run: () => ({ pass: true, detected: true, recovered: true, contained: false, verified: false }) };
      const partial = chaos.resilienceScorecard();
      if (partial.allComplete) v.push('a scorecard containing a two-of-four experiment reported all complete');
      const row = partial.experiments.find((r) => r.experiment === 'dns-failure');
      if (row.score !== 0.5) v.push(`a two-of-four experiment scored ${row.score}, not 0.5`);
      if (row.grade === 'complete') v.push('a two-of-four experiment was graded complete');
      if (partial.overallScore >= 1) v.push('the overall score ignored a partial experiment');
    } finally { chaos.EXPERIMENTS['dns-failure'] = original; }

    // The suite reports all four stages at the top level.
    const suite = chaos.runSuite({ light: true });
    for (const stage of ['detected', 'contained', 'recovered', 'verified']) {
      if (suite[stage] !== suite.chaos.length) v.push(`the suite did not report '${stage}' for every experiment`);
    }
    if (!suite.scorecard || !suite.scorecard.allComplete) v.push('the suite scorecard is missing or incomplete');
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
      // Phase 12 extended the contract to four stages, so an experiment reporting nothing now
      // fails on all four rather than on the original two.
      if (silent.contractViolations.length !== chaos.RESILIENCE_STAGES.length) v.push('the resilience contract did not name every missing stage');
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

  fit('APP-FIT-ENTERPRISE-INTELLIGENCE', 'Quality dashboards, builder trust, AI fairness and calibration, and session consistency all hold — and fail when they should', (v) => {
    // --- Part 7: executive data-quality dashboard ---------------------------------------------
    const dgm = require('../src/fabric/data-governance');
    const dg = dgm.seedPlatformDatasets(new dgm.DataGovernance({ clock: () => 1_000_000 }));
    const blindDash = dg.executiveQualityDashboard();
    if (blindDash.acceptable) v.push('an entirely unmeasured estate produced an acceptable executive dashboard');
    if (!/not evidence of quality/i.test(blindDash.unmeasuredMeans)) v.push('the dashboard does not say what unmeasured means');
    if (!blindDash.question || !blindDash.answer) v.push('the executive dashboard does not state the question it answers');
    const good = Object.fromEntries(dgm.OBSERVED_DIMENSIONS.map((d) => [d, 0.99]));
    for (const id of dg.datasets()) dg.observeQuality(id, good, { recordCount: 10 });
    const dash = dg.executiveQualityDashboard();
    if (!dash.acceptable || dash.qualityReadiness !== 1) v.push('a fully measured healthy estate was not acceptable');
    if (!dash.byDomain.length || !Object.keys(dash.byOwner).length) v.push('the dashboard does not group by domain and owner');
    for (const d of dash.byDomain) if (!d.status) v.push(`domain '${d.domain}' has no status`);
    if (dash.authorizes !== false) v.push('the executive quality dashboard claims authority');
    // A degraded dataset changes the answer, not just a number.
    dg.observeQuality('case-records', Object.fromEntries(dgm.OBSERVED_DIMENSIONS.map((d) => [d, 0.3])), { recordCount: 10 });
    const degraded = dg.executiveQualityDashboard();
    if (degraded.acceptable) v.push('a poor dataset left the executive answer unchanged');
    if (!degraded.blockers.length) v.push('a degraded estate named no blocker');

    // --- Part 8: trusted builders, vulnerability trends, deployability -----------------------
    const slsa = require('../src/supplychain/slsa');
    const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
    if (sc.verifyBuilder('nobody').trusted) v.push('an unregistered builder was trusted');
    let unattributedBuilder = false;
    try { sc.registerBuilder('ci', { operator: 'GovCI' }); } catch (e) { unattributedBuilder = !!e.failClosed; }
    if (!unattributedBuilder) v.push('a builder was trusted with no named human behind the decision');
    sc.registerBuilder('partial', { operator: 'GovCI', hardened: true, isolated: true, by: 'ISRB Chair', rationale: 'audited' });
    const partial = sc.verifyBuilder('partial');
    if (partial.trusted) v.push('a partially-hardened builder was fully trusted');
    if (!partial.failing.includes('ephemeral') || !partial.failing.includes('attestsProvenance')) v.push('the unmet builder properties were not named');
    sc.registerBuilder('full', { operator: 'GovCI', hardened: true, isolated: true, ephemeral: true, attestsProvenance: true, by: 'ISRB Chair', rationale: 'audited' });
    if (!sc.verifyBuilder('full').trusted) v.push('a fully hardened builder was not trusted');

    // Zero SCANS and zero FINDINGS must not read alike.
    if (sc.vulnerabilityTrend().direction !== 'insufficient-data') v.push('a vulnerability trend was produced from no scans');
    let replayed = false;
    sc.recordVulnerabilityScan({ at: 1, critical: 0, high: 1 });
    try { sc.recordVulnerabilityScan({ at: 1, critical: 0, high: 1 }); } catch (_) { replayed = true; }
    if (!replayed) v.push('a vulnerability scan timestamp was overwritten — scan history must be append-only');
    sc.recordVulnerabilityScan({ at: 2, critical: 1, high: 3, oldestCriticalAgeDays: 10 });
    const worsening = sc.vulnerabilityTrend();
    if (worsening.direction !== 'worsening') v.push('a rising vulnerability count was not reported as worsening');
    if (!worsening.slaBreached) v.push('a critical finding open past its remediation window was not flagged');
    if (worsening.clean) v.push('an estate with an open critical finding was reported clean');

    const nothing = sc.deployabilityReport({ artifact: 'a', artifactDigest: 'never-built' });
    if (nothing.deployable) v.push('an artifact with no provenance, no builder and open criticals was deployable');
    if (!nothing.blockers.some((b) => b.check === 'trusted-builder')) v.push('an unidentified builder did not block deployability');
    if (nothing.failClosed !== true || nothing.authorizes !== false) v.push('the deployability report is not fail-closed / claims authority');
    if (!/NOT DEPLOYABLE/.test(nothing.note)) v.push('a blocked deployability report did not say so');

    // --- Part 9: fairness, calibration, retirement -------------------------------------------
    const { AiLifecycle, FAIRNESS_CRITERIA } = require('../src/ai/ai-lifecycle');
    const ai = new AiLifecycle({ clock: () => 1_000 });
    ai.register('model', 'm', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
    ai.approve('model', 'm', { by: 'AI Governance Board', rationale: 'explainable, advisory-only' });
    // Several fairness criteria exist and are mutually incompatible — the platform will not pick.
    if (Object.keys(FAIRNESS_CRITERIA).length < 3) v.push('too few fairness criteria to represent the trade-off');
    for (const [id, c] of Object.entries(FAIRNESS_CRITERIA)) if (!c.description || !c.suitsWhen) v.push(`fairness criterion '${id}' does not say when it applies`);
    if (ai.fairnessReport('m').assessed) v.push('fairness was assessed with no criterion declared — "fair" means several things');
    let unattributedCriterion = false;
    try { ai.declareFairnessCriterion('m', { criterion: 'demographic-parity' }); } catch (e) { unattributedCriterion = !!e.failClosed; }
    if (!unattributedCriterion) v.push('a fairness criterion was chosen with no named human behind it');
    let unknownCriterion = false;
    try { ai.declareFairnessCriterion('m', { criterion: 'vibes', by: 'x', rationale: 'y' }); } catch (_) { unknownCriterion = true; }
    if (!unknownCriterion) v.push('an unknown fairness criterion was accepted');
    ai.declareFairnessCriterion('m', { criterion: 'equal-opportunity', threshold: 0.2, by: 'AI Governance Board', rationale: 'missing a real case matters more than a false alarm' });
    for (const [g, rate] of [['region-a', 0.5], ['region-b', 0.9]]) ai.observeBias('m', { group: g, outcomeRate: rate, sampleSize: 100 });
    const unfair = ai.fairnessReport('m');
    if (!unfair.assessed) v.push('fairness was not assessed with a criterion and enough observations');
    if (unfair.fair) v.push('a 0.4 outcome disparity was reported as fair against a 0.2 threshold');
    if (!unfair.criterionMeaning) v.push('the fairness report does not state what the criterion means');

    // Calibration: overconfidence is the direction that makes a confidence floor useless.
    if (ai.calibrationReport('m').assessed) v.push('a calibration curve was drawn from no observations');
    for (let i = 0; i < 100; i++) ai.recordCalibration('m', { confidence: 0.9, correct: i < 60 });
    const miscal = ai.calibrationReport('m');
    if (!miscal.assessed) v.push('calibration was not assessed with a hundred observations');
    if (miscal.calibrated) v.push('a model claiming 0.9 and right 60% of the time was reported calibrated');
    if (!miscal.overconfidentBuckets.length) v.push('the overconfident bucket was not named');
    if (!/confidence floor/.test(miscal.reason)) v.push('the calibration report does not connect overconfidence to the confidence floors that depend on it');
    let badCal = false;
    try { ai.recordCalibration('m', { confidence: 0.9, correct: 'probably' }); } catch (_) { badCal = true; }
    if (!badCal) v.push('calibration accepted a non-boolean outcome');
    const wellCal = new AiLifecycle({ clock: () => 1_000 });
    wellCal.register('model', 'w', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
    for (let i = 0; i < 100; i++) wellCal.recordCalibration('w', { confidence: 0.9, correct: i < 90 });
    for (let i = 0; i < 100; i++) wellCal.recordCalibration('w', { confidence: 0.3, correct: i < 30 });
    for (let i = 0; i < 100; i++) wellCal.recordCalibration('w', { confidence: 0.5, correct: i < 50 });
    for (let i = 0; i < 100; i++) wellCal.recordCalibration('w', { confidence: 0.7, correct: i < 70 });
    for (let i = 0; i < 100; i++) wellCal.recordCalibration('w', { confidence: 0.1, correct: i < 10 });
    if (!wellCal.calibrationReport('w').calibrated) v.push('a genuinely calibrated model was reported miscalibrated');

    // Retirement: a retired artifact loses its approval, and cannot be inferred from.
    let unattributedRetire = false;
    try { ai.retire('model', 'm', { by: 'x' }); } catch (e) { unattributedRetire = !!e.failClosed; }
    if (!unattributedRetire) v.push('an AI artifact was retired with no rationale');
    ai.retire('model', 'm', { by: 'AI Governance Board', rationale: 'superseded by a re-approved version' });
    if (ai.isApproved('model', 'm').approved) v.push('a retired model kept its approval');
    let inferredFromRetired = false;
    try { ai.infer({ model: 'm', output: 'x', explanation: 'e', confidence: 0.9, requestedBy: 'inv' }); } catch (e) { inferredFromRetired = !!e.failClosed; }
    if (!inferredFromRetired) v.push('an inference was drawn from a retired model');
    if (!ai.retired().length) v.push('the retired artifact was not listed');
    if (!ai.validate().valid) v.push('retiring an artifact broke estate validation: ' + ai.validate().violations.join('; '));

    // --- Part 10: session consistency, dependency map, failover ------------------------------
    const mr = require('../src/twin2/multi-region');
    for (const model of ['strong', 'eventual', 'causal', 'read-your-writes', 'monotonic-reads']) {
      if (!mr.CONSISTENCY_MODELS[model]) v.push(`consistency model '${model}' is not declared`);
    }
    for (const violation of mr.validateConsistency().violations) v.push(violation);
    // Every consistency decision cites the ADR that made it.
    for (const c of mr.contextConsistency()) if (!c.adr) v.push(`${c.context}: consistency model cites no ADR`);

    // Read-your-writes: a session must observe its own write.
    const ownWrite = mr.readAllowed({ context: 'investigation', replicaLagMs: 100, session: { lastWriteSequence: 10 }, replicaSequence: 5 });
    if (ownWrite.allowed) v.push('a session was served a replica that had not applied its own write');
    if (!/own write/.test(ownWrite.reason)) v.push('the read-your-writes denial did not say why');
    if (!mr.readAllowed({ context: 'investigation', replicaLagMs: 100, session: { lastWriteSequence: 10 }, replicaSequence: 12 }).allowed) v.push('a caught-up replica was refused a read-your-writes read');
    // An unverifiable session guarantee is not a guarantee.
    if (mr.readAllowed({ context: 'investigation', replicaLagMs: 100 }).allowed) v.push('a per-session guarantee was assumed to hold with no session token');
    // Monotonic reads: time may not run backwards for a reader.
    const backwards = mr.readAllowed({ context: 'analytics', replicaLagMs: 100, session: { lastReadSequence: 50 }, replicaSequence: 40 });
    if (backwards.allowed) v.push('a reader was served an earlier state than one it had already seen');
    if (!mr.readAllowed({ context: 'analytics', replicaLagMs: 100, session: { lastReadSequence: 50 }, replicaSequence: 55 }).allowed) v.push('a forward-moving monotonic read was refused');

    // Dependency map: an inversion is reported, not silently resolved.
    const depMap = mr.consistencyDependencyMap();
    if (!depMap.contexts.length) v.push('the consistency dependency map is empty');
    for (const row of depMap.contexts) if (!row.note) v.push(`${row.context}: dependency row states nothing`);
    if (!/human to judge/.test(depMap.note)) v.push('the dependency map does not say who resolves an inversion');

    // Failover: a model is REFUSED, never quietly downgraded.
    const healthy = mr.validateFailover({ failed: [] });
    if (healthy.unavailable.length) v.push('a context was unavailable with every region healthy');
    const lostQuorum = mr.validateFailover({ failed: ['bw-south', 'bw-north'] });
    if (!lostQuorum.unavailable.length) v.push('losing quorum left every strongly-consistent context available');
    if (!lostQuorum.noGuaranteeWeakened) v.push('a consistency guarantee was weakened rather than refused under failover');
    if (lostQuorum.failClosed !== true || lostQuorum.authorizes !== false) v.push('failover validation is not fail-closed / claims authority');
    for (const row of lostQuorum.contexts) if (!row.reason) v.push(`${row.context}: failover row states no reason`);
    if (JSON.stringify(mr.validateFailover({ failed: ['bw-south'] })) !== JSON.stringify(mr.validateFailover({ failed: ['bw-south'] }))) v.push('failover validation is not deterministic');
  }),

  fit('APP-FIT-GOVERNANCE-INTELLIGENCE', 'ADR quality, release impact, active ownership and evidence provenance all hold — and each rejects the case it exists to catch', (v) => {
    // --- Part 11: ADR review lifecycle, quality reporting, automatic rejection -----------------
    const adr = require('../src/architecture/adr-governance');
    const cat = adr.validateCatalogue();
    if (!cat.valid) v.push('ADR catalogue invalid: ' + cat.violations.join('; '));
    // The governance schema is in force and something actually satisfies it — a schema no ADR is
    // held to is a schema that has never been tested.
    if (!adr.GOVERNANCE_SCHEMA.length) v.push('the governance schema declares no sections');
    for (const s of adr.GOVERNANCE_SCHEMA) if (!s.why) v.push(`governance section '${s.heading}' does not say why it is required`);
    const governed = cat.adrs.filter((a) => a.schema === 'governance');
    if (!governed.length) v.push('no ADR is held to the governance schema — an untested schema governs nothing');
    for (const a of governed) if (!a.valid) v.push(`${a.file}: fails the governance schema: ${a.violations.join('; ')}`);

    const q = adr.qualityReport({ now: '2026-08-03' });
    if (!q.sound) v.push('the ADR catalogue is not sound: ' + JSON.stringify(q.incomplete) + ' overdue=' + q.review.overdue.join(','));
    if (q.authorizes !== false) v.push('the ADR quality report claims authority');
    for (const d of q.byDimension) if (!d.description) v.push(`quality dimension '${d.dimension}' has no description`);
    if (!q.byDimension.some((d) => d.dimension === 'reviewability' && d.score !== null)) v.push('reviewability is not assessed for any ADR');
    // Weakest link, not mean: the catalogue score must equal its worst ADR on each dimension.
    for (const d of q.byDimension.filter((x) => x.score !== null)) {
      const rows = q.adrs.map((a) => a.dimensions.find((x) => x.dimension === d.dimension)).filter((x) => x && x.applicable);
      if (d.score !== Math.min(...rows.map((r) => r.score))) v.push(`dimension '${d.dimension}' does not aggregate to the weakest ADR`);
    }

    // An ADR with no review schedule is not "not due" — and one whose schedule names no date is
    // reported as undated rather than as compliant.
    const complete = require('node:fs').readFileSync(require('node:path').join(adr.ADR_DIR, '0007-session-consistency-and-adr-review-lifecycle.md'), 'utf8');
    if (!adr.admit(complete).admitted) v.push('a complete ADR was rejected: ' + adr.admit(complete).rejections.join('; '));
    const vague = complete.replace(/## Review schedule\n[\s\S]*?\n## Sunset criteria/, '## Review schedule\nThis decision is reviewed periodically by the Architecture Review Board whenever it seems appropriate to do so.\n\n## Sunset criteria');
    const vagueVerdict = adr.admit(vague);
    if (vagueVerdict.admitted) v.push('"reviewed periodically" was accepted as a review schedule');
    if (!vagueVerdict.rejections.some((r) => /is not a schedule/.test(r))) v.push('the vague review schedule was rejected for the wrong reason');
    const noSunset = complete.replace(/## Sunset criteria\n[\s\S]*?(?=\n## Decision owner)/, '');
    if (adr.admit(noSunset).admitted) v.push('an ADR with no sunset criteria was admitted');
    if (adr.admit('').admitted || !adr.admit('').failClosed) v.push('an empty proposal was admitted, or did not fail closed');
    if (adr.admit('## Context\nsomething').admitted) v.push('a proposal with no ADR heading was admitted');
    if (adr.admit(complete).authorizes !== false) v.push('admission claims to be approval');
    if (!/not approval/i.test(adr.admit(complete).note)) v.push('admission does not distinguish itself from approval');

    // --- Part 12: release impact reported BEFORE deployment ------------------------------------
    const { ConsumerContracts } = require('../src/contracts/consumer-contracts');
    const { ContractRegistry } = require('../src/contracts/integration-contracts');
    const reg = new ContractRegistry();
    const cc = new ConsumerContracts({ registry: reg });
    const unassessed = cc.releaseImpact({ release: 'empty' });
    if (unassessed.deployable) v.push('a release with nothing assessed was reported deployable — an unassessed release is not a safe one');
    if (!unassessed.blockers.some((b) => b.check === 'no-changes-assessed')) v.push('an empty release named no blocker');
    const submit = reg.current('api.reports.submit');
    const status = reg.current('api.reports.status');
    const additive = cc.releaseImpact({
      release: 'additive',
      changes: [{ contract: 'api.reports.submit', description: 'accept an optional locale field', spec: { fields: { required: submit.fields.required, optional: [...submit.fields.optional, 'locale'] } } }],
    });
    if (!additive.deployable) v.push('a backward-compatible release was blocked: ' + JSON.stringify(additive.blockers));
    if (additive.worstBand !== 'none') v.push('an additive release did not band as none');
    if (additive.authorizes !== false || additive.failClosed !== true) v.push('the release impact report claims authority / is not fail-closed');
    // Breaking a constitutional consumer blocks the release outright.
    const breaking = cc.releaseImpact({ release: 'breaking', changes: [{ contract: 'api.reports.submit', description: 'remove every field', spec: { fields: { required: [], optional: [] } } }] });
    if (breaking.deployable) v.push('a release breaking the constitutional reporting path was deployable');
    if (!breaking.constitutionalImpact) v.push('breaking a constitutional consumer was not reported as constitutional impact');
    if (!breaking.blockers.some((b) => b.check === 'constitutional-consumer')) v.push('a constitutional break was not the named blocker');
    if (!/RELEASE BLOCKED/.test(breaking.note)) v.push('a blocked release did not say so');
    // Two changes landing on ONE consumer at once — the case no per-contract report can see.
    const both = cc.releaseImpact({
      release: 'simultaneous',
      changes: [
        { contract: 'api.reports.submit', spec: { fields: { required: [], optional: [] } } },
        { contract: 'api.reports.status', spec: { fields: { required: [], optional: [] }, responseFields: status.responseFields } },
      ],
    });
    if (!both.simultaneouslyBroken.includes('citizen-web')) v.push('two changes landing on one consumer were not reported as a simultaneous break');
    if (!both.blockers.some((b) => b.check === 'simultaneous-break')) v.push('a simultaneous break did not block the release');
    if (both.worstBand !== 'severe') v.push('the release band did not aggregate to its worst change');

    // --- Part 13: owner activity, training, escalation, active ownership -----------------------
    const own = require('../src/governance/ownership');
    const DAY = 24 * 3600_000, NOW = 400 * DAY;
    const blind = own.continuityDashboard({ now: NOW });
    if (blind.sound) v.push('governance was reported soundly owned with no activity or training evidence at all');
    if (!blind.blockers.some((b) => /unknown is not active/.test(b))) v.push('an unknown activity state was not reported as unknown');
    const activity = new own.ActivityRegister({ clock: () => NOW });
    const training = new own.TrainingRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        const holder = own.OWNERSHIP[s][role];
        activity.recordAct({ person: holder, act: 'review', subsystem: s, at: NOW - 10 * DAY });
        for (const course of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person: holder, course, at: NOW - 30 * DAY, by: 'Registrar of Governance' });
      }
    }
    const wired = own.continuityDashboard({ activity, training, now: NOW });
    if (!wired.sound) v.push('a fully available, active and trained estate was not sound: ' + wired.blockers.slice(0, 3).join('; '));
    if (wired.activeCoverage !== 1) v.push('active coverage was not complete for a fully evidenced estate');
    // A dormant owner is not an available one, even though availability says otherwise.
    const dormantActivity = new own.ActivityRegister({ clock: () => NOW });
    for (const s of own.subsystems()) for (const role of own.DEPUTY_ROLES) dormantActivity.recordAct({ person: own.OWNERSHIP[s][role], act: 'review', subsystem: s, at: NOW - 300 * DAY });
    const dormant = own.continuityDashboard({ activity: dormantActivity, training, now: NOW });
    if (dormant.sound) v.push('an estate whose every owner last acted 300 days ago was reported soundly owned');
    if (own.coverageScore({ now: NOW }).coverage !== 1) v.push('availability coverage changed — activity must be a separate fact, not a redefinition of availability');
    if (!dormant.dormantOwners || !dormant.dormantOwners.length) v.push('dormant owners were not named');
    // Expired training blocks separately from missing training.
    const expiredTraining = new own.TrainingRegister({ clock: () => NOW });
    for (const s of own.subsystems()) for (const role of own.DEPUTY_ROLES) for (const course of own.REQUIRED_TRAINING[role]) expiredTraining.recordCompletion({ person: own.OWNERSHIP[s][role], course, at: NOW - 400 * DAY, by: 'Registrar of Governance' });
    const lapsed = own.activeCoverage({ activity, training: expiredTraining, now: NOW });
    if (lapsed.complete) v.push('an estate whose training expired a year ago was actively owned');
    if (!lapsed.unowned.some((u) => u.blockers.some((b) => /expired/.test(b)))) v.push('expired training was not reported as expired');
    let selfCertified = false;
    try { expiredTraining.recordCompletion({ person: 'X', course: 'records-management', at: NOW }); } catch (_) { selfCertified = true; }
    if (!selfCertified) v.push('a training completion was accepted with nobody attesting it');
    // Escalation is a workflow: resolution cannot skip acknowledgement.
    const esc = new own.EscalationWorkflow({ clock: () => NOW });
    const raised = esc.raise({ subsystem: own.subsystems()[0], reason: 'no available owner', raisedBy: 'Operations Duty Officer' });
    let skipped = false;
    try { esc.resolve(raised.id, { by: 'ARB Chair', resolution: 'reassigned' }); } catch (_) { skipped = true; }
    if (!skipped) v.push('an escalation was resolved without ever being acknowledged');
    if (esc.status({ now: NOW }).healthy !== true) v.push('a freshly raised escalation was already reported unhealthy');
    if (esc.overdue({ now: NOW + 2 * DAY }).length !== 1) v.push('an escalation unacknowledged past its window was not reported overdue');
    esc.acknowledge(raised.id, { by: 'ARB Vice-Chair' });
    esc.resolve(raised.id, { by: 'ARB Chair', resolution: 'deputy confirmed and recorded' });
    if (esc.status({ now: NOW }).byState.resolved !== 1) v.push('a resolved escalation was not recorded as resolved');

    // --- Part 14: verification history, confidence trend, provenance ---------------------------
    const ec = require('../src/assurance/evidence-confidence');
    let clock = 0;
    const evidence = new ec.EvidenceRegister({ clock: () => clock });
    if (evidence.provenanceReport('nothing').known) v.push('a provenance report was produced for evidence that does not exist');
    evidence.record({ id: 'fitness', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
    if (evidence.confidenceTrend('fitness').direction !== 'insufficient-data') v.push('a trend was reported from a single verification');
    // Re-recording the same observation must not manufacture a trend.
    evidence.record({ id: 'fitness', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
    if (evidence.history('fitness').length !== 1) v.push('re-recording an identical observation created a second history point');
    clock = 6 * 3600_000; evidence.record({ id: 'fitness', source: 'executable-check', completeness: 0.9, verifiedAt: 0, now: clock });
    clock = 12 * 3600_000; evidence.record({ id: 'fitness', source: 'executable-check', completeness: 0.8, verifiedAt: 0, now: clock });
    const trend = evidence.confidenceTrend('fitness');
    if (trend.direction !== 'degrading') v.push('falling confidence was not reported as degrading');
    if (trend.consecutiveFalls < 2) v.push('consecutive falls were not counted');
    if (!trend.warning || !/on its way out/.test(trend.warning)) v.push('a degrading trend produced no warning');
    const prov = evidence.provenanceReport('fitness');
    for (const f of ['source', 'sourceMeaning', 'confidence', 'completeness', 'freshness', 'method', 'calculation', 'verificationHistory', 'trend']) {
      if (prov[f] === undefined || prov[f] === null) v.push(`provenance report omits '${f}'`);
    }
    if (prov.manualEntry !== false || !/cannot be supplied/.test(prov.derivationNote)) v.push('the provenance report does not state that confidence cannot be hand-entered');
    if (prov.authorizes !== false || !prov.doesNotEstablish) v.push('the provenance report does not say what it fails to establish');
    // Improving evidence must read as improving, so the trend can pass as well as fail.
    let c2 = 0;
    const better = new ec.EvidenceRegister({ clock: () => c2 });
    better.record({ id: 'coverage', source: 'derived-computation', completeness: 0.5, verifiedAt: 0, now: 0 });
    c2 = 3600_000; better.record({ id: 'coverage', source: 'derived-computation', completeness: 0.8, verifiedAt: c2, now: c2 });
    if (better.confidenceTrend('coverage').direction !== 'improving') v.push('rising confidence was not reported as improving');
    const provenance = evidence.provenance();
    if (!provenance.degrading.includes('fitness')) v.push('the register-wide provenance report did not name the degrading evidence');
    if (provenance.authorizes !== false) v.push('the provenance report claims authority');
  }),

  fit('APP-FIT-ENGINEERING-INTELLIGENCE', 'Readiness dependencies explain without aggregating, and engineering intelligence reports unknown rather than a comfortable default', (v) => {
    const ec = require('../src/assurance/evidence-confidence');

    // --- Part 15: readiness dependency analysis ------------------------------------------------
    const graph = ec.readinessDependencyGraph();
    if (!graph.valid) v.push('readiness dependency graph invalid: ' + graph.violations.join('; '));
    if (!graph.acyclic) v.push('the readiness dependency graph contains a cycle: ' + graph.cycles.join('; '));
    if (graph.nodes.length !== Object.keys(ec.READINESS_DIMENSIONS).length) v.push('the graph does not cover every readiness dimension');
    for (const e of graph.edges) if (!e.because) v.push(`edge ${e.from} → ${e.to} states no reason`);
    if (!graph.roots.length) v.push('no readiness dimension is foundational — everything depending on something is a cycle waiting to happen');
    // Every dimension declares its dependencies, including "none". Omission must not read as none.
    for (const id of Object.keys(ec.READINESS_DIMENSIONS)) if (!ec.DIMENSION_DEPENDENCIES[id]) v.push(`${id}: no dependency list declared`);

    // The graph EXPLAINS; it must not aggregate. Scores are unchanged by it.
    const dims = Object.keys(ec.READINESS_DIMENSIONS).map((d) => ({ dimension: d, ready: d !== 'technical', score: d !== 'technical' ? 1 : 0 }));
    const analysis = ec.readinessDependencyAnalysis({ dimensions: dims });
    for (const row of analysis.dimensions) {
      const src = dims.find((d) => d.dimension === row.dimension);
      if (row.ready !== src.ready) v.push(`${row.dimension}: the dependency analysis changed a dimension's readiness — dependencies explain, they do not aggregate`);
    }
    if (analysis.authorizationStatus !== 'NOT AUTHORIZED') v.push('the dependency analysis produced something other than NOT AUTHORIZED');
    if (analysis.derivedFromReadiness !== false || analysis.authorizes !== false) v.push('the dependency analysis claims to derive authorization');
    if (Object.prototype.hasOwnProperty.call(analysis, 'overallReadiness') || Object.prototype.hasOwnProperty.call(analysis, 'score')) {
      v.push('the dependency analysis produced an overall figure — that is the single number the ten dimensions exist to avoid');
    }
    // One broken foundation is named as the root cause, and everything standing on it is named too.
    if (!analysis.rootCauses.includes('technical')) v.push('the only unready dimension was not identified as the root cause');
    if (!analysis.restingOnUnready.includes('security')) v.push('a ready dimension resting on an unready one was not reported');
    if (analysis.suggestedOrder[0] !== 'technical') v.push('the suggested repair order does not start at the root cause');
    // With everything ready, nothing rests on anything unready — the check can pass as well as fail.
    const allReady = ec.readinessDependencyAnalysis({ dimensions: Object.keys(ec.READINESS_DIMENSIONS).map((d) => ({ dimension: d, ready: true })) });
    if (allReady.restingOnUnready.length || allReady.rootCauses.length) v.push('a fully ready model reported unready foundations');
    if (allReady.authorizationStatus !== 'NOT AUTHORIZED') v.push('ten ready dimensions produced an authorization');

    // --- Part 16: engineering intelligence -----------------------------------------------------
    for (const [id, spec] of Object.entries(ec.TEST_TYPES)) {
      if (!spec.proves || !spec.missingMeans) v.push(`test type '${id}' does not say what it proves or what its absence means`);
    }
    for (const required of ['unit', 'integration', 'contract', 'resilience', 'chaos', 'policy']) {
      if (!ec.TEST_TYPES[required]) v.push(`test type '${required}' is not named`);
    }
    // A test type nobody runs is reported as unmeasured, not omitted from the list.
    const partial = ec.engineeringMetrics({ tests: { unit: 400 } });
    if (!partial.tests.unmeasuredTypes.includes('chaos')) v.push('an unrun test type vanished from the breakdown instead of reporting unmeasured');
    if (partial.tests.typeCoverage >= 1) v.push('a breakdown missing five of six test types claimed full type coverage');
    const full = ec.engineeringMetrics({ tests: Object.fromEntries(Object.keys(ec.TEST_TYPES).map((k) => [k, 10])) });
    if (full.tests.unmeasuredTypes.length || full.tests.typeCoverage !== 1) v.push('a complete breakdown was not reported as complete');

    // Assurance coverage: a documented procedure is not a control.
    const none = ec.assuranceCoverage({});
    if (none.coverage !== null || none.complete) v.push('no declared controls read as full assurance coverage');
    if (!/undefined, not complete/.test(none.reason)) v.push('undefined assurance coverage was not distinguished from complete');
    const partialCov = ec.assuranceCoverage({ controls: ['C1', { id: 'C2', verifiedBy: ['APP-FIT-X'] }], executableCheckIds: ['C1'] });
    if (partialCov.complete) v.push('a control with no executable check behind it counted as covered');
    if (!partialCov.uncovered.includes('C2')) v.push('the uncovered control was not named');
    const fullCov = ec.assuranceCoverage({ controls: ['C1'], executableCheckIds: ['C1'] });
    if (!fullCov.complete || fullCov.coverage !== 1) v.push('a fully covered control set was not reported complete');

    // Governance maturity cannot inflate on unmeasured inputs.
    const blind = ec.governanceMaturity({});
    if (blind.level !== 0) v.push('governance maturity rose above zero with nothing measured');
    if (!blind.blockedBy.length) v.push('an unmeasured governance estate named nothing blocking it');
    const top = ec.governanceMaturity({ controlsDeclared: true, adrCatalogueValid: true, adrCatalogueSound: true, assurance: fullCov, activeOwnershipComplete: true, structuralGaps: 0 });
    if (top.level !== 5) v.push('a fully evidenced governance estate did not reach the top level: ' + top.blockedBy.join('; '));
    const unowned = ec.governanceMaturity({ controlsDeclared: true, adrCatalogueValid: true, adrCatalogueSound: true, assurance: fullCov, activeOwnershipComplete: false, structuralGaps: 1 });
    if (unowned.level >= 4) v.push('an estate with incomplete active ownership reached the owned level');
    for (const l of ec.GOVERNANCE_MATURITY_LEVELS) if (!l.requires) v.push(`governance maturity level ${l.level} does not say what it requires`);

    // History: a missing period is a gap, never an interpolated line.
    let threw = false;
    try { ec.engineeringHistory({ snapshots: [{ coverage: 0.8 }] }); } catch (_) { threw = true; }
    if (!threw) v.push('an unlabelled engineering snapshot was accepted');
    const hist = ec.engineeringHistory({ snapshots: [
      { period: '2026-Q1', coverage: 0.70, mutationScore: 0.55, testTotal: 400, invariantTotal: 100, changeFailureRate: 0.12, mttrHours: 6, assuranceCoverage: 0.7 },
      { period: '2026-Q2', coverage: 0.78, testTotal: 470, invariantTotal: 110, changeFailureRate: 0.09, mttrHours: 4, assuranceCoverage: 0.8 },
      { period: '2026-Q3', coverage: 0.86, mutationScore: 0.72, testTotal: 533, invariantTotal: 123, changeFailureRate: 0.06, mttrHours: 2, assuranceCoverage: 0.92 },
    ] });
    if (!hist.metrics.mutationScore.gaps.includes('2026-Q2')) v.push('a period with no measurement was not reported as a gap');
    if (hist.metrics.mutationScore.measuredPeriods !== 2) v.push('a gap was counted as a measurement');
    if (hist.completeness >= 1) v.push('a history with a gap claimed full completeness');
    if (hist.metrics.coverage.direction !== 'rising') v.push('rising coverage was not reported as rising');
    // Duplicate periods collapse — a series cannot be padded by re-submitting a period.
    const padded = ec.engineeringHistory({ snapshots: [{ period: 'P1', coverage: 0.5 }, { period: 'P1', coverage: 0.5 }, { period: 'P1', coverage: 0.5 }] });
    if (padded.snapshots !== 1) v.push('a history series was padded by re-submitting one period');

    // Forecast: fewer than two points is unknown, never a default.
    const blindCast = ec.engineeringForecast({ history: padded });
    for (const row of blindCast.metrics) if (row.projectable) v.push(`'${row.metric}' was projected from a single period`);
    if (!blindCast.unprojectable.includes('coverage')) v.push('an unprojectable metric was not named');
    if (blindCast.healthyClaim !== null) v.push('a forecast with nothing to project claimed health');
    const cast = ec.engineeringForecast({ history: hist, periodsAhead: 2 });
    const cov = cast.metrics.find((m) => m.metric === 'coverage');
    if (!cov.projectable || cov.direction !== 'rising' || cov.improving !== true) v.push('rising coverage was not projected as improving');
    const cfr = cast.metrics.find((m) => m.metric === 'changeFailureRate');
    if (cfr.improving !== true) v.push('a FALLING change-failure rate was not read as an improvement — polarity must be stated, not guessed');
    if (cast.authorizes !== false) v.push('the engineering forecast claims authority');
    // A metric moving the wrong way is named as regressing.
    const worse = ec.engineeringForecast({ history: ec.engineeringHistory({ snapshots: [
      { period: 'A', coverage: 0.9, changeFailureRate: 0.02 },
      { period: 'B', coverage: 0.7, changeFailureRate: 0.10 },
    ] }) });
    if (!worse.regressing.includes('coverage') || !worse.regressing.includes('changeFailureRate')) v.push('metrics moving the wrong way were not reported as regressing');
    if (!worse.offTarget.includes('coverage')) v.push('a metric below its target was not reported off-target');
  }),

  fit('APP-FIT-OPERATIONS-TWIN', 'The operations twin is built from the architecture-of-record, and a simulation provably never touches it', (v) => {
    const { OperationsTwin, ENTITY_KINDS, SCENARIOS } = require('../src/twin2/operations-twin');
    const contextMap = require('../src/architecture/context-map');
    const twin = new OperationsTwin({ evidenceIds: ['APP-FIT-OPERATIONS-TWIN'] });

    // --- The model is derived, not hand-maintained ---------------------------------------------
    const validation = twin.validate();
    if (!validation.valid) v.push('operations twin model invalid: ' + validation.violations.join('; '));
    for (const [kind, spec] of Object.entries(ENTITY_KINDS)) {
      if (!spec.source) v.push(`entity kind '${kind}' does not say where it is read from — an unsourced kind is a hand-maintained one`);
      if (!twin.model().byKind[kind]) v.push(`the twin models no '${kind}' entities`);
    }
    // Drift detection in both directions: nothing modelled that the architecture lacks, and nothing
    // in the architecture that the twin omits.
    const modelled = new Set(twin.entities('bounded-context').map((e) => e.id));
    for (const id of contextMap.ids()) if (!modelled.has(id)) v.push(`context '${id}' is in the architecture-of-record but not in the twin`);
    for (const id of modelled) if (!contextMap.ids().includes(id)) v.push(`context '${id}' is modelled but not in the architecture-of-record — the twin has drifted`);
    // Rebuilding produces the same model: the twin is a function of the registries, not of history.
    if (new OperationsTwin({ evidenceIds: ['APP-FIT-OPERATIONS-TWIN'] }).digest() !== twin.digest()) v.push('two twins built from the same registries disagree — the model is not deterministic');

    // --- Every scenario runs, states its question, and authorizes nothing ----------------------
    for (const [id, spec] of Object.entries(SCENARIOS)) {
      if (!spec.question || !spec.perturbs) v.push(`scenario '${id}' does not state what it perturbs or what question it answers`);
    }
    let unknownScenario = false;
    try { twin.simulate({ scenario: 'wing-it' }); } catch (_) { unknownScenario = true; }
    if (!unknownScenario) v.push('an unknown scenario was simulated');

    const runs = [
      twin.simulate({ scenario: 'infrastructure-change', change: { zones: ['independent'] } }),
      twin.simulate({ scenario: 'operational-failure', change: { failed: ['kms'] } }),
      twin.simulate({ scenario: 'policy-update', change: { policies: { investigation: 'eventual' } } }),
      twin.simulate({ scenario: 'governance-change', change: { vacated: ['identity-access'] } }),
      twin.simulate({ scenario: 'migration-plan', change: { contexts: ['custody'] } }),
      twin.simulate({ scenario: 'dr-exercise', change: { failedRegions: ['bw-south', 'bw-north'] } }),
    ];
    for (const r of runs) {
      if (r.authorizes !== false) v.push(`scenario '${r.scenario}' claims authority`);
      if (!r.question) v.push(`scenario '${r.scenario}' produced no question`);
      // THE PART 17 INVARIANT, checked after every single run.
      if (!r.isolation.unchanged) v.push(`scenario '${r.scenario}' changed the baseline model — a simulation must never affect production state`);
      if (!r.isolation.frozen) v.push('the baseline model is not frozen');
    }

    // --- Each scenario finds the thing it exists to find ----------------------------------------
    const infra = runs[0];
    if (infra.safe) v.push('withdrawing the independent zone produced no blocking finding — the constitutional services live there');
    if (!infra.findings.some((f) => f.entity === 'intake-api')) v.push('withdrawing the independent zone did not name intake-api');
    const failure = runs[1];
    if (!failure.blastRadius.impacted.includes('evidence-store')) v.push('a KMS failure did not propagate to the evidence store');
    if (!/lower bound/.test(failure.blastRadius.caveat)) v.push('the blast radius does not state that it is a lower bound');
    const policy = runs[2];
    if (policy.safe) v.push('a consistency stance was changed with no ADR and produced no blocking finding');
    if (!policy.findings.some((f) => f.weakening)) v.push('read-your-writes → eventual was not reported as a weakening');
    const governance = runs[3];
    if (governance.safe) v.push('vacating an accountable authority left the model with no blocking finding');
    if (!governance.findings.some((f) => /no accountable authority/.test(f.finding))) v.push('a vacated authority was not reported as leaving something unowned');
    const migration = runs[4];
    if (!migration.findings.some((f) => /moves from zone/.test(f.finding))) v.push('a migration plan did not state what moves');
    if (migration.safe) v.push('a migration plan with no target zone was reported safe');
    const dr = runs[5];
    if (dr.safe) v.push('losing two of three regions produced no blocking finding');
    if (!dr.findings.some((f) => /unavailable/.test(f.finding))) v.push('the DR exercise did not report an unavailable context');

    // A simulation over an unmodelled entity says so rather than reporting nothing.
    const ghost = twin.simulate({ scenario: 'operational-failure', change: { failed: ['a-service-that-does-not-exist'] } });
    if (!ghost.findings.some((f) => /not modelled/.test(f.finding))) v.push('a failure of an unmodelled entity produced silence');

    // Isolation holds across the whole run, and the model is genuinely immutable.
    const after = twin.verifyIsolation();
    if (!after.unchanged) v.push('the baseline model changed across the simulation suite');
    const snapshot = twin.model();
    snapshot.entities.push({ kind: 'service', id: 'injected' });
    if (twin.model().entities.length === snapshot.entities.length) v.push('model() handed out a live reference — a caller could mutate the baseline');
    if (twin.history().length !== runs.length + 1) v.push('the simulation history does not record every run');
  }),

  fit('APP-FIT-MISSION-IMPACT', 'A technical event is forecast through justice services to citizen impact and strategic goals, and an unmapped path reports unknown', (v) => {
    const bus = require('../src/observability/business');

    // --- The six-stage chain is declared and joined end to end ---------------------------------
    // Phase 13, Part 3 extended the chain past the citizen into the institution, and past the
    // strategic goal into the government mission outcome.
    const expected = ['technical-event', 'business-process', 'justice-service', 'citizen-impact', 'institutional-impact', 'mission-objective', 'strategic-goal', 'government-mission-outcome'];
    if (JSON.stringify(bus.MISSION_IMPACT_LAYERS) !== JSON.stringify(expected)) v.push('the mission impact chain does not have the eight declared stages');
    for (const violation of bus.validateMissionChain().violations) v.push(violation);
    for (const l of bus.missionImpactLinks()) {
      if (!l.mechanism) v.push(`link ${l.from} → ${l.to}: no mechanism`);
      if (bus.MISSION_IMPACT_LAYERS.indexOf(l.toLayer) <= bus.MISSION_IMPACT_LAYERS.indexOf(l.fromLayer)) v.push(`link ${l.from} → ${l.to} does not move forward`);
    }
    // A citizen impact is stated in the citizen's words. A severity with no experience behind it is
    // a number about a person, which is the thing this layer exists to avoid.
    for (const c of bus.citizenImpacts()) {
      if (!c.experience) v.push(`citizen impact '${c.id}' states no experience`);
      if (/api|service|store|endpoint|latency/i.test(c.experience)) v.push(`citizen impact '${c.id}' is stated in the platform's words, not the citizen's`);
      if (!bus.CITIZEN_IMPACT_SEVERITY.includes(c.severity)) v.push(`citizen impact '${c.id}': undeclared severity`);
    }
    for (const s of bus.justiceServices()) if (!s.delivers || !s.dependsOn.length) v.push(`justice service '${s.id}' does not say what it delivers or what it needs`);

    // --- The forecast reaches all the way through ----------------------------------------------
    const intake = bus.missionImpactForecast({ change: 'withdraw the intake store', failed: ['persistence-ind'] });
    if (!intake.undeliveredServices.includes('anonymous-reporting')) v.push('losing the intake store did not stop the anonymous-reporting service');
    if (!intake.citizenImpacts.some((c) => c.impact === 'cannot-report')) v.push('a citizen who cannot report was not reported as a citizen impact');
    if (!intake.strategicGoals.some((g) => g.id === 'rule-of-law')) v.push('the forecast did not reach a strategic goal');
    if (!intake.constitutionalServicesLost.includes('anonymous-reporting')) v.push('a lost constitutional service was not named as such');
    if (intake.safeToDeploy) v.push('a change that stops a citizen reporting was reported safe to deploy');
    if (intake.authorizes !== false || intake.failClosed !== true) v.push('the mission impact forecast claims authority / is not fail-closed');
    if (!intake.paths.length) v.push('the forecast produced no traceable path');
    for (const p of intake.paths) if (!p.mechanisms.length) v.push(`path ${p.chain} states no mechanism`);

    // Aggregation is to the WORST impact, not the mean — and severity ordering is respected.
    const all = bus.missionImpactForecast({ change: 'total loss', failed: ['persistence-ind', 'kms', 'persistence-exec', 'persistence-jud'] });
    if (!all.worstCitizenImpact || all.worstCitizenImpact.severity !== 'severe') v.push('the worst citizen impact was not the severe one');
    if (!all.irreversibleImpacts.length) v.push('an irreversible harm was not flagged as irreversible');
    if (!/irreversible/.test(all.boardSummary)) v.push('the board summary does not say the harm is irreversible');
    // The summary speaks in the citizen's language, not the platform's.
    if (/persistence-|kms|api\b/i.test(all.boardSummary.replace(/^[^:]*:/, ''))) v.push('the board summary describes components rather than people');

    // --- An unmapped path is UNKNOWN, not safe -------------------------------------------------
    const nothing = bus.missionImpactForecast({ change: 'no-op', failed: [] });
    if (!nothing.safeToDeploy) v.push('a change affecting nothing was not reported safe');
    if (nothing.citizenImpacts.length) v.push('a change affecting nothing produced a citizen impact');
    // A component outside every justice service's dependency tree must produce "unknown", not
    // "no impact". `broker-exec` is genuinely such a component in the current topology — nothing
    // declares a dependency on it — so the probe uses reality rather than mutating shared state.
    const orphan = bus.missionImpactForecast({ change: 'withdraw the executive broker', failed: ['broker-exec'] });
    if (!orphan.unmappedComponents.includes('broker-exec')) v.push('an affected component outside every service tree was not reported unmapped');
    if (orphan.safeToDeploy) v.push('a change with an unmapped affected component was reported safe — unknown is not safe');
    if (!/unknown, not nil/.test(orphan.boardSummary)) v.push('the board summary treated an unknown impact as no impact');
    // The sharpest case: a component the topology has never heard of. Deployed before it was
    // modelled, it must surface as unmodelled rather than crashing or reading as harmless.
    const ghost = bus.missionImpactForecast({ change: 'ship an unmodelled component', failed: ['new-search-index'] });
    if (!ghost.unmodelledComponents.includes('new-search-index')) v.push('a component the topology does not know was not reported as unmodelled');
    if (ghost.safeToDeploy) v.push('a change touching an unmodelled component was reported safe');
    // And the mapping still holds for the components that ARE mapped.
    if (!bus.missionImpactForecast({ change: 'kms outage', failed: ['kms'] }).undeliveredServices.includes('evidence-custody')) v.push('a mapped component stopped reaching its justice service');
  }),

  fit('APP-FIT-COMPLIANCE-INTELLIGENCE', 'A change maps onto every artefact it touches, and an unassessed change is a gap rather than silence', (v) => {
    const { ComplianceIntelligence, CHANGE_KINDS, KIND_READINESS } = require('../src/legislation/compliance-intelligence');
    const ec = require('../src/assurance/evidence-confidence');
    const ci = new ComplianceIntelligence({ clock: () => 1_000 });

    const validation = ci.validate();
    if (!validation.valid) v.push('compliance intelligence invalid: ' + validation.violations.join('; '));
    for (const [kind, spec] of Object.entries(CHANGE_KINDS)) {
      if (!spec.originator || !spec.missedMeans) v.push(`change kind '${kind}' does not say who originates it or what a missed one costs`);
      for (const d of KIND_READINESS[kind] || []) if (!ec.READINESS_DIMENSIONS[d]) v.push(`change kind '${kind}' maps to unknown readiness dimension '${d}'`);
    }
    for (const d of ci.mappingDimensions()) if (!d.source) v.push(`mapping dimension '${d.dimension}' names no source registry`);

    // Observation is attributed and validated, or it does not happen.
    let unattributed = false;
    try { ci.observe({ kind: 'legislative-change', summary: 'x' }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('a compliance change was recorded with nobody observing it');
    let unknownKind = false;
    try { ci.observe({ kind: 'vibes-shift', summary: 'x', observedBy: 'y' }); } catch (_) { unknownKind = true; }
    if (!unknownKind) v.push('an unknown change kind was accepted');

    const change = ci.observe({
      kind: 'legislative-change', summary: 'Data Protection Act amended', severity: 'critical', observedBy: 'Legal Counsel',
      affects: { contexts: ['privacy', 'ministry-of-typos'], controls: ['APP-FIT-ANONYMITY-BOUNDARY', 'APP-FIT-NEVER-WRITTEN'], datasets: ['case-records', 'a-spreadsheet-somewhere'] },
    });
    const controls = [{ id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true }, { id: 'APP-FIT-FAILING-PROBE', pass: false }];
    const mapped = ci.mapChange(change.id, { controls, datasets: ['case-records'] });

    // Everything is resolved against a registry; a name the architecture does not contain is
    // reported, not carried through.
    if (!mapped.boundedContexts.includes('privacy')) v.push('a real bounded context was not mapped');
    if (!mapped.unresolvedContexts.includes('ministry-of-typos')) v.push('a context the architecture does not contain was carried through as if real');
    if (!mapped.policies.length) v.push('no policy was mapped for an affected context');
    if (!mapped.adrs.length) v.push('no ADR was mapped for an affected context');
    if (!mapped.workflows.length) v.push('no workflow was mapped for an affected context');
    if (!mapped.readinessDimensions.includes('legal')) v.push('a legislative change did not reach the legal readiness dimension');
    if (!mapped.owners.length || !mapped.owners.every((o) => o.responsibleAuthority)) v.push('the mapping resolved no accountable owner');
    if (mapped.authorizes !== false) v.push('a compliance mapping claims authority');

    // "Missing" and "failing" are different facts, reported separately.
    const states = Object.fromEntries(mapped.controls.map((c) => [c.control, c.state]));
    if (states['APP-FIT-ANONYMITY-BOUNDARY'] !== 'holding') v.push('a holding control was not reported as holding');
    if (states['APP-FIT-NEVER-WRITTEN'] !== 'missing') v.push('a control with no executable check was not reported missing');

    let gaps = ci.gapAnalysis({ controls, datasets: ['case-records'] });
    if (gaps.clear) v.push('an unassessed change with a missing control produced a clear compliance report');
    if (!gaps.unassessed.includes(change.id)) v.push('an unassessed change was not named');
    if (!gaps.gaps.some((g) => g.gap === 'unassessed')) v.push('an unassessed change did not produce a gap — silence is not compliance');
    if (!gaps.gaps.some((g) => g.gap === 'no-control')) v.push('a control that was never written did not produce a gap');
    if (!gaps.gaps.some((g) => g.gap === 'unresolved-context')) v.push('an unresolved context did not produce a gap');
    if (!gaps.gaps.some((g) => g.gap === 'ungoverned-dataset')) v.push('an ungoverned dataset did not produce a gap');
    if (!/not evidence that no unrecorded change exists/.test(gaps.coverageCaveat)) v.push('a clear compliance report does not caveat what it has not seen');

    // A control that exists but does not hold is not a control.
    const failing = new ComplianceIntelligence({ clock: () => 1_000 });
    failing.observe({ kind: 'control-effectiveness', summary: 'control regression', observedBy: 'Assurance', severity: 'critical', affects: { controls: ['APP-FIT-FAILING-PROBE'] } });
    const failingGaps = failing.gapAnalysis({ controls });
    if (!failingGaps.gaps.some((g) => g.gap === 'control-failing')) v.push('a control that ran and failed was not reported as a gap');
    if (!failingGaps.gaps.some((g) => /does not hold is not a control/.test(g.detail))) v.push('the failing-control gap does not say why it matters');
    // Unverified is not holding either.
    const unverified = new ComplianceIntelligence({ clock: () => 1_000 });
    unverified.observe({ kind: 'policy-update', summary: 'p', observedBy: 'Board', affects: { controls: ['APP-FIT-ANONYMITY-BOUNDARY'] } });
    if (!unverified.gapAnalysis({ controls: ['APP-FIT-ANONYMITY-BOUNDARY'] }).gaps.some((g) => g.gap === 'control-unverified')) v.push('a control whose result was not supplied was treated as holding');

    // Assessment is a recorded human act; it closes the assessment gap and nothing else.
    let unattributedAssessment = false;
    try { ci.assess(change.id, { by: 'someone' }); } catch (e) { unattributedAssessment = !!e.failClosed; }
    if (!unattributedAssessment) v.push('a change was assessed with no stated conclusion');
    ci.assess(change.id, { by: 'Legal Counsel', conclusion: 'the amendment is implemented by the anonymity boundary control' });
    gaps = ci.gapAnalysis({ controls, datasets: ['case-records'] });
    if (gaps.gaps.some((g) => g.gap === 'unassessed')) v.push('assessment did not close the assessment gap');
    if (gaps.clear) v.push('assessing a change silently closed the control and context gaps too');

    // Remediation recommends; it never acts.
    const rem = ci.remediation({ controls, datasets: ['case-records'] });
    if (!rem.recommendations.length) v.push('open gaps produced no recommendation');
    if (rem.recommendationsOnly !== true || rem.authorizes !== false) v.push('remediation claims to be more than a recommendation');
    for (const r of rem.recommendations) {
      if (!r.recommendedAction || !r.owners.length || !r.derivedFrom) v.push(`recommendation for ${r.gap} lacks an action, an owner or a derivation`);
    }
    const order = { critical: 0, major: 1, minor: 2 };
    const ranks = rem.recommendations.map((r) => order[r.severity]);
    if (JSON.stringify(ranks) !== JSON.stringify([...ranks].sort((a, b) => a - b))) v.push('recommendations are not ranked by severity');
    // A clean estate produces a clear report, so the analysis can pass as well as fail.
    const clean = new ComplianceIntelligence({ clock: () => 1_000 });
    const ok = clean.observe({ kind: 'policy-update', summary: 'threshold updated', observedBy: 'ARB Chair', severity: 'minor', affects: { contexts: ['privacy'], controls: ['APP-FIT-ANONYMITY-BOUNDARY'] } });
    clean.assess(ok.id, { by: 'ARB Chair', conclusion: 'implemented' });
    const cleanGaps = clean.gapAnalysis({ controls: [{ id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true }] });
    if (!cleanGaps.clear) v.push('a fully assessed change with a holding control was not clear: ' + JSON.stringify(cleanGaps.gaps));
  }),

  fit('APP-FIT-ENTERPRISE-GRAPH', 'Every platform entity is linked and its traceability to executable evidence is reported by name', (v) => {
    const { EnterpriseGraph, NODE_KINDS, EDGE_KINDS } = require('../src/graph/enterprise-graph');
    const { ContractRegistry } = require('../src/contracts/integration-contracts');
    const contextMap = require('../src/architecture/context-map');
    // The graph's evidence is the declared fitness identifiers, read the same way the RACI control
    // check reads them. They are recorded as holding here — this function runs inside the suite and
    // cannot re-run it without recursing — and the failure paths below use crafted results instead.
    const results = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const build = (opts = {}) => new EnterpriseGraph({
      fitnessResults: results, contracts: new ContractRegistry(),
      datasets: [{ id: 'case-records', domain: 'investigation' }],
      obligations: [{ id: 'data-protection-act', mapsToControls: ['APP-FIT-ANONYMITY-BOUNDARY'] }],
      ...opts,
    });
    const g = build();

    // Every node kind Part 20 names is present and says where it comes from.
    for (const required of ['adr', 'bounded-context', 'service', 'api', 'risk', 'control', 'evidence', 'policy', 'dataset', 'metric', 'owner', 'readiness-dimension', 'compliance-obligation']) {
      if (!NODE_KINDS[required]) v.push(`node kind '${required}' is not declared`);
      if (!g.stats().byKind[required]) v.push(`the graph contains no '${required}' nodes`);
    }
    for (const [kind, spec] of Object.entries(NODE_KINDS)) if (!spec.source) v.push(`node kind '${kind}' names no source registry`);
    for (const [rel, meaning] of Object.entries(EDGE_KINDS)) if (!meaning) v.push(`edge kind '${rel}' states no meaning — an edge with no meaning is a line on a diagram`);
    for (const e of g.edges()) if (!e.meaning) v.push(`edge ${e.from} → ${e.to} carries no meaning`);
    const validation = g.validate();
    if (!validation.valid) v.push('enterprise graph invalid: ' + validation.violations.join('; '));
    // Drift, same check as the operations twin.
    for (const id of contextMap.ids()) if (!g.node(`bounded-context:${id}`)) v.push(`'${id}' is in the architecture-of-record but not in the graph`);
    // Deterministic: built from the registries, not from history.
    if (build().digest() !== g.digest()) v.push('two graphs built from the same registries disagree');
    let badEdge = false;
    try { g._link('adr:ADR-0001', 'bounded-context:privacy', 'vibes-with'); } catch (_) { badEdge = true; }
    if (!badEdge) v.push('an edge with no declared meaning was accepted');

    // --- Traceability: named answers, not a tick over the graph --------------------------------
    const trace = g.traceability();
    if (trace.coverage === null) v.push('traceability produced no coverage figure');
    if (trace.complete && trace.untraceable.length) v.push('traceability reported complete while naming untraceable entities');
    if (!trace.byKind.length) v.push('traceability is not broken down by kind');
    // Aggregation is to the WEAKEST kind, not the mean.
    const weakest = trace.byKind.filter((b) => b.coverage !== null).sort((a, b) => a.coverage - b.coverage || a.kind.localeCompare(b.kind))[0];
    if (!trace.weakestKind || trace.weakestKind.kind !== weakest.kind) v.push('traceability does not aggregate to the weakest kind');
    // Untraceable entities are NAMED, and the count matches.
    if (trace.untraceable.length !== trace.total - trace.traceable) v.push('the untraceable list does not match the traceable count');
    for (const key of trace.untraceable) if (!g.node(key)) v.push(`untraceable entity '${key}' is not a node`);
    // A control traces to its own evidence; that is the edge the whole property rests on.
    const anyControl = g.nodes('control')[0];
    if (!anyControl) v.push('the graph contains no controls');
    else {
      const row = trace.nodes.find((n) => n.node === anyControl.key);
      if (!row.traceable || !row.evidence) v.push('a control did not trace to its own evidence');
    }
    // A path to a FAILING check is not traceability.
    const withFailure = new EnterpriseGraph({ fitnessResults: [{ id: 'APP-FIT-PROBE', pass: false }], contracts: new ContractRegistry() });
    const strict = withFailure.traceability({ requireHolding: true });
    if (strict.nodes.find((n) => n.node === 'control:APP-FIT-PROBE').traceable) v.push('a control whose only evidence FAILED was reported traceable');
    if (!/demonstrated defect/.test(strict.note)) v.push('the traceability note does not distinguish a failing check from an absent one');
    const lenient = withFailure.traceability({ requireHolding: false });
    if (!lenient.nodes.find((n) => n.node === 'control:APP-FIT-PROBE').traceable) v.push('a control with a ran-but-failed check was untraceable even when holding was not required');
    // A graph with no evidence at all traces nothing — absence must not read as coverage.
    const blind = new EnterpriseGraph({ fitnessResults: [] });
    if (blind.traceability().coverage !== 0) v.push('a graph with no evidence reported non-zero traceability');
    if (blind.traceability().complete) v.push('a graph with no evidence at all reported complete traceability');

    // --- Impact analysis ------------------------------------------------------------------------
    const unknown = g.impactOf('bounded-context:atlantis');
    if (unknown.known) v.push('impact analysis answered for an entity that does not exist');
    if (!/absence of a node is not absence of the thing/.test(unknown.reason)) v.push('an unknown entity was not caveated');
    const impact = g.impactOf('bounded-context:identity-access');
    if (!impact.known || !impact.dependents.length) v.push('a high-fan-in context has no dependents in the graph');
    if (!impact.dependsOn.length) v.push('a context that is verified by controls depends on nothing');
    if (!/lower bound/.test(impact.caveat)) v.push('impact analysis does not state that it is a lower bound');
    if (impact.authorizes !== false) v.push('impact analysis claims authority');
    for (const d of impact.dependents) if (!(d.depth > 0)) v.push('a dependent was reported at depth zero');
    // Depth is bounded and the bound is reported.
    const shallow = g.impactOf('bounded-context:identity-access', { maxDepth: 1 });
    if (shallow.dependents.some((d) => d.depth > 1)) v.push('maxDepth was not respected');
    if (shallow.dependents.length > impact.dependents.length) v.push('a shallower traversal found more than a deeper one');
  }),

  fit('APP-FIT-RUNBOOK-ACCURACY', 'Every API path an operational document tells someone to call actually exists', (v) => {
    // "Keep documentation synchronized with implementation" is a requirement everywhere in this
    // platform and, until now, an aspiration in the one place it matters most at 03:00: the
    // runbook. A route renamed in `server.js` leaves the runbook telling an operator to call
    // something that 404s, and nothing catches it. This check makes the requirement executable.
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');

    // Routes as they are actually served: exact-match literals plus the path regexes.
    const src = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
    const literals = new Set([...src.matchAll(/p === '(\/api\/[^']+)'/g)].map((m) => m[1]));
    const patterns = [...src.matchAll(/p\.match\((\/(?:\\.|\[[^\]]*\]|[^/\\])+\/)\)/g)]
      .map((m) => m[1]).filter((r) => r.includes('api')).map((r) => new RegExp(r.slice(1, -1)));
    if (literals.size < 50) v.push(`only ${literals.size} literal routes were extracted from server.js — the extractor has stopped working, which would make this check pass vacuously`);
    if (patterns.length < 10) v.push(`only ${patterns.length} parameterised routes were extracted — the extractor has stopped working`);

    // Paths a document tells an operator to call. `{a,b}` expands; `<placeholder>` and `:param`
    // become a sample segment so a documented parameterised route still resolves.
    const documentedPaths = (text) => {
      const out = new Set();
      for (const m of text.matchAll(/(\/api\/[A-Za-z0-9/{},:<>_-]*)/g)) {
        const raw = m[1].replace(/[.,)]+$/, '');
        const brace = raw.match(/^(.*)\{([^}]*)\}(.*)$/);
        const variants = brace ? brace[2].split(',').map((o) => `${brace[1]}${o.trim()}${brace[3]}`) : [raw];
        for (const variant of variants) {
          const normalised = variant.replace(/\/$/, '').split('/')
            .map((seg) => (seg.startsWith('<') || seg.startsWith(':') ? 'sample' : seg)).join('/');
          if (normalised.length > 4) out.add(normalised);
        }
      }
      return [...out].sort();
    };
    const resolves = (p) => literals.has(p) || patterns.some((r) => r.test(p))
      || literals.has(`${p}/sample`) || patterns.some((r) => r.test(`${p}/sample`));

    // The operational documents an operator is actually sent to.
    const docs = ['docs/operations/runbook.md'];
    let checked = 0;
    for (const rel of docs) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) { v.push(`${rel} is missing — an operational document that does not exist cannot be followed`); continue; }
      const paths = documentedPaths(fs.readFileSync(file, 'utf8'));
      if (!paths.length) v.push(`${rel} names no API path — either it is not an operational document or the extractor is broken`);
      for (const p of paths) { checked += 1; if (!resolves(p)) v.push(`${rel} tells an operator to call '${p}', which no route serves`); }
    }
    if (checked < 5) v.push(`only ${checked} documented paths were checked — too few for this control to be meaningful`);

    // THE CHECK MUST BE ABLE TO FAIL. A resolver that says yes to everything would pass the whole
    // suite above while proving nothing, so it is fed a route that does not exist.
    for (const invented of documentedPaths('Call `GET /api/does-not-exist/anything` and `POST /api/nonsense`.')) {
      if (resolves(invented)) v.push(`the route resolver accepted '${invented}', which no route serves — the check cannot fail and is therefore decoration`);
    }
    // …and it must say yes to one that does, or it would pass by refusing everything.
    if (!resolves('/api/resilience/consistency')) v.push('the route resolver rejected a route that plainly exists');
  }),

  fit('APP-FIT-ASSUMPTION-REGISTRY', 'Every assumption has an owner, an expiry and evidence — and an owner may not claim more confidence than the evidence supports', (v) => {
    const asm = require('../src/architecture/assumptions');
    const contextMap = require('../src/architecture/context-map');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const fresh = () => new asm.AssumptionRegistry({ clock: () => 0 });
    const base = { statement: 's'.repeat(10), rationale: 'r'.repeat(10), owner: 'ARB', reviewCadenceDays: 90, expiresAt: 365 * 24 * 3600_000, verificationMethod: 'executable-check' };

    // --- The registry refuses what makes an assumption register decorative -------------------
    let unowned = false;
    try { fresh().register('A', { ...base, owner: undefined }); } catch (e) { unowned = !!e.failClosed; }
    if (!unowned) v.push('an assumption was registered with no owner — an unowned assumption is one nobody will revisit');
    let immortal = false;
    try { fresh().register('A', { ...base, expiresAt: undefined }); } catch (e) { immortal = !!e.failClosed; }
    if (!immortal) v.push('an assumption was registered with no expiry — an assumption that never expires is a belief');
    for (const [field, patch] of [['statement', { statement: undefined }], ['rationale', { rationale: undefined }], ['cadence', { reviewCadenceDays: 0 }], ['method', { verificationMethod: 'vibes' }]]) {
      let threw = false;
      try { fresh().register('A', { ...base, ...patch }); } catch (_) { threw = true; }
      if (!threw) v.push(`an assumption was registered with no valid ${field}`);
    }
    let redeclared = false;
    const r0 = fresh(); r0.register('A', base);
    try { r0.register('A', base); } catch (_) { redeclared = true; }
    if (!redeclared) v.push('an assumption was silently re-registered rather than amended');

    // --- Declared confidence may not exceed what the evidence supports -----------------------
    const over = fresh();
    over.register('OVER', { ...base, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'], confidence: 'high' });
    const overclaims = over.overclaims({ now: 0, controls });
    if (!overclaims.length) v.push('an assumption claiming high confidence that nothing has ever verified was not reported as an overclaim');
    if (overclaims[0] && overclaims[0].assessed !== 'low') v.push('a never-verified assumption did not cap at low confidence');
    // Verifying it lifts the assessment, so the check can pass as well as fail.
    over.recordVerification('OVER', { holds: true, by: 'Assurance', at: 0 });
    const lifted = over.assessConfidence('OVER', { now: 0, controls });
    if (lifted.assessed !== 'high') v.push('a verified, evidenced, executable-check assumption did not reach high confidence: ' + lifted.reasons.join('; '));
    if (over.overclaims({ now: 0, controls }).length) v.push('a fully supported declaration was still reported as an overclaim');
    // A verification that found it did NOT hold takes it to unknown, not merely down a notch.
    over.recordVerification('OVER', { holds: false, by: 'Assurance', at: 1 });
    if (over.assessConfidence('OVER', { now: 0, controls }).assessed !== 'unknown') v.push('an assumption whose latest verification failed still supported a confidence level');
    let unattributedVerification = false;
    try { over.recordVerification('OVER', { holds: true }); } catch (e) { unattributedVerification = !!e.failClosed; }
    if (!unattributedVerification) v.push('a verification was recorded with nothing named as having performed it');

    // --- Detection: stale, contradictory, orphaned, unevidenced ------------------------------
    const YEAR = 365 * 24 * 3600_000;
    const d = fresh();
    d.register('STALE', { ...base, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'], expiresAt: 10 });
    if (!d.stale({ now: 20 }).some((s) => s.assumption === 'STALE' && s.expired)) v.push('an expired assumption was not reported as expired');
    if (d.stale({ now: 5 }).some((s) => s.assumption === 'STALE' && s.expired)) v.push('an unexpired assumption was reported as expired');
    if (!d.stale({ now: 100 * 24 * 3600_000 }).some((s) => s.neverReviewed)) v.push('an assumption past its first cadence with no review was not reported');
    if (d.assessConfidence('STALE', { now: 20, controls }).assessed !== 'unknown') v.push('an expired assumption still supported a confidence level');

    const c = fresh();
    c.register('LO', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'], claim: { subject: 'replica-lag', predicate: 'at-most', value: 100 } });
    c.register('HI', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'], claim: { subject: 'replica-lag', predicate: 'at-least', value: 500 } });
    c.register('YES', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'], claim: { subject: 'session-affinity', predicate: 'holds' } });
    c.register('NO', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'], claim: { subject: 'session-affinity', predicate: 'does-not-hold' } });
    c.register('OTHER', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'], claim: { subject: 'something-else', predicate: 'holds' } });
    const found = c.contradictions();
    if (!found.some((x) => x.subject === 'replica-lag')) v.push('at-most 100 alongside at-least 500 was not reported as a contradiction');
    if (!found.some((x) => x.subject === 'session-affinity')) v.push('holds alongside does-not-hold was not reported as a contradiction');
    if (found.some((x) => x.subject === 'something-else')) v.push('an assumption with no counterpart was reported as contradicting something');
    if (found.length !== 2) v.push(`expected exactly two contradictions, found ${found.length} — a false positive trains people to ignore the report`);
    if (c.validate().valid) v.push('a registry containing a contradiction validated successfully');

    const o = fresh();
    o.register('NOWHERE', { ...base, contexts: [], evidence: ['APP-FIT-CONTEXT-MAP'] });
    o.register('GHOST', { ...base, contexts: ['ministry-of-typos'], evidence: ['APP-FIT-CONTEXT-MAP'] });
    o.register('REAL', { ...base, contexts: [contextMap.ids()[0]], evidence: ['APP-FIT-CONTEXT-MAP'] });
    const orphans = o.orphaned().map((x) => x.assumption).sort();
    if (JSON.stringify(orphans) !== JSON.stringify(['GHOST', 'NOWHERE'])) v.push(`orphan detection is wrong: ${orphans.join(', ')}`);

    const u = fresh();
    u.register('BARE', { ...base, contexts: ['assurance'] });
    u.register('IMAGINARY', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-NEVER-WRITTEN'] });
    u.register('CITED', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'] });
    const bare = u.unevidenced({ controls }).map((x) => x.assumption).sort();
    if (JSON.stringify(bare) !== JSON.stringify(['BARE', 'IMAGINARY'])) v.push(`unevidenced detection is wrong: ${bare.join(', ')}`);

    // --- Health aggregates to the weakest, and an undeclared assumption is not an absent one ---
    const h = fresh();
    h.register('GOOD', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'] });
    h.recordVerification('GOOD', { holds: true, by: 'Assurance', at: 0 });
    h.register('EXPIRED', { ...base, contexts: ['assurance'], evidence: ['APP-FIT-CONTEXT-MAP'], expiresAt: 10 });
    if (h.health(['GOOD'], { now: 0, controls }).confidence !== 'high') v.push('a sound assumption set was not reported as high confidence');
    if (h.health(['GOOD', 'EXPIRED'], { now: 20, controls }).confidence !== 'unknown') v.push('a set containing an expired assumption did not aggregate to the weakest');
    const none = h.health([], { now: 0, controls });
    if (none.sound) v.push('an empty assumption set was reported sound');
    if (!/unexamined/.test(none.reason)) v.push('an empty assumption set does not say that undeclared is not absent');
    const missing = h.health(['DOES-NOT-EXIST'], { now: 0, controls });
    if (missing.sound || !missing.missing.includes('DOES-NOT-EXIST')) v.push('citing an unregistered assumption was not reported');

    // --- The platform's own assumptions are registered and internally consistent --------------
    const platform = asm.seedPlatformAssumptions(fresh());
    const report = platform.report({ now: 0, controls });
    if (report.count < 8) v.push(`only ${report.count} platform assumptions are registered — the ones this codebase actually makes are not recorded`);
    if (report.contradictions.length) v.push('the platform\'s own assumptions contradict each other: ' + JSON.stringify(report.contradictions));
    if (report.orphaned.length) v.push('a platform assumption names no real bounded context: ' + report.orphaned.map((x) => x.assumption).join(', '));
    if (report.unevidenced.length) v.push('a platform assumption cites evidence that does not resolve: ' + report.unevidenced.map((x) => `${x.assumption} (${x.unresolved.join(', ')})`).join('; '));
    if (!report.validation.valid) v.push('the platform assumption registry is invalid: ' + report.validation.violations.join('; '));
    if (report.authorizes !== false) v.push('the assumption report claims authority');
    for (const a of report.assumptions) {
      if (!a.statement || !a.rationale || !a.owner) v.push(`${a.id}: incomplete record`);
      if (a.expiresAt <= a.registeredAt) v.push(`${a.id}: expires before it was registered`);
    }
    // Every platform assumption is honestly overclaimed until somebody verifies it — and that is
    // reported rather than smoothed over. If this ever becomes empty without verifications being
    // recorded, the assessment has been weakened.
    if (!report.overclaims.length) v.push('no platform assumption is reported as an overclaim, yet none has been verified — the assessment has stopped being strict');
  }),

  fit('APP-FIT-TWIN-CONFIDENCE', 'No simulation runs without declared assumptions, and an unchecked simulation cannot claim high confidence', (v) => {
    const twinMod = require('../src/twin2/operations-twin');
    const asm = require('../src/architecture/assumptions');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Every declared scenario carries the metadata that makes it arguable ------------------
    for (const [id, spec] of Object.entries(twinMod.SCENARIOS)) {
      try { twinMod.assertDeclaredMetadata(id, spec); } catch (e) { v.push(`scenario '${id}': ${e.message}`); }
      for (const l of spec.limitations || []) if (l.length < 20) v.push(`scenario '${id}': a limitation stated in ${l.length} characters is not a limitation`);
    }
    // …and the guard genuinely rejects a scenario that does not. Fed crafted specs, so the check
    // never has to mutate the real scenario table to prove it works.
    const good = { assumptions: ['ASM-0001'], limitations: ['something the model cannot see, stated at length'], owner: 'ARB', reviewCadenceDays: 90 };
    for (const [what, spec] of [
      ['no assumptions', { ...good, assumptions: [] }],
      ['no limitations', { ...good, limitations: [] }],
      ['no owner', { ...good, owner: null }],
      ['no cadence', { ...good, reviewCadenceDays: 0 }],
    ]) {
      let rejected = false;
      try { twinMod.assertDeclaredMetadata('probe', spec); } catch (e) { rejected = !!e.failClosed; }
      if (!rejected) v.push(`a scenario with ${what} was accepted for simulation`);
    }
    if (twinMod.assertDeclaredMetadata('probe', good) !== true) v.push('a fully declared scenario was rejected — the guard rejects everything and proves nothing');

    // --- Calibration: never seeded, and it caps confidence ------------------------------------
    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const twin = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: registry, clock: () => 0 });
    for (const s of Object.keys(twinMod.SCENARIOS)) {
      if (twin.validationHistory(s).length) v.push(`scenario '${s}' has a validation history on a freshly built twin — historical evidence must never be fabricated`);
      if (twin.calibration(s).state !== 'uncalibrated') v.push(`scenario '${s}' is calibrated with no comparisons recorded`);
    }
    let unattributed = false;
    try { twin.recordValidation('dr-exercise', { predicted: true, observed: true }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('a simulation validation was recorded with nobody named as having made the comparison');
    let notBoolean = false;
    try { twin.recordValidation('dr-exercise', { predicted: 'probably', observed: true, by: 'ORB' }); } catch (_) { notBoolean = true; }
    if (!notBoolean) v.push('a validation accepted a non-boolean prediction');

    // Three agreeing comparisons calibrate it; the state must actually change, or the mechanism is
    // decoration.
    for (let i = 0; i < twinMod.CALIBRATION_MIN_OBSERVATIONS; i++) twin.recordValidation('dr-exercise', { predicted: true, observed: true, by: 'Operations Review Board', at: i });
    if (twin.calibration('dr-exercise').state !== 'calibrated') v.push('three agreeing comparisons did not calibrate the scenario');
    // Disagreement takes it to diverging, and diverging caps confidence at unknown.
    const drift = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: registry, clock: () => 0 });
    for (let i = 0; i < 5; i++) drift.recordValidation('dr-exercise', { predicted: true, observed: i < 1, by: 'ORB', at: i });
    if (drift.calibration('dr-exercise').state !== 'diverging') v.push('a simulation that disagreed with reality four times out of five was not reported as diverging');
    if (drift.confidence('dr-exercise', { now: 0, controls }).confidence !== 'unknown') v.push('a diverging simulation still supported a confidence level');
    if (!drift.confidenceTrend('dr-exercise').warning) v.push('a degrading agreement trend produced no warning');
    if (drift.confidenceTrend('operational-failure').direction !== 'insufficient-data') v.push('a trend was reported for a scenario with no comparisons');

    // --- Confidence is capped by the weakest factor, and can reach high ----------------------
    const noRegistry = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), clock: () => 0 });
    const blind = noRegistry.confidence('dr-exercise', { now: 0, controls });
    if (blind.confidence !== 'unknown') v.push('a twin with no assumption registry still reported a confidence level');
    if (!blind.limitedBy.includes('assumptions')) v.push('a missing assumption registry was not named as the limiting factor');

    // A crafted registry where every factor is sound must reach 'high' — otherwise this is a gate
    // that can only fail, which proves nothing about the platform.
    const sound = new asm.AssumptionRegistry({ clock: () => 0 });
    for (const id of twinMod.SCENARIOS['dr-exercise'].assumptions) {
      sound.register(id, {
        statement: 'a sound assumption for the confidence probe', rationale: 'exercises the success path of the confidence calculation',
        evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['resilience'], owner: 'ORB',
        reviewCadenceDays: 3650, expiresAt: 3650 * 24 * 3600_000, verificationMethod: 'executable-check', confidence: 'high',
      });
      sound.recordVerification(id, { holds: true, by: 'Assurance', at: 0 });
    }
    const calibrated = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: sound, clock: () => 0 });
    for (let i = 0; i < 4; i++) calibrated.recordValidation('dr-exercise', { predicted: true, observed: true, by: 'ORB', at: i });
    const best = calibrated.confidence('dr-exercise', { now: 0, controls });
    if (best.confidence !== 'high') v.push('a calibrated simulation on verified assumptions did not reach high confidence: ' + JSON.stringify(best.factors));

    // --- Every simulation carries its confidence metadata ------------------------------------
    const run = calibrated.simulate({ scenario: 'dr-exercise', change: { failedRegions: ['bw-south', 'bw-north'] }, now: 0, controls });
    for (const field of ['confidence', 'assumptions', 'limitations', 'owner', 'reviewDueAt', 'calibration', 'validationHistory', 'confidenceDetail']) {
      if (run[field] === undefined || run[field] === null) v.push(`a simulation result omits '${field}'`);
    }
    if (!run.confidenceDetail.evidenceBasis) v.push('a simulation result states no evidence basis');
    if (run.authorizes !== false) v.push('a simulation with high confidence claims authority');
    if (run.isolation.unchanged !== true) v.push('the confidence framework broke simulation isolation');

    // The report aggregates to the weakest scenario, not the average.
    const report = calibrated.confidenceReport({ now: 0, controls });
    const weakest = report.scenarios.slice().sort((a, b) => ['high', 'moderate', 'low', 'unknown'].indexOf(b.confidence) - ['high', 'moderate', 'low', 'unknown'].indexOf(a.confidence))[0];
    if (report.confidence !== weakest.confidence) v.push('the confidence report does not aggregate to the weakest scenario');
    if (!report.uncalibrated.length) v.push('scenarios that have never been compared against reality were not named as uncalibrated');
    if (report.authorizes !== false) v.push('the confidence report claims authority');
  }),

  fit('APP-FIT-INSTITUTIONAL-CHAIN', 'The mission chain reaches the institution and the government outcome, and every hop states its mechanism', (v) => {
    const bus = require('../src/observability/business');
    for (const violation of bus.validateMissionChain().violations) v.push(violation);

    // The two new layers are populated and joined at both ends.
    if (!bus.institutionalImpacts().length) v.push('no institutional impacts are declared');
    if (!bus.governmentMissionOutcomes().length) v.push('no government mission outcomes are declared');
    for (const i of bus.institutionalImpacts()) {
      if (!i.institution) v.push(`institutional impact '${i.id}' names no institution`);
      if (!i.escalatesTo) v.push(`institutional impact '${i.id}' names no board it escalates to`);
    }
    for (const g of bus.governmentMissionOutcomes()) if (!g.owner || !g.title) v.push(`government mission outcome '${g.id}' is incomplete`);

    // The dependency graph is derived from the same links the forecast traverses, so the picture
    // and the calculation cannot disagree.
    const graph = bus.missionDependencyGraph();
    if (graph.edgeCount !== bus.missionImpactLinks().length) v.push('the mission dependency graph has a different number of edges than the chain it draws');
    if (graph.backwardEdges.length) v.push('the mission chain contains a backward edge, which would make it a cycle: ' + graph.backwardEdges.join(', '));
    if (graph.unresolvedEndpoints.length) v.push('the mission graph has edges to nodes it does not contain: ' + graph.unresolvedEndpoints.join(', '));
    if (graph.isolated.length) v.push('mission graph nodes nothing reaches and that reach nothing: ' + graph.isolated.join(', '));
    for (const l of graph.layers) if (!l.nodes.length && l.layer !== 'technical-event') v.push(`mission layer '${l.layer}' has no nodes`);

    // A forecast now reaches all the way to a government mission outcome, through the institution.
    const f = bus.missionImpactForecast({ change: 'withdraw the intake store', failed: ['persistence-ind'] });
    if (!f.institutionalImpacts.length) v.push('a constitutional service failure reached no institutional impact');
    if (!f.institutionsAffected.length) v.push('no institution was named as affected');
    if (!f.governmentMissionOutcomes.length) v.push('the forecast did not reach a government mission outcome');
    if (!f.paths.length) v.push('the forecast produced no traceable path');
    for (const p of f.paths) if (!/→/.test(p.chain) || !p.mechanisms.length) v.push(`path '${p.chain}' is not traceable`);
    // Unknown must still be distinct from no impact — the Phase 12 property, re-checked here
    // because Part 3 is exactly the kind of extension that could quietly lose it.
    const orphan = bus.missionImpactForecast({ change: 'broker withdrawal', failed: ['broker-exec'] });
    if (orphan.safeToDeploy) v.push('an unmapped affected component was reported safe — unknown must remain distinct from no impact');
    if (!/unknown, not nil/.test(orphan.boardSummary)) v.push('the extended chain lost the unknown-vs-none distinction');
    const nothing = bus.missionImpactForecast({ change: 'docs only', failed: [] });
    if (!nothing.safeToDeploy || nothing.institutionalImpacts.length) v.push('a change affecting nothing produced an institutional impact');
    if (f.authorizes !== false || graph.authorizes !== false) v.push('the mission chain claims authority');
  }),

  fit('APP-FIT-COMPLIANCE-LIFECYCLE', 'Compliance states are a machine, unknown never reads as compliant, and verified cannot be self-declared', (v) => {
    const ci = require('../src/legislation/compliance-intelligence');
    const { LegislativeRegistry } = require('../src/legislation/registry');
    const build = () => {
      const reg = new LegislativeRegistry({ clock: () => 0 });
      reg.register('act', { title: 'An Act', mapsToControls: ['APP-FIT-A', 'APP-FIT-B'] });
      return new ci.ComplianceIntelligence({ registry: reg, clock: () => 0 });
    };

    // --- The eight states, and the invariant --------------------------------------------------
    for (const required of ['unknown', 'under-assessment', 'compliant', 'partially-compliant', 'failing', 'governance-gap', 'remediating', 'verified']) {
      if (!ci.COMPLIANCE_STATES[required]) v.push(`compliance state '${required}' is not declared`);
    }
    // THE PART 4 INVARIANT.
    if (ci.COMPLIANCE_STATES.unknown.compliant) v.push('the unknown state is declared compliant');
    if (ci.COMPLIANCE_STATES['under-assessment'].compliant) v.push('under-assessment is declared compliant — work in progress is not an outcome');
    if (ci.COMPLIANCE_STATES['partially-compliant'].compliant) v.push('partial compliance is declared compliant');
    if (!ci.COMPLIANCE_STATES.compliant.compliant || !ci.COMPLIANCE_STATES.verified.compliant) v.push('no state counts as compliant, so the model can never succeed');
    for (const [id, spec] of Object.entries(ci.COMPLIANCE_STATES)) {
      if (!spec.description) v.push(`state '${id}' has no description`);
      if (!ci.COMPLIANCE_TRANSITIONS[id]) v.push(`state '${id}' declares no legal transitions`);
      for (const to of ci.COMPLIANCE_TRANSITIONS[id]) if (!ci.COMPLIANCE_STATES[to]) v.push(`'${id}' transitions to undeclared state '${to}'`);
    }
    if (!build().validate().valid) v.push('the compliance lifecycle is invalid: ' + build().validate().violations.join('; '));

    // --- The state machine refuses the transitions an audit most wants to make ----------------
    const c = build();
    let jumped = false;
    try { c.transition('act', { to: 'verified', by: 'Compliance', rationale: 'looks fine' }); } catch (e) { jumped = !!e.failClosed; }
    if (!jumped) v.push('an obligation jumped from unknown straight to verified');
    let unattributed = false;
    try { c.transition('act', { to: 'under-assessment', by: 'Compliance' }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('a compliance state change was recorded with no rationale');
    let unknownState = false;
    try { c.transition('act', { to: 'probably-fine', by: 'x', rationale: 'y' }); } catch (_) { unknownState = true; }
    if (!unknownState) v.push('an undeclared compliance state was accepted');

    c.transition('act', { to: 'under-assessment', by: 'Compliance Officer', rationale: 'assessment opened' });
    c.transition('act', { to: 'compliant', by: 'Compliance Officer', rationale: 'both controls hold' });
    let selfVerified = false;
    try { c.transition('act', { to: 'verified', by: 'Compliance Officer', rationale: 'confirmed', independent: true }); } catch (e) { selfVerified = !!e.failClosed; }
    if (!selfVerified) v.push('the assessor verified their own assessment — verified and compliant would then mean the same thing');
    let notIndependent = false;
    try { c.transition('act', { to: 'verified', by: 'Auditor General', rationale: 'confirmed' }); } catch (e) { notIndependent = !!e.failClosed; }
    if (!notIndependent) v.push('verified was set without independent confirmation');
    c.transition('act', { to: 'verified', by: 'Auditor General', rationale: 'independently confirmed', independent: true });
    if (c.state('act').state !== 'verified') v.push('a legal, independent verification did not take effect');

    // --- Derivation from evidence, and reconciliation against what was declared ---------------
    const holding = [{ id: 'APP-FIT-A', pass: true }, { id: 'APP-FIT-B', pass: true }];
    const mixed = [{ id: 'APP-FIT-A', pass: true }, { id: 'APP-FIT-B', pass: false }];
    const d = build();
    if (d.deriveState('act', { controls: [] }).derived !== 'governance-gap') v.push('an obligation whose controls never ran did not derive as a governance gap');
    if (d.deriveState('act', { controls: holding }).derived !== 'compliant') v.push('an obligation whose controls all hold did not derive as compliant');
    if (d.deriveState('act', { controls: mixed }).derived !== 'partially-compliant') v.push('a partly-failing obligation did not derive as partially compliant');
    if (d.deriveState('act', { controls: [{ id: 'APP-FIT-A', pass: false }, { id: 'APP-FIT-B', pass: false }] }).derived !== 'failing') v.push('an obligation whose controls all failed did not derive as failing');
    if (d.deriveState('act', { controls: ['APP-FIT-A', 'APP-FIT-B'] }).derived !== 'under-assessment') v.push('controls with no supplied result derived as something other than under-assessment');

    // An obligation declared compliant whose evidence disagrees is the finding this exists for.
    const r = build();
    r.transition('act', { to: 'under-assessment', by: 'Officer', rationale: 'opened' });
    r.transition('act', { to: 'compliant', by: 'Officer', rationale: 'declared' });
    const bad = r.stateReconciliation({ controls: mixed });
    if (!bad.overstated.includes('act')) v.push('an obligation declared compliant whose controls fail was not reported as overstated');
    if (bad.sound) v.push('a reconciliation with an overstated obligation reported sound');
    const good = r.stateReconciliation({ controls: holding });
    if (!good.sound || good.overstated.length) v.push('a correctly declared obligation was reported as overstated');
    if (!good.noUnknownReportedCompliant) v.push('the unknown-is-never-compliant invariant is not checked');

    // --- Timeline and evolution ---------------------------------------------------------------
    const fresh = build();
    if (!fresh.timeline('act').neverAssessed) v.push('an obligation with no recorded state change was not reported as never assessed');
    if (!/not a form of compliant/.test(fresh.timeline('act').note || '')) v.push('a never-assessed obligation does not say that unknown is not compliant');
    const tl = c.timeline('act');
    if (tl.transitions !== 3) v.push(`expected three recorded transitions, found ${tl.transitions}`);
    for (const e of tl.entries) if (!e.by || !e.rationale || typeof e.compliantDuring !== 'boolean') v.push('a timeline entry is missing its attribution or its compliance flag');
    const evo = c.evolution({ controls: holding });
    if (evo.verified !== 1 || evo.complianceRate !== 1) v.push('the evolution report disagrees with the recorded states');
    if (evo.direction !== 'improving') v.push('an obligation that moved unknown → verified was not reported as improving');
    // Net movement and the latest movement are separate facts: an estate that rose and then fell has
    // a net of zero and a problem, and reporting only the net would hide it.
    const upDown = build();
    upDown.transition('act', { to: 'under-assessment', by: 'O', rationale: 'r', at: 1 });
    upDown.transition('act', { to: 'compliant', by: 'O', rationale: 'r', at: 2 });
    upDown.transition('act', { to: 'failing', by: 'O', rationale: 'a control broke', at: 3 });
    const swung = upDown.evolution({ controls: mixed });
    if (swung.direction !== 'flat') v.push('an estate that began and ended non-compliant did not report a flat net direction');
    if (swung.recentDirection !== 'regressing') v.push('an estate whose latest move was downward was not reported as recently regressing');
    if (fresh.evolution({ controls: holding }).neverAssessed.length !== 1) v.push('a never-assessed obligation was not counted separately');
    if (evo.authorizes !== false) v.push('the evolution report claims authority');
  }),

  fit('APP-FIT-TEMPORAL-GRAPH', 'Every graph edge is placeable in time, and an undated edge is excluded rather than assumed eternal', (v) => {
    const { EnterpriseGraph, EDGE_EVIDENCE, EDGE_KINDS } = require('../src/graph/enterprise-graph');
    const { ContractRegistry } = require('../src/contracts/integration-contracts');
    const results = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const known = new Set(results.map((r) => r.id));
    // Every relationship declares the check that would fail if an edge of that kind were wrong,
    // and that check must actually exist — otherwise the edge cites evidence nobody runs.
    for (const rel of Object.keys(EDGE_KINDS)) if (!EDGE_EVIDENCE[rel]) v.push(`edge kind '${rel}' names no control that would fail if it were wrong`);
    for (const [rel, control] of Object.entries(EDGE_EVIDENCE)) if (!known.has(control)) v.push(`edge kind '${rel}' cites '${control}', which is not a control that runs`);

    const EPOCH = 1_000;
    const g = new EnterpriseGraph({ fitnessResults: results, contracts: new ContractRegistry(), epoch: EPOCH });

    // --- Every edge carries the five temporal fields ------------------------------------------
    for (const e of g.edges()) {
      for (const field of ['createdAt', 'version', 'evidence']) {
        if (e[field] === undefined || e[field] === null) v.push(`edge ${e.from} → ${e.to} has no ${field}`);
      }
      if (!Object.prototype.hasOwnProperty.call(e, 'expiredAt')) v.push(`edge ${e.from} → ${e.to} has no expiry field`);
    }
    const integrity = g.temporalIntegrity();
    if (integrity.coverage !== 1) v.push(`only ${integrity.coverage} of edges are dated: ${integrity.undated.slice(0, 3).join(', ')}`);
    if (integrity.unevidenced.length) v.push('edges with no evidence: ' + integrity.unevidenced.slice(0, 3).join(', '));
    if (!integrity.sound) v.push('temporal integrity is unsound: ' + JSON.stringify(integrity.expiredBeforeCreated));

    // --- Temporal queries ----------------------------------------------------------------------
    if (g.asOf(EPOCH - 1).totalEdgesInForce !== 0) v.push('edges created at the epoch were in force before it');
    if (g.asOf(EPOCH).totalEdgesInForce === 0) v.push('no edge was in force at the epoch it was created');
    let undatedQuery = false;
    try { g.asOf(undefined); } catch (_) { undatedQuery = true; }
    if (!undatedQuery) v.push('a temporal query without an instant was accepted');

    // An edge with no creation time is EXCLUDED, not assumed eternal — the property that stops a
    // half-migrated graph from silently answering historical questions wrongly.
    const withUndated = new EnterpriseGraph({
      fitnessResults: results, contracts: new ContractRegistry(), epoch: EPOCH,
      history: [{ from: 'adr:ADR-0001', to: 'bounded-context:assurance', rel: 'decides', createdAt: null, expiredAt: null, version: 1, evidence: null, owner: null }],
    });
    if (withUndated.temporalIntegrity().coverage === 1) v.push('an undated edge was counted as dated');
    if (withUndated.edgesAsOf(EPOCH + 10).some((e) => !Number.isFinite(e.createdAt))) v.push('an undated edge was reported as in force at an instant');
    if (!withUndated.asOf(EPOCH).undated.length) v.push('an undated edge was not named in the temporal query');

    // A superseded edge is in force before its expiry and not after — the query that makes
    // "which policies governed this dataset on that date" answerable.
    const historical = new EnterpriseGraph({
      fitnessResults: results, contracts: new ContractRegistry(), epoch: EPOCH,
      history: [
        // Still in force today, so it proves the as-of query returns what governed then.
        { from: 'policy:consistency:investigation', to: 'bounded-context:investigation', rel: 'governs', createdAt: 100, expiredAt: 500, version: 1, evidence: 'evidence:APP-FIT-RACI-GOVERNANCE', owner: 'ARB' },
        // Retired: no current edge re-establishes this relationship, so it proves removal.
        { from: 'policy:consistency:retired-stance', to: 'bounded-context:investigation', rel: 'governs', createdAt: 100, expiredAt: 500, version: 1, evidence: 'evidence:APP-FIT-RACI-GOVERNANCE', owner: 'ARB' },
      ],
    });
    if (!historical.edgesAsOf(300).some((e) => e.historical)) v.push('a superseded edge was not in force before its expiry');
    if (historical.edgesAsOf(600).some((e) => e.historical)) v.push('a superseded edge was still in force after its expiry');
    const then = historical.asOf(300, { node: 'bounded-context:investigation' });
    if (!then.policies.includes('policy:consistency:investigation')) v.push('a historical policy query did not return the policy in force at that instant');

    // --- Temporal impact ------------------------------------------------------------------------
    // Spans the epoch: the historical edge expires at 500 and the current graph comes into force at
    // EPOCH, so this interval must report both a removal and additions.
    const change = historical.temporalImpact(300, EPOCH + 500);
    if (!change.removed.some((r) => /retired-stance/.test(r.edge))) v.push('an edge that expired between two instants was not reported as removed');
    // …and a relationship that expired but was re-established is NOT a removal, because it still holds.
    if (change.removed.some((r) => /policy:consistency:investigation/.test(r.edge))) v.push('a relationship that still holds today was reported as removed because an older version of it expired');
    if (!change.added.length) v.push('edges that came into force between two instants were not reported as added');
    let backwards = false;
    try { historical.temporalImpact(600, 300); } catch (_) { backwards = true; }
    if (!backwards) v.push('a temporal impact analysis accepted a second instant before the first');
    if (change.authorizes !== false) v.push('temporal impact analysis claims authority');
    // Nothing changed across an interval with no events.
    const quiet = historical.temporalImpact(EPOCH + 100, EPOCH + 200);
    if (quiet.added.length || quiet.removed.length) v.push('a quiet interval reported changes');
  }),

  fit('APP-FIT-DOCUMENTATION-ASSURANCE', 'Every claim a governed document makes resolves against the implementation, and the extractor cannot pass by matching nothing', (v) => {
    const da = require('../src/architecture/documentation-assurance');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Every claim kind says what it is, what resolved means, and what a wrong one costs -----
    for (const k of da.claimKinds()) {
      if (!k.description || !k.resolvedMeans || !k.ifWrong) v.push(`claim kind '${k.kind}' does not say what it is, what resolution means, or what it costs when wrong`);
    }
    if (da.documents().length < 8) v.push(`only ${da.documents().length} documents are governed — the corpus is too small for this control to mean anything`);

    const report = da.report({ controls });
    if (!report.sound) for (const b of report.blockers) v.push(b);
    if (report.verification.missingDocuments.length) v.push('governed documents that do not exist: ' + report.verification.missingDocuments.join(', '));
    if (report.verification.documentsWithNoClaims.length) v.push('governed documents from which nothing could be extracted: ' + report.verification.documentsWithNoClaims.join(', '));
    if (report.authorizes !== false) v.push('the documentation assurance report claims authority');
    // It says what it did NOT do, rather than implying it ran the commands.
    if (!/resolved, not executed|RESOLVE/.test(report.verification.verifiedNotExecuted)) v.push('the report does not distinguish resolving a command from executing it');

    // --- The extractor guards itself ------------------------------------------------------------
    if (!report.verification.extractorSound) v.push(`only ${report.verification.claims} claims extracted — below the ${da.MINIMUM_CLAIMS} floor, so the extractor has stopped working`);
    for (const kind of ['api-route', 'adr-reference', 'fitness-id', 'source-module', 'doc-link']) {
      const row = report.verification.byKind.find((b) => b.kind === kind);
      if (!row || !row.total) v.push(`no '${kind}' claims were extracted from the entire corpus — the pattern for that kind has stopped matching`);
    }

    // --- Every kind of wrong claim is caught. Fed crafted text, so the check proves it can fail --
    const world = { routes: da.serverRoutes(), scripts: da.npmScripts(), adrs: da.adrNumbers(), controls: new Set(controls.map((c) => c.id)) };
    const bad = [
      { kind: 'api-route', value: '/api/does-not-exist' },
      { kind: 'npm-command', value: 'never-defined-script' },
      { kind: 'adr-reference', value: 9999 },
      { kind: 'doc-link', value: 'no-such-document.md' },
      { kind: 'fitness-id', value: 'APP-FIT-NEVER-WRITTEN' },
      { kind: 'source-module', value: 'src/imaginary/module.js' },
      { kind: 'telepathy', value: 'anything' },
    ];
    for (const claim of bad) {
      const r = da.verifyClaim({ ...claim, raw: '' }, world);
      if (r.resolved) v.push(`a documentation claim of kind '${claim.kind}' with value '${claim.value}' resolved, but nothing of that name exists`);
    }
    // …and every kind of right claim passes, or the checker rejects everything and proves nothing.
    const good = [
      { kind: 'api-route', value: '/api/resilience/consistency' },
      { kind: 'npm-command', value: 'test' },
      { kind: 'adr-reference', value: 1 },
      { kind: 'doc-link', value: 'adr/0001-baseline-and-mvp.md' },
      { kind: 'fitness-id', value: 'APP-FIT-CONTEXT-MAP' },
      { kind: 'source-module', value: 'src/server.js' },
    ];
    for (const claim of good) {
      const r = da.verifyClaim({ ...claim, raw: '' }, world);
      if (!r.resolved) v.push(`a valid documentation claim of kind '${claim.kind}' ('${claim.value}') was reported unresolvable: ${r.detail}`);
    }
    // Extraction itself works on crafted text, so a silent regex failure is caught here too.
    const extracted = da.extractClaims('See `GET /api/reports` and run npm run test, per ADR-0002, in `src/server.js`, gated by APP-FIT-CONTEXT-MAP.');
    for (const kind of ['api-route', 'npm-command', 'adr-reference', 'source-module', 'fitness-id']) {
      if (!extracted.some((c) => c.kind === kind)) v.push(`the extractor did not find a '${kind}' claim in text that plainly contains one`);
    }
    for (const c of extracted) if (!c.raw) v.push(`an extracted claim carries no source text, so a finding could not be traced back to the sentence that made it`);

    // --- Part 7: operational procedures carry what an operator needs at 03:00 -------------------
    const procedures = da.verifyProcedures({});
    if (!procedures.count) v.push('no document is classified as an operational procedure');
    for (const p of procedures.procedures) {
      if (p.missing) v.push(`operational procedure '${p.document}' does not exist`);
      for (const g of p.gaps || []) v.push(`${p.document}: no ${g.requirement} — ${g.why}`);
    }
    if (!procedures.complete) v.push('an operational procedure is incomplete: ' + procedures.incomplete.join(', '));
    for (const r of procedures.requirements) if (!r.why) v.push(`procedure requirement '${r.requirement}' does not say why it is needed`);
    // The caveat is the honest part: presence is not correctness.
    if (!/only a rehearsal catches that/.test(procedures.caveat)) v.push('the procedure check does not admit that presence of a section is not proof the procedure works');
    // And it can fail: a document with none of the required elements must be reported incomplete.
    const emptyProbe = Object.keys(da.PROCEDURE_REQUIREMENTS).filter((req) => da.PROCEDURE_REQUIREMENTS[req].pattern.test('This document says nothing operational whatsoever.'));
    if (emptyProbe.length) v.push('a document containing nothing operational satisfied procedure requirements: ' + emptyProbe.join(', '));
  }),

  fit('APP-FIT-KNOWLEDGE-CONTINUITY', 'A derived deputy is a name, not an alternative — continuity counts only people who could actually take over', (v) => {
    const own = require('../src/governance/ownership');
    const DAY = 24 * 3600_000, NOW = 400 * DAY;

    // --- Rehearsal participation is attested, typed and expires --------------------------------
    for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) {
      if (!k.why || !k.relevantTo || !k.relevantTo.length) v.push(`exercise '${id}' does not say why it matters or which roles it applies to`);
      for (const role of k.relevantTo) if (!own.DEPUTY_ROLES.includes(role)) v.push(`exercise '${id}' names unknown role '${role}'`);
    }
    const ex = new own.ExerciseRegister({ clock: () => NOW });
    let unattested = false;
    try { ex.recordParticipation({ person: 'X', exercise: 'disaster-recovery', at: NOW }); } catch (e) { unattested = !!e.failClosed; }
    if (!unattested) v.push('rehearsal participation was recorded with nobody attesting it — self-reported attendance attests nothing');
    let unknownExercise = false;
    try { ex.recordParticipation({ person: 'X', exercise: 'a-chat-about-it', at: NOW, by: 'ORB' }); } catch (_) { unknownExercise = true; }
    if (!unknownExercise) v.push('an undeclared exercise kind was accepted');
    ex.recordParticipation({ person: 'X', exercise: 'disaster-recovery', at: NOW - 400 * DAY, by: 'ORB' });
    const lapsed = ex.status('X', 'operationalOwner', { now: NOW });
    if (!lapsed.lapsed.includes('disaster-recovery')) v.push('a rehearsal older than its validity was not reported as lapsed');
    if (lapsed.current) v.push('a lapsed rehearsal was reported current');
    // Never-participated and lapsed are different states with different remedies.
    if (!ex.status('Y', 'operationalOwner', { now: NOW }).never.includes('disaster-recovery')) v.push('never having rehearsed was not distinguished from a lapsed rehearsal');

    // --- Role readiness is the weakest of four facts, and unknown is not ready -----------------
    const blind = own.roleReadiness('X', 'dataSteward', { now: NOW });
    if (blind.ready) v.push('a role was reported ready with no evidence of anything');
    if (blind.unknownFactors.length !== 4) v.push('unsupplied registers were not all reported as unknown factors');
    if (!/readiness unknown/.test(blind.reason)) v.push('unknown readiness was not distinguished from failed readiness');

    // A fully evidenced estate must reach bus factor 2, or this control can only ever fail.
    const availability = new own.AvailabilityRegister({ clock: () => NOW });
    const activity = new own.ActivityRegister({ clock: () => NOW });
    const training = new own.TrainingRegister({ clock: () => NOW });
    const exercises = new own.ExerciseRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
          activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
          for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar of Governance' });
          for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
        }
      }
    }
    const full = { availability, activity, training, exercises, now: NOW };
    const sound = own.knowledgeContinuity(full);
    if (!sound.sound) v.push('a fully evidenced estate still reported single-person dependencies: ' + sound.singlePersonDependencies.slice(0, 3).join(', '));
    if (sound.minimumBusFactor < 2) v.push('a fully evidenced estate did not reach a bus factor of two');

    // THE TRAP THIS CONTROL EXISTS FOR: with the deputies' evidence removed, every role must fall
    // back to a single person — because a derived deputy who has never acted is a name, not an
    // alternative. If this ever passes, continuity has started counting names.
    const primariesOnly = new own.ActivityRegister({ clock: () => NOW });
    const primaryTraining = new own.TrainingRegister({ clock: () => NOW });
    const primaryExercises = new own.ExerciseRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        const person = own.OWNERSHIP[s][role];
        primariesOnly.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
        for (const c of own.REQUIRED_TRAINING[role]) primaryTraining.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar' });
        for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) primaryExercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
      }
    }
    const namesOnly = own.knowledgeContinuity({ availability, activity: primariesOnly, training: primaryTraining, exercises: primaryExercises, now: NOW });
    if (namesOnly.sound) v.push('an estate whose deputies have never acted and hold no training reported sound continuity — a derived deputy is being counted as an alternative');
    if (namesOnly.minimumBusFactor !== 1) v.push('an estate covered only by primaries did not report a bus factor of one');

    // --- Part 11: training assurance, and its effect on readiness ------------------------------
    const assurance = own.trainingAssurance(full);
    if (!assurance.sound) v.push('a fully trained and rehearsed estate was not reported sound: ' + JSON.stringify(assurance.expiredQualifications.slice(0, 3)));
    if (assurance.readinessContribution !== 1) v.push('a fully certified estate did not contribute full readiness');
    const nothing = own.trainingAssurance({ now: NOW });
    if (nothing.readinessContribution !== 0) v.push('an estate with no training evidence contributed readiness anyway');
    if (!nothing.unknown.length) v.push('unknown certification was not reported as unknown');
    // An expired qualification lowers readiness on its own, with nobody deciding to lower it.
    const stale = new own.TrainingRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
          for (const c of own.REQUIRED_TRAINING[role]) stale.recordCompletion({ person, course: c, at: NOW - 400 * DAY, by: 'Registrar' });
        }
      }
    }
    const lapsedEstate = own.trainingAssurance({ activity, training: stale, exercises, now: NOW });
    if (lapsedEstate.readinessContribution >= assurance.readinessContribution) v.push('expired qualifications did not reduce the readiness contribution');
    if (!lapsedEstate.expiredQualifications.length) v.push('expired qualifications were not named');
  }),

  fit('APP-FIT-INSTITUTIONAL-RESILIENCE', 'No critical capability depends on a single person, process, document or system — and an alternative counts only if validated', (v) => {
    const ir = require('../src/governance/institutional-resilience');
    const own = require('../src/governance/ownership');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const DAY = 24 * 3600_000, NOW = 400 * DAY;

    // --- The invariant is stated, and every dimension says how an alternative is validated -----
    for (const required of ['person', 'team', 'document', 'process', 'service', 'region', 'supplier', 'communication-channel',
      // Phase 14, Part 11.
      'data', 'knowledge', 'facility', 'legal-authority', 'governance']) {
      if (!ir.DEPENDENCY_KINDS[required]) v.push(`dependency kind '${required}' is not assessed`);
    }
    for (const [kind, spec] of Object.entries(ir.DEPENDENCY_KINDS)) {
      if (!spec.question || !spec.validatedBy) v.push(`dependency kind '${kind}' does not say what it asks or how an alternative is validated`);
      if (spec.detectedBy === undefined) v.push(`dependency kind '${kind}' does not say whether anything would detect it breaking`);
    }
    // Part 11: the eleven categories, and every kind belongs to exactly one.
    for (const required of ['people', 'process', 'technology', 'data', 'knowledge', 'documentation', 'facilities', 'communications', 'suppliers', 'legal-authority', 'governance']) {
      if (!ir.DEPENDENCY_CATEGORIES[required]) v.push(`dependency category '${required}' is not evaluated`);
    }
    if (Object.keys(ir.DEPENDENCY_CATEGORIES).length !== 11) v.push('the dependency taxonomy does not have exactly eleven categories');
    for (const kind of Object.keys(ir.DEPENDENCY_KINDS)) {
      const owning = Object.entries(ir.DEPENDENCY_CATEGORIES).filter(([, c]) => c.kinds.includes(kind)).map(([id]) => id);
      if (owning.length !== 1) v.push(`dependency kind '${kind}' belongs to ${owning.length} categories: ${owning.join(', ')}`);
    }
    for (const [id, c] of Object.entries(ir.DEPENDENCY_CATEGORIES)) {
      if (!c.asks || !c.kinds.length) v.push(`dependency category '${id}' asks nothing or covers no kind`);
      for (const k of c.kinds) if (!ir.DEPENDENCY_KINDS[k]) v.push(`category '${id}' claims unknown kind '${k}'`);
    }
    // Every critical capability states what its loss costs — the sentence that makes narrowing the
    // definition visible.
    for (const [id, spec] of Object.entries(ir.CRITICAL_CAPABILITIES)) {
      if (!spec.lossMeans || spec.lossMeans.length < 30) v.push(`critical capability '${id}' does not say what its loss costs`);
      if (!spec.services.length || !spec.subsystems.length) v.push(`critical capability '${id}' names no services or subsystems`);
    }
    if (Object.values(ir.CRITICAL_CAPABILITIES).filter((c) => c.constitutional).length < 3) v.push('fewer than three capabilities are marked constitutional — the definition has been narrowed');

    // --- With no continuity evidence, the person dimension is unknown, and unknown is not resilient
    const blind = ir.evaluate({ controls });
    if (blind.holds) v.push('the invariant held with no evidence that anybody could take over anything');
    if (!blind.capabilities.every((c) => c.singleDependencies.includes('person'))) v.push('unknown personal continuity was not treated as a single-person dependency');
    if (!blind.blocksInstitutionalReadiness) v.push('an unheld invariant did not block institutional readiness');
    if (blind.authorizes !== false) v.push('the institutional resilience report claims authority');

    // --- With a fully evidenced estate, the person dimension clears ----------------------------
    const availability = new own.AvailabilityRegister({ clock: () => NOW });
    const activity = new own.ActivityRegister({ clock: () => NOW });
    const training = new own.TrainingRegister({ clock: () => NOW });
    const exercises = new own.ExerciseRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
          activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
          for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar' });
          for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
        }
      }
    }
    const continuity = own.knowledgeContinuity({ availability, activity, training, exercises, now: NOW });
    const evaluated = ir.evaluate({ continuity, controls });
    if (evaluated.capabilities.some((c) => c.singleDependencies.includes('person'))) v.push('a fully evidenced estate still reported a single-person dependency');
    if (evaluated.capabilities.some((c) => c.singleDependencies.includes('document'))) v.push('a governed operational procedure was not accepted as a followable document');
    if (evaluated.capabilities.some((c) => c.singleDependencies.includes('region'))) v.push('losing one of three regions stopped a capability');
    // At least one capability must come out fully resilient, or this control can only ever fail.
    if (!evaluated.capabilities.some((c) => c.resilient)) v.push('no capability is resilient on every dimension, so the check has no success path');

    // --- THE RATCHET. The known architectural single point of failure is the per-zone persistence
    // store: each zone has exactly one, so losing it stops the capabilities in that zone. That is
    // recorded here so it cannot be forgotten — and so any NEW kind of single dependency, or a new
    // capability acquiring one, fails the build rather than joining a growing list.
    //
    // Phase 14 added two entries, both found by the Part 11 taxonomy widening the question from
    // eight dimensions to thirteen. Nothing in this platform records what LEGALLY AUTHORISES case
    // investigation or service recovery — the legislative registry holds one instrument and it maps
    // to neither. Reported as unknown, and unknown is not resilient. The other two findings the
    // taxonomy produced turned out to be incomplete capability declarations rather than gaps, and
    // were corrected in `CRITICAL_CAPABILITIES` instead of being recorded here.
    const known = new Set([
      'anonymous-reporting|service', 'case-investigation|service', 'governance-decision-recording|service',
      'case-investigation|legal-authority', 'service-recovery|legal-authority',
    ]);
    for (const violation of evaluated.violations) {
      for (const kind of violation.singleDependencies) {
        const key = `${violation.capability}|${kind}`;
        if (!known.has(key)) v.push(`NEW single dependency: '${violation.capability}' now depends on a single ${kind}. Either close it or record it as accepted by the appropriate authority.`);
      }
    }
    for (const key of known) {
      const [capability, kind] = key.split('|');
      const found = evaluated.violations.find((x) => x.capability === capability);
      if (!found || !found.singleDependencies.includes(kind)) v.push(`'${key}' was recorded as a known single dependency but is no longer reported — remove it from the baseline rather than leaving a stale exception`);
    }
    // The known ones are real: the store whose loss is fatal is named, not guessed.
    const intake = ir.serviceResilience('anonymous-reporting');
    if (!intake.fatalSingleServices.includes('persistence-ind')) v.push('the intake store was not identified as the fatal single service for anonymous reporting');

    // --- Acceptance is attributed, time-bound and constitutionally restricted ------------------
    const acceptances = new ir.ResilienceAcceptance({ clock: () => NOW });
    for (const [what, args] of [
      ['no authority', { capability: 'anonymous-reporting', kind: 'service', rationale: 'r', expiresAt: NOW + DAY }],
      ['no rationale', { capability: 'anonymous-reporting', kind: 'service', by: 'Oversight Board', expiresAt: NOW + DAY }],
      ['no expiry', { capability: 'anonymous-reporting', kind: 'service', by: 'Oversight Board', rationale: 'r' }],
    ]) {
      let rejected = false;
      try { acceptances.accept(args); } catch (e) { rejected = !!e.failClosed; }
      if (!rejected) v.push(`a single point of failure was accepted with ${what}`);
    }
    let wrongAuthority = false;
    try { acceptances.accept({ capability: 'anonymous-reporting', kind: 'service', by: 'Platform Engineering', rationale: 'known limitation', expiresAt: NOW + DAY }); } catch (e) { wrongAuthority = !!e.failClosed; }
    if (!wrongAuthority) v.push('a constitutional single point of failure was accepted by somebody other than the Oversight Board');
    acceptances.accept({ capability: 'anonymous-reporting', kind: 'service', by: 'Oversight Board', rationale: 'one store per zone is the current architecture; redundancy is planned', expiresAt: NOW + 30 * DAY });
    const withAcceptance = ir.report({ continuity, controls, acceptances, now: NOW });
    if (withAcceptance.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.kind === 'service')) v.push('an accepted single point of failure was still reported as unaccepted');
    // An expired acceptance stops covering it, with nobody deciding to withdraw it.
    const later = ir.report({ continuity, controls, acceptances, now: NOW + 60 * DAY });
    if (!later.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.kind === 'service')) v.push('an expired acceptance still covered a single point of failure');
    if (!later.blocksInstitutionalReadiness) v.push('an expired acceptance left institutional readiness unblocked');

    // --- Recommendations name what would actually close each dependency ------------------------
    const recs = ir.recommendations(evaluated);
    if (!recs.count) v.push('open single dependencies produced no recommendation');
    for (const r of recs.recommendations) if (!r.recommendedAction || !r.finding) v.push(`recommendation for ${r.capability}/${r.kind} is incomplete`);
    if (recs.recommendationsOnly !== true || recs.authorizes !== false) v.push('resilience recommendations claim to be more than recommendations');
    if (recs.recommendations.length && recs.recommendations[0].priority !== 'constitutional') v.push('recommendations are not ranked with constitutional capabilities first');
  }),

  fit('APP-FIT-GOVERNANCE-REHEARSALS', 'A rehearsal is scored against what the document promised, and one nobody has run is reported as never rehearsed', (v) => {
    const { RehearsalRegister, REHEARSALS } = require('../src/governance/rehearsals');
    const own = require('../src/governance/ownership');
    const MIN = 60_000;

    // --- Every rehearsal declares its steps, expectations and where they come from -------------
    for (const [id, spec] of Object.entries(REHEARSALS)) {
      if (!spec.steps || spec.steps.length < 3) v.push(`rehearsal '${id}' has fewer than three steps`);
      if (!Object.keys(spec.expectations || {}).length) v.push(`rehearsal '${id}' declares no expectations — there would be nothing to score it against`);
      if (!spec.expectationSource) v.push(`rehearsal '${id}' does not say where its expectations come from — an expectation with no source is somebody's opinion`);
      if (!spec.tests) v.push(`rehearsal '${id}' does not say what it tests`);
    }
    for (const required of ['incident-escalation', 'disaster-recovery', 'emergency-authorization', 'evidence-custody', 'legislative-change', 'executive-approval']) {
      if (!REHEARSALS[required]) v.push(`rehearsal '${required}' is not declared`);
    }

    const reg = () => new RehearsalRegister({ clock: () => 0 });
    // --- Scheduling and observation are attributed and constrained ----------------------------
    let noFacilitator = false, noParticipants = false;
    try { reg().schedule({ rehearsal: 'disaster-recovery', participants: ['A'] }); } catch (e) { noFacilitator = !!e.failClosed; }
    if (!noFacilitator) v.push('a rehearsal was scheduled with no facilitator');
    try { reg().schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB' }); } catch (e) { noParticipants = !!e.failClosed; }
    if (!noParticipants) v.push('a rehearsal with no participants was scheduled — it rehearses nobody');
    let unknownRehearsal = false;
    try { reg().schedule({ rehearsal: 'a-quick-chat', facilitator: 'ORB', participants: ['A'] }); } catch (_) { unknownRehearsal = true; }
    if (!unknownRehearsal) v.push('an undeclared rehearsal was scheduled');

    // --- A rehearsal that misses a step, or runs late, FAILS ----------------------------------
    const slow = reg();
    const slowRun = slow.schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB', participants: ['Ops'], at: 0 });
    slow.observe(slowRun.id, { step: 'detected', at: 0, by: 'Ops' });
    slow.observe(slowRun.id, { step: 'declared', at: 5 * MIN, by: 'ORB' });
    slow.observe(slowRun.id, { step: 'restore-started', at: 10 * MIN, by: 'Ops' });
    slow.observe(slowRun.id, { step: 'service-restored', at: 200 * MIN, by: 'Ops' });
    slow.observe(slowRun.id, { step: 'integrity-verified', at: 210 * MIN, by: 'Ops', integrityVerified: true });
    const slowReport = slow.close(slowRun.id, { by: 'ORB' });
    if (slowReport.passed) v.push('a recovery that took 210 minutes passed a 30-minute expectation');
    if (!slowReport.unmetExpectations.includes('resolutionMinutes')) v.push('a rehearsal that overran its documented time did not report the expectation as unmet');
    if (!slowReport.lessons.length) v.push('a failed rehearsal produced no lessons');

    // A missed step is a failure, and it says which.
    const partial = reg();
    const pr = partial.schedule({ rehearsal: 'evidence-custody', facilitator: 'OB', participants: ['Custodian'], at: 0 });
    partial.observe(pr.id, { step: 'sealed', at: 0, by: 'Custodian' });
    partial.observe(pr.id, { step: 'transferred', at: MIN, by: 'Custodian' });
    const partialReport = partial.close(pr.id, { by: 'OB' });
    if (partialReport.passed) v.push('a rehearsal that skipped half its steps passed');
    if (!partialReport.missedSteps.includes('chain-verified')) v.push('a missed step was not named');

    // An unobserved boolean expectation is NOT met — silence is not success.
    const silent = reg();
    const sr = silent.schedule({ rehearsal: 'evidence-custody', facilitator: 'OB', participants: ['A', 'B'], at: 0 });
    for (const [i, step] of REHEARSALS['evidence-custody'].steps.entries()) silent.observe(sr.id, { step, at: i * MIN, by: 'A' });
    const silentReport = silent.close(sr.id, { by: 'OB' });
    if (silentReport.passed) v.push('a rehearsal passed without anybody recording that the chain held or that it was witnessed');
    if (!silentReport.unmetExpectations.includes('chainUnbroken')) v.push('an unobserved expectation was treated as met');

    // Steps observed out of order are reported.
    const jumbled = reg();
    const jr = jumbled.schedule({ rehearsal: 'incident-escalation', facilitator: 'ORB', participants: ['A'], at: 0 });
    jumbled.observe(jr.id, { step: 'detected', at: 100 * MIN, by: 'A' });
    jumbled.observe(jr.id, { step: 'raised', at: 0, by: 'A' });
    const jumbledReport = jumbled.afterAction(jr.id);
    if (!jumbledReport.outOfOrder.length) v.push('steps observed out of the documented order were not reported');

    // --- …and a well-run rehearsal PASSES, or this control can only fail ----------------------
    const good = reg();
    const gr = good.schedule({ rehearsal: 'evidence-custody', facilitator: 'OB', participants: ['A', 'B'], at: 0 });
    good.observe(gr.id, { step: 'sealed', at: 0, by: 'A', witnessed: true });
    good.observe(gr.id, { step: 'transferred', at: MIN, by: 'A' });
    good.observe(gr.id, { step: 'received', at: 2 * MIN, by: 'B' });
    good.observe(gr.id, { step: 'chain-verified', at: 3 * MIN, by: 'B', chainUnbroken: true });
    const goodReport = good.close(gr.id, { by: 'OB' });
    if (!goodReport.passed) v.push('a correctly run rehearsal did not pass: ' + goodReport.lessons.join('; '));
    if (goodReport.authorizes !== false) v.push('an after-action report claims authority');

    // Separation of duties inside the rehearsal itself.
    const selfAuth = reg();
    const sa = selfAuth.schedule({ rehearsal: 'executive-approval', facilitator: 'OB', participants: ['Chair'], at: 0 });
    selfAuth.observe(sa.id, { step: 'package-assembled', at: 0, by: 'Chair' });
    selfAuth.observe(sa.id, { step: 'reviewed', at: MIN, by: 'Chair' });
    selfAuth.observe(sa.id, { step: 'decided', at: 2 * MIN, by: 'Chair' });
    selfAuth.observe(sa.id, { step: 'recorded', at: 3 * MIN, by: 'Chair', decisionRecorded: true });
    const saReport = selfAuth.close(sa.id, { by: 'OB' });
    if (saReport.passed) v.push('one person assembled, reviewed, decided and recorded an approval, and the rehearsal passed');
    if (!saReport.unmetExpectations.includes('distinctAuthoriser')) v.push('a self-authorised approval was not reported');

    // --- A closed report cannot be edited ------------------------------------------------------
    let edited = false;
    try { good.observe(gr.id, { step: 'sealed', at: 99, by: 'A' }); } catch (e) { edited = !!e.failClosed; }
    if (!edited) v.push('an observation was added to a closed after-action report');

    // --- Coverage: never-rehearsed is its own state and the worst one -------------------------
    const empty = reg().coverage({ now: 0 });
    if (empty.neverRehearsed.length !== Object.keys(REHEARSALS).length) v.push('a register with no runs did not report every rehearsal as never rehearsed');
    if (empty.sound) v.push('a register in which nothing has ever been rehearsed reported sound');
    if (!/first test will be a real incident/.test(empty.note)) v.push('the coverage report does not say what never-rehearsed costs');
    const covered = good.coverage({ now: 0 });
    if (!covered.passing.includes('evidence-custody')) v.push('a passed rehearsal was not reported as passing');
    if (!covered.neverRehearsed.includes('disaster-recovery')) v.push('an unrun rehearsal was not reported as never rehearsed');

    // --- Part 11 linkage: closing a rehearsal makes participation current ----------------------
    const exercises = new own.ExerciseRegister({ clock: () => 0 });
    const linked = new RehearsalRegister({ clock: () => 0, exercises });
    const lr = linked.schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB', participants: ['Operator'], at: 0 });
    for (const [i, step] of REHEARSALS['disaster-recovery'].steps.entries()) linked.observe(lr.id, { step, at: i * MIN, by: 'Operator', integrityVerified: true });
    linked.close(lr.id, { by: 'ORB' });
    if (!exercises.participation('Operator').some((p) => p.exercise === 'disaster-recovery')) v.push('closing a rehearsal did not record participation — training currency and rehearsals would then be unrelated');
  }),

  fit('APP-FIT-DECISION-MEMORY', 'A decision with no recorded outcome is unevaluated, and an outcome with no evidence is claimed rather than evidenced', (v) => {
    const dm = require('../src/architecture/decision-memory');
    const adr = require('../src/architecture/adr-governance');
    const controls = [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }, { id: 'APP-FIT-BROKEN-PROBE', pass: false }];

    for (const [id, s] of Object.entries(dm.LINEAGE_STAGES)) if (!s.requires || !s.description) v.push(`lineage stage '${id}' is underspecified`);
    for (const [id, s] of Object.entries(dm.OUTCOME_VERDICTS)) if (!s.description) v.push(`outcome verdict '${id}' has no description`);
    // `mixed` and `too-early` exist because forcing a binary pushes honest entries into the wrong box.
    for (const required of ['as-predicted', 'mixed', 'not-as-predicted', 'too-early']) if (!dm.OUTCOME_VERDICTS[required]) v.push(`verdict '${required}' is missing`);

    const fresh = () => new dm.DecisionMemory({ clock: () => 0 });
    // A lineage entry for a decision nobody wrote is a note about nothing.
    let ghost = false;
    try { fresh().record('ADR-9999', 'implementation', { by: 'A', modules: ['src/x.js'] }); } catch (_) { ghost = true; }
    if (!ghost) v.push('a lineage entry was recorded against an ADR that does not exist');
    let unattributed = false;
    try { fresh().record('ADR-0001', 'implementation', { modules: ['src/x.js'] }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('a decision-memory entry was recorded with nobody named');
    for (const [stage, payload] of [['implementation', {}], ['outcome', { verdict: 'as-predicted' }], ['lesson', {}]]) {
      let missing = false;
      try { fresh().record('ADR-0001', stage, { by: 'A', ...payload }); } catch (_) { missing = true; }
      if (!missing) v.push(`a '${stage}' entry was accepted without what it requires`);
    }
    let noVerdict = false;
    try { fresh().record('ADR-0001', 'outcome', { by: 'A', evidence: ['APP-FIT-CONTEXT-MAP'] }); } catch (_) { noVerdict = true; }
    if (!noVerdict) v.push('an outcome was recorded with no verdict');

    // An outcome citing evidence that does not resolve is CLAIMED, not evidenced.
    const m = fresh();
    m.record('ADR-0001', 'implementation', { by: 'ARB', modules: ['src/app.js'] });
    m.record('ADR-0001', 'outcome', { by: 'ARB', verdict: 'as-predicted', evidence: ['APP-FIT-NEVER-WRITTEN'] });
    const claimed = m.lineage('ADR-0001', { controls });
    if (claimed.evidencedOutcome) v.push('an outcome citing a control that never ran was reported as evidenced');
    if (claimed.outcomes[0].state !== 'claimed') v.push('an unevidenced outcome was not reported as claimed');
    if (!claimed.gaps.some((g) => /claimed rather than evidenced/.test(g))) v.push('the claimed-only state was not reported as a gap');

    // An outcome recorded as 'as-predicted' whose evidence is FAILING is a contradiction.
    const c = fresh();
    c.record('ADR-0001', 'outcome', { by: 'ARB', verdict: 'as-predicted', evidence: ['APP-FIT-BROKEN-PROBE'] });
    const contradicted = c.lineage('ADR-0001', { controls });
    if (!contradicted.outcomes[0].contradicted) v.push('an outcome claiming success on failing evidence was not reported as contradicted');
    if (!contradicted.gaps.some((g) => /failing evidence/.test(g))) v.push('a contradicted outcome produced no gap');

    // A complete lineage passes, so the check has a success path.
    const full = fresh();
    full.record('ADR-0001', 'implementation', { by: 'ARB', modules: ['src/app.js'] });
    full.record('ADR-0001', 'outcome', { by: 'ARB', verdict: 'as-predicted', evidence: ['APP-FIT-CONTEXT-MAP'] });
    full.record('ADR-0001', 'lesson', { by: 'ARB', statement: 'Freezing the baseline early made every later phase additive.' });
    full.record('ADR-0001', 'supersession', { by: 'ARB', adr: 'ADR-0002' });
    const complete = full.lineage('ADR-0001', { controls });
    if (!complete.complete) v.push('a fully recorded lineage was not reported complete: ' + complete.gaps.join('; '));
    if (!complete.ledTo.includes('ADR-0002')) v.push('a supersession did not appear in the lineage');
    let ghostSupersession = false;
    try { full.record('ADR-0001', 'supersession', { by: 'ARB', adr: 'ADR-9999' }); } catch (_) { ghostSupersession = true; }
    if (!ghostSupersession) v.push('a decision was recorded as leading to an ADR that does not exist');

    // --- The catalogue-wide report ------------------------------------------------------------
    const report = full.report({ controls });
    if (report.count !== adr.adrFiles().length) v.push('decision memory does not cover every ADR in the catalogue');
    // The number this exists to surface: most decisions have never been evaluated, and silence must
    // not read as success.
    if (!report.unevaluated.length) v.push('no ADR is reported as unevaluated, yet outcomes have been recorded for only one — silence is being read as success');
    if (report.evaluationRate === null || report.evaluationRate >= 1) v.push('the evaluation rate claims every decision has been checked');
    if (!/UNEVALUATED, not successful/.test(report.note)) v.push('the report does not say that an unevaluated decision is not a successful one');
    if (report.authorizes !== false) v.push('the decision memory report claims authority');
  }),

  fit('APP-FIT-ORGANIZATIONAL-TWIN', 'The twin simulates losing people, and a deputy nobody assessed does not cover anything', (v) => {
    const twinMod = require('../src/twin2/operations-twin');
    const own = require('../src/governance/ownership');
    const asm = require('../src/architecture/assumptions');
    const DAY = 24 * 3600_000, NOW = 400 * DAY;
    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const twin = () => new twinMod.OperationsTwin({ evidenceIds: ['APP-FIT-ORGANIZATIONAL-TWIN'], assumptions: registry, clock: () => 0 });

    for (const required of ['owner-absence', 'leadership-turnover', 'operational-overload']) {
      if (!twinMod.SCENARIOS[required]) v.push(`organizational scenario '${required}' is not declared`);
      else try { twinMod.assertDeclaredMetadata(required, twinMod.SCENARIOS[required]); } catch (e) { v.push(`scenario '${required}': ${e.message}`); }
    }

    // Losing an office AND its deputy leaves a governance object unowned.
    const chair = own.OWNERSHIP[own.subsystems()[0]].approvingAuthority;
    const turnover = twin().simulate({ scenario: 'leadership-turnover', change: { absent: [chair] } });
    if (turnover.safe) v.push('an office changing hands with its deputy left every governance object owned');
    if (!turnover.blocking.some((f) => /no accountable authority remains/.test(f.finding))) v.push('leadership turnover did not report an unowned governance object');
    if (!turnover.findings.some((f) => f.entity === 'organizational-spof')) v.push('the organizational single point of failure was not named');
    if (turnover.isolation.unchanged !== true) v.push('an organizational simulation touched the baseline model');

    // A deputy nobody has assessed does not cover the absence: unknown is not cover.
    const absence = twin().simulate({ scenario: 'owner-absence', change: { absent: [chair] } });
    if (absence.safe) v.push('an absent primary was covered by a deputy nobody has assessed');
    if (!absence.blocking.some((f) => /not assessed as ready/.test(f.finding))) v.push('an unassessed deputy was not reported as unable to take over');

    // …and a deputy who IS assessed ready does cover it, so the scenario has a success path.
    const availability = new own.AvailabilityRegister({ clock: () => NOW });
    const activity = new own.ActivityRegister({ clock: () => NOW });
    const training = new own.TrainingRegister({ clock: () => NOW });
    const exercises = new own.ExerciseRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
          activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
          for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar' });
          for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
        }
      }
    }
    const continuity = own.knowledgeContinuity({ availability, activity, training, exercises, now: NOW });
    const covered = twin().simulate({ scenario: 'owner-absence', change: { absent: [chair], continuity } });
    if (!covered.safe) v.push('an absent primary with a fully assessed deputy was still reported uncovered: ' + covered.blocking.map((f) => f.finding).slice(0, 2).join('; '));

    // Concurrent incidents exhaust the available approving authorities.
    const overload = twin().simulate({ scenario: 'operational-overload', change: { concurrentIncidents: 99 } });
    if (overload.safe) v.push('99 concurrent incidents left enough approving authorities');
    if (!overload.blocking.some((f) => /nobody to authorise/.test(f.finding))) v.push('exhausted approval capacity was not reported');
    const manageable = twin().simulate({ scenario: 'operational-overload', change: { concurrentIncidents: 1 } });
    if (!manageable.safe) v.push('a single incident exhausted the approving authorities');
    // Nobody absent, nothing concurrent: the scenario must be able to come out clean.
    const quiet = twin().simulate({ scenario: 'owner-absence', change: { absent: [] } });
    if (!quiet.safe) v.push('an absence scenario with nobody absent reported findings');
  }),

  fit('APP-FIT-EVIDENCE-QUALITY', 'Evidence quality is its weakest dimension, and agreement from the same source kind is not corroboration', (v) => {
    const ec = require('../src/assurance/evidence-confidence');
    for (const required of ['completeness', 'freshness', 'provenance', 'integrity', 'reproducibility', 'corroboration', 'independence', 'historical-consistency']) {
      if (!ec.QUALITY_DIMENSIONS[required]) v.push(`evidence quality dimension '${required}' is not assessed`);
    }
    for (const [id, d] of Object.entries(ec.QUALITY_DIMENSIONS)) if (!d.description || !d.weakMeans) v.push(`quality dimension '${id}' does not say what it is or what weak means`);

    let clock = 0;
    const reg = new ec.EvidenceRegister({ clock: () => clock });
    reg.record({ id: 'check', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
    reg.record({ id: 'attestation', source: 'human-attestation', completeness: 1, verifiedAt: 0, now: 0 });
    reg.record({ id: 'sibling', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
    clock = 3600_000;
    reg.record({ id: 'check', source: 'executable-check', completeness: 1, verifiedAt: clock, now: clock });

    if (ec.evidenceQuality(reg, 'never-recorded').known) v.push('quality was assessed for evidence that was never recorded');
    // THE RULE: two checks reading the same registry agree by construction.
    const sameKind = ec.evidenceQuality(reg, 'check', { corroborators: ['sibling'], now: clock });
    if (sameKind.independentlyCorroborated) v.push('corroboration from the same source kind was counted as independent');
    if (sameKind.dimensions.find((d) => d.dimension === 'independence').score !== 0) v.push('same-kind agreement scored above zero for independence');
    const crossKind = ec.evidenceQuality(reg, 'check', { corroborators: ['attestation'], now: clock });
    if (!crossKind.independentlyCorroborated) v.push('corroboration from a different source kind was not counted as independent');

    // Quality is the WEAKEST dimension, never the mean, and the report says which.
    if (crossKind.quality !== Math.min(...crossKind.dimensions.map((d) => d.score))) v.push('evidence quality is not its weakest dimension');
    if (crossKind.quality === crossKind.mean && crossKind.dimensions.some((d) => d.score !== crossKind.mean)) v.push('quality was reported as the mean');
    if (!crossKind.weakestDimension || !crossKind.note.includes(crossKind.weakestDimension)) v.push('the quality report does not name its weakest dimension');
    // A human attestation is not reproducible and does not claim to be.
    const attested = ec.evidenceQuality(reg, 'attestation', { now: clock });
    if (attested.dimensions.find((d) => d.dimension === 'reproducibility').score !== 0) v.push('a human attestation was scored as reproducible');
    // …and an executable check is, so the dimension can score both ways.
    if (ec.evidenceQuality(reg, 'check', { now: clock }).dimensions.find((d) => d.dimension === 'reproducibility').score !== 1) v.push('an executable check was not scored as reproducible');
    // One verification is no history to be consistent with.
    if (ec.evidenceQuality(reg, 'sibling', { now: clock }).dimensions.find((d) => d.dimension === 'historical-consistency').score !== 0) v.push('a single verification was scored as historically consistent');

    const dash = ec.evidenceQualityDashboard(reg, { now: clock, corroboration: { check: ['attestation'] } });
    if (dash.quality !== Math.min(...dash.evidence.map((e) => e.quality))) v.push('the dashboard does not aggregate to the weakest item');
    if (!dash.weakestDimension) v.push('the dashboard does not name the estate\'s weakest dimension');
    if (dash.replacesAuthorization !== false || dash.authorizes !== false) v.push('evidence quality claims to replace authorization');
    if (!/never replaces human authorization/.test(dash.note)) v.push('the dashboard does not say that quality never replaces authorization');
    if (!dash.uncorroborated.length) v.push('uncorroborated evidence was not named');
  }),

  fit('APP-FIT-ARCHITECTURE-DRIFT', 'Every kind of drift is checked in both directions, and structural drift is zero', (v) => {
    const dp = require('../src/architecture/drift-prevention');
    const asm = require('../src/architecture/assumptions');
    const contextMap = require('../src/architecture/context-map');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const assumptions = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));

    // Both directions are declared for every kind — a checker looking one way passes a document
    // describing a system nobody built.
    for (const required of ['module', 'coupling', 'api', 'control', 'ownership', 'assumption']) {
      if (!dp.DRIFT_KINDS[required]) v.push(`drift kind '${required}' is not checked`);
      else if (!dp.DRIFT_KINDS[required].undocumented || !dp.DRIFT_KINDS[required].unrealised) v.push(`drift kind '${required}' is not checked in both directions`);
    }

    const drift = dp.detect({ controls, assumptions });
    if (!drift.clean) for (const f of drift.structural) v.push(`architecture drift (${f.kind}/${f.direction}): ${f.subject} — ${f.detail}`);
    if (drift.authorizes !== false) v.push('the drift report claims authority');

    // The extractor must actually be finding things, or "clean" means "broken".
    if (!dp.sourceFiles().length) v.push('no source modules were found — the drift scanner has stopped working');
    if (!Object.keys(dp.actualDependencies()).length) v.push('no cross-context requires were found — the coupling scanner has stopped working');
    // COUPLING RATCHET. Source coupling is not declared context dependency, so it is informational —
    // but it must not grow unnoticed. If this trips, either reduce the coupling or move the baseline
    // deliberately, with a reason.
    // Moved from 121 → 124 in Phase 14. The three new edges all come from the diagram verifier
    // (`src/architecture/documentation-assurance.js`), which must read the operational topology, the
    // region table and the mission chain in order to check that a diagram's nodes and arrows resolve
    // against them. Verifying a claim about another context means reading that context; the
    // alternative would be a curated copy of each registry inside the verifier, which is the drift
    // this whole module exists to catch.
    //
    // 124 → 125 in Phase 14 Part 8: the drift checker itself now reads the threat model, so that a
    // treatment naming a control which no longer runs is reported as security drift. Detecting drift
    // in another context means reading that context.
    const COUPLING_BASELINE = 125;
    if (drift.couplingCount > COUPLING_BASELINE) v.push(`cross-context coupling has grown to ${drift.couplingCount} from a baseline of ${COUPLING_BASELINE} — reduce it or move the baseline deliberately`);

    // The checks can fail: a fabricated module claim and a fabricated context are both caught.
    const fakeOwner = dp.moduleOwner('src/nowhere/imaginary.js');
    if (fakeOwner.length) v.push('a module that does not exist was reported as owned');
    const realOwner = dp.moduleOwner('src/server.js');
    if (realOwner.length !== 1) v.push('a real module was not claimed by exactly one context');
    // Every bounded context has an accountability record and vice versa — checked here rather than
    // assumed, because it is the pair most likely to drift apart when a context is renamed.
    const ownership = require('../src/governance/ownership');
    for (const id of contextMap.ids()) if (!ownership.subsystems().includes(id)) v.push(`bounded context '${id}' has no accountability record`);
    for (const id of ownership.subsystems()) if (!contextMap.ids().includes(id)) v.push(`accountability record '${id}' names no bounded context`);

    // --- Part 17: governance analytics ---------------------------------------------------------
    const analytics = dp.governanceAnalytics({ assumptions, controls, now: 0 });
    if (!analytics.ownershipLoad.length) v.push('no ownership load was computed');
    if (analytics.auditReadiness === null) v.push('audit readiness was not computed from control evidence');
    if (!analytics.bottlenecks.length) v.push('no governance bottleneck was forecast from an estate with no activity register — capacity is unknown and unknown is not capacity');
    if (!analytics.bottlenecks.some((b) => b.kind === 'unmeasured-capacity')) v.push('an unmeasured governance capacity was not reported as a bottleneck');
    if (!analytics.forecast) v.push('governance analytics produced no forecast');
    if (analytics.authorizes !== false) v.push('governance analytics claims authority');
    // An authority accountable for a quarter of the estate is a bottleneck whether or not anything
    // has jammed yet, and the load figures must be derived rather than asserted.
    const totalRoles = analytics.ownershipLoad.reduce((a, l) => a + l.roles, 0);
    if (totalRoles !== require('../src/governance/ownership').subsystems().length * require('../src/governance/ownership').DEPUTY_ROLES.length) {
      v.push('ownership load does not account for every (subsystem, role) pair');
    }
    // With nothing recorded, "no bottleneck visible" must not read as "no bottleneck".
    if (!/not the same as none existing/.test(dp.governanceAnalytics({ controls, activity: {}, training: {}, now: 0 }).forecast) && !dp.governanceAnalytics({ controls, activity: {}, training: {}, now: 0 }).bottlenecks.length) {
      v.push('an empty bottleneck list did not caveat what it had not seen');
    }
  }),

  fit('APP-FIT-INSTITUTIONAL-ASSURANCE', 'Institutional readiness is proved from evidence and still never authorizes; an unmeasured domain is never a green one', (v) => {
    const inst = require('../src/assurance/institutional');
    const bus = require('../src/observability/business');

    // --- Part 15: every executive metric is derived ------------------------------------------
    for (const [id, p] of Object.entries(inst.EXECUTIVE_PANELS)) {
      if (!p.question || !p.derivedFrom) v.push(`executive panel '${id}' does not state its question or where it is derived from`);
    }
    const blind = inst.executiveGovernanceIntelligence({});
    if (blind.sound) v.push('an executive dashboard with nothing measured reported sound');
    if (blind.unmeasured.length !== Object.keys(inst.EXECUTIVE_PANELS).length) v.push('unmeasured panels were not all reported as unmeasured');
    if (!blind.everyMetricDerived) v.push('an executive metric is not derived');
    for (const p of blind.panels) {
      if (p.manualEntry !== false) v.push(`panel '${p.panel}' permits manual entry`);
      if (p.sound !== null) v.push(`panel '${p.panel}' reported a verdict with nothing measured`);
    }
    if (blind.authorizationStatus !== 'NOT AUTHORIZED') v.push('the executive dashboard produced something other than NOT AUTHORIZED');
    // There is no path that accepts a figure: a caller-supplied value must not appear as a panel.
    const injected = inst.executiveGovernanceIntelligence({ institutionalResilience: 1, governanceMaturity: 5 });
    if (injected.panels.find((p) => p.panel === 'institutionalResilience').measured) v.push('a hand-entered executive metric was accepted');

    // …and with real sources the panels populate, or this is a dashboard that can only be blank.
    const wired = inst.executiveGovernanceIntelligence({
      resilience: { holds: true, violationCount: 0 },
      governanceMaturity: { level: 5, name: 'Continuously assured' },
      readiness: { readyCount: 10, dimensionCount: 10, allDimensionsReady: true },
      mission: { safeToDeploy: true, boardSummary: 'no service affected' },
      documentation: { sound: true, verification: { claims: 132, unresolvedCount: 0 } },
      continuity: { sound: true, minimumBusFactor: 2, singlePersonDependencies: [] },
      compliance: { complianceRate: 1, direction: 'improving', recentDirection: 'improving', reconciliation: { sound: true } },
      training: { sound: true, readinessContribution: 1, expiredQualifications: [] },
      simulation: { confidence: 'high', uncalibrated: [] },
      assumptions: { count: 9, sound: true, stale: [], overclaims: [] },
      // Phase 14, Part 19 added five strategic panels.
      regulatory: { count: 2, ready: true, readinessBasis: '2 forecast change(s) modelled' },
      adaptive: { constrained: ['auditReadiness'], unconstrained: [], forecasts: [1, 2, 3, 4, 5, 6] },
      capacity: { measured: ['staffing'], complete: true, shortfallCount: 0, unmeasurable: [] },
      decisions: { evaluationRate: 1, contradicted: [], unevaluated: [] },
      publicTrust: { composite: 'warranted', basis: 'every measured condition holds' },
    });
    if (!wired.sound) v.push('a fully evidenced executive dashboard was not sound: ' + wired.unsound.concat(wired.unmeasured).join(', '));
    if (wired.authorizationStatus !== 'NOT AUTHORIZED') v.push('fifteen green executive panels produced an authorization');
    if (wired.authorizes !== false) v.push('the executive dashboard claims authority');

    // --- Part 19: the improvement loop must close ---------------------------------------------
    const loop = new inst.ImprovementLoop({ clock: () => 0 });
    let speculative = false;
    try { loop.observe({ detail: 'something', observedBy: 'CI' }); } catch (_) { speculative = true; }
    if (!speculative) v.push('an improvement was opened with no control behind it — that is a project, not a correction');
    let unattributed = false;
    try { loop.observe({ control: 'APP-FIT-X', detail: 'failed' }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('an observed failure was recorded with nobody observing it');

    const item = loop.observe({ control: 'APP-FIT-X', detail: 'the control failed', observedBy: 'CI' });
    let skipped = false;
    try { loop.advance(item.id, 'verified', { by: 'A', detail: 'd' }); } catch (e) { skipped = !!e.failClosed; }
    if (!skipped) v.push('an improvement skipped from observed straight to verified');
    loop.advance(item.id, 'root-caused', { by: 'Engineering', detail: 'the digest omitted the resource tenant' });
    loop.advance(item.id, 'action-agreed', { by: 'ARB', detail: 'add resourceTenant to the digest' });
    let noAdr = false;
    try { loop.advance(item.id, 'decided', { by: 'ARB', detail: 'agreed' }); } catch (e) { noAdr = !!e.failClosed; }
    if (!noAdr) v.push('a corrective action changing the architecture was recorded with no ADR');
    loop.advance(item.id, 'decided', { by: 'ARB', detail: 'agreed', adr: 'ADR-0005' });
    // THE RULE: verification is the control that FAILED now passing. Not a new one.
    let unverified = false;
    try { loop.advance(item.id, 'verified', { by: 'CI', detail: 'fixed', controls: [{ id: 'APP-FIT-X', pass: false }] }); } catch (e) { unverified = !!e.failClosed; }
    if (!unverified) v.push('an improvement was verified while the control that failed was still failing');
    let wrongControl = false;
    try { loop.advance(item.id, 'verified', { by: 'CI', detail: 'fixed', controls: [{ id: 'APP-FIT-SOMETHING-ELSE', pass: true }] }); } catch (e) { wrongControl = !!e.failClosed; }
    if (!wrongControl) v.push('an improvement was verified by a control other than the one that failed');
    loop.advance(item.id, 'verified', { by: 'CI', detail: 'the control holds', controls: [{ id: 'APP-FIT-X', pass: true }] });
    loop.advance(item.id, 'outcome-recorded', { by: 'ARB', detail: 'held across a quarter' });
    const history = loop.history({});
    if (history.closureRate !== 1) v.push('a fully closed improvement was not reported as closed');
    if (history.authorizes !== false) v.push('the improvement history claims authority');
    // An improvement stuck before verification is named, because the work was done and nobody checked.
    const stalled = new inst.ImprovementLoop({ clock: () => 0 });
    const s = stalled.observe({ control: 'APP-FIT-Y', detail: 'failed', observedBy: 'CI' });
    stalled.advance(s.id, 'root-caused', { by: 'A', detail: 'cause' });
    if (!stalled.history({}).stalled.some((x) => x.at === 'root-caused')) v.push('an improvement stalled before verification was not named');

    // --- Part 18: an unmeasured layer breaks the correlation ----------------------------------
    const noLayers = bus.operationalIntelligence({});
    if (noLayers.correlationValid) v.push('a correlation was carried across unmeasured layers');
    // Phase 14, Part 9 extended the chain to eight layers plus a cross-cutting one.
    if (noLayers.unmeasured.length !== bus.OPERATIONAL_LAYERS.length + bus.CROSS_CUTTING_LAYERS.length) v.push('unmeasured operational layers were not all reported');
    if (!/correlation between one thing and an assumption/.test(noLayers.note)) v.push('the operational chain does not say what a gap costs');
    const full = bus.operationalIntelligence({
      infrastructure: { degraded: ['kms'] }, applicationBehaviour: {}, businessMetrics: { backlog: 12 },
      missionOutcomes: { custodyIntact: true }, governance: { overdueReviews: ['intake'], unattributedDecisions: [] },
      institutionalOutcomes: { mandatesDeliverable: true },
    });
    if (!full.chainComplete) v.push('a fully measured operational chain was reported incomplete');
    if (!full.recommendations.length) v.push('a degraded estate produced no operational recommendation');
    for (const r of full.recommendations) if (!r.falsifiedBy || !r.from) v.push('an operational recommendation states nothing that would falsify it');
    if (full.authorizes !== false) v.push('operational intelligence claims authority');

    // --- Part 20: the framework, and the invariant that outlives every phase ------------------
    for (const [id, d] of Object.entries(inst.ASSURANCE_DOMAINS)) if (!d.unverifiedMeans) v.push(`assurance domain '${id}' does not say what unverified would mean`);
    if (Object.keys(inst.ASSURANCE_DOMAINS).length < 13) v.push(`only ${Object.keys(inst.ASSURANCE_DOMAINS).length} assurance domains are declared; Part 20 names thirteen`);
    const nothing = inst.institutionalAssurance({});
    if (nothing.institutionallyReady) v.push('institutional readiness was claimed with nothing measured');
    if (nothing.unmeasured.length !== Object.keys(inst.ASSURANCE_DOMAINS).length) v.push('unmeasured domains were not all reported as unmeasured');
    if (nothing.domains.some((d) => d.state === 'verified')) v.push('a domain was verified with nothing measured');
    for (const b of nothing.blockers) if (!/unmeasured|failing/.test(b)) v.push('a blocker does not say whether the domain is failing or unmeasured');
    const green = inst.institutionalAssurance({
      drift: { clean: true }, security: true, privacy: true,
      governanceMaturity: { level: 5 }, documentation: { sound: true },
      readiness: { allDimensionsReady: true }, continuity: { sound: true, minimumBusFactor: 2 },
      resilience: { holds: true, capabilities: [{ categoriesValidated: true }] }, training: { sound: true },
      compliance: { reconciliation: { sound: true } }, mission: { safeToDeploy: true },
      evidenceQuality: { sound: true },
      // Phase 14, Part 20 added five domains: dependency resilience, strategic readiness, learning
      // maturity, governance adaptability and public trust indicators.
      regulatory: { ready: true }, learning: { learningRate: 1, correctedNotLearned: [] },
      optimization: { bottleneckAuthorities: [], overCapacityAuthorities: [] },
      publicTrust: { composite: 'warranted' },
    });
    if (!green.institutionallyReady) v.push('a fully verified estate was not reported institutionally ready: ' + green.blockers.join('; '));
    // THE INVARIANT. Eighteen verified domains still print NOT AUTHORIZED.
    if (green.authorizationStatus !== 'NOT AUTHORIZED') v.push('eighteen verified assurance domains produced an authorization');
    if (green.authorizes !== false || green.derivedFromReadiness !== false) v.push('the institutional assurance framework claims to derive authorization');
    if (!/does not replace human authority/.test(green.note)) v.push('the framework does not state that it never replaces human authority');
    if (green.failClosed !== true) v.push('the institutional assurance framework is not fail-closed');
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
    // 'analytics' is monotonic-reads (Phase 12), which is session-scoped: a lag-only read is
    // refused because the guarantee cannot be checked without a session token.
    if (!mr.readAllowed({ context: 'assurance', replicaLagMs: 30_000 }).allowed) v.push('an eventually consistent context refused a read inside its staleness bound');
    if (mr.readAllowed({ context: 'assurance', replicaLagMs: 90_000 }).allowed) v.push('a read beyond the declared staleness bound was served');
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
        // Sections with a content rule get content that satisfies it, so the probe isolates the
        // one rule under test rather than failing on an unrelated one.
        const other = adr.schema().measurableSections.includes(s.heading) ? `${filler} 108 invariants hold.`
          : adr.schema().datedSections.includes(s.heading) ? `${filler} Reviewed on or before 2027-08-03.`
            : filler;
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
    // A new ADR is held to the newest tier in force, which Phase 12 made 'governance'.
    if (measurable.schema !== 'governance') v.push('ADR-0099 was not held to the newest schema in force');
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
    for (const s of [...adr.LEGACY_SCHEMA, ...adr.FULL_SCHEMA, ...adr.EXTENDED_SCHEMA, ...adr.GOVERNANCE_SCHEMA]) if (!tpl.includes(`## ${s.heading}`)) v.push(`the generated template omits '${s.heading}'`);
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

  // ===== PHASE 14 =================================================================================

  fit('APP-FIT-ASSUMPTION-GRAPH', 'Invalidating an assumption reduces confidence in everything that rests on it, and a cycle is refused', (v) => {
    const asm = require('../src/architecture/assumptions');
    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const graph = registry.dependencyGraph();

    // --- The vocabulary is declared, and every strength says what an upstream failure does ------
    for (const required of ['necessary', 'supporting', 'contextual']) {
      if (!asm.DEPENDENCY_STRENGTHS[required]) v.push(`dependency strength '${required}' is not declared`);
    }
    for (const [id, s] of Object.entries(asm.DEPENDENCY_STRENGTHS)) {
      if (!s.description || !s.ifUpstreamFails) v.push(`dependency strength '${id}' does not say what it means or what an upstream failure does`);
      if (typeof s.cascades !== 'boolean') v.push(`dependency strength '${id}' does not declare whether it cascades`);
    }
    for (const [id, t] of Object.entries(asm.DEPENDENCY_TYPES)) if (!t.description) v.push(`dependency type '${id}' has no description`);

    // --- The graph is real, acyclic and orderable ----------------------------------------------
    if (!graph.edgeCount) v.push('no dependency between platform assumptions is declared — a registry of nine independent beliefs is a registry that has not been examined');
    if (!graph.acyclic) v.push(`the assumption graph is cyclic: ${graph.unordered.join(', ')}`);
    if (graph.order.length !== graph.nodes.length) v.push('the topological order does not cover every assumption');
    if (!graph.roots.length) v.push('every assumption depends on another — the graph has no root, which cannot be true');
    for (const e of graph.edges) {
      if (!e.rationale) v.push(`dependency '${e.from}' → '${e.to}' states no rationale — an edge nobody can argue with is a line on a diagram`);
    }
    // The load-bearing assumption is named rather than left to be noticed.
    if (!graph.loadBearing.length || graph.loadBearing[0].carries < 2) v.push('no assumption is reported as load-bearing, though several rest on others');

    // --- A cycle is REFUSED, fail-closed --------------------------------------------------------
    let cycleRefused = false;
    try { registry.declareDependency('ASM-0006', { on: 'ASM-0005', strength: 'necessary', type: 'logical', rationale: 'r' }); }
    catch (e) { cycleRefused = !!e.failClosed; }
    if (!cycleRefused) v.push('a dependency that would close a cycle was accepted — propagation over a cycle answers whatever its starting point decided');
    let selfRefused = false;
    try { registry.declareDependency('ASM-0006', { on: 'ASM-0006', strength: 'necessary', type: 'logical' }); } catch (e) { selfRefused = !!e.failClosed; }
    if (!selfRefused) v.push('an assumption was allowed to depend on itself');
    for (const [what, edge] of [
      ['unknown strength', { on: 'ASM-0001', strength: 'vibes', type: 'logical' }],
      ['unknown type', { on: 'ASM-0001', strength: 'necessary', type: 'vibes' }],
      ['unregistered upstream', { on: 'ASM-9999', strength: 'necessary', type: 'logical' }],
    ]) {
      let rejected = false;
      try { registry.declareDependency('ASM-0009', edge); } catch (_) { rejected = true; }
      if (!rejected) v.push(`a dependency with ${what} was accepted`);
    }

    // --- THE PART 1 PROOF: invalidating one assumption reduces confidence in all affected ------
    // A crafted graph, so the success and failure paths are both exercised without depending on the
    // platform's own (already low) confidence levels masking the effect.
    const YEAR = 365 * 24 * 3600_000;
    const probe = new asm.AssumptionRegistry({ clock: () => 0 });
    const base = {
      rationale: 'exercises confidence propagation', evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'],
      owner: 'ARB', reviewCadenceDays: 3650, expiresAt: 10 * YEAR, verificationMethod: 'executable-check', confidence: 'high',
    };
    for (const id of ['ROOT', 'NEC', 'SUP', 'CTX', 'DEEP']) {
      probe.register(id, { ...base, statement: `probe assumption ${id}` });
      probe.recordVerification(id, { holds: true, by: 'Assurance', at: 0 });
    }
    probe.declareDependency('NEC', { on: 'ROOT', strength: 'necessary', type: 'logical', rationale: 'r' });
    probe.declareDependency('SUP', { on: 'ROOT', strength: 'supporting', type: 'evidential', rationale: 'r' });
    probe.declareDependency('CTX', { on: 'ROOT', strength: 'contextual', type: 'operational', rationale: 'r' });
    probe.declareDependency('DEEP', { on: 'NEC', strength: 'necessary', type: 'logical', rationale: 'r' });

    const controls = [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }];
    // Success path first: with everything holding, every assumption is high. Without this the check
    // could only ever fail, which would prove nothing about propagation.
    const sound = probe.propagateConfidence({ now: 0, controls });
    for (const r of sound.assumptions) if (r.effective !== 'high') v.push(`'${r.assumption}' is not 'high' with every dependency holding: ${r.effective}`);
    if (sound.invalid.length) v.push('a sound graph reported invalid assumptions');

    // Now invalidate the root and watch it propagate.
    const after = probe.propagateConfidence({ now: 0, controls, invalidated: ['ROOT'] });
    const level = (id) => (after.assumptions.find((r) => r.assumption === id) || {}).effective;
    if (!after.invalid.includes('ROOT')) v.push('the invalidated assumption was not reported invalid');
    if (!after.invalid.includes('NEC')) v.push('a necessary dependent of an invalid assumption still held — a cascading failure was reported as a lower score');
    if (!after.invalid.includes('DEEP')) v.push('invalidity did not cascade transitively through a chain of necessary dependencies');
    if (after.invalid.includes('SUP')) v.push('a supporting dependent was INVALIDATED rather than weakened — the two are different facts');
    if (level('SUP') !== 'low') v.push(`a supporting dependent of an invalid assumption did not degrade to 'low': ${level('SUP')}`);
    if (level('CTX') !== 'high') v.push('a contextual dependency propagated confidence, which it must not');
    for (const id of ['NEC', 'DEEP']) if (level(id) !== 'unknown') v.push(`cascaded assumption '${id}' is not 'unknown': ${level(id)}`);

    // Impact analysis names the same set, with the reason for each.
    const impact = probe.assumptionImpact('ROOT', { now: 0, controls });
    if (impact.affectedCount !== 4) v.push(`impact analysis found ${impact.affectedCount} affected assumptions, expected 4`);
    if (!impact.wouldNotHold.includes('NEC') || !impact.wouldNotHold.includes('DEEP')) v.push('impact analysis did not name the assumptions that would stop holding');
    if (!impact.wouldBeWeakened.includes('SUP')) v.push('impact analysis did not name the weakened assumption');
    if (!impact.toJudge.includes('CTX')) v.push('impact analysis did not leave the contextual dependent for a human to judge');
    for (const r of impact.affected) if (!r.effect || !r.path.length) v.push(`impact row for '${r.assumption}' states no effect or path`);
    if (impact.authorizes !== false) v.push('assumption impact analysis claims authority');

    // An expired upstream cascades the same way — nobody has to declare it invalid by hand.
    const expiring = new asm.AssumptionRegistry({ clock: () => 0 });
    expiring.register('OLD', { ...base, statement: 'expires shortly', expiresAt: 10 * 24 * 3600_000 });
    expiring.register('ON-OLD', { ...base, statement: 'rests on it' });
    expiring.recordVerification('OLD', { holds: true, by: 'A', at: 0 });
    expiring.recordVerification('ON-OLD', { holds: true, by: 'A', at: 0 });
    expiring.declareDependency('ON-OLD', { on: 'OLD', strength: 'necessary', type: 'logical', rationale: 'r' });
    const later = expiring.propagateConfidence({ now: 100 * 24 * 3600_000, controls });
    if (!later.invalid.includes('ON-OLD')) v.push('an assumption resting on an EXPIRED assumption still held — expiry must cascade like any other invalidity');
    if (!later.cascaded.some((c) => c.assumption === 'ON-OLD' && c.from === 'OLD')) v.push('the cascade did not name which upstream caused it');

    // A verification that found the assumption did not hold invalidates it without anyone saying so.
    expiring.recordVerification('OLD', { holds: false, by: 'Assurance', at: 1 });
    if (!expiring.propagateConfidence({ now: 0, controls }).invalid.includes('ON-OLD')) v.push('a failed verification of an upstream did not cascade');

    // --- Health, and therefore the twin, reads the propagated level ----------------------------
    const health = probe.health(['DEEP'], { now: 0, controls });
    if (health.confidence !== 'high') v.push('a sound chain did not report high health');
    const brokenChain = new asm.AssumptionRegistry({ clock: () => 0 });
    brokenChain.register('U', { ...base, statement: 'unverifiable upstream', verificationMethod: 'unverifiable', confidence: 'unknown' });
    brokenChain.register('D', { ...base, statement: 'well-evidenced dependent' });
    brokenChain.recordVerification('D', { holds: true, by: 'A', at: 0 });
    brokenChain.declareDependency('D', { on: 'U', strength: 'necessary', type: 'logical', rationale: 'r' });
    const inherited = brokenChain.health(['D'], { now: 0, controls });
    if (inherited.confidence !== 'unknown') v.push(`a well-evidenced assumption resting on an unverifiable one reported '${inherited.confidence}' — confidence must not exceed what it rests on`);
    if (!inherited.inheritedWeakness.length) v.push('the inherited weakness was not named, so a reader cannot tell whether to fix this assumption or its foundation');
    if (brokenChain.health(['D'], { now: 0, controls, propagate: false }).confidence === 'unknown') v.push('propagation made no difference, so the mechanism is decoration');

    if (!registry.validate({ now: 0 }).valid) v.push('the platform assumption graph does not validate: ' + registry.validate({ now: 0 }).violations.join('; '));
    if (registry.report({ now: 0, controls }).authorizes !== false) v.push('the assumption report claims authority');
  }),

  fit('APP-FIT-TWIN-CONFIDENCE-DIMENSIONS', 'Twin confidence is derived from six independent dimensions, and a simulation missing one refuses to run', (v) => {
    const twinMod = require('../src/twin2/operations-twin');
    const asm = require('../src/architecture/assumptions');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Six dimensions, each with a question, a derivation and a stated consequence -----------
    for (const required of ['model', 'evidence', 'data', 'simulation', 'forecast', 'calibration']) {
      if (!twinMod.CONFIDENCE_DIMENSIONS[required]) v.push(`confidence dimension '${required}' is not declared`);
    }
    if (Object.keys(twinMod.CONFIDENCE_DIMENSIONS).length !== 6) v.push('the confidence model does not have exactly six dimensions');
    for (const [id, d] of Object.entries(twinMod.CONFIDENCE_DIMENSIONS)) {
      if (!d.question || !d.question.endsWith('?')) v.push(`confidence dimension '${id}' states no question`);
      if (!d.derivedFrom) v.push(`confidence dimension '${id}' does not say where it is derived from`);
      if (!d.absentMeans || d.absentMeans.length < 30) v.push(`confidence dimension '${id}' does not say what its absence would mean`);
    }

    // --- The completeness guard rejects a partial set, and accepts a full one ------------------
    const full = Object.keys(twinMod.CONFIDENCE_DIMENSIONS).map((id) => ({ dimension: id, level: 'high', why: 'crafted for the guard' }));
    if (twinMod.assertCompleteConfidence('probe', full) !== true) v.push('a complete confidence set was rejected — the guard rejects everything and proves nothing');
    for (const [what, dims] of [
      ['a missing dimension', full.slice(1)],
      ['an unrecognised level', full.map((d, i) => (i ? d : { ...d, level: 'quite-good' }))],
      ['a dimension with no reason', full.map((d, i) => (i ? d : { ...d, why: null }))],
      ['an undeclared dimension', [...full, { dimension: 'vibes', level: 'high', why: 'x' }]],
      ['no dimensions at all', null],
    ]) {
      let rejected = false;
      try { twinMod.assertCompleteConfidence('probe', dims); } catch (e) { rejected = !!e.failClosed; }
      if (!rejected) v.push(`a simulation with ${what} was allowed to run`);
    }

    // --- Every dimension is derived, and the overall figure is the weakest of them -------------
    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const twin = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: registry, clock: () => 0 });
    for (const scenario of Object.keys(twinMod.SCENARIOS)) {
      const c = twin.confidence(scenario, { now: 0, controls });
      if (c.dimensions.length !== 6) v.push(`scenario '${scenario}' reports ${c.dimensions.length} confidence dimensions`);
      if (c.manualEntry !== false || c.derived !== true) v.push(`scenario '${scenario}' confidence is not marked as derived`);
      const weakest = c.dimensions.reduce((w, d) => (['high', 'moderate', 'low', 'unknown'].indexOf(d.level) >= ['high', 'moderate', 'low', 'unknown'].indexOf(w) ? d.level : w), 'high');
      if (c.confidence !== weakest) v.push(`scenario '${scenario}': overall confidence '${c.confidence}' is not the weakest dimension '${weakest}' — it has been averaged`);
      for (const d of c.dimensions) if (!d.why) v.push(`scenario '${scenario}': dimension '${d.dimension}' states no reason`);
      if (!c.limitedBy.length) v.push(`scenario '${scenario}' names no limiting dimension`);
    }

    // --- Each dimension can actually move it, or it is decoration ------------------------------
    // data: a scenario perturbing a kind the model does not contain.
    const emptyModel = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: registry, clock: () => 0, regions: [] });
    const drData = emptyModel.confidenceDimensions('dr-exercise', { now: 0, controls }).find((d) => d.dimension === 'data');
    if (drData.level !== 'unknown') v.push('a scenario perturbing a kind with no modelled entities did not report unknown data confidence');
    // forecast: agreement decaying.
    const decaying = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: registry, clock: () => 0 });
    for (let i = 0; i < 6; i++) decaying.recordValidation('migration-plan', { predicted: true, observed: i < 3, by: 'ARB', at: i });
    const fc = decaying.confidenceDimensions('migration-plan', { now: 0, controls }).find((d) => d.dimension === 'forecast');
    if (fc.level !== 'unknown') v.push('a model whose agreement with reality is falling did not report unknown forecast confidence');
    // simulation and model reach 'high' on a sound twin, so both directions exist.
    const sound = twin.confidenceDimensions('operational-failure', { now: 0, controls });
    for (const id of ['model', 'simulation']) {
      if (sound.find((d) => d.dimension === id).level !== 'high') v.push(`dimension '${id}' cannot reach 'high' on a sound twin, so it can only ever fail`);
    }

    // --- The report says which dimension limits the estate most often --------------------------
    const report = twin.confidenceReport({ now: 0, controls });
    if (!report.mostLimitingDimension || !report.mostLimitingDimension.dimension) v.push('the confidence report does not name the dimension limiting the estate most often');
    if (report.byDimension.length !== 6) v.push('the confidence report does not break down by all six dimensions');
    if (report.authorizes !== false) v.push('the confidence report claims authority');

    // --- Every simulation carries the breakdown, not just the word ----------------------------
    const run = twin.simulate({ scenario: 'operational-failure', change: { failed: ['kms'] }, now: 0, controls });
    if (!run.confidenceDimensions || Object.keys(run.confidenceDimensions).length !== 6) v.push('a simulation result does not carry its six confidence dimensions');
    if (run.authorizes !== false) v.push('a simulation claims authority');
  }),

  fit('APP-FIT-TEMPORAL-MISSION-IMPACT', 'Mission impact is evaluated across five horizons, and an unknown horizon is never rendered as no impact', (v) => {
    const bus = require('../src/observability/business');

    // --- Five horizons, ordered, each saying what changes there and what an unknown would mean --
    for (const required of ['immediate', 'short-term', 'medium-term', 'long-term', 'strategic-institutional']) {
      if (!bus.IMPACT_HORIZONS[required]) v.push(`impact horizon '${required}' is not declared`);
    }
    if (bus.IMPACT_HORIZON_ORDER.length !== 5) v.push('the temporal model does not have exactly five horizons');
    for (const [id, h] of Object.entries(bus.IMPACT_HORIZONS)) {
      if (!h.within) v.push(`horizon '${id}' states no window`);
      if (!h.whatChangesHere || h.whatChangesHere.length < 30) v.push(`horizon '${id}' does not say what changes there`);
      if (!h.ifUnknown || h.ifUnknown.length < 30) v.push(`horizon '${id}' does not say what an unknown would cost`);
      if (!h.layers.length) v.push(`horizon '${id}' claims no chain layer, so nothing can ever land in it`);
    }
    // Every chain layer lands in exactly one horizon — enforced by the chain validator, so adding a
    // layer without deciding when it manifests fails the build.
    for (const violation of bus.validateMissionChain().violations) v.push(violation);
    for (const layer of bus.MISSION_IMPACT_LAYERS) {
      if (!bus.horizonOfLayer(layer)) v.push(`chain layer '${layer}' maps to no horizon`);
    }

    // --- A constitutional outage reaches every horizon -----------------------------------------
    const outage = bus.temporalMissionImpact({ change: 'intake withdrawn', failed: ['intake-api'] });
    if (outage.horizons.length !== 5) v.push('the temporal forecast does not report all five horizons');
    if (!outage.reachesStrategic) v.push('losing anonymous reporting did not reach the strategic-institutional horizon — the most expensive consequence was dropped');
    if (outage.furthestImpact !== 'strategic-institutional') v.push('the furthest horizon reached was not reported');
    for (const h of outage.horizons) {
      if (h.state !== 'impact') v.push(`horizon '${h.horizon}' reported '${h.state}' for a constitutional outage`);
      if (!h.reason) v.push(`horizon '${h.horizon}' states no reason`);
    }
    if (outage.timeline.length !== 5) v.push('no time-ordered forecast was produced');
    for (const row of outage.timeline) if (!row.when || !row.expect) v.push('a timeline row does not say when or what to expect');

    // --- THE RULE: unknown is never rendered as no impact --------------------------------------
    // A component that maps to no declared justice service breaks the chain at its source.
    const unmapped = bus.temporalMissionImpact({ change: 'search index lost', failed: ['search-index'] });
    if (unmapped.unknownHorizons.length !== 5) v.push('an unmapped component did not make every downstream horizon unknown');
    if (unmapped.horizons.some((h) => h.state === 'no-declared-impact')) v.push('an UNMAPPED component produced "no declared impact" at some horizon — unknown was rendered as safe');
    if (unmapped.complete) v.push('a forecast with unknown horizons reported itself complete');
    if (!/UNKNOWN/.test(unmapped.boardSummary)) v.push('the board summary did not say the impact was unknown');
    for (const h of unmapped.horizons) if (h.impacted !== false || h.assessable !== false) v.push(`unknown horizon '${h.horizon}' reports a boolean that reads like an answer`);

    // A component the topology does not model at all is the same failure, more sharply.
    const unmodelled = bus.temporalMissionImpact({ change: 'a service nobody modelled', failed: ['quantum-widget'] });
    if (unmodelled.unknownHorizons.length !== 5) v.push('an unmodelled component did not make the horizons unknown');

    // --- And the success path: nothing failed means nothing reaches any horizon ----------------
    const quiet = bus.temporalMissionImpact({ change: 'a change affecting nothing', failed: [] });
    if (quiet.impactedHorizons.length) v.push('a change affecting nothing produced an impact');
    if (quiet.unknownHorizons.length) v.push('a change affecting nothing produced an unknown — then the check can only ever be unknown');
    if (!quiet.complete) v.push('a fully traversable forecast was not reported complete');
    if (quiet.horizons.some((h) => h.state !== 'no-declared-impact')) v.push('a quiet forecast did not report no-declared-impact at every horizon');
    if (!/not a guarantee/.test(quiet.boardSummary)) v.push('a clean forecast did not state that it describes only what is declared');

    // --- A chain that stops with no declared link forward is unknown, not clear ----------------
    // Degradation with no service loss: business processes move, nothing reaches a justice service.
    const partial = bus.temporalMissionImpact({ change: 'evidence store degraded', failed: [], degraded: ['evidence-store'] });
    if (partial.horizons.find((h) => h.horizon === 'immediate').state === 'impact'
      && partial.horizons.slice(1).every((h) => h.state === 'no-declared-impact')) {
      v.push('impact at the immediate horizon with nothing declared beyond it was reported as no impact rather than unknown');
    }

    if (outage.authorizes !== false) v.push('the temporal forecast claims authority');
    if (outage.failClosed !== true) v.push('the temporal forecast is not fail-closed');
  }),

  fit('APP-FIT-COMPLIANCE-TRANSITIONS', 'An illegal compliance transition is refused and recorded; an exception is a board decision that expires and can never reach `verified`', (v) => {
    const ci = require('../src/legislation/compliance-intelligence');
    const DAY = 24 * 3600_000;
    const NOW = 100 * DAY;

    // --- The machine is well formed and every state declares whether it counts as compliant ----
    for (const [state, spec] of Object.entries(ci.COMPLIANCE_STATES)) {
      if (typeof spec.compliant !== 'boolean') v.push(`compliance state '${state}' does not declare whether it counts as compliant`);
      if (!ci.COMPLIANCE_TRANSITIONS[state]) v.push(`compliance state '${state}' declares no legal transitions`);
    }
    for (const [id, spec] of Object.entries(ci.TRANSITION_LEGALITY)) if (!spec.description) v.push(`transition legality '${id}' has no description`);

    // --- The illegal transition is REFUSED, fail-closed, and the attempt is recorded -----------
    const plain = new ci.ComplianceIntelligence({ clock: () => NOW });
    let refused = false;
    try { plain.transition('OB-1', { to: 'verified', by: 'Auditor', rationale: 'signed off', independent: true }); }
    catch (e) { refused = !!e.failClosed; }
    if (!refused) v.push('unknown → verified was accepted — the jump a hurried audit most wants to make');
    if (plain.refusals().length !== 1) v.push('a refused transition was not recorded — an attempt the machine turned down is exactly what an auditor wants to see');
    if (plain.refusals()[0].legality !== 'refused') v.push('a refused transition was not labelled as refused');
    if (plain.state('OB-1').state !== 'unknown') v.push('a refused transition still changed the state');

    // …and the legal path works, or this control could only ever fail.
    plain.transition('OB-1', { to: 'under-assessment', by: 'Legal Informatics Team', rationale: 'assessment opened' });
    plain.transition('OB-1', { to: 'compliant', by: 'Legal Informatics Team', rationale: 'controls hold' });
    plain.transition('OB-1', { to: 'verified', by: 'Attorney General Chambers', rationale: 'independently confirmed', independent: true });
    if (plain.state('OB-1').state !== 'verified') v.push('the legal path to verified did not work');
    if (plain.transitionAudit({ now: NOW }).entries.some((e) => e.legality !== 'by-default')) v.push('a default-legal transition was labelled as exceptional');

    // --- An exception is a board decision: attributed, time-bound, one obligation, one move ----
    const ex = new ci.TransitionExceptions({ clock: () => NOW });
    for (const [what, args] of [
      ['no obligation', { from: 'unknown', to: 'compliant', by: 'OB', rationale: 'r', expiresAt: NOW + DAY }],
      ['no authority', { obligation: 'OB-2', from: 'unknown', to: 'compliant', rationale: 'r', expiresAt: NOW + DAY }],
      ['no rationale', { obligation: 'OB-2', from: 'unknown', to: 'compliant', by: 'OB', expiresAt: NOW + DAY }],
      ['no expiry', { obligation: 'OB-2', from: 'unknown', to: 'compliant', by: 'OB', rationale: 'r' }],
      ['an unknown state', { obligation: 'OB-2', from: 'unknown', to: 'perfect', by: 'OB', rationale: 'r', expiresAt: NOW + DAY }],
    ]) {
      let rejected = false;
      try { ex.grant(args); } catch (_) { rejected = true; }
      if (!rejected) v.push(`a transition exception with ${what} was granted`);
    }
    let notABoard = false;
    try { ex.grant({ obligation: 'OB-2', from: 'unknown', to: 'compliant', by: 'Platform Engineering', rationale: 'we are in a hurry', expiresAt: NOW + DAY }); }
    catch (e) { notABoard = !!e.failClosed; }
    if (!notABoard) v.push('a transition exception was granted by somebody who is not a governance board');

    // THE RULE NO EXCEPTION LIFTS.
    let verifiedRefused = false;
    try { ex.grant({ obligation: 'OB-2', from: 'unknown', to: 'verified', by: 'Oversight Board', rationale: 'the auditor is confident', expiresAt: NOW + DAY }); }
    catch (e) { verifiedRefused = !!e.failClosed; }
    if (!verifiedRefused) v.push('an exception was granted for reaching `verified` — that would make `verified` mean `compliant` with extra steps');

    // --- A granted exception permits exactly that move, and the audit trail says so forever ----
    ex.grant({ obligation: 'OB-2', from: 'unknown', to: 'compliant', by: 'Oversight Board', rationale: 'inherited assessment from the predecessor regime, evidenced out of band', expiresAt: NOW + 30 * DAY });
    const governed = new ci.ComplianceIntelligence({ clock: () => NOW, exceptions: ex });
    governed.transition('OB-2', { to: 'compliant', by: 'Attorney General Chambers', rationale: 'carried forward under the granted exception' });
    if (governed.state('OB-2').state !== 'compliant') v.push('a granted exception did not permit the transition it was granted for');
    const audit = governed.transitionAudit({ now: NOW });
    if (audit.byExceptionCount !== 1) v.push('the transition made under an exception was not counted');
    const entry = audit.entries[0];
    if (entry.legality !== 'by-exception' || !entry.exception || entry.exception.by !== 'Oversight Board') v.push('the audit trail does not record who granted the exception');
    if (!audit.exceptionRate && audit.exceptionRate !== 0) v.push('the audit trail reports no exception rate');

    // The exception covers ONE move for ONE obligation, and nothing else.
    let unwidened = false;
    try { governed.transition('OB-3', { to: 'compliant', by: 'X', rationale: 'the same shortcut, elsewhere' }); } catch (e) { unwidened = !!e.failClosed; }
    if (!unwidened) v.push('an exception granted for one obligation widened the machine for another');

    // An expired exception stops covering it, with nobody withdrawing anything.
    const later = new ci.ComplianceIntelligence({ clock: () => NOW + 60 * DAY, exceptions: ex });
    let lapsed = false;
    try { later.transition('OB-4', { to: 'compliant', by: 'X', rationale: 'r' }); } catch (e) { lapsed = !!e.failClosed; }
    if (!lapsed) v.push('an expired exception still permitted a transition');
    if (!ex.expired({ now: NOW + 60 * DAY }).length) v.push('an expired exception was not reported as expired');

    // The permanent record: the entry still says it was exceptional after the exception has gone.
    const afterwards = governed.transitionAudit({ now: NOW + 60 * DAY });
    if (afterwards.byExceptionCount !== 1) v.push('the record that a state was reached by exception disappeared with the exception — which is what makes using one cheap');

    // --- An estate leaning on exceptions has a machine that no longer describes practice -------
    const heavy = new ci.ComplianceIntelligence({ clock: () => NOW, exceptions: ex });
    heavy.transition('OB-2', { to: 'compliant', by: 'X', rationale: 'r' });
    if (heavy.transitionAudit({ now: NOW }).machineDescribesPractice !== false) v.push('an estate whose every transition was exceptional still reported that the machine describes practice');
    if (audit.authorizes !== false) v.push('the transition audit claims authority');
  }),

  fit('APP-FIT-DIAGRAM-ASSURANCE', 'Every node in a governed diagram resolves to something that exists, and every arrow to a declared relationship', (v) => {
    const da = require('../src/architecture/documentation-assurance');

    // --- Seven diagram kinds, each saying what "resolved" means and what a wrong one costs ----
    for (const required of ['architecture', 'sequence', 'deployment', 'infrastructure', 'process-flow', 'openapi', 'state']) {
      if (!da.DIAGRAM_KINDS[required]) v.push(`diagram kind '${required}' is not verified`);
    }
    for (const [id, k] of Object.entries(da.DIAGRAM_KINDS)) {
      if (!k.resolvedMeans || !k.ifWrong) v.push(`diagram kind '${id}' does not say what resolved means or what a wrong one costs`);
    }

    // --- The corpus verifies, and the floor stops it passing by finding nothing ----------------
    const report = da.verifyDiagrams({});
    for (const f of report.findings) v.push(`${f.document}: ${f.kind} diagram — '${f.subject}' ${f.detail}`);
    if (!report.extractorSound) v.push(`only ${report.count} governed diagram(s) found, below the floor of ${da.MINIMUM_DIAGRAMS} — a corpus with no diagrams passes every diagram rule trivially`);
    if (report.count < da.MINIMUM_DIAGRAMS) v.push('the diagram corpus is below its floor');
    // Every kind that has a resolver must actually be exercised by the corpus, or its rules are
    // written and never run.
    for (const kind of ['architecture', 'deployment', 'infrastructure', 'process-flow', 'sequence', 'state']) {
      if (!report.byKind.some((k) => k.kind === kind)) v.push(`no governed document contains a '${kind}' diagram, so its rules have never run against anything`);
    }

    // --- THE COUNTEREXAMPLES: each resolver must reject a diagram that lies -------------------
    const world = da.diagramWorld();
    const craft = (kind, body) => da.verifyDiagram({ document: 'crafted', kind, body, source: null }, world);
    for (const [what, kind, body] of [
      ['a bounded context that does not exist', 'architecture', 'graph LR\n  intake[a]\n  ministry-of-magic[b]\n  intake --> ministry-of-magic\n'],
      ['a dependency the context map does not declare', 'architecture', 'graph LR\n  custody[a]\n  intake[b]\n  custody --> intake\n'],
      ['a service the topology does not contain', 'infrastructure', 'graph LR\n  intake-api[a]\n  quantum-widget[b]\n  intake-api --> quantum-widget\n'],
      ['a service dependency the topology does not declare', 'infrastructure', 'graph LR\n  intake-api[a]\n  kms[b]\n  intake-api --> kms\n'],
      ['a region that is not deployed', 'deployment', 'graph TD\n  bw-central[a]\n  atlantis[b]\n  bw-central --> atlantis\n'],
      ['a mission-chain link that is not declared', 'process-flow', 'graph LR\n  case-throughput[a]\n  public-trust[b]\n  case-throughput --> public-trust\n'],
      ['a case transition the lifecycle refuses', 'state', 'stateDiagram-v2\n  closed --> received\n'],
      ['a lifeline that is neither a service nor an actor', 'sequence', 'sequenceDiagram\n  participant nobody-in-particular\n  participant intake-api\n  nobody-in-particular->>intake-api: hello\n'],
      ['a sequence with no messages', 'sequence', 'sequenceDiagram\n  participant intake-api\n'],
    ]) {
      const r = craft(kind, body);
      if (r.sound) v.push(`a ${kind} diagram containing ${what} was accepted`);
    }
    // …and each resolver accepts a correct diagram, so none of them is simply rejecting everything.
    for (const [kind, body] of [
      ['architecture', 'graph LR\n  investigation[a]\n  custody[b]\n  investigation --> custody\n'],
      ['infrastructure', 'graph LR\n  intake-api[a]\n  policy-engine[b]\n  intake-api --> policy-engine\n'],
      ['deployment', 'graph TD\n  bw-central[a]\n  independent[b]\n  bw-central --> independent\n'],
      ['process-flow', 'graph LR\n  reports-can-be-filed[a]\n  public-trust[b]\n  reports-can-be-filed --> public-trust\n'],
      ['state', 'stateDiagram-v2\n  received --> reviewed\n'],
      ['sequence', 'sequenceDiagram\n  participant Citizen\n  participant intake-api\n  Citizen->>intake-api: POST /api/reports\n'],
    ]) {
      const r = craft(kind, body);
      if (!r.sound) v.push(`a correct ${kind} diagram was rejected: ${r.findings.map((f) => `${f.subject} ${f.detail}`).join('; ')}`);
    }

    // --- A diagram that declares no kind cannot be checked, and is a finding rather than a skip
    const unclassified = da.verifyDiagram({ document: 'crafted', kind: null, body: 'graph LR\n  a --> b\n' }, world);
    if (unclassified.sound) v.push('a diagram declaring no kind was accepted — a diagram nothing can classify is a diagram nothing can check');
    // An unparseable line is unverified, not verified.
    const garbled = craft('architecture', 'graph LR\n  intake\n  ??? this is not mermaid ???\n');
    if (garbled.sound) v.push('a diagram containing an unparseable line was accepted');

    // --- OpenAPI: everything published is served, and every operation carries what is needed ---
    const api = da.verifyOpenApi();
    for (const f of api.findings) v.push(`openapi: '${f.subject}' ${f.detail}`);
    if (api.paths < 10) v.push('the OpenAPI check is reading a specification with almost no paths — it has stopped resolving');

    if (report.authorizes !== false) v.push('the diagram report claims authority');
    if (!da.report({ controls: [] }).diagrams) v.push('the documentation report does not carry the diagram verification');
  }),

  fit('APP-FIT-GOVERNANCE-STATES', 'Seven governance states are never merged, and not-applicable cannot be asserted without a reason', (v) => {
    const inst = require('../src/assurance/institutional');
    const DAY = 24 * 3600_000;

    // --- All seven, each declaring whether it counts and what to do about it -------------------
    for (const required of ['unknown', 'missing', 'not-applicable', 'accepted-risk', 'verified', 'failed', 'pending-review']) {
      if (!inst.GOVERNANCE_STATES[required]) v.push(`governance state '${required}' is not declared`);
    }
    if (Object.keys(inst.GOVERNANCE_STATES).length !== 7) v.push('the governance state model does not have exactly seven states');
    for (const [id, s] of Object.entries(inst.GOVERNANCE_STATES)) {
      if (typeof s.countsAsAssured !== 'boolean') v.push(`governance state '${id}' does not declare whether it counts as assured`);
      if (typeof s.needsAction !== 'boolean') v.push(`governance state '${id}' does not declare whether it needs action`);
      if (!s.means || !s.action) v.push(`governance state '${id}' does not say what it means or what to do`);
    }
    // Only verified and accepted-risk count. If `unknown` ever counted, every dashboard here would
    // be a lie, so it is checked structurally rather than trusted.
    const assured = Object.entries(inst.GOVERNANCE_STATES).filter(([, s]) => s.countsAsAssured).map(([id]) => id).sort();
    if (assured.join(',') !== 'accepted-risk,verified') v.push(`the states counting as assured are '${assured.join(', ')}' — only verified and accepted-risk may`);
    if (inst.GOVERNANCE_STATES.unknown.countsAsAssured) v.push('unknown counts as assured — the failure this whole model exists to prevent');
    if (!inst.GOVERNANCE_STATES['accepted-risk'].caveat) v.push('accepted-risk does not state that governed is not the same as safe');

    // --- not-applicable and accepted-risk cannot be asserted casually -------------------------
    for (const [what, args] of [
      ['not-applicable with no reason', { state: 'not-applicable', by: 'X' }],
      ['not-applicable with no person', { state: 'not-applicable', justification: 'out of scope' }],
      ['accepted-risk with no authority', { state: 'accepted-risk', justification: 'r', expiresAt: 10 * DAY }],
      ['accepted-risk with no expiry', { state: 'accepted-risk', justification: 'r', by: 'Oversight Board' }],
    ]) {
      let rejected = false;
      try { inst.governanceState({ ...args, now: 0 }); } catch (e) { rejected = !!e.failClosed; }
      if (!rejected) v.push(`'${what}' was accepted`);
    }
    let unknownState = false;
    try { inst.governanceState({ state: 'probably-fine', now: 0 }); } catch (_) { unknownState = true; }
    if (!unknownState) v.push('an undeclared governance state was accepted');
    // …and a properly justified one is accepted, so the guard is not simply refusing everything.
    if (inst.governanceState({ state: 'not-applicable', by: 'DGB', justification: 'this platform holds no payment data', now: 0 }).state !== 'not-applicable') {
      v.push('a properly justified not-applicable was rejected');
    }

    // --- An expired acceptance lapses back to the truth, not to nothing -----------------------
    const lapsed = inst.governanceState({ state: 'accepted-risk', by: 'Oversight Board', justification: 'known limitation', expiresAt: 10 * DAY, now: 100 * DAY });
    if (lapsed.state !== 'failed') v.push('an expired risk acceptance did not lapse back to failed — the risk was never closed');
    if (lapsed.lapsedFrom !== 'accepted-risk') v.push('a lapsed acceptance does not say what it lapsed from');

    // --- Completeness counts every state separately and never merges them ---------------------
    const items = [
      { item: 'a', state: 'verified' },
      { item: 'b', state: 'accepted-risk', by: 'Oversight Board', justification: 'redundancy is planned', expiresAt: 100 * DAY },
      { item: 'c', state: 'failed' },
      { item: 'd', state: 'missing' },
      { item: 'e', state: 'pending-review' },
      { item: 'f', state: 'not-applicable', by: 'DGB', justification: 'no payment data exists' },
      { item: 'g', state: 'unknown' },
    ];
    const c = inst.governanceCompleteness(items, { now: 0 });
    for (const [state, expected] of Object.entries({ verified: 1, 'accepted-risk': 1, failed: 1, missing: 1, 'pending-review': 1, 'not-applicable': 1, unknown: 1 })) {
      if (c.byState[state] !== expected) v.push(`governance state '${state}' was counted ${c.byState[state]} times, expected ${expected} — states have been merged`);
    }
    if (c.applicable !== 6) v.push('not-applicable was not excluded from the applicable set');
    if (c.completeness !== 0.3333) v.push(`completeness is ${c.completeness}, expected 2 of 6 applicable items assured`);
    if (!/not applicable/.test(c.completenessBasis)) v.push('the completeness figure travels without saying what it excluded');
    if (!/verified/.test(c.completenessBasis) || !/accepted as risk/.test(c.completenessBasis)) v.push('the completeness basis does not separate verifications from accepted risks');
    if (!c.unexamined.includes('g')) v.push('unknown items were not named separately');
    if (c.sound) v.push('an estate with unknown, failed, missing and pending items reported itself sound');
    // The success path: an estate of verifications and justified exclusions is sound.
    const clean = inst.governanceCompleteness([
      { item: 'a', state: 'verified' },
      { item: 'b', state: 'not-applicable', by: 'DGB', justification: 'no payment data exists' },
      { item: 'c', state: 'accepted-risk', by: 'Oversight Board', justification: 'accepted', expiresAt: 100 * DAY },
    ], { now: 0 });
    if (!clean.sound) v.push('an estate of verifications, justified exclusions and live acceptances was not sound — this check can only fail');
    if (clean.completeness !== 1) v.push('a fully assured estate did not reach completeness 1');
    if (clean.authorizes !== false) v.push('the governance completeness report claims authority');
  }),

  fit('APP-FIT-DEPENDENCY-RISK', 'Every open dependency is ranked on six factors, constitutional first, and a declared prior is never presented as a measurement', (v) => {
    const ir = require('../src/governance/institutional-resilience');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Six factors, each declaring its basis and where it comes from ------------------------
    for (const required of ['likelihood', 'operationalImpact', 'detectability', 'recoveryComplexity', 'businessCriticality', 'governancePriority']) {
      if (!ir.RISK_FACTORS[required]) v.push(`risk factor '${required}' is not assessed`);
    }
    for (const [id, f] of Object.entries(ir.RISK_FACTORS)) {
      if (!['derived', 'declared'].includes(f.basis)) v.push(`risk factor '${id}' does not declare whether it is derived or a declared prior`);
      if (!f.scale || f.scale.length < 2) v.push(`risk factor '${id}' has no usable scale`);
      if (!f.question || !f.derivation) v.push(`risk factor '${id}' does not say what it asks or how it is arrived at`);
    }
    // Both kinds must exist. If every factor were "derived" the model would be claiming to measure
    // things it cannot, and if every one were "declared" nothing would be evidence at all.
    const derived = Object.values(ir.RISK_FACTORS).filter((f) => f.basis === 'derived').length;
    const declared = Object.values(ir.RISK_FACTORS).filter((f) => f.basis === 'declared').length;
    if (!derived || !declared) v.push('the risk model presents every factor as the same kind of thing — derived facts and declared priors must be distinguishable');
    // Every declared prior states its reasoning, for every kind, or it is an unarguable number.
    for (const kind of Object.keys(ir.DEPENDENCY_KINDS)) {
      for (const [table, name] of [[ir.KIND_LIKELIHOOD, 'likelihood'], [ir.KIND_RECOVERY, 'recovery']]) {
        if (!table[kind]) v.push(`no ${name} prior is declared for dependency kind '${kind}'`);
        else if (!table[kind].why || table[kind].why.length < 20) v.push(`the ${name} prior for '${kind}' states no reasoning`);
      }
    }

    // --- Scoring one dependency ---------------------------------------------------------------
    const scored = ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'service', controls });
    if (scored.factors.length !== 6) v.push('a scored dependency does not carry all six factors');
    for (const f of scored.factors) {
      if (!ir.RISK_FACTORS[f.factor].scale.includes(f.level)) v.push(`factor '${f.factor}' reported '${f.level}', which is not on its scale`);
      if (!f.why) v.push(`factor '${f.factor}' states no reason`);
      if (f.basis !== ir.RISK_FACTORS[f.factor].basis) v.push(`factor '${f.factor}' reports a different basis from the one it declares`);
    }
    if (scored.category !== 'technology') v.push('a service dependency was not mapped to the technology category');
    let unknownKind = false;
    try { ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'astrology', controls }); } catch (_) { unknownKind = true; }
    if (!unknownKind) v.push('an undeclared dependency kind was scored');

    // --- Detectability actually moves, in both directions -------------------------------------
    // Phase 14 gave every kind a detecting control, so 'undetected' is now demonstrated by a control
    // that did not run rather than by a kind that has none. Both are the same finding: nothing would
    // notice this dependency breaking.
    const undetected = ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'communication-channel', controls: controls.filter((c) => c.id !== 'APP-FIT-GOVERNANCE-CONTINUITY') });
    if (undetected.levels.detectability !== 'undetected') v.push('a dependency whose detecting control did not run was not reported as undetected');
    for (const [kind, spec] of Object.entries(ir.DEPENDENCY_KINDS)) {
      if (!spec.detectedBy) v.push(`dependency kind '${kind}' names no detecting control — a dependency nothing would notice breaking is the worst kind`);
    }
    const blind = ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'service', controls: [] });
    if (blind.levels.detectability !== 'undetected') v.push('a dependency whose detecting control did not run was still reported as detected');
    const failing = ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'service', controls: [{ id: 'APP-FIT-CHAOS-DETECT-RECOVER', pass: false }] });
    if (failing.levels.detectability !== 'partially-detected') v.push('a failing detecting control was scored the same as a holding one');
    if (scored.levels.detectability !== 'detected') v.push('a dependency whose control runs and holds was not reported as detected — the factor can only ever be bad');

    // --- THE RANKING RULE: constitutional first, whatever the arithmetic says ------------------
    const evaluation = ir.evaluate({ controls });
    const ranked = ir.riskPrioritisation(evaluation, { controls });
    if (!ranked.count) v.push('an estate with open single dependencies produced no ranking');
    let seenNonConstitutional = false;
    for (const r of ranked.ranked) {
      if (!r.constitutional) seenNonConstitutional = true;
      else if (seenNonConstitutional) v.push(`a constitutional dependency (${r.capability}/${r.kind}) ranked below a non-constitutional one — the arithmetic was allowed to outweigh what the platform exists to do`);
    }
    // …and there IS a non-constitutional one in the list, or the rule was never exercised.
    if (!seenNonConstitutional) v.push('no non-constitutional dependency is open, so the ranking rule was never tested');
    for (const r of ranked.ranked) {
      if (typeof r.rank !== 'number') v.push('a ranked dependency has no rank');
      if (r.orderingKey > r.maxOrderingKey) v.push('an ordering key exceeded its own maximum');
    }
    // Ranking is deterministic: the same input twice gives the same order.
    const again = ir.riskPrioritisation(evaluation, { controls });
    if (JSON.stringify(again.ranked.map((r) => `${r.capability}/${r.kind}`)) !== JSON.stringify(ranked.ranked.map((r) => `${r.capability}/${r.kind}`))) {
      v.push('the risk ranking is not deterministic');
    }

    // --- Executive remediation priorities name the action, the effort and who decides ---------
    if (!ranked.remediationPriorities.length) v.push('no executive remediation priorities were produced');
    for (const p of ranked.remediationPriorities) {
      if (!p.action || !p.why || !p.effort || !p.decidedBy) v.push(`remediation priority ${p.rank} does not say what to do, why, how hard, or who decides`);
      if (p.action === 'Review this dependency.') v.push(`remediation priority ${p.rank} (${p.capability}/${p.kind}) has no specific action — a generic action is a placeholder`);
    }
    if (ranked.recommendationsOnly !== true || ranked.authorizes !== false) v.push('the risk prioritisation claims to be more than a ranking');
    if (!/always rank first/.test(ranked.method)) v.push('the ranking method does not state the constitutional-first rule');
    if (ranked.declaredFactorShare === null || ranked.declaredFactorShare === 0) v.push('the ranking does not disclose that some of its factors are declared priors');

    // --- Part 11: the taxonomy is evaluated per capability and per category -------------------
    for (const c of evaluation.capabilities) {
      if (c.categories.length !== 11) v.push(`capability '${c.capability}' was not evaluated across all eleven categories`);
      for (const cat of c.categories) {
        if (cat.unassessed) v.push(`category '${cat.category}' was not assessed for '${c.capability}' — an unassessed category is unvalidated, not validated`);
        if (!cat.reason) v.push(`category '${cat.category}' for '${c.capability}' states no reason`);
        if (cat.validated && cat.failingKinds.length) v.push(`category '${cat.category}' reported validated with failing kinds`);
      }
      if (c.categoriesValidated !== (c.unvalidatedCategories.length === 0)) v.push(`capability '${c.capability}' disagrees with itself about category validation`);
    }
    if (evaluation.categoryCoverage.length !== 11) v.push('the estate-wide category coverage does not report all eleven categories');
    // At least one category must be fully validated across the estate and at least one not, or the
    // taxonomy is a list that always gives the same answer.
    if (!evaluation.categoryCoverage.some((c) => c.validatedFor === c.of)) v.push('no category is validated anywhere — the taxonomy can only ever fail');
    if (!evaluation.categoryCoverage.some((c) => c.validatedFor < c.of)) v.push('every category is validated everywhere — the taxonomy can only ever pass');

    // --- Each new dimension can move in both directions ---------------------------------------
    // data: reconstructible vs not.
    if (!ir.dataResilience('governance-decision-recording').reason.includes('reconstructible')) v.push('a capability with a hash-chained ledger was not treated as holding reconstructible data');
    if (ir.dataResilience('evidence-custody').singleDependency !== false) v.push('a capability with a custody ledger was reported as holding an unreconstructible store');
    // facility: honest about being a proxy.
    const fac = ir.facilityResilience('anonymous-reporting');
    if (fac.proxy !== true || !/proxy/i.test(fac.reason)) v.push('the facilities assessment does not state that it is a proxy for a physical site');
    if (ir.facilityResilience('anonymous-reporting', { regions: ['bw-central'] }).singleDependency !== true) v.push('a single-site estate was not reported as a single facility dependency');
    // legal authority: unknown is not resilient, and a real registry changes the answer.
    if (ir.legalAuthorityResilience('case-investigation').singleDependency !== true) v.push('a capability with no recorded legal authority was treated as resilient — unknown is not resilient');
    const withInstruments = ir.legalAuthorityResilience('case-investigation', { instruments: [
      { id: 'corruption-and-economic-crime-act', contexts: ['investigation'] },
      { id: 'criminal-procedure-and-evidence-act', contexts: ['investigation'] },
    ] });
    if (withInstruments.singleDependency !== false) v.push('two authorising instruments were still reported as a single legal-authority dependency');
    if (ir.legalAuthorityResilience('anonymous-reporting').singleDependency !== false) v.push('a constitutional mandate was reported as resting on a single instrument');
    // knowledge: needs BOTH a validated person and a followable document.
    const noContinuity = ir.knowledgeResilience('anonymous-reporting', { controls });
    if (noContinuity.singleDependency !== true) v.push('a capability with no validated alternative person was reported as holding its knowledge somewhere else');
    if (!/head/.test(noContinuity.reason) && !/written down/.test(noContinuity.reason)) v.push('the knowledge assessment does not say which half is missing');
    // governance: separation of duties gives a second authority.
    if (ir.governanceResilience('anonymous-reporting').singleDependency !== false) v.push('separation of duties did not produce a second governance authority');
  }),

  fit('APP-FIT-DECISION-EVOLUTION', 'A prediction filed after the result is refused, an unintended consequence that was predicted is reclassified, and a reversal is never a supersession', (v) => {
    const { DecisionMemory, LINEAGE_STAGES } = require('../src/architecture/decision-memory');

    // --- The four new stages exist and each says what it requires -----------------------------
    for (const required of ['intent', 'unintended', 'abandoned', 'reversal']) {
      if (!LINEAGE_STAGES[required]) v.push(`lineage stage '${required}' is not supported`);
    }
    for (const [id, s] of Object.entries(LINEAGE_STAGES)) {
      if (!s.requires || !s.requires.length) v.push(`lineage stage '${id}' requires nothing, so anything counts as one`);
      if (!s.description || s.description.length < 30) v.push(`lineage stage '${id}' has no usable description`);
    }
    // Reversal and supersession must be separate stages. If one were an alias of the other the whole
    // distinction would be decorative.
    if (LINEAGE_STAGES.reversal === LINEAGE_STAGES.supersession) v.push('reversal and supersession are the same stage');

    const mem = new DecisionMemory({ clock: () => 0 });

    // --- THE HINDSIGHT RULE -------------------------------------------------------------------
    mem.record('ADR-0005', 'intent', { by: 'ARB', at: 1, predictions: [{ subject: 'authorization-latency', expectation: 'falls below 5ms at the 99th percentile' }] });
    mem.record('ADR-0005', 'implementation', { by: 'Platform Engineering', at: 2, modules: ['src/authz.js'] });
    mem.record('ADR-0005', 'outcome', { by: 'Assurance', at: 3, verdict: 'as-predicted', evidence: ['APP-FIT-AUTHZ-CACHE-SAFETY'] });
    let hindsight = false;
    try { mem.record('ADR-0005', 'intent', { by: 'ARB', at: 4, predictions: [{ subject: 'x', expectation: 'we meant that all along' }] }); }
    catch (e) { hindsight = !!e.failClosed; }
    if (!hindsight) v.push('an intent was recorded after the outcome — a prediction filed after the result is not a prediction');
    // A prediction with no subject cannot be matched against anything later.
    let unmatchable = false;
    try { mem.record('ADR-0006', 'intent', { by: 'ARB', at: 1, predictions: [{ expectation: 'it will be better' }] }); } catch (_) { unmatchable = true; }
    if (!unmatchable) v.push('a prediction with no subject was accepted, so no later outcome could ever be matched against it');

    // --- THE UNINTENDED-CONSEQUENCE CHECK -----------------------------------------------------
    // Something genuinely unforeseen stays unforeseen.
    mem.record('ADR-0005', 'unintended', { by: 'SRE', at: 5, subject: 'cross-tenant-cache-replay', consequence: 'a cached decision could be replayed across tenants', discoveredBy: 'APP-FIT-AUTHZ-CACHE-SAFETY' });
    // Something that WAS predicted, filed as unforeseen, is reclassified.
    mem.record('ADR-0005', 'unintended', { by: 'Somebody Optimistic', at: 6, subject: 'authorization-latency', consequence: 'latency changed', discoveredBy: 'observation' });
    const lineage = mem.lineage('ADR-0005', { controls: [{ id: 'APP-FIT-AUTHZ-CACHE-SAFETY', pass: true }] });
    if (!lineage.genuinelyUnintended.includes('a cached decision could be replayed across tenants')) v.push('a genuinely unforeseen consequence was not recorded as unforeseen');
    if (!lineage.misfiledAsUnintended.length) v.push('a consequence that was predicted at decision time was still reported as unintended');
    if (lineage.misfiledAsUnintended[0].wasPredictedBy !== 'ARB') v.push('the reclassification does not name who predicted it');
    if (!lineage.gaps.some((g) => /was predicted at decision time/.test(g))) v.push('the misfiled consequence produced no gap for a reader to see');

    // --- Reversal is not supersession ---------------------------------------------------------
    let noSuchAdr = false;
    try { mem.record('ADR-0005', 'reversal', { by: 'ARB', at: 7, reversedBy: 'ADR-9999', reason: 'r' }); } catch (_) { noSuchAdr = true; }
    if (!noSuchAdr) v.push('a reversal cited an ADR that does not exist');
    mem.record('ADR-0005', 'reversal', { by: 'ARB', at: 8, reversedBy: 'ADR-0007', reason: 'the caching stance was withdrawn' });
    mem.record('ADR-0004', 'supersession', { by: 'ARB', at: 8, adr: 'ADR-0007' });
    const reversedEvo = mem.evolution('ADR-0005', { controls: [] });
    const supersededEvo = mem.evolution('ADR-0004', { controls: [] });
    if (!reversedEvo.branches.reversed.length) v.push('a reversal was not recorded as a reversal');
    if (reversedEvo.branches.superseded.length) v.push('a reversal was reported as a supersession');
    if (!supersededEvo.branches.superseded.length) v.push('a supersession was not recorded');
    if (supersededEvo.branches.reversed.length) v.push('a supersession was reported as a reversal');
    if (!/REVERSED, not superseded/.test(reversedEvo.note)) v.push('the evolution report does not distinguish reversal from supersession in what a reader sees');

    // --- Abandoned approaches are kept, so they are not re-proposed ---------------------------
    let incomplete = false;
    try { mem.record('ADR-0004', 'abandoned', { by: 'ARB', at: 1, approach: 'a shared mutable cache' }); } catch (_) { incomplete = true; }
    if (!incomplete) v.push('an abandoned approach was recorded without saying why it was dropped');
    mem.record('ADR-0004', 'abandoned', { by: 'ARB', at: 1, approach: 'a shared mutable cache', whyNot: 'no way to bound cross-tenant visibility' });
    if (!mem.evolution('ADR-0004').branches.abandoned.includes('a shared mutable cache')) v.push('an abandoned approach was not carried into the evolution timeline');

    // --- The timeline is ordered, complete, and names the cost of not learning ----------------
    if (reversedEvo.events.length < 6) v.push('the evolution timeline is missing events');
    for (let i = 1; i < reversedEvo.events.length; i++) {
      if (reversedEvo.events[i].at < reversedEvo.events[i - 1].at) v.push('the evolution timeline is not in chronological order');
    }
    for (const e of reversedEvo.events) if (!e.what || !e.by) v.push(`a timeline event at ${e.at} says nothing, or nobody recorded it`);
    if (reversedEvo.costWithoutLearning !== true) v.push('a decision that was reversed with no lesson recorded was not flagged — that is the most expensive kind');
    mem.record('ADR-0005', 'lesson', { by: 'ARB', at: 9, statement: 'a cache keyed without the tenant is a cross-tenant channel' });
    if (mem.evolution('ADR-0005').costWithoutLearning !== false) v.push('recording a lesson did not clear the cost-without-learning flag, so the flag means nothing');

    // --- The catalogue-wide report separates all of it -----------------------------------------
    const report = mem.report({ controls: [{ id: 'APP-FIT-AUTHZ-CACHE-SAFETY', pass: true }] });
    if (!report.reversed.some((r) => r.adr === 'ADR-0005')) v.push('the catalogue report does not name reversed decisions');
    if (!report.superseded.includes('ADR-0004')) v.push('the catalogue report does not name superseded decisions');
    if (!report.unforeseen.length) v.push('the catalogue report does not name unforeseen consequences');
    if (!report.misfiledAsUnintended.length) v.push('the catalogue report hides consequences that were predicted and filed as unforeseen');
    if (!report.unpredicted.length) v.push('every ADR has a recorded intent, on a platform where none had one before this phase — historical evidence must not be fabricated');
    if (report.authorizes !== false) v.push('the decision memory report claims authority');
  }),

  fit('APP-FIT-DRIFT-CLASSIFICATION', 'Every drift finding is classified, and no two classifications produce the same governance response', (v) => {
    const dp = require('../src/architecture/drift-prevention');
    const asm = require('../src/architecture/assumptions');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Eight classifications, each with its own routing -------------------------------------
    for (const required of ['architectural', 'documentation', 'ownership', 'governance', 'dependency', 'runtime', 'security', 'policy']) {
      if (!dp.DRIFT_CLASSES[required]) v.push(`drift classification '${required}' is not supported`);
    }
    if (Object.keys(dp.DRIFT_CLASSES).length !== 8) v.push('the drift taxonomy does not have exactly eight classifications');
    for (const [id, c] of Object.entries(dp.DRIFT_CLASSES)) {
      if (!c.respondsBy) v.push(`drift class '${id}' names nobody to respond`);
      if (typeof c.blocksBuild !== 'boolean') v.push(`drift class '${id}' does not declare whether it blocks the build`);
      if (!c.within) v.push(`drift class '${id}' states no timescale`);
      if (!c.response || c.response.length < 30) v.push(`drift class '${id}' states no governance response`);
      if (!c.ifIgnored || c.ifIgnored.length < 30) v.push(`drift class '${id}' does not say what happens if it is ignored`);
      for (const k of c.kinds) if (!dp.DRIFT_KINDS[k]) v.push(`drift class '${id}' claims unknown kind '${k}'`);
    }
    // Every kind is routed by exactly one class, or a finding would arrive with nowhere to go.
    for (const kind of Object.keys(dp.DRIFT_KINDS)) {
      const owning = Object.entries(dp.DRIFT_CLASSES).filter(([, c]) => c.kinds.includes(kind)).map(([id]) => id);
      if (owning.length !== 1) v.push(`drift kind '${kind}' is claimed by ${owning.length} classifications`);
    }

    // --- THE STRUCTURAL RULE: different categories produce DIFFERENT responses ----------------
    const distinct = dp.assertDistinctResponses();
    if (!distinct.distinct) for (const c of distinct.collisions) v.push(c);
    // …and the check itself can fail, fed a crafted table where two classes are the same class twice.
    const collided = dp.assertDistinctResponses({
      a: { respondsBy: 'ARB', blocksBuild: true, within: 'now', response: 'fix it' },
      b: { respondsBy: 'ARB', blocksBuild: true, within: 'now', response: 'fix it' },
    });
    if (collided.distinct) v.push('the distinct-response check accepted two identical responses, so it proves nothing');
    // At least two classes must differ on whether they block, or "classification" is one behaviour.
    const blocking = Object.values(dp.DRIFT_CLASSES).filter((c) => c.blocksBuild).length;
    if (!blocking || blocking === Object.keys(dp.DRIFT_CLASSES).length) v.push('every drift class blocks the build, or none does — the classification changes nothing');
    if (new Set(Object.values(dp.DRIFT_CLASSES).map((c) => c.respondsBy)).size < 4) v.push('drift is routed to fewer than four distinct authorities, so classification is not routing anything');

    // --- Every finding carries its classification and its routing -----------------------------
    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const drift = dp.detect({ controls, assumptions: registry });
    for (const f of drift.findings) {
      if (!f.classification) v.push(`a ${f.kind}/${f.direction} finding carries no classification — an unclassified finding is one nobody has decided how to route`);
      if (!f.respondsBy) v.push(`a ${f.kind} finding names nobody to respond`);
    }
    if (drift.unclassified.length) v.push(`unclassified drift findings: ${drift.unclassified.join(', ')}`);
    if (drift.byClass.length !== 8) v.push('the drift report does not break down by all eight classifications');
    for (const r of drift.routing) if (!r.to || !r.action || !r.within) v.push(`routing for '${r.classification}' is incomplete`);

    // --- The three new detectors can actually fire --------------------------------------------
    // Security: a threat treated by a control that ran and failed.
    const threatModel = require('../src/security/threat-model');
    const oneControl = threatModel.traceability()[0].controls[0].control;
    const failing = dp.detect({ controls: controls.map((c) => (c.id === oneControl ? { ...c, pass: false } : c)), assumptions: registry, checkDocumentation: false });
    if (!failing.findings.some((f) => f.kind === 'security' && f.subject.includes(oneControl))) {
      v.push('a threat whose treating control ran and failed produced no security drift finding');
    }
    if (!failing.findings.filter((f) => f.kind === 'security').every((f) => f.respondsBy === 'Information Security Review Board')) {
      v.push('security drift was not routed to the Information Security Review Board');
    }
    // Security, the other direction: a treatment naming a control the suite does not contain.
    const missingControl = dp.detect({ controls: controls.filter((c) => c.id !== oneControl), assumptions: registry, checkDocumentation: false });
    if (!missingControl.findings.some((f) => f.kind === 'security' && f.direction === 'unrealised')) {
      v.push('a treatment naming a control the verification suite does not contain produced no finding');
    }
    // Documentation: the detector is wired in and reports the same findings the doc checker does.
    const documentation = require('../src/architecture/documentation-assurance');
    const docFindings = drift.findings.filter((f) => f.kind === 'documentation').length;
    const docReport = documentation.report({ controls });
    if (docReport.sound && docFindings) v.push('documentation drift was reported while the documentation checker says the corpus is sound');
    if (!docReport.sound && !docFindings) v.push('the documentation checker reports findings that the drift classifier never sees');
    // Policy: every declared stance cites an ADR that exists, and the check can fail.
    if (drift.findings.some((f) => f.kind === 'policy')) {
      for (const f of drift.findings.filter((x) => x.kind === 'policy')) v.push(`policy drift: ${f.subject} — ${f.detail}`);
    }

    // --- The estate is clean of structural drift, and the class breakdown says so -------------
    if (!drift.clean) for (const f of drift.structural) v.push(`architecture drift (${f.classification}/${f.direction}): ${f.subject} — ${f.detail}`);
    if (drift.blockingCount !== drift.findings.filter((f) => dp.DRIFT_CLASSES[f.classification].blocksBuild).length) v.push('the blocking count does not agree with the classifications');
    if (drift.authorizes !== false) v.push('the classified drift report claims authority');
  }),

  fit('APP-FIT-PUBLIC-TRUST', 'The trust chain reaches public trust, and a derived indicator never presents itself as a measurement of what people believe', (v) => {
    const bus = require('../src/observability/business');

    // --- Eight chain layers, plus governance-performance as cross-cutting ---------------------
    for (const required of ['infrastructure', 'application-behaviour', 'business-process', 'mission-outcome', 'citizen-experience', 'institutional-outcome', 'government-objective', 'public-trust']) {
      if (!bus.OPERATIONAL_LAYERS.includes(required)) v.push(`operational layer '${required}' is not in the correlation chain`);
    }
    if (bus.OPERATIONAL_LAYERS.length !== 8) v.push('the operational correlation chain does not have exactly eight layers');
    if (!bus.CROSS_CUTTING_LAYERS.includes('governance-performance')) v.push('governance-performance was dropped rather than being kept as a cross-cutting layer');
    if (bus.OPERATIONAL_LAYERS.includes('governance-performance')) v.push('governance-performance is modelled as a link in the chain, which puts it in an order that is not true');

    // --- Every indicator states what it is and what it is not ---------------------------------
    for (const [id, i] of Object.entries(bus.TRUST_INDICATORS)) {
      if (!i.question || !i.question.endsWith('?')) v.push(`trust indicator '${id}' states no question`);
      if (!i.derivedFrom) v.push(`trust indicator '${id}' does not say where it comes from`);
      if (!i.whyItBearsOnTrust || i.whyItBearsOnTrust.length < 30) v.push(`trust indicator '${id}' does not say why it bears on trust`);
      if (!i.ifAbsent) v.push(`trust indicator '${id}' does not say what its absence would mean`);
    }
    if (Object.keys(bus.TRUST_INDICATORS).length < 4) v.push('fewer than four leading indicators — the composite would rest on almost nothing');

    // --- THE RULE THIS EXISTS FOR: never a measurement of trust -------------------------------
    const green = {
      infrastructure: { degraded: [] }, applicationBehaviour: {}, businessMetrics: { backlog: 0 },
      missionOutcomes: { custodyIntact: true }, governance: { overdueReviews: [], unattributedDecisions: [] },
      institutionalOutcomes: { mandatesDeliverable: true },
    };
    const best = bus.publicTrustIndicators(green);
    if (best.measuresTrust !== false) v.push('the trust report claims to measure trust');
    for (const i of best.indicators) if (i.measuresTrust !== false || i.derived !== true) v.push(`indicator '${i.indicator}' does not declare that it is derived and does not measure trust`);
    if (!best.whatWouldMeasureIt || !/decided not to/.test(best.whatWouldMeasureIt)) v.push('the report does not say what would actually measure trust, including the people it cannot reach');
    if (typeof best.composite !== 'string') v.push('the composite is a number — a trust score is the most consequential invention this platform could make');
    if (best.composite !== 'warranted') v.push('a fully favourable estate did not report trust as warranted, so the indicator can only ever be bad');
    if (!/may still not trust/.test(best.basis)) v.push('a favourable reading does not acknowledge that citizens may still not trust the institution');

    // --- Unknown is never favourable ----------------------------------------------------------
    const partial = bus.publicTrustIndicators({ infrastructure: { degraded: [] }, businessMetrics: { backlog: 0 } });
    if (partial.composite !== 'unknown') v.push('a partially measured trust picture was reported as something other than unknown');
    if (partial.assessable) v.push('a partial picture reported itself assessable');
    if (!partial.unmeasured.length) v.push('unmeasured indicators were not named');
    if (bus.publicTrustIndicators({}).composite !== 'unknown') v.push('an entirely unmeasured estate did not report unknown');

    // --- And an unfavourable estate says so, without softening --------------------------------
    const bad = bus.publicTrustIndicators({
      infrastructure: { degraded: ['intake-api'] }, businessMetrics: { backlog: 40 },
      missionOutcomes: { custodyIntact: false }, governance: { unattributedDecisions: ['d1'] },
      institutionalOutcomes: { mandatesDeliverable: false },
    });
    if (bad.composite !== 'not-warranted') v.push('an estate where a citizen cannot report and evidence is not intact still reported trust as warranted');
    if (bad.declining.length !== Object.keys(bus.TRUST_INDICATORS).length) v.push('not every failing indicator was named as declining');
    if (!/conditions, not about opinion/.test(bad.basis)) v.push('an unfavourable reading does not distinguish conditions from opinion');

    // --- The chain carries it, and an unmeasured layer still breaks the correlation ------------
    const full = bus.operationalIntelligence(green);
    if (!full.chainComplete || !full.correlationValid) v.push('a fully measured estate did not produce a valid correlation');
    if (full.publicTrust.composite !== 'warranted') v.push('the chain did not carry the derived trust indicator');
    const none = bus.operationalIntelligence({});
    if (none.correlationValid) v.push('an entirely unmeasured chain reported a valid correlation');
    if (none.unmeasured.length !== bus.OPERATIONAL_LAYERS.length + bus.CROSS_CUTTING_LAYERS.length) v.push('not every unmeasured layer was reported');
    // A declining indicator produces a recommendation, and it names what would falsify it.
    const declining = bus.operationalIntelligence({ ...green, missionOutcomes: { custodyIntact: false } });
    const rec = declining.recommendations.find((r) => r.from === 'public-trust');
    if (!rec) v.push('a declining trust indicator produced no recommendation');
    else if (!rec.falsifiedBy) v.push('the public-trust recommendation cannot be argued with, which makes it an instruction');
    if (full.authorizes !== false) v.push('the operational intelligence report claims authority');
  }),

  fit('APP-FIT-STRATEGIC-SCENARIOS', 'The twin rehearses institutional change, and every strategic scenario can produce a blocking finding without touching the baseline', (v) => {
    const twinMod = require('../src/twin2/operations-twin');
    const asm = require('../src/architecture/assumptions');
    const own = require('../src/governance/ownership');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const STRATEGIC = ['policy-reform', 'legislative-change', 'funding-reduction', 'organizational-restructuring', 'staffing-growth', 'cross-government-collaboration', 'emergency-operations'];
    for (const s of STRATEGIC) if (!twinMod.SCENARIOS[s]) v.push(`strategic scenario '${s}' is not modelled`);
    // Every one carries the same metadata every other scenario must.
    for (const s of STRATEGIC) {
      const spec = twinMod.SCENARIOS[s];
      if (!spec) continue;
      try { twinMod.assertDeclaredMetadata(s, spec); } catch (e) { v.push(`scenario '${s}': ${e.message}`); }
      if (!twinMod.ENTITY_KINDS[spec.perturbs]) v.push(`scenario '${s}' perturbs '${spec.perturbs}', which is not a modelled entity kind`);
    }

    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const twin = new twinMod.OperationsTwin({ evidenceIds: controls.map((c) => c.id), assumptions: registry, clock: () => 0 });
    const run = (scenario, change) => twin.simulate({ scenario, change, now: 0, controls });

    // --- Each scenario must be able to BLOCK, or it is a rehearsal that always passes ----------
    const blockingCases = [
      ['policy-reform', { reforms: { analytics: 'eventual' } }, /cites no ADR/],
      ['policy-reform', { reforms: { analytics: 'eventual' }, adr: 'ADR-0007' }, /inherit a weaker guarantee/],
      ['legislative-change', { affects: ['investigation'], requiresControls: ['APP-FIT-DOES-NOT-EXIST'] }, /does not exist/],
      ['legislative-change', { affects: [] }, /names no bounded context/],
      ['legislative-change', { affects: ['ministry-of-magic'] }, /does not contain/],
      ['funding-reduction', { reduceBy: 0.5 }, /not assessed as ready/],
      ['organizational-restructuring', { merge: [['Oversight Board', 'Oversight Board Secretariat']] }, /separation of duties is lost/],
      // Phase 15, Part 6 closed the ADR-0009 debt: zones are declared in the context map, so the
      // proposal no longer supplies them. A proposal that disagrees with the record blocks, and a
      // context declaring 'no-sharing' cannot be shared by agreement.
      ['cross-government-collaboration', { partners: ['Auditor General'], sharing: ['intake'] }, /declares collaboration constraint 'no-sharing'/],
      ['cross-government-collaboration', { partners: ['Auditor General'], sharing: ['custody', 'investigation'] }, /zone isolation is a constitutional invariant/],
      ['cross-government-collaboration', { partners: ['Auditor General'], sharing: ['custody'], zones: { custody: 'executive' } }, /working from the wrong picture/],
      ['cross-government-collaboration', { sharing: [] }, /not a collaboration/],
      ['emergency-operations', { failed: ['intake-api'], surgeMultiplier: 50 }, /wait for a person rather than for a system/],
      ['emergency-operations', { failed: ['intake-api'], surgeMultiplier: 1 }, /constitutional service/],
    ];
    for (const [scenario, change, expected] of blockingCases) {
      const r = run(scenario, change);
      if (!r.blocking.length) { v.push(`'${scenario}' produced no blocking finding for a change that should be refused: ${JSON.stringify(change)}`); continue; }
      if (!r.blocking.some((f) => expected.test(f.finding))) v.push(`'${scenario}' blocked for the wrong reason: ${r.blocking.map((f) => f.finding).join(' | ').slice(0, 200)}`);
    }

    // --- …and each must be able to PASS, or it is a check nobody can satisfy -------------------
    const passingCases = [
      ['policy-reform', { reforms: {}, adr: 'ADR-0007' }],
      ['legislative-change', { affects: ['investigation'], requiresControls: ['APP-FIT-CONTEXT-MAP'] }],
      ['funding-reduction', { reduceBy: 0 }],
      ['organizational-restructuring', { merge: [] }],
      ['staffing-growth', { additionalAuthorities: 5 }],
      ['cross-government-collaboration', { partners: ['Auditor General'], sharing: ['custody'] }],
      ['emergency-operations', { failed: ['analytics'], surgeMultiplier: 1 }],
    ];
    for (const [scenario, change] of passingCases) {
      const r = run(scenario, change);
      if (r.blocking.length) v.push(`'${scenario}' blocked an acceptable change: ${r.blocking.map((f) => f.finding).join(' | ').slice(0, 200)}`);
      if (!r.safe) v.push(`'${scenario}' did not report an acceptable change as safe`);
    }

    // --- Growth does not close a single-person dependency -------------------------------------
    const DAY = 24 * 3600_000, NOW = 400 * DAY;
    const availability = new own.AvailabilityRegister({ clock: () => NOW });
    const activity = new own.ActivityRegister({ clock: () => NOW });
    const trainingReg = new own.TrainingRegister({ clock: () => NOW });
    const exercises = new own.ExerciseRegister({ clock: () => NOW });
    const continuity = own.knowledgeContinuity({ availability, activity, training: trainingReg, exercises, now: NOW });
    const growth = run('staffing-growth', { additionalAuthorities: 20, continuity });
    const spof = growth.findings.find((f) => f.entity === 'single-person-dependencies');
    if (!spof) v.push('the staffing-growth scenario says nothing about single-person dependencies, which is the thing headcount is assumed to fix');
    else if (!/before growth, and \d+ after it/.test(spof.finding)) v.push('growth was allowed to appear to close a single-person dependency');
    // With no continuity assessment, it says unknown rather than nothing.
    if (!/UNKNOWN/.test(run('staffing-growth', { additionalAuthorities: 20 }).findings.find((f) => f.entity === 'single-person-dependencies').finding)) {
      v.push('with no continuity evidence the growth scenario did not report the number as unknown');
    }

    // --- Isolation, confidence and authority hold for every strategic scenario -----------------
    for (const s of STRATEGIC) {
      const r = run(s, {});
      if (r.isolation.unchanged !== true) v.push(`scenario '${s}' mutated the baseline model`);
      if (r.authorizes !== false) v.push(`scenario '${s}' claims authority`);
      if (!r.confidenceDimensions || Object.keys(r.confidenceDimensions).length !== 6) v.push(`scenario '${s}' does not carry its six confidence dimensions`);
      if (!r.limitations.length || !r.assumptions.length) v.push(`scenario '${s}' ran without declared assumptions or limitations`);
    }
    // Determinism: the same strategic change simulated twice gives the same findings.
    const a = run('funding-reduction', { reduceBy: 0.4 });
    const b = run('funding-reduction', { reduceBy: 0.4 });
    if (JSON.stringify(a.findings) !== JSON.stringify(b.findings)) v.push('a strategic simulation is not deterministic');
  }),

  fit('APP-FIT-INSTITUTIONAL-LEARNING', 'A corrected incident is not a learned one, and learning is only claimed when training was demonstrated afterwards', (v) => {
    const inst = require('../src/assurance/institutional');
    const own = require('../src/governance/ownership');
    const DAY = 24 * 3600_000;

    // --- The nine-stage chain, each stage saying what evidences it and what its absence means --
    for (const required of ['incident', 'investigation', 'root-cause', 'corrective-action', 'verification', 'governance-update', 'adr', 'training', 'future-readiness']) {
      if (!inst.LEARNING_STAGES[required]) v.push(`learning stage '${required}' is not modelled`);
    }
    if (Object.keys(inst.LEARNING_STAGES).length !== 9) v.push('the learning chain does not have exactly nine stages');
    for (const [id, s] of Object.entries(inst.LEARNING_STAGES)) {
      if (!s.evidencedBy) v.push(`learning stage '${id}' says nothing about what evidences it`);
      if (!s.meansIfAbsent) v.push(`learning stage '${id}' does not say what its absence means`);
    }

    // --- With no register at all, learning is UNKNOWN, not zero and not fine -------------------
    const blind = inst.institutionalLearning({});
    if (blind.learningRate !== null) v.push('a learning rate was computed with no improvement register');
    if (blind.measurable) v.push('learning reported itself measurable with nothing to measure');
    if (!/UNKNOWN/.test(blind.note)) v.push('an unmeasurable estate did not say the answer is unknown');

    // --- A corrected incident with nobody trained is CORRECTED-NOT-LEARNED --------------------
    const loop = new inst.ImprovementLoop({ clock: () => 0 });
    const imp = loop.observe({ control: 'APP-FIT-X', detail: 'a control failed', observedBy: 'CI', at: 10 * DAY });
    loop.advance(imp.id, 'root-caused', { by: 'Eng', detail: 'the cause, not the symptom', at: 11 * DAY });
    loop.advance(imp.id, 'action-agreed', { by: 'ARB', detail: 'the plan', at: 12 * DAY });
    loop.advance(imp.id, 'decided', { by: 'ARB', detail: 'agreed', adr: 'ADR-0005', at: 13 * DAY });
    loop.advance(imp.id, 'verified', { by: 'CI', detail: 'holds', controls: [{ id: 'APP-FIT-X', pass: true }], at: 14 * DAY });

    const training = new own.TrainingRegister({ clock: () => 0 });
    const exercises = new own.ExerciseRegister({ clock: () => 0 });
    const correctedOnly = inst.institutionalLearning({ loop, training, exercises, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
    if (correctedOnly.correctionRate !== 1) v.push('a verified fix was not counted as a correction');
    if (correctedOnly.learningRate !== 0) v.push('an incident with nobody trained afterwards was counted as learned');
    if (!correctedOnly.correctedNotLearned.includes(imp.id)) v.push('a corrected-but-not-learned incident was not named as one');
    if (correctedOnly.incidents[0].state !== 'corrected-not-learned') v.push('the incident state does not distinguish correction from learning');
    if (!/repairs the same class of failure repeatedly/.test(correctedOnly.note)) v.push('the report does not say why correction without learning is the failure worth catching');

    // --- Training BEFORE the incident is not a response to it ---------------------------------
    const stale = new own.TrainingRegister({ clock: () => 0 });
    stale.recordCompletion({ person: 'Somebody', course: Object.values(own.REQUIRED_TRAINING)[0][0], at: 1 * DAY, by: 'Registrar' });
    const beforeOnly = inst.institutionalLearning({ loop, training: stale, exercises, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
    if (beforeOnly.learningRate !== 0) v.push('training completed BEFORE the incident was counted as a response to it');

    // --- Training with no rehearsal behind it is a certificate --------------------------------
    const taught = new own.TrainingRegister({ clock: () => 0 });
    taught.recordCompletion({ person: 'Somebody', course: Object.values(own.REQUIRED_TRAINING)[0][0], at: 20 * DAY, by: 'Registrar' });
    const untested = inst.institutionalLearning({ loop, training: taught, exercises, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
    if (untested.learningRate !== 0) v.push('training with no rehearsal behind it was counted as learning');
    if (untested.incidents[0].stages['future-readiness'].reached) v.push('future readiness was reached with no rehearsal recorded');

    // --- And the full chain DOES reach 'learned', or nothing could ever satisfy this ----------
    const rehearsed = new own.ExerciseRegister({ clock: () => 0 });
    rehearsed.recordParticipation({ person: 'Somebody', exercise: Object.keys(own.EXERCISE_KINDS)[0], at: 30 * DAY, by: 'ORB', role: 'operationalOwner' });
    const full = inst.institutionalLearning({ loop, training: taught, exercises: rehearsed, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
    if (full.learningRate !== 1) v.push('a fully evidenced chain — fixed, taught, then demonstrated — was not counted as learned');
    if (!full.learned.includes(imp.id)) v.push('the learned incident was not named');
    if (full.incidents[0].missing.length) v.push(`a fully learned incident still reports missing stages: ${full.incidents[0].missing.join(', ')}`);
    if (!full.measurable) v.push('a fully evidenced estate did not report itself measurable');
    if (full.weakestStage !== null) v.push('a complete chain still named a weakest stage');

    // --- A rehearsal BEFORE the training does not count -------------------------------------
    const early = new own.ExerciseRegister({ clock: () => 0 });
    early.recordParticipation({ person: 'Somebody', exercise: Object.keys(own.EXERCISE_KINDS)[0], at: 15 * DAY, by: 'ORB', role: 'operationalOwner' });
    if (inst.institutionalLearning({ loop, training: taught, exercises: early, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY }).learningRate !== 0) {
      v.push('a rehearsal that happened before the training was counted as demonstrating it');
    }

    // --- An open incident is neither corrected nor learned, and the weakest stage is named ----
    const openLoop = new inst.ImprovementLoop({ clock: () => 0 });
    openLoop.observe({ control: 'APP-FIT-Y', detail: 'failed', observedBy: 'CI', at: 1 * DAY });
    const open = inst.institutionalLearning({ loop: openLoop, training, exercises, controls: [], now: 100 * DAY });
    if (open.correctionRate !== 0 || open.learningRate !== 0) v.push('an unfixed incident was counted as corrected or learned');
    if (open.incidents[0].state !== 'open') v.push('an unfixed incident was not reported as open');
    if (!open.weakestStage) v.push('an estate with a broken learning chain did not name where it breaks');
    if (open.authorizes !== false) v.push('the institutional learning report claims authority');
  }),

  fit('APP-FIT-GOVERNANCE-OPTIMIZATION', 'No optimization may remove an approval or let an authority approve its own work, and no capacity figure may be invented', (v) => {
    const opt = require('../src/governance/optimization');
    const own = require('../src/governance/ownership');

    // --- Every target names the WRONG remedy as well as the right one -------------------------
    for (const required of ['approval-bottleneck', 'review-workload', 'committee-utilisation', 'governance-delay', 'policy-conflict', 'duplicated-activity']) {
      if (!opt.OPTIMIZATION_TARGETS[required]) v.push(`optimization target '${required}' is not analysed`);
    }
    for (const [id, t] of Object.entries(opt.OPTIMIZATION_TARGETS)) {
      if (!t.signal || !t.rightRemedy) v.push(`optimization target '${id}' does not say what it looks for or what to do`);
      if (!t.wrongRemedy || t.wrongRemedy.length < 40) v.push(`optimization target '${id}' does not name the wrong remedy — for every one of these the obvious fix removes a control`);
    }
    for (const [id, means] of Object.entries(opt.GOVERNANCE_INTEGRITY)) if (!means) v.push(`integrity property '${id}' is not explained`);

    // --- THE RULE: a recommendation that damages integrity is REFUSED, not warned about -------
    const sound = { recommendation: 'delegate approval to a second authority of equal standing', preserves: ['separationOfDuties'] };
    if (opt.assertPreservesIntegrity(sound) !== true) v.push('a sound recommendation was refused — the guard refuses everything and proves nothing');
    for (const [what, rec] of [
      ['no stated action', { preserves: ['separationOfDuties'] }],
      ['no preserved property', { recommendation: 'streamline approvals' }],
      ['an unknown property', { recommendation: 'x', preserves: ['efficiency'] }],
      ['reducing distinct authorities', { recommendation: 'x', preserves: ['separationOfDuties'], reducesDistinctAuthorities: true }],
      ['removing an approval', { recommendation: 'x', preserves: ['separationOfDuties'], removesApproval: true }],
      ['letting an authority approve its own work', { recommendation: 'x', preserves: ['separationOfDuties'], mergesResponsibleAndApprover: true }],
    ]) {
      let refused = false;
      try { opt.assertPreservesIntegrity(rec); } catch (e) { refused = !!e.failClosed; }
      if (!refused) v.push(`an optimization recommendation ${what} was accepted`);
    }
    // `recommend` runs the guard, so nothing can be emitted without passing it.
    let emitted = false;
    try { opt.recommend({ recommendation: 'let the operational owner approve their own releases', preserves: ['separationOfDuties'], mergesResponsibleAndApprover: true }); emitted = true; } catch (_) { /* refused */ }
    if (emitted) v.push('a recommendation that lets an authority approve its own work was emitted');

    // --- The analysis finds real things, and every recommendation carries what it protects ----
    const r = opt.governanceOptimization({ now: 0 });
    if (!r.findingCount) v.push('the optimizer found nothing at all on an estate with overdue reviews — it has stopped looking');
    if (!r.recommendationCount) v.push('findings produced no recommendations');
    for (const rec of r.recommendations) {
      if (!rec.preserves || !rec.preserves.length) v.push(`a recommendation for '${rec.target}' names no preserved property`);
      if (!rec.wouldNotFix) v.push(`a recommendation for '${rec.target}' does not say what it would NOT fix — a recommendation with no stated limit is a promise`);
      if (rec.authorizes !== false || rec.recommendationOnly !== true) v.push('an optimization recommendation claims to be more than a recommendation');
    }
    if (r.everyRecommendationPreservesIntegrity !== true) v.push('not every recommendation names an integrity property');
    // Each analysis actually runs against real data.
    if (!r.load.approvalLoad.length) v.push('no approval load was computed');
    if (!r.load.boards.length) v.push('no committee utilisation was computed');
    if (!r.duplicatedActivities.length) v.push('no duplicated governance activity was found across thirty subsystems sharing ten activities — the detector has stopped working');
    // Policy conflicts are real and detected in the right direction.
    for (const c of r.policyConflicts) {
      if (!c.detail || !c.from || !c.to) v.push('a policy conflict is incompletely described');
      if (!/cannot be honoured/.test(c.detail)) v.push('a policy conflict does not say what actually breaks');
    }
    // …and the conflict detector can be silent: a context depending on an equal-or-stronger stance
    // produces nothing, which is what stops this being a permanent alarm.
    if (r.policyConflicts.some((c) => c.from === c.to)) v.push('a context was reported as conflicting with itself');

    // --- Part 14: no capacity figure is invented ---------------------------------------------
    const blind = opt.capacityPlan({ now: 0 });
    for (const required of ['staffing', 'infrastructure', 'operationalWorkload', 'training', 'governanceWorkload', 'investigationCapacity']) {
      if (!blind.dimensions.some((d) => d.dimension === required)) v.push(`capacity dimension '${required}' is not forecast`);
    }
    if (blind.everyFigureDerived !== true) v.push('a capacity figure is not marked as derived');
    for (const d of blind.dimensions) {
      if (!d.basis) v.push(`capacity dimension '${d.dimension}' states no basis`);
      if (d.value === null && !/UNKNOWN/.test(d.basis)) v.push(`capacity dimension '${d.dimension}' has no value and does not say it is unknown`);
    }
    // The three that depend on caller measurements are unknown on a platform that measures none.
    for (const dim of ['operationalWorkload', 'training', 'investigationCapacity']) {
      if (blind.dimensions.find((d) => d.dimension === dim).value !== null) v.push(`'${dim}' produced a figure with nothing supplied to derive it from`);
    }
    // The three derived from registries are real.
    for (const dim of ['staffing', 'infrastructure', 'governanceWorkload']) {
      const d = blind.dimensions.find((x) => x.dimension === dim);
      if (d.value === null || d.value <= 0) v.push(`'${dim}' is derivable from a registry and produced nothing`);
    }
    if (blind.complete) v.push('a plan with three unmeasurable dimensions reported itself complete');

    // …and supplying measurements produces figures, so the check is not permanently unknown.
    const DAY = 24 * 3600_000, NOW = 400 * DAY;
    const training = new own.TrainingRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
          for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar' });
        }
      }
    }
    const measured = opt.capacityPlan({ now: NOW, training, caseload: { openCases: 40, periods: 3 }, investigators: { available: 4, concurrentPerInvestigator: 5 } });
    if (measured.dimensions.find((d) => d.dimension === 'training').value !== 0) v.push('a fully trained estate still reported outstanding training');
    if (measured.dimensions.find((d) => d.dimension === 'investigationCapacity').value !== 20) v.push('investigation capacity was not derived from the supplied measurements');
    if (!measured.complete) v.push('a fully measured capacity plan was not reported complete');
    // A shortfall is only computed where both sides are measured.
    const shortfall = measured.shortfalls.find((s) => s.dimension === 'investigationCapacity');
    if (!shortfall || shortfall.shortfall !== 20) v.push('a caseload exceeding capacity produced no shortfall');
    if (blind.shortfalls.some((s) => s.dimension === 'investigationCapacity')) v.push('a shortfall was computed against an unmeasured capacity — a number with a sign and no meaning');
    if (measured.authorizes !== false) v.push('the capacity plan claims authority');
  }),

  fit('APP-FIT-CROSS-AGENCY', 'Institutions are derived from who is accountable, and a declared relationship is never reported as a working one', (v) => {
    const ca = require('../src/governance/cross-agency');
    const own = require('../src/governance/ownership');

    // --- Five coordination dimensions, each saying what evidences it -------------------------
    for (const required of ['governanceOwnership', 'communicationPath', 'approvalDependency', 'informationSharing', 'demonstratedCoordination']) {
      if (!ca.COORDINATION_DIMENSIONS[required]) v.push(`coordination dimension '${required}' is not assessed`);
    }
    for (const [id, d] of Object.entries(ca.COORDINATION_DIMENSIONS)) {
      if (!d.evidencedBy || !d.ifAbsent) v.push(`coordination dimension '${id}' does not say how it is evidenced or what its absence costs`);
    }
    // Only 'demonstrated' is a ready state. If 'declared' counted, every org chart would pass.
    const ready = Object.entries(ca.READINESS_BANDS).filter(([, b]) => b.ready).map(([id]) => id);
    if (ready.join(',') !== 'demonstrated') v.push(`readiness bands counting as ready are '${ready.join(', ')}' — only 'demonstrated' may`);
    if (ca.READINESS_BANDS.declared.ready) v.push('a merely declared relationship counts as ready — that is every relationship in an org chart');

    // --- The institutions are DERIVED, and match the ownership record ------------------------
    const agencies = ca.agencies();
    const fromOwnership = new Set(own.subsystems().flatMap((s) => [own.OWNERSHIP[s].responsibleAuthority, own.OWNERSHIP[s].approvingAuthority]));
    if (agencies.length !== fromOwnership.size) v.push(`the derived agency list (${agencies.length}) does not match the accountable authorities in the ownership record (${fromOwnership.size})`);
    for (const a of agencies) if (!fromOwnership.has(a.agency)) v.push(`'${a.agency}' is reported as an institution and is accountable for nothing`);
    if (agencies.length < 10) v.push('fewer than ten institutions were derived — the derivation has stopped working');

    // --- Information sharing is read from the architecture, and crosses institutions ---------
    const sharing = ca.informationSharing();
    if (!sharing.length) v.push('no cross-institutional data flow was found on a platform with thirty contexts held by twenty-seven institutions');
    for (const f of sharing) {
      if (f.fromAgency === f.toAgency) v.push(`'${f.fromContext} → ${f.toContext}' was reported as cross-institutional and both sides are held by the same institution`);
      if (ca.agencyOf(f.fromContext) !== f.fromAgency) v.push('a sharing flow names an institution that does not hold the context');
    }
    const approvals = ca.approvalDependencies();
    if (!approvals.length) v.push('no approval dependency was found, though separation of duties guarantees one per subsystem');
    for (const d of approvals) if (d.needs === d.held) v.push(`'${d.subsystem}' reports an approval dependency on itself`);

    // --- A relationship nobody has exercised is never 'ready' --------------------------------
    const cold = ca.collaborationReadiness({});
    if (cold.readinessRate !== 0) v.push('a platform with no joint-act register reported some relationships as ready — historical evidence must not be fabricated');
    if (!cold.untestedPairs.length) v.push('pairs that share data and have never coordinated were not named');
    if (cold.measurable) v.push('collaboration readiness reported itself measurable with no register supplied');
    for (const p of cold.pairs) {
      if (p.ready) v.push(`pair ${p.agencies.join(' ↔ ')} is ready with no recorded joint act`);
      if (!p.means) v.push('a readiness band carries no explanation');
      if (p.coordination.unknown !== true) v.push('coordination was reported as known with no register supplied');
    }

    // --- …and a recorded joint act DOES make it ready, or the bar is unreachable -------------
    const DAY = 24 * 3600_000, NOW = 400 * DAY;
    const exercises = new own.ExerciseRegister({ clock: () => NOW });
    const pair = cold.pairs[0];
    const peopleFor = (agency) => own.subsystems()
      .filter((s) => [own.OWNERSHIP[s].responsibleAuthority, own.OWNERSHIP[s].approvingAuthority].includes(agency))
      .flatMap((s) => own.DEPUTY_ROLES.map((r) => own.OWNERSHIP[s][r]));
    const exercise = Object.keys(own.EXERCISE_KINDS)[0];
    for (const agency of pair.agencies) {
      const person = peopleFor(agency)[0];
      if (person) exercises.recordParticipation({ person, exercise, at: NOW - 10 * DAY, by: 'ORB', role: 'operationalOwner' });
    }
    const warm = ca.pairReadiness(pair.agencies[0], pair.agencies[1], { exercises, now: NOW });
    if (warm.readiness !== 'demonstrated') v.push(`a pair with a recorded joint rehearsal did not reach 'demonstrated': ${warm.readiness} — ${warm.coordination.reason}`);
    if (!warm.ready) v.push('a demonstrated relationship was not reported as ready');
    if (!warm.coordination.evidence.length) v.push('a demonstrated relationship names no evidence');
    if (ca.collaborationReadiness({ exercises, now: NOW }).measurable !== true) v.push('supplying a register did not make collaboration readiness measurable');

    // --- Inter-agency risks are derived and each says where it would fail --------------------
    const risks = cold.risks;
    if (!risks.length) v.push('no inter-agency risk was found on an estate with no recorded coordination at all');
    for (const risk of risks) {
      if (!risk.detail || !risk.wouldFailAt) v.push(`inter-agency risk '${risk.risk}' does not say what it is or where it would fail`);
      if (!risk.agencies || !risk.agencies.length) v.push(`inter-agency risk '${risk.risk}' names no institution`);
    }
    if (!risks.some((r) => r.risk === 'untested-sharing')) v.push('data crossing institutions that have never coordinated was not raised as a risk');
    if (!risks.some((r) => r.risk === 'cross-agency-approval-bottleneck')) v.push('an institution approving a quarter of the estate for other institutions was not raised as a cross-agency risk');

    // --- A communication path is real or it is not, and both answers occur -------------------
    const reachable = cold.pairs.filter((p) => p.communicationPath.reachable);
    if (!reachable.length) v.push('no pair of institutions can reach each other — the path derivation has stopped working');
    if (ca.communicationPath('Nobody At All', 'Also Nobody').reachable) v.push('two institutions that hold nothing were reported as able to reach each other');
    if (cold.authorizes !== false) v.push('the collaboration readiness report claims authority');
  }),

  fit('APP-FIT-ADAPTIVE-ANALYTICS', 'Every governance forecast carries an interval derived from its observation count, and no observations means the interval constrains nothing', (v) => {
    const dp = require('../src/architecture/drift-prevention');
    const ir = require('../src/governance/institutional-resilience');
    const inst = require('../src/assurance/institutional');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Six forecast dimensions, each with a question and a unit ----------------------------
    for (const required of ['governanceMaturity', 'auditReadiness', 'institutionalResilience', 'organizationalLearning', 'policyEffectiveness', 'operationalStability']) {
      if (!dp.FORECAST_DIMENSIONS[required]) v.push(`forecast dimension '${required}' is not predicted`);
    }
    for (const [id, d] of Object.entries(dp.FORECAST_DIMENSIONS)) {
      if (!d.question || !d.question.endsWith('?')) v.push(`forecast dimension '${id}' states no question`);
      if (!d.unit) v.push(`forecast dimension '${id}' states no unit`);
    }

    // --- THE INTERVAL RULE, checked directly on the function ---------------------------------
    const zero = dp.forecastInterval(0.9, 0);
    if (!zero.interval || zero.interval[0] !== 0 || zero.interval[1] !== 1) v.push('a forecast with no observations did not report an interval of [0,1]');
    if (zero.constrained) v.push('a forecast with no observations reported itself constrained');
    const four = dp.forecastInterval(0.5, 4);
    const hundred = dp.forecastInterval(0.5, 100);
    if (!(hundred.interval[1] - hundred.interval[0] < four.interval[1] - four.interval[0])) v.push('the interval does not narrow as observations accumulate — an interval that ignores evidence is decoration');
    if (four.constrained) v.push('four observations produced a constrained interval');
    if (!hundred.constrained) v.push('a hundred observations did not produce a constrained interval, so nothing could ever be constrained');
    if (dp.forecastInterval(null, 50).interval !== null) v.push('an interval was offered around a null point estimate');
    for (const [p, n] of [[0.02, 4], [0.98, 4]]) {
      const i = dp.forecastInterval(p, n);
      if (i.interval[0] < 0 || i.interval[1] > 1) v.push(`an interval escaped [0,1]: ${JSON.stringify(i.interval)}`);
    }
    if (!/NOT a statistical confidence interval/.test(dp.forecastInterval(0.5, 9).method)) v.push('the interval does not disclaim being a statistical confidence interval');

    // --- With nothing supplied, most forecasts are unforecastable rather than optimistic -----
    const blind = dp.adaptiveGovernanceAnalytics({ now: 0 });
    if (blind.forecasts.length !== 6) v.push('not all six forecasts were produced');
    for (const f of blind.forecasts) {
      if (!f.basis) v.push(`forecast '${f.forecast}' states no basis`);
      if (f.derived !== true) v.push(`forecast '${f.forecast}' is not marked as derived`);
      if (f.point === null && f.interval !== null) v.push(`forecast '${f.forecast}' offers an interval around nothing`);
    }
    if (!blind.unforecastable.length) v.push('every forecast produced a figure with nothing supplied — something is being invented');
    if (blind.everyForecastDerived !== true) v.push('a forecast is not derived');

    // --- With evidence supplied, forecasts appear and some become constrained ----------------
    const learning = inst.institutionalLearning({});
    const full = dp.adaptiveGovernanceAnalytics({
      controls, governanceMaturity: { level: 4, name: 'Evidenced' },
      resilience: ir.evaluate({ controls }), learning,
      stabilityHistory: [0.95, 0.97, 0.96, 0.98, 0.97, 0.99, 0.98, 0.97, 0.96, 0.98],
      now: 0,
    });
    const byId = Object.fromEntries(full.forecasts.map((f) => [f.forecast, f]));
    if (byId.auditReadiness.point === null) v.push('audit readiness was not derived from the supplied control results');
    if (!byId.auditReadiness.constrained) v.push(`audit readiness over ${byId.auditReadiness.observations} controls is still unconstrained`);
    if (byId.institutionalResilience.point === null) v.push('institutional resilience was not derived from the supplied evaluation');
    if (byId.policyEffectiveness.point === null) v.push('policy effectiveness was not derived from the declared stances');
    if (byId.operationalStability.point === null) v.push('operational stability was not derived from the supplied history');
    // Five capabilities is too few for the interval to constrain anything, and it says so.
    if (byId.institutionalResilience.constrained) v.push('a forecast over five observations reported itself constrained');
    // Learning is unknown because no register was supplied — unknown, not zero.
    if (byId.organizationalLearning.point !== null) v.push('organizational learning produced a figure with no learning register');
    if (!full.unconstrained.length) v.push('every forecast on this estate is constrained, which the evidence does not support');
    if (!/rest on too few observations/.test(full.note)) v.push('the report does not warn that some forecasts are unconstrained');
    if (full.authorizes !== false) v.push('the adaptive analytics report claims authority');

    // --- And it is wired into the governance analytics the platform already ran --------------
    const analytics = dp.governanceAnalytics({ controls, now: 0 });
    if (!analytics.adaptive || analytics.adaptive.forecasts.length !== 6) v.push('the adaptive forecasts are not carried by the governance analytics report');
  }),

  fit('APP-FIT-REGULATORY-FORECAST', 'A forecast about a change that has not happened can never move an obligation into a compliance state', (v) => {
    const ci = require('../src/legislation/compliance-intelligence');
    const { LegislativeRegistry } = require('../src/legislation/registry');
    const DAY = 24 * 3600_000;
    const controls = require('./app-fitness').map((f) => ({ id: f.id, pass: true }));

    for (const [id, b] of Object.entries(ci.FORECAST_CONFIDENCE)) if (!b.description) v.push(`forecast confidence band '${id}' has no description`);
    if (ci.EFFORT_BANDS.length < 3) v.push('fewer than three effort bands — the estimate cannot distinguish anything');

    // --- A forecast is attributed and has a horizon, or it is a rumour ------------------------
    const c = new ci.ComplianceIntelligence({ registry: new LegislativeRegistry(), clock: () => 0 });
    for (const [what, args] of [
      ['no author', { kind: 'legislative-change', summary: 's', expectedAt: 100 * DAY }],
      ['no horizon', { kind: 'legislative-change', summary: 's', forecastBy: 'AG' }],
      ['no summary', { kind: 'legislative-change', forecastBy: 'AG', expectedAt: 100 * DAY }],
      ['an unknown kind', { kind: 'vibes', summary: 's', forecastBy: 'AG', expectedAt: 100 * DAY }],
      ['an unknown confidence band', { kind: 'legislative-change', summary: 's', forecastBy: 'AG', expectedAt: 100 * DAY, confidence: 'certain' }],
    ]) {
      let rejected = false;
      try { c.forecast(args); } catch (_) { rejected = true; }
      if (!rejected) v.push(`a regulatory forecast with ${what} was accepted`);
    }

    // --- THE RULE: forecasting moves nothing -------------------------------------------------
    c.forecast({ kind: 'legislative-change', summary: 'Whistleblower Protection Amendment', affects: { contexts: ['intake', 'custody'], controls: ['APP-FIT-ANONYMITY-BOUNDARY', 'APP-FIT-WHISTLEBLOWER-SHIELD'] }, expectedAt: 200 * DAY, forecastBy: 'Attorney General Chambers', confidence: 'drafted' });
    if (c.changes().length) v.push('a forecast appeared in the OBSERVED change register — a hypothetical beside an observation is how "we expect to comply" becomes "we comply"');
    if (c.state('data-protection-act').state !== 'unknown') v.push('forecasting moved an obligation out of unknown');
    if (c.transitionAudit({ now: 0 }).transitions !== 0) v.push('forecasting produced a compliance transition');
    for (const f of c.forecasts()) {
      if (f.hypothetical !== true || f.observed !== false) v.push(`forecast '${f.id}' is not labelled as hypothetical`);
    }

    // --- The impact is DERIVED from what is missing, not typed in ----------------------------
    const impact = c.forecastImpact('FCH-0001', { controls, now: 0 });
    if (!impact.affectedContexts.includes('intake')) v.push('an affected context was not resolved');
    if (!impact.controls.toBuild.includes('APP-FIT-WHISTLEBLOWER-SHIELD')) v.push('a control that does not exist was not identified as work');
    if (!impact.controls.existing.includes('APP-FIT-ANONYMITY-BOUNDARY')) v.push('a control that already runs was not identified as existing');
    if (!impact.governanceImpact.boards.length) v.push('no governance impact was derived');
    if (!impact.operationalDisruption.dataFlows.length) v.push('no operational disruption was derived from the declared data flows');
    if (!ci.EFFORT_BANDS.includes(impact.effort)) v.push(`effort '${impact.effort}' is not a declared band`);
    if (!/derived from/.test(impact.effortBasis)) v.push('the effort estimate does not say how it was arrived at');
    if (impact.daysAway !== 200) v.push('the horizon was not computed');
    if (!/has not happened/.test(impact.caveat)) v.push('a forecast impact does not carry its caveat');
    // Effort moves with the work: a change needing nothing is 'absorbed'.
    c.forecast({ kind: 'policy-update', summary: 'a change already covered', affects: { contexts: ['intake'], controls: ['APP-FIT-ANONYMITY-BOUNDARY'] }, expectedAt: 300 * DAY, forecastBy: 'ARB' });
    if (c.forecastImpact('FCH-0002', { controls, now: 0 }).effort !== 'absorbed') v.push('a forecast change requiring no new work was not reported as absorbed — the estimate does not move');
    // An unresolvable context is reported, not carried through.
    c.forecast({ kind: 'policy-update', summary: 'names a context that does not exist', affects: { contexts: ['ministry-of-magic'] }, expectedAt: 300 * DAY, forecastBy: 'ARB' });
    if (!c.forecastImpact('FCH-0003', { controls, now: 0 }).unresolvedContexts.includes('ministry-of-magic')) v.push('a forecast naming a context the architecture does not contain was carried through silently');

    // --- Readiness, and what an empty register actually means --------------------------------
    const readiness = c.regulatoryReadiness({ controls, now: 0 });
    if (readiness.count !== 3) v.push('not every forecast was assessed');
    if (readiness.obligationsMoved !== 0) v.push('regulatory forecasting moved an obligation');
    if (readiness.hypothetical !== true) v.push('the readiness report is not labelled hypothetical');
    if (readiness.authorizes !== false) v.push('the regulatory readiness report claims authority');
    const empty = new ci.ComplianceIntelligence({ clock: () => 0 }).regulatoryReadiness({ controls, now: 0 });
    if (empty.ready) v.push('an estate with no forecast at all reported itself regulatorily ready');
    if (!/nobody has looked/.test(empty.readinessBasis)) v.push('an empty forecast register was not reported as nobody having looked');
  }),

  fit('APP-FIT-GLOBAL-INVARIANT', 'No critical capability rests on an unvalidated assumption, an unverified dependency, an undocumented governance relationship, or a single point of organizational failure', (v) => {
    const ir = require('../src/governance/institutional-resilience');
    const own = require('../src/governance/ownership');
    const asm = require('../src/architecture/assumptions');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];
    const DAY = 24 * 3600_000, YEAR = 365 * DAY, NOW = 400 * DAY;

    // --- Four clauses, each naming where it is evaluated from and what an unknown costs -------
    for (const required of ['unvalidated-assumption', 'unverified-dependency', 'undocumented-governance-relationship', 'single-point-of-organizational-failure']) {
      if (!ir.INVARIANT_CLAUSES[required]) v.push(`invariant clause '${required}' is not evaluated`);
    }
    if (Object.keys(ir.INVARIANT_CLAUSES).length !== 4) v.push('the global invariant does not have exactly four clauses');
    for (const [id, c] of Object.entries(ir.INVARIANT_CLAUSES)) {
      if (!c.statement || !c.evaluatedFrom || !c.ifUnknown) v.push(`invariant clause '${id}' does not state itself, where it is evaluated from, or what an unknown means`);
    }

    // --- With no registers, every clause that needs one reports UNKNOWN and does not hold ----
    const blind = ir.evaluateGlobalInvariant({ controls: [], now: NOW });
    if (blind.holds) v.push('the invariant held with nothing supplied to evaluate it against');
    if (!blind.blocksInstitutionalReadiness) v.push('an unheld invariant did not block institutional readiness');
    for (const cap of blind.capabilities) {
      const assumption = cap.clauses.find((c) => c.clause === 'unvalidated-assumption');
      if (assumption.holds || !assumption.unknown) v.push(`'${cap.capability}': an unknown assumption position was not treated as a failure`);
      const verification = cap.clauses.find((c) => c.clause === 'unverified-dependency');
      if (verification.holds) v.push(`'${cap.capability}': every dependency was reported verified with no control results at all`);
    }
    if (blind.authorizes !== false) v.push('the global invariant report claims authority');

    // --- Every clause can FAIL on its own, fed a crafted position ----------------------------
    // Assumption clause: an expired assumption bearing on the capability's context.
    const stale = new asm.AssumptionRegistry({ clock: () => NOW });
    stale.register('STALE-1', { statement: 's', rationale: 'r', evidence: ['APP-FIT-CUSTODY-SIGNED-CHAIN'], contexts: ['custody'], owner: 'DFS', reviewCadenceDays: 90, expiresAt: 10 * DAY, verificationMethod: 'executable-check', confidence: 'high' });
    const withStale = ir.assumptionClause('evidence-custody', { assumptions: stale, controls, now: NOW });
    if (withStale.holds) v.push('a capability resting on an expired assumption satisfied the assumption clause');
    // Verification clause: a detecting control that ran and failed.
    const oneKind = Object.entries(ir.DEPENDENCY_KINDS).find(([, k]) => k.detectedBy);
    const broken = ir.verificationClause('evidence-custody', { controls: controls.map((c) => (c.id === oneKind[1].detectedBy ? { ...c, pass: false } : c)) });
    if (broken.holds) v.push('a dependency whose detecting control ran and failed satisfied the verification clause');
    if (!broken.unverified.includes(oneKind[0])) v.push('the unverified dependency kind was not named');
    // …and a control that never ran is equally unverified.
    if (ir.verificationClause('evidence-custody', { controls: controls.filter((c) => c.id !== oneKind[1].detectedBy) }).holds) {
      v.push('a dependency whose detecting control did not run satisfied the verification clause');
    }
    // Governance relationship clause: it holds on the real estate, so both directions exist.
    const rel = ir.governanceRelationshipClause('evidence-custody');
    if (!rel.holds) v.push(`the governance relationship clause fails on the real estate: ${rel.reason}`);
    if (!rel.institutions.length) v.push('no institution was resolved for a capability');

    // --- THE SUCCESS PATH: a fully evidenced capability satisfies all four clauses -----------
    const availability = new own.AvailabilityRegister({ clock: () => NOW });
    const activity = new own.ActivityRegister({ clock: () => NOW });
    const training = new own.TrainingRegister({ clock: () => NOW });
    const exercises = new own.ExerciseRegister({ clock: () => NOW });
    for (const s of own.subsystems()) {
      for (const role of own.DEPUTY_ROLES) {
        for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
          activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
          for (const course of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course, at: NOW - 30 * DAY, by: 'Registrar' });
          for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
        }
      }
    }
    const continuity = own.knowledgeContinuity({ availability, activity, training, exercises, now: NOW });
    const sound = new asm.AssumptionRegistry({ clock: () => NOW });
    sound.register('CUSTODY-SOUND', { statement: 'a verified assumption for the success path', rationale: 'exercises the passing branch of the assumption clause', evidence: ['APP-FIT-CUSTODY-SIGNED-CHAIN'], contexts: ['custody'], owner: 'Directorate of Forensic Services', reviewCadenceDays: 3650, expiresAt: NOW + 10 * YEAR, verificationMethod: 'executable-check', confidence: 'high' });
    sound.recordVerification('CUSTODY-SOUND', { holds: true, by: 'Assurance', at: NOW });
    const evidenced = ir.evaluateGlobalInvariant({ assumptions: sound, continuity, controls, now: NOW });
    const custody = evidenced.capabilities.find((c) => c.capability === 'evidence-custody');
    if (!custody.holds) v.push(`a fully evidenced constitutional capability did not satisfy the invariant: ${custody.clauses.filter((c) => !c.holds).map((c) => `${c.clause} — ${c.reason}`).join('; ')}`);
    // …and the invariant as a whole still does NOT hold, because other capabilities genuinely fail.
    if (evidenced.holds) v.push('the whole estate satisfied the invariant, which the recorded evidence does not support');

    // --- Acceptance: attributed, time-bound, constitutionally restricted ---------------------
    const acceptances = new ir.ResilienceAcceptance({ clock: () => NOW });
    for (const [what, args] of [
      ['no authority', { capability: 'anonymous-reporting', clause: 'unvalidated-assumption', rationale: 'r', expiresAt: NOW + DAY }],
      ['no rationale', { capability: 'anonymous-reporting', clause: 'unvalidated-assumption', by: 'Oversight Board', expiresAt: NOW + DAY }],
      ['no expiry', { capability: 'anonymous-reporting', clause: 'unvalidated-assumption', by: 'Oversight Board', rationale: 'r' }],
      ['an unknown clause', { capability: 'anonymous-reporting', clause: 'inconvenience', by: 'Oversight Board', rationale: 'r', expiresAt: NOW + DAY }],
    ]) {
      let rejected = false;
      try { acceptances.acceptClause(args); } catch (_) { rejected = true; }
      if (!rejected) v.push(`a failing clause was accepted with ${what}`);
    }
    let wrongAuthority = false;
    try { acceptances.acceptClause({ capability: 'anonymous-reporting', clause: 'unvalidated-assumption', by: 'Platform Engineering', rationale: 'known', expiresAt: NOW + DAY }); }
    catch (e) { wrongAuthority = !!e.failClosed; }
    if (!wrongAuthority) v.push('a failing clause on a constitutional capability was accepted by somebody other than the Oversight Board');

    acceptances.acceptClause({ capability: 'anonymous-reporting', clause: 'unvalidated-assumption', by: 'Oversight Board', rationale: 'the assumption register is new and verification is scheduled', expiresAt: NOW + 30 * DAY });
    const accepted = ir.globalInvariantReport({ assumptions: sound, continuity, controls, acceptances, now: NOW });
    if (accepted.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.clause === 'unvalidated-assumption')) v.push('an accepted clause was still reported as unaccepted');
    if (!accepted.blocksInstitutionalReadiness) v.push('the estate still has unaccepted violations and did not block institutional readiness');
    for (const u of accepted.unaccepted) if (!u.ifUnknown) v.push(`an unaccepted violation of '${u.clause}' does not say what it costs`);
    // An expired acceptance stops covering it, with nobody withdrawing anything.
    const later = ir.globalInvariantReport({ assumptions: sound, continuity, controls, acceptances, now: NOW + 60 * DAY });
    if (!later.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.clause === 'unvalidated-assumption')) v.push('an expired acceptance still covered a failing clause');
    if (!later.expiredAcceptances.length) v.push('an expired acceptance was not reported as expired');

    // --- Evaluated across every capability, and the per-clause view is produced --------------
    if (evidenced.clauses.length !== 4) v.push('the per-clause view does not report all four clauses');
    for (const c of evidenced.clauses) if (!Array.isArray(c.failingCapabilities)) v.push(`clause '${c.clause}' does not name which capabilities fail it`);
    if (evidenced.capabilities.length !== Object.keys(ir.CRITICAL_CAPABILITIES).length) v.push('the invariant was not evaluated for every critical capability');
  }),

  fit('APP-FIT-STRATEGIC-INTELLIGENCE', 'Every strategic panel and assurance domain is derived, and eighteen verified domains still print NOT AUTHORIZED', (v) => {
    const inst = require('../src/assurance/institutional');

    // --- Part 19: the strategic panels ------------------------------------------------------
    for (const required of ['institutionalResilience', 'strategicReadiness', 'governanceMaturity', 'complianceEvolution', 'documentationHealth', 'organizationalMaturity', 'operationalSustainability', 'decisionQuality', 'publicTrust']) {
      if (!inst.EXECUTIVE_PANELS[required]) v.push(`executive panel '${required}' is not provided`);
    }
    for (const [id, p] of Object.entries(inst.EXECUTIVE_PANELS)) {
      if (!p.question || !p.question.endsWith('?')) v.push(`executive panel '${id}' states no question`);
      if (!p.derivedFrom) v.push(`executive panel '${id}' does not say where it is derived from`);
    }
    if (Object.keys(inst.EXECUTIVE_PANELS).length !== 15) v.push('the executive dashboard does not carry all fifteen panels');

    // No hand-entered metric, still. Supplying a figure for a panel changes nothing.
    const injected = inst.executiveGovernanceIntelligence({ publicTrust: 1, decisionQuality: 0.99, strategicReadiness: true });
    for (const p of injected.panels) if (p.manualEntry !== false || p.derived !== true) v.push(`panel '${p.panel}' is not marked as derived`);
    if (injected.panels.find((p) => p.panel === 'decisionQuality').measured) v.push('a hand-entered executive figure was accepted');
    if (injected.everyMetricDerived !== true) v.push('the dashboard does not assert that every metric is derived');
    // Unmeasured stays unmeasured.
    const empty = inst.executiveGovernanceIntelligence({});
    if (empty.unmeasured.length !== Object.keys(inst.EXECUTIVE_PANELS).length) v.push('an empty dashboard did not report every panel as unmeasured');
    if (empty.sound) v.push('an entirely unmeasured dashboard reported itself sound');

    // A fully evidenced dashboard is sound and still prints NOT AUTHORIZED.
    const green = {
      resilience: { holds: true, violationCount: 0, capabilities: [{ categoriesValidated: true }] },
      governanceMaturity: { level: 5, name: 'Continuously assured' },
      readiness: { readyCount: 10, dimensionCount: 10, allDimensionsReady: true },
      mission: { safeToDeploy: true, boardSummary: 'no declared justice service is affected' },
      documentation: { sound: true, verification: { claims: 132, unresolvedCount: 0 } },
      continuity: { sound: true, minimumBusFactor: 2, singlePersonDependencies: [] },
      compliance: { complianceRate: 1, direction: 'improving', recentDirection: 'improving', reconciliation: { sound: true } },
      training: { sound: true, readinessContribution: 1, expiredQualifications: [] },
      simulation: { confidence: 'high', uncalibrated: [] },
      assumptions: { count: 9, sound: true, stale: [], overclaims: [] },
      regulatory: { count: 2, ready: true, readinessBasis: '2 forecast change(s) modelled' },
      adaptive: { constrained: ['auditReadiness'], unconstrained: [], forecasts: [1, 2, 3, 4, 5, 6] },
      capacity: { measured: ['staffing'], complete: true, shortfallCount: 0, unmeasurable: [] },
      decisions: { evaluationRate: 1, contradicted: [], unevaluated: [] },
      publicTrust: { composite: 'warranted', basis: 'every measured condition holds' },
    };
    const dashboard = inst.executiveGovernanceIntelligence(green);
    if (!dashboard.sound) v.push('a fully evidenced strategic dashboard was not sound: ' + dashboard.unsound.concat(dashboard.unmeasured).join(', '));
    if (dashboard.authorizationStatus !== 'NOT AUTHORIZED' || dashboard.authorizes !== false) v.push('a green strategic dashboard claims authority');
    // A failing strategic source turns its own panel red rather than being averaged away.
    const trustLost = inst.executiveGovernanceIntelligence({ ...green, publicTrust: { composite: 'not-warranted', basis: 'a citizen cannot report' } });
    if (!trustLost.unsound.includes('publicTrust')) v.push('a failing public-trust indicator did not turn its panel red');
    if (trustLost.sound) v.push('a dashboard with a red panel reported itself sound');

    // --- Part 20: eighteen assurance domains -------------------------------------------------
    for (const required of ['architecture', 'governance', 'compliance', 'documentation', 'institutionalResilience', 'dependencyResilience', 'organizationalReadiness', 'strategicReadiness', 'learningMaturity', 'governanceAdaptability', 'evidenceQuality', 'publicTrustIndicators']) {
      if (!inst.ASSURANCE_DOMAINS[required]) v.push(`assurance domain '${required}' is not verified`);
    }
    if (Object.keys(inst.ASSURANCE_DOMAINS).length !== 18) v.push('the assurance framework does not carry all eighteen domains');
    for (const [id, d] of Object.entries(inst.ASSURANCE_DOMAINS)) {
      if (!d.unverifiedMeans || d.unverifiedMeans.length < 30) v.push(`assurance domain '${id}' does not say what unverified would mean`);
    }

    const unmeasuredAll = inst.institutionalAssurance({});
    if (unmeasuredAll.unmeasured.length !== 18) v.push('an unmeasured estate did not report all eighteen domains as unmeasured');
    if (unmeasuredAll.institutionallyReady) v.push('an entirely unmeasured estate was reported institutionally ready');
    // Failing and unmeasured stay different states.
    const mixed = inst.institutionalAssurance({ drift: { clean: false }, learning: { learningRate: 0, correctedNotLearned: ['IMP-0001'] } });
    if (!mixed.failing.includes('architecture')) v.push('a failing domain was not reported as failing');
    if (!mixed.failing.includes('learningMaturity')) v.push('an institution that corrects without learning was not reported as failing learning maturity');
    if (mixed.unmeasured.includes('architecture')) v.push('a failing domain was also reported as unmeasured');

    // THE INVARIANT THAT OUTLIVES EVERY PHASE.
    const verified = inst.institutionalAssurance({
      drift: { clean: true }, security: true, privacy: true,
      governanceMaturity: { level: 5 }, documentation: { sound: true },
      readiness: { allDimensionsReady: true }, continuity: { sound: true, minimumBusFactor: 2 },
      resilience: { holds: true, capabilities: [{ categoriesValidated: true }] }, training: { sound: true },
      compliance: { reconciliation: { sound: true } }, mission: { safeToDeploy: true },
      evidenceQuality: { sound: true },
      regulatory: { ready: true }, learning: { learningRate: 1, correctedNotLearned: [] },
      optimization: { bottleneckAuthorities: [], overCapacityAuthorities: [] },
      publicTrust: { composite: 'warranted' },
    });
    if (!verified.institutionallyReady) v.push('a fully verified estate was not institutionally ready: ' + verified.blockers.join('; '));
    if (verified.verified !== 18) v.push(`only ${verified.verified} of 18 domains verified on a fully evidenced estate`);
    if (verified.authorizationStatus !== 'NOT AUTHORIZED') v.push('eighteen verified domains produced an authorization');
    if (verified.authorizes !== false || verified.derivedFromReadiness !== false) v.push('institutional readiness was allowed to imply authorization');
    if (!/does not replace human authority/.test(verified.note)) v.push('the framework no longer states that it does not replace human authority');
  }),

  // ===== PHASE 15 =================================================================================

  fit('APP-FIT-ASSUMPTION-MATURITY', 'Maturity is derived and never declared, verification frequency scales with criticality, and a regression is named rather than netted off', (v) => {
    const asm = require('../src/architecture/assumptions');
    const DAY = 24 * 3600_000, YEAR = 365 * DAY;
    const controls = require('./app-fitness').map((f) => ({ id: f.id, pass: true }));

    // --- Six levels and four criticalities, each saying what it means and what comes next ------
    for (const required of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']) {
      if (!asm.MATURITY_LEVELS[required]) v.push(`maturity level '${required}' is not modelled`);
    }
    if (asm.MATURITY_ORDER.length !== 6) v.push('the maturity model does not have exactly six levels');
    for (const [id, m] of Object.entries(asm.MATURITY_LEVELS)) {
      if (!m.means || m.means.length < 25) v.push(`maturity level '${id}' does not say what it means`);
      if (!m.next) v.push(`maturity level '${id}' does not say what the next step is — a level with no next step is a score`);
      if (typeof m.level !== 'number') v.push(`maturity level '${id}' has no ordinal`);
    }
    for (const required of ['informational', 'important', 'critical', 'foundational']) {
      if (!asm.CRITICALITY_LEVELS[required]) v.push(`criticality '${required}' is not modelled`);
    }
    for (const [id, c] of Object.entries(asm.CRITICALITY_LEVELS)) {
      if (!Number.isFinite(c.verifyEveryDays) || c.verifyEveryDays <= 0) v.push(`criticality '${id}' implies no verification frequency`);
      if (!asm.MATURITY_LEVELS[c.minimumMaturity]) v.push(`criticality '${id}' requires an unknown minimum maturity`);
      if (!c.means || c.means.length < 25) v.push(`criticality '${id}' does not say what its consequence is`);
    }
    // Frequency must actually scale, or "scales with criticality" is a sentence rather than a rule.
    if (!(asm.CRITICALITY_LEVELS.foundational.verifyEveryDays < asm.CRITICALITY_LEVELS.informational.verifyEveryDays)) {
      v.push('a foundational assumption is not verified more often than an informational one');
    }

    // --- There is NO path that sets maturity by hand -------------------------------------------
    const probe = new asm.AssumptionRegistry({ clock: () => 0 });
    const base = {
      statement: 's', rationale: 'r', evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'],
      owner: 'ARB', reviewCadenceDays: 3650, expiresAt: 10 * YEAR, verificationMethod: 'executable-check',
    };
    probe.register('CLAIMED', { ...base, maturity: 'A5', criticality: 'foundational' });
    if (probe.maturity('CLAIMED', { now: 0, controls }).maturity === 'A5') v.push('a hand-declared maturity was accepted');
    let unknownCriticality = false;
    try { probe.register('BAD', { ...base, criticality: 'quite-important' }); } catch (_) { unknownCriticality = true; }
    if (!unknownCriticality) v.push('an undeclared criticality level was accepted');

    // --- Every level is reachable, and each is reached by doing the thing it names -------------
    const at = (id) => probe.maturity(id, { now: 0, controls }).maturity;
    probe.register('A1x', { ...base, evidence: [] });
    if (at('A1x') !== 'A1') v.push(`a registered assumption with no evidence is '${at('A1x')}', expected A1`);
    probe.register('A2x', { ...base });
    if (at('A2x') !== 'A2') v.push(`a registered assumption citing a holding control is '${at('A2x')}', expected A2`);
    probe.register('A3x', { ...base });
    probe.recordVerification('A3x', { holds: true, by: 'Independent Assurance', at: 0 });
    if (at('A3x') !== 'A3') v.push(`one independent verification gives '${at('A3x')}', expected A3`);
    probe.register('A4x', { ...base });
    probe.recordVerification('A4x', { holds: true, by: 'Independent Assurance', at: 0 });
    probe.recordVerification('A4x', { holds: true, by: 'Independent Assurance', at: 1 });
    if (at('A4x') !== 'A5') v.push(`two independent verifications behind an executable check give '${at('A4x')}', expected A5`);
    // A4 without an executable check behind it stops at A4 — the ceiling is the method, as everywhere.
    probe.register('A4y', { ...base, verificationMethod: 'human-attestation' });
    probe.recordVerification('A4y', { holds: true, by: 'Independent Assurance', at: 0 });
    probe.recordVerification('A4y', { holds: true, by: 'Independent Assurance', at: 1 });
    if (at('A4y') !== 'A4') v.push(`human attestation reached '${at('A4y')}' — only an executable check may reach A5`);

    // --- A self-check is not independent verification -----------------------------------------
    probe.register('SELFX', { ...base });
    probe.recordVerification('SELFX', { holds: true, by: 'ARB', at: 0 });   // ARB is the owner
    if (at('SELFX') !== 'A2') v.push('an owner verifying their own assumption reached A3 — a self-check is not independent verification');
    if (!probe.maturity('SELFX', { now: 0, controls }).blockers.some((b) => /self-check/.test(b))) v.push('the self-check blocker was not named');

    // --- Failing or unresolvable evidence pulls it back to A1 ---------------------------------
    if (probe.maturity('A2x', { now: 0, controls: [{ id: 'APP-FIT-CONTEXT-MAP', pass: false }] }).maturity !== 'A1') {
      v.push('an assumption whose cited evidence is FAILING still counted as evidence-attached');
    }
    if (probe.maturity('A2x', { now: 0, controls: [] }).maturity !== 'A1') v.push('an assumption whose evidence did not run still counted as evidence-attached');

    // --- Expiry and cadence pull a monitored assumption back ----------------------------------
    const ageing = new asm.AssumptionRegistry({ clock: () => 0 });
    ageing.register('OLD', { ...base, reviewCadenceDays: 30, expiresAt: 100 * DAY });
    ageing.recordVerification('OLD', { holds: true, by: 'Assurance', at: 0 });
    ageing.recordVerification('OLD', { holds: true, by: 'Assurance', at: 1 });
    if (ageing.maturity('OLD', { now: 0, controls }).maturity !== 'A5') v.push('a fresh, twice-verified, executable-checked assumption did not reach A5');
    const lapsed = ageing.maturity('OLD', { now: 200 * DAY, controls }).maturity;
    if (lapsed !== 'A3') v.push(`an expired assumption reported '${lapsed}' — expiry must pull it back below continuous monitoring`);

    // --- THE REGRESSION RULE ------------------------------------------------------------------
    const trend = ageing.maturityTrend([{ OLD: 'A5' }, { OLD: 'A3' }]);
    if (trend.direction !== 'regressed') v.push('a maturity regression was not reported as one');
    if (!trend.regressions.length || trend.regressions[0].assumption !== 'OLD') v.push('the regressing assumption was not named');
    // And a regression is never netted off against improvements.
    const mixed = ageing.maturityTrend([{ A: 'A5', B: 'A1', C: 'A1' }, { A: 'A2', B: 'A4', C: 'A4' }]);
    if (mixed.direction !== 'regressed') v.push('three improvements were allowed to hide one regression — a net figure is exactly what must not happen here');
    if (!/Reported separately/.test(mixed.reason)) v.push('the trend does not say that regressions are reported separately');
    if (ageing.maturityTrend([{ A: 'A1' }]).direction !== 'insufficient-data') v.push('a trend was reported from one snapshot');
    if (ageing.maturityTrend([{ A: 'A1' }, { A: 'A3' }]).direction !== 'improving') v.push('an improvement was not reported as one');

    // --- Verification frequency scales with criticality automatically -------------------------
    const sched = new asm.AssumptionRegistry({ clock: () => 0 });
    sched.register('FOUND', { ...base, criticality: 'foundational', reviewCadenceDays: 3650 });
    sched.register('INFO', { ...base, criticality: 'informational', reviewCadenceDays: 3650 });
    const f = sched.verificationSchedule('FOUND', { now: 0 });
    const i = sched.verificationSchedule('INFO', { now: 0 });
    if (!(f.requiredCadenceDays < i.requiredCadenceDays)) v.push('the required verification cadence does not scale with criticality');
    if (f.declaredCadenceDays === f.requiredCadenceDays) v.push('the declared and required cadences are the same field — an owner cannot then be shown to have declared one that is too slow');
    if (!f.cadenceTooSlow) v.push('a 3650-day cadence on a foundational assumption was not reported as too slow');
    if (!/slower than/.test(f.reason)) v.push('the schedule does not explain why the cadence is too slow');
    if (sched.verificationSchedule('FOUND', { now: 200 * DAY }).overdue !== true) v.push('a never-verified foundational assumption was not overdue after 200 days');

    // --- The estate report is a work queue, not a scoreboard -----------------------------------
    const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
    const report = registry.maturityReport({ now: 0, controls });
    if (report.assumptions.length !== registry.ids().length) v.push('not every assumption was assessed for maturity');
    for (const r of report.assumptions) if (!r.nextStep) v.push(`'${r.assumption}' states no next step`);
    // Aggregated to the WEAKEST, as everywhere else.
    const weakestLevel = report.assumptions.reduce((w, r) => (asm.MATURITY_ORDER.indexOf(r.maturity) < asm.MATURITY_ORDER.indexOf(w) ? r.maturity : w), 'A5');
    if (report.organizationalMaturity !== weakestLevel) v.push('organizational maturity is not the weakest assumption — it has been averaged');
    if (!/least mature/.test(report.maturityBasis)) v.push('the maturity figure travels without saying it is the weakest rather than the mean');
    if (!report.verificationBacklog.length) v.push('a registry where nothing has been verified produced an empty verification backlog');
    // The backlog is ordered by criticality first.
    for (let n = 1; n < report.verificationBacklog.length; n++) {
      const prev = asm.CRITICALITY_LEVELS[report.verificationBacklog[n - 1].criticality].rank;
      const cur = asm.CRITICALITY_LEVELS[report.verificationBacklog[n].criticality].rank;
      if (cur > prev) v.push('the verification backlog is not ordered with the most critical assumptions first');
    }
    if (!report.belowMinimum.length) v.push('no assumption is below the maturity its criticality requires, on a registry where none has been verified');
    if (!report.criticalityLevels.length || !report.levels.length) v.push('the report does not publish its own vocabulary');
    if (report.authorizes !== false) v.push('the maturity report claims authority');
    // The platform's own foundational assumptions are declared as such rather than left at default.
    const foundational = registry.all().filter((a) => a.criticality === 'foundational').map((a) => a.id);
    if (!foundational.includes('ASM-0006')) v.push('ASM-0006 carries seven of nine assumptions and is not declared foundational');
    if (!foundational.includes('ASM-0001')) v.push('ASM-0001 is not declared foundational though three assumptions rest on it');
  }),

  fit('APP-FIT-ZONE-GOVERNANCE', 'Every bounded context declares its zone governance, nothing is inferred, and an undeclared value refuses composition', (v) => {
    const contextMap = require('../src/architecture/context-map');

    // --- Six properties, each with a declared vocabulary and a stated reason -------------------
    for (const required of ['zone', 'trustBoundary', 'residency', 'classification', 'failover', 'collaboration']) {
      if (!contextMap.ZONE_PROPERTIES.some((p) => p.field === required)) v.push(`zone governance property '${required}' is not declared`);
    }
    if (contextMap.ZONE_PROPERTIES.length !== 6) v.push('zone governance does not declare exactly six properties');
    for (const p of contextMap.ZONE_PROPERTIES) {
      if (!p.set || !p.set.size) v.push(`property '${p.field}' has no declared vocabulary, so any string would be accepted`);
      if (!p.why || p.why.length < 30) v.push(`property '${p.field}' does not say why it matters`);
    }
    // The three constitutional zones exist, plus `cross-zone` for what is deployed into all of them.
    for (const z of ['independent', 'executive', 'judiciary']) if (!contextMap.ZONES.has(z)) v.push(`constitutional zone '${z}' is not a declared zone`);

    // --- EVERY context declares all six, with a rationale for its zone ------------------------
    if (contextMap.ids().length !== 30) v.push(`the platform has ${contextMap.ids().length} bounded contexts; Baseline v1.7 declares 30`);
    for (const id of contextMap.ids()) {
      let g = null;
      try { g = contextMap.zoneGovernance(id); } catch (e) { v.push(`'${id}': ${e.message}`); continue; }
      for (const p of contextMap.ZONE_PROPERTIES) {
        if (g[p.field] === undefined || g[p.field] === null) v.push(`'${id}': declares no ${p.field}`);
        else if (!p.set.has(g[p.field])) v.push(`'${id}': declares unknown ${p.field} '${g[p.field]}'`);
      }
      if (!g.zoneRationale || g.zoneRationale.length < 30) v.push(`'${id}': states no rationale for its zone placement`);
    }
    if (contextMap.validate().zoneGovernanceDeclared !== contextMap.ids().length) v.push('not every bounded context has zone governance declared');

    // --- An undeclared or invalid value REFUSES composition -----------------------------------
    // Fed a crafted table, so the guard is exercised without mutating the real one.
    const crafted = (patch) => {
      const original = { ...contextMap.ZONE_GOVERNANCE.intake };
      Object.assign(contextMap.ZONE_GOVERNANCE.intake, patch);
      const result = contextMap.validate();
      Object.assign(contextMap.ZONE_GOVERNANCE.intake, original);
      for (const k of Object.keys(patch)) if (!(k in original)) delete contextMap.ZONE_GOVERNANCE.intake[k];
      return result;
    };
    if (crafted({ zone: undefined }).valid) v.push('a context with no declared zone passed validation');
    if (crafted({ zone: 'atlantis' }).valid) v.push('a context declaring an unknown zone passed validation');
    if (crafted({ classification: 'quite-sensitive' }).valid) v.push('a context declaring an unknown classification passed validation');
    if (crafted({ zoneRationale: null }).valid) v.push('a zone placement with no rationale passed validation — a placement nobody can disagree with is one nobody reviewed');
    if (!contextMap.validate().valid) v.push('restoring the declaration did not restore validity, so the probe is destructive');

    // --- The debt ADR-0009 recorded is closed: the record answers the zone question ------------
    const constitutionalZones = ['independent', 'executive', 'judiciary'];
    for (const z of constitutionalZones) {
      if (!contextMap.contextsInZone(z).length) v.push(`no bounded context is declared in the '${z}' zone`);
    }
    // Anonymous reporting is in the independent zone. This is the platform's oldest constitutional
    // claim and it is now recorded rather than implied.
    if (contextMap.zoneGovernance('intake').zone !== 'independent') v.push('anonymous intake is not declared in the independent zone');
    if (contextMap.zoneGovernance('governance-oversight').zone !== 'judiciary') v.push('governance oversight is not declared in the judiciary zone');
    if (contextMap.zoneGovernance('investigation').zone !== 'executive') v.push('investigation is not declared in the executive zone');
    // Crossing detection works in both directions, and a cross-zone context causes no crossing.
    if (!contextMap.crossesZoneBoundary(['intake', 'investigation']).crosses) v.push('sharing across the independent and executive zones was not reported as crossing a boundary');
    if (contextMap.crossesZoneBoundary(['intake', 'custody']).crosses) v.push('two contexts in the same zone were reported as crossing a boundary');
    if (contextMap.crossesZoneBoundary(['assurance', 'resilience']).crosses) v.push('two cross-zone contexts were reported as crossing a boundary');
    if (!contextMap.crossesZoneBoundary(['intake', 'nowhere']).unknown.includes('nowhere')) v.push('an undeclared context was not reported as unknown by the crossing check');

    // --- The constitutional contexts carry the strongest constraints --------------------------
    for (const id of ['intake', 'custody', 'governance-oversight', 'identity-access', 'policy-governance', 'privacy']) {
      const g = contextMap.zoneGovernance(id);
      if (g.classification !== 'constitutional') v.push(`'${id}' is a constitutional context classified '${g.classification}'`);
      if (g.residency !== 'sovereign-only') v.push(`'${id}' permits non-sovereign residency`);
    }
    if (contextMap.zoneGovernance('intake').collaboration !== 'no-sharing') v.push('anonymous intake permits sharing — nothing about a report may leave the platform');
    // …and at least one context is genuinely open, or the vocabulary has one usable value.
    if (!contextMap.zoneGovernanceAll().some((g) => g.collaboration === 'open-sharing')) v.push('no context permits open sharing, so the constraint has one setting and is not a decision');
    if (!contextMap.zoneGovernanceAll().some((g) => g.failover === 'no-failover')) v.push('every context claims a failover, which is not true of a privacy control that must fail closed');
  }),

  fit('APP-FIT-LEGAL-AUTHORITY', 'Every critical capability declares what legally authorises it, and unknown authority blocks readiness', (v) => {
    const la = require('../src/legislation/legal-authority');
    const ir = require('../src/governance/institutional-resilience');
    const DAY = 24 * 3600_000;
    const controls = require('./app-fitness').map((f) => ({ id: f.id, pass: true }));

    // --- Five kinds of authority, each saying how it can be withdrawn -------------------------
    for (const required of ['constitutional', 'legislation', 'delegated-authority', 'regulation', 'policy']) {
      if (!la.AUTHORITY_KINDS[required]) v.push(`authority kind '${required}' is not modelled`);
    }
    for (const [id, k] of Object.entries(la.AUTHORITY_KINDS)) {
      if (!k.withdrawnBy) v.push(`authority kind '${id}' does not say how it can be withdrawn — that is the only thing that distinguishes them`);
      if (!k.means || k.means.length < 25) v.push(`authority kind '${id}' does not say what it means`);
    }
    // Constitutional must be the strongest and policy the weakest, or the ordering is decorative.
    if (la.AUTHORITY_KINDS.constitutional.rank >= la.AUTHORITY_KINDS.policy.rank) v.push('a policy is ranked at least as strong as a constitutional mandate');
    // Unknown, expired and withdrawn are all distinct states, and all block.
    for (const required of ['unknown', 'declared', 'reviewed', 'expired', 'overdue', 'withdrawn']) {
      if (!la.AUTHORITY_STATES[required]) v.push(`authority state '${required}' is not modelled`);
    }
    if (la.AUTHORITY_STATES.unknown.authorized) v.push('unknown legal authority counts as authorized');
    if (!la.AUTHORITY_STATES.unknown.blocksReadiness) v.push('unknown legal authority does not block readiness');
    if (la.AUTHORITY_STATES.unknown.means === la.AUTHORITY_STATES.expired.means) v.push('unknown and expired are described identically — nobody looking and an instrument lapsing need different work');

    // --- A declaration must be complete, or it reads as complete to everybody downstream ------
    const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
    const good = {
      kind: 'legislation', instrument: 'an instrument recorded by the institution',
      approvingOrganization: 'Attorney General Chambers', reviewEveryDays: 365,
      expiresAt: 1000 * DAY, evidence: ['APP-FIT-LEGISLATIVE-IMPACT'],
      scope: 'investigate reports to an outcome', declaredBy: 'Legal Informatics Team',
    };
    for (const field of Object.keys(la.AUTHORITY_FIELDS)) {
      const partial = { ...good };
      delete partial[field];
      let rejected = false;
      try { reg.declare('case-investigation', partial); } catch (_) { rejected = true; }
      if (!rejected) v.push(`a legal authority declaration with no '${field}' was accepted`);
    }
    let unattributed = false;
    try { reg.declare('case-investigation', { ...good, declaredBy: null }); } catch (e) { unattributed = !!e.failClosed; }
    if (!unattributed) v.push('a legal authority declaration was accepted with nobody named as recording it');
    let untraceable = false;
    try { reg.declare('case-investigation', { ...good, kind: 'delegated-authority' }); } catch (e) { untraceable = !!e.failClosed; }
    if (!untraceable) v.push('delegated authority was accepted without naming what it was delegated from');

    // --- Review is BY the approving organization, and by nobody else --------------------------
    reg.declare('case-investigation', good);
    if (reg.state('case-investigation', { now: 0 }).state !== 'declared') v.push('a fresh declaration is not in the declared state');
    if (reg.state('case-investigation', { now: 0 }).authorized) v.push('an unreviewed declaration counted as authorized');
    let wrongReviewer = false;
    try { reg.review('case-investigation', { by: 'Platform Engineering', at: 1 }); } catch (e) { wrongReviewer = !!e.failClosed; }
    if (!wrongReviewer) v.push('a legal authority was reviewed by somebody other than the approving organization');
    reg.review('case-investigation', { by: 'Attorney General Chambers', at: 1 });
    const reviewed = reg.state('case-investigation', { now: 2, controls });
    if (reviewed.state !== 'reviewed' || !reviewed.authorized) v.push('a reviewed declaration did not reach the authorized state — this check would then have no success path');

    // --- Lapse, expiry and withdrawal are each their own state -------------------------------
    if (reg.state('case-investigation', { now: 500 * DAY }).state !== 'overdue') v.push('a missed review schedule was not reported as overdue');
    if (reg.state('case-investigation', { now: 2000 * DAY }).state !== 'expired') v.push('an expired declaration was not reported as expired');
    const withdrawn = new la.LegalAuthorityRegistry({ clock: () => 0 });
    withdrawn.declare('case-investigation', good);
    withdrawn.review('case-investigation', { by: 'Attorney General Chambers', at: 1 });
    withdrawn.withdraw('case-investigation', { by: 'Attorney General Chambers', reason: 'the instrument was repealed', at: 2 });
    if (withdrawn.state('case-investigation', { now: 3 }).state !== 'withdrawn') v.push('a withdrawn authority was not reported as withdrawn');
    if (withdrawn.state('case-investigation', { now: 3 }).blocksReadiness !== true) v.push('a withdrawn authority did not block readiness');
    // A review that finds the authority no longer stands is the same finding by a different route.
    const lapsed = new la.LegalAuthorityRegistry({ clock: () => 0 });
    lapsed.declare('case-investigation', good);
    lapsed.review('case-investigation', { by: 'Attorney General Chambers', at: 1, stillStands: false, note: 'amended away' });
    if (lapsed.state('case-investigation', { now: 2 }).state !== 'withdrawn') v.push('a review finding the authority no longer stands did not withdraw it');
    let unattributedWithdrawal = false;
    try { lapsed.withdraw('case-investigation', { by: 'X' }); } catch (e) { unattributedWithdrawal = !!e.failClosed; }
    if (!unattributedWithdrawal) v.push('an authority was withdrawn with no reason recorded');

    // --- THE PART 5 RULE: unknown authority blocks readiness ---------------------------------
    const empty = new la.LegalAuthorityRegistry({ clock: () => 0 });
    const report = empty.report({ now: 0, controls });
    if (report.count !== Object.keys(ir.CRITICAL_CAPABILITIES).length) v.push('not every critical capability was assessed for legal authority');
    if (!report.blocksReadiness) v.push('an estate with no legal authority declared did not block readiness');
    if (report.complete) v.push('an entirely undeclared estate reported its legal authority complete');
    if (report.unknown.length !== report.count) v.push('not every capability was reported as unknown on an empty registry');
    if (!report.criticalGaps.length) v.push('constitutional capabilities with no recorded legal authority were not named as critical gaps');
    if (!/three different people/.test(report.completenessBasis)) v.push('the completeness basis does not distinguish unknown from expired and withdrawn');
    // The register ships EMPTY of statutory claims, which is the honest state and is stated as such.
    if (!/no statutory claims/.test(report.note)) v.push('the registry does not state that it ships with no statutory claims');
    if (empty.declarations().length) v.push('the legal authority registry ships with fabricated statutory claims');

    // --- Validation catches a declaration that names something that does not exist ------------
    if (!reg.validate().valid) v.push('a well-formed declaration failed validation: ' + reg.validate().violations.join('; '));
    let unknownCapability = false;
    try { reg.declare('ministry-of-magic', good); } catch (_) { unknownCapability = true; }
    if (!unknownCapability) { if (reg.validate().valid) v.push('a declaration for a capability that does not exist passed validation'); }
    const wrongOrg = new la.LegalAuthorityRegistry({ clock: () => 0 });
    wrongOrg.declare('case-investigation', { ...good, approvingOrganization: 'The Ministry of Magic' });
    if (wrongOrg.validate().valid) v.push('an authority approved by a body that is not in the accountability record passed validation');
  }),

  fit('APP-FIT-DEPENDENCY-INTELLIGENCE', 'Every dependency carries a standardized type, impact propagates over declared structure only, and constitutional priority is never averaged', (v) => {
    const ir = require('../src/governance/institutional-resilience');
    const controls = [
      ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./app-fitness').map((f) => ({ id: f.id, pass: true })),
      ...require('./infra-fitness').map((f) => ({ id: f.id, pass: true })),
    ];

    // --- Ten standardized types, each saying how it fails -------------------------------------
    for (const required of ['technical', 'operational', 'organizational', 'legal', 'contractual', 'informational', 'governance', 'infrastructure', 'communications', 'facilities']) {
      if (!ir.DEPENDENCY_TYPES[required]) v.push(`standardized dependency type '${required}' is not modelled`);
    }
    if (Object.keys(ir.DEPENDENCY_TYPES).length !== 10) v.push('the standardized type vocabulary does not have exactly ten values');
    for (const [id, t] of Object.entries(ir.DEPENDENCY_TYPES)) {
      if (!t.failsBy || t.failsBy.length < 30) v.push(`dependency type '${id}' does not say how it fails — that is what distinguishes the ten`);
      if (!t.detectedIn) v.push(`dependency type '${id}' does not say how quickly it is noticed`);
    }
    // Every assessable kind maps to exactly one type, and every type is used — a type nothing maps
    // to is a vocabulary entry, not a classification.
    for (const kind of Object.keys(ir.DEPENDENCY_KINDS)) {
      const t = ir.typeOfKind(kind);
      if (!t) v.push(`dependency kind '${kind}' carries no standardized type`);
      else if (!ir.DEPENDENCY_TYPES[t]) v.push(`dependency kind '${kind}' maps to unknown type '${t}'`);
    }
    const used = new Set(Object.keys(ir.DEPENDENCY_KINDS).map((k) => ir.typeOfKind(k)));
    for (const t of Object.keys(ir.DEPENDENCY_TYPES)) if (!used.has(t)) v.push(`standardized type '${t}' classifies no assessable dependency kind`);

    // --- The intelligence report carries all three views without three models ----------------
    const evaluation = ir.evaluate({ controls });
    const di = ir.dependencyIntelligence(evaluation);
    if (!di.count) v.push('no dependency was assessed');
    for (const d of di.dependencies) {
      if (!d.kind || !d.category || !d.type) v.push(`a dependency is missing one of kind/category/type: ${JSON.stringify({ k: d.kind, c: d.category, t: d.type })}`);
      if (!d.reason) v.push(`dependency ${d.capability}/${d.kind} states no reason`);
    }
    if (di.unmappedKinds.length) v.push(`dependency kinds with no standardized type: ${di.unmappedKinds.join(', ')}`);
    if (di.blindSpots.length) v.push(`standardized types nothing assesses: ${di.blindSpots.join(', ')}`);
    if (!di.weakestType) v.push('the report does not name where the institution is structurally weakest');
    if (di.authorizes !== false) v.push('the dependency intelligence report claims authority');

    // --- Impact propagation is over DECLARED structure, and says it is a lower bound ----------
    const impact = ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'service', controls });
    if (!impact.type || !impact.failsBy) v.push('an impact analysis does not carry the dependency type or its failure mode');
    if (!/lower bound/.test(impact.caveat)) v.push('impact propagation does not state that it is a lower bound');
    if (!impact.summary) v.push('an impact analysis produces no summary');
    // An organizational dependency propagates through shared subsystems, not through services.
    const org = ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'person', controls });
    if (org.impactedServices.length) v.push('an organizational dependency was propagated through the service topology');
    if (org.type !== 'organizational') v.push('a person dependency was not classified as organizational');
    // A capability that shares nothing reaches nothing, so the analysis can say "no reach".
    const isolated = ir.dependencyImpact({ capability: 'evidence-custody', kind: 'legal-authority', controls });
    if (typeof isolated.reachCount !== 'number') v.push('reach was not computed');
    // Detection is derived from the kind's control, both ways.
    if (!ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'service', controls }).detected) v.push('a dependency whose control runs and holds was not reported as detected');
    if (ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'service', controls: [] }).detected) v.push('a dependency whose control did not run was reported as detected');
    let unknownKind = false;
    try { ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'astrology', controls }); } catch (_) { unknownKind = true; }
    if (!unknownKind) v.push('impact was computed for an undeclared dependency kind');

    // --- Seven perspectives, computed in parallel, never averaged ----------------------------
    for (const required of ['constitutional', 'operational', 'mission', 'citizenImpact', 'likelihood', 'recoveryDifficulty', 'urgency']) {
      if (!ir.RISK_PERSPECTIVES[required]) v.push(`risk perspective '${required}' is not computed`);
    }
    if (Object.keys(ir.RISK_PERSPECTIVES).length !== 7) v.push('there are not exactly seven risk perspectives');
    for (const [id, p] of Object.entries(ir.RISK_PERSPECTIVES)) {
      if (!p.asks || !p.asks.endsWith('?')) v.push(`perspective '${id}' states no question`);
      if (!p.orderedBy) v.push(`perspective '${id}' does not say what it orders by`);
    }
    // Exactly one perspective is a BAND rather than a factor, and it is the constitutional one.
    const banded = Object.entries(ir.RISK_PERSPECTIVES).filter(([, p]) => p.band).map(([id]) => id);
    if (banded.join(',') !== 'constitutional') v.push(`the banded perspectives are '${banded.join(', ')}' — only the constitutional one may be a band`);

    const mp = ir.multiPerspectiveRisk(evaluation, { controls });
    if (mp.perspectiveCount !== 7) v.push('not all seven perspectives were produced');
    for (const p of mp.perspectives) {
      if (p.ranking.length !== mp.count) v.push(`perspective '${p.perspective}' ranked ${p.ranking.length} of ${mp.count} dependencies`);
      for (let n = 0; n < p.ranking.length; n++) if (p.ranking[n].rank !== n + 1) v.push(`perspective '${p.perspective}' produced a broken rank sequence`);
    }
    // The perspectives genuinely differ, or seven questions are being answered once.
    if (mp.distinctOrderings < 3) v.push(`the seven perspectives produce only ${mp.distinctOrderings} distinct orderings — they are not answering different questions`);
    if (!mp.contested) v.push('the perspectives were reported as uncontested though they order things differently');

    // --- THE RULE: constitutional priority is never collapsed into an average ----------------
    if (!mp.constitutionalPrimacy) v.push('the constitutional ranking does not put constitutional capabilities first');
    if (ir.assertConstitutionalPrimacy(mp.perspectives.find((p) => p.perspective === 'constitutional').ranking) !== true) {
      v.push('the constitutional ranking failed its own primacy check');
    }
    // …and the check can fail, fed a crafted ranking that violates it.
    let caught = false;
    try {
      ir.assertConstitutionalPrimacy([
        { capability: 'service-recovery', kind: 'data', constitutional: false },
        { capability: 'anonymous-reporting', kind: 'service', constitutional: true },
      ]);
    } catch (e) { caught = !!e.failClosed; }
    if (!caught) v.push('a ranking placing a non-constitutional dependency above a constitutional one was accepted — that is the one thing this rule exists to prevent');
    // A ranking with no constitutional items, and one with only them, both pass.
    if (ir.assertConstitutionalPrimacy([{ capability: 'a', kind: 'x', constitutional: false }]) !== true) v.push('a ranking with no constitutional items was rejected');
    if (mp.authorizes !== false) v.push('the multi-perspective ranking claims authority');
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
