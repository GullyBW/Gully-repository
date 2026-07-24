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
const { PolicySet } = require('../src/iam/policy-engine');
const zeroTrust = require('../src/iam/zero-trust');
const { TenantRegistry, TenantScopedStore, CollaborationBroker } = require('../src/tenancy/tenant');
const { KnowledgeGraph } = require('../src/graph/graph');
const { MemoryStore } = require('../src/adapters/store');
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

  fit('APP-FIT-GRAPH-PRIVACY', 'Knowledge graph refuses identifying node/edge properties', (v) => {
    const g = new KnowledgeGraph();
    g.addNode('n1', 'Person', { role: 'suspect' });
    let refused = false; try { g.addNode('n2', 'Person', { name: 'Real Name' }); } catch (_) { refused = true; }
    if (!refused) v.push('graph stored an identifying node property');
    if (!KnowledgeGraph) v.push('graph missing');
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
