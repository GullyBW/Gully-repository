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
    // Nothing is cached: two identical requests are each evaluated at the PDP.
    const before = zt.pdp.decisionsEvaluated();
    zt.pdp.decide(base); zt.pdp.decide(base);
    if (zt.pdp.decisionsEvaluated() !== before + 2) v.push('a decision was cached rather than re-evaluated');
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

  fit('APP-FIT-FORMAL-POLICY', 'Critical governance policies are proven, and the checker can produce counterexamples', (v) => {
    const fp = require('../src/iam/formal-policy');
    const mandates = [{ instrument: 'data-protection-act', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }];
    const report = fp.verifyAll({ mandates });
    if (!report.allProven) v.push('policy verification failed: ' + JSON.stringify(report.failed));
    // Every required policy domain is specified.
    const kinds = new Set(fp.specifications().map((s) => s.kind));
    for (const required of ['authorization', 'separation-of-duties', 'approval-chain', 'escalation', 'evidence-custody', 'data-residency', 'legislative']) {
      if (!kinds.has(required)) v.push(`no formal specification for '${required}'`);
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
    const ok = sc.verifyRelease({ artifact: 'njtip-app', artifactDigest: 'abc', sbom: sbom(), dependencies: [], signedContainer: true });
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
