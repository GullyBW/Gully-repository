'use strict';
// NJTIP HTTP API (Node built-in http; zero dependencies). Production-shaped:
// composition root, session auth, structured observability, health/metrics,
// centralized error handling. SYNTHETIC ONLY — no production systems or data.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');
const openapi = require('./openapi');
const { newTraceId } = require('./adapters/observability');
const configMod = require('./config');
const { twinValidate, runTwin, runApp, runInfra } = require('./twin-validate');
const { makePackage } = require('../scripts/evidence-package');
const { assess } = require('../scripts/readiness');

// Synthetic login credentials → roles. Production: OIDC/FIDO2 assertion verification.
const CREDS = {
  'demo-investigator': { principal: 'inv-001', role: 'investigator' },
  'demo-oversight': { principal: 'gov-001', role: 'oversight-board' },
  'demo-admin': { principal: 'adm-001', role: 'admin' },
};

function bearer(req) { const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i); return m ? m[1] : null; }
function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function route(app, req, url, body) {
  const p = url.pathname, method = req.method;
  const requireRole = (role) => {
    // Accept a session token OR a verified OIDC/OAuth2 token (same authorization outcome).
    const u = app.auth.verify(bearer(req));
    if (!u || u.role !== role) throw err(401, `${role} authentication required`);
    return u;
  };
  // Authenticate, then apply the app-level RBAC+ABAC gate for a specific action.
  const requirePermission = (action, attributes = {}) => {
    const u = app.auth.verify(bearer(req));
    if (!u) throw err(401, 'authentication required');
    const d = app.authz.authorize({ role: u.role, action, attributes });
    if (!d.allow) throw err(403, d.reason);
    return u;
  };

  // --- Ops & contract ---
  if (method === 'GET' && (p === '/' || p === '/index.html')) return page('index.html');
  if (method === 'GET' && p === '/openapi.json') return json(200, openapi.spec());
  if (method === 'GET' && p === '/healthz') { const h = app.health.snapshot(); return json(h.status === 'healthy' ? 200 : 503, h); }
  if (method === 'GET' && p === '/readyz') { const ok = app.health.snapshot().checks['architecture-invariants'] === 'ok'; return json(ok ? 200 : 503, { ready: ok }); }
  if (method === 'GET' && p === '/metrics') return { status: 200, body: app.metrics.prometheus(), type: 'text/plain' };

  // --- Auth (synthetic login → session token) ---
  if (method === 'POST' && p === '/api/auth/session') {
    const c = CREDS[body.credential]; if (!c) throw err(401, 'invalid credential');
    return json(200, { token: app.session.issue(c), role: c.role, expiresInMs: app.cfg.sessionTtlMs });
  }

  // --- Citizen (anonymous) ---
  if (method === 'POST' && p === '/api/reports') return json(201, app.workflow.submitReport({ category: body.category, content: body.content, extra: body.extra }));
  let m;
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/status$/))) { const s = app.workflow.status(dec(m[1])); return s ? json(200, s) : json(404, { error: 'not-found' }); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/notifications$/))) { const n = app.workflow.notificationsFor(dec(m[1])); return n ? json(200, { notifications: n }) : json(404, { error: 'not-found' }); }
  if (method === 'POST' && (m = p.match(/^\/api\/reports\/([^/]+)\/evidence$/))) return json(201, app.workflow.attachEvidence({ case_code: dec(m[1]), content: body.content }));

  // --- Investigator (privileged) ---
  if (method === 'GET' && p === '/api/reports') { requireRole('investigator'); return json(200, { queue: app.workflow.listReports({ category: url.searchParams.get('category'), status: url.searchParams.get('status') }) }); }
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/review$/))) { const u = requireRole('investigator'); return json(200, app.workflow.investigatorReview({ principal: u.principal, case_code: dec(m[1]), note: body.note, disposition: body.disposition })); }
  // Case lifecycle transition (review/escalate/resolve/close) — RBAC+ABAC gated.
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/transition$/))) { const u = requirePermission('transition-case', { caseCode: dec(m[1]) }); return json(200, app.workflow.transitionCase({ principal: u.principal, case_code: dec(m[1]), event: body.event })); }
  // Evidence handling lifecycle transition (seal/open/admit/exclude/purge).
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/evidence\/([^/]+)\/transition$/))) { requirePermission('seal-evidence', { caseCode: dec(m[1]) }); return json(200, app.workflow.evidenceTransition({ case_code: dec(m[1]), evidenceId: dec(m[2]), event: body.event })); }

  // --- Enterprise operational workflows (assignment, SLA, stages, appeals, retention) ---
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/assign$/))) { requireRole('investigator'); return json(200, app.workflow.assignCase({ case_code: dec(m[1]) })); }
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/stage$/))) { const u = requireRole('investigator'); return json(200, app.workflow.advanceStage({ principal: u.principal, case_code: dec(m[1]) })); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/sla$/))) { const s = app.workflow.slaStatus(dec(m[1])); return json(200, s); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/retention$/))) { requireRole('investigator'); return json(200, app.workflow.retentionPlan(dec(m[1]))); }
  if (method === 'POST' && (m = p.match(/^\/api\/reports\/([^/]+)\/appeal$/))) return json(201, app.workflow.fileAppeal({ case_code: dec(m[1]), by: body.by, reason: body.reason }));
  if (method === 'GET' && p === '/api/investigator/workloads') { requireRole('investigator'); return json(200, { workloads: app.workflow.workloads() }); }

  // --- Oversight (aggregate, read-only) ---
  if (method === 'GET' && p === '/api/oversight/dashboard') return json(200, app.workflow.oversightDashboard({ category: url.searchParams.get('category') }));
  if (method === 'GET' && p === '/api/oversight/report') return json(200, { generatedAt: new Date().toISOString(), ...app.workflow.oversightDashboard() });

  // --- Search, analytics, intelligence (privacy-preserving, non-attributable) ---
  if (method === 'GET' && p === '/api/search') { requireRole('investigator'); return json(200, { results: app.workflow.searchCases(url.searchParams.get('q'), { limit: Number(url.searchParams.get('limit') || 50) }) }); }
  if (method === 'GET' && p === '/api/analytics') return json(200, app.workflow.analytics({ by: url.searchParams.get('by') || 'category' }));
  // Semantic search (Phase 30) + graph intelligence (Phase 31, advisory).
  if (method === 'GET' && p === '/api/search/semantic') { requireRole('investigator'); return json(200, app.workflow.semanticSearch(url.searchParams.get('q'))); }
  if (method === 'GET' && (m = p.match(/^\/api\/graph\/([^/]+)\/predict$/))) { requireRole('investigator'); return json(200, app.graphIntel.predictLinks(app.graph, dec(m[1]))); }
  if (method === 'GET' && p === '/api/graph/patterns') { requireRole('investigator'); return json(200, app.graphIntel.suspiciousPatterns(app.graph)); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/timeline$/))) { requireRole('investigator'); return json(200, app.workflow.caseTimeline(dec(m[1]))); }
  if (method === 'GET' && p === '/api/analytics/export') {
    requireRole('oversight-board');
    const fmt = url.searchParams.get('format') || 'json';
    const out = app.workflow.exportCases({ format: fmt, filter: { category: url.searchParams.get('category'), status: url.searchParams.get('status') } });
    return fmt === 'csv' ? { status: 200, body: out, type: 'text/csv' } : json(200, { rows: out });
  }

  // --- Governance (privileged; records HUMAN decisions only) ---
  if (method === 'POST' && p === '/api/governance/decisions') { const u = requireRole('oversight-board'); return json(201, app.workflow.governanceDecision({ reviewer: body.reviewer || u.principal, role: u.role, subject: body.subject, verdict: body.verdict, rationale: body.rationale })); }

  // --- Evidence + Twin validation ---
  if (method === 'GET' && p === '/api/evidence/bundle') return json(200, app.workflow.generateEvidence());
  if (method === 'GET' && p === '/api/twin/validate') return json(200, twinValidate());

  // --- Assurance (Phase 9/10): deterministic evidence package + human-gated readiness ---
  if (method === 'GET' && p === '/api/assurance/evidence-package') { requireRole('admin'); return json(200, makePackage()); }
  if (method === 'GET' && p === '/api/assurance/readiness') { requireRole('admin'); return json(200, assess([])); }

  // --- Administration (privileged) ---
  if (method === 'GET' && p === '/api/admin/health') { requireRole('admin'); return json(200, app.health.snapshot()); }
  if (method === 'GET' && p === '/api/admin/metrics') { requireRole('admin'); return json(200, app.metrics.snapshot()); }
  if (method === 'GET' && p === '/api/admin/config') { requireRole('admin'); return json(200, configMod.redacted(app.cfg)); }
  if (method === 'GET' && p === '/api/admin/slo') { requireRole('admin'); return json(200, app.evaluateSlo()); }
  if (method === 'GET' && p === '/api/admin/traces') { requireRole('admin'); return json(200, { spans: app.tracer.recent(Number(url.searchParams.get('limit') || 50)) }); }

  // --- Event sourcing / CQRS (Phase 11) ---
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/events$/))) { requireRole('investigator'); return json(200, { events: app.workflow.caseEvents(dec(m[1])), replayState: app.workflow.replayCase(dec(m[1])) }); }
  if (method === 'GET' && p === '/api/admin/events/verify') { requireRole('admin'); return json(200, app.workflow.verifyEventIntegrity()); }
  if (method === 'GET' && p === '/api/admin/readmodel/rebuild') { requireRole('admin'); return json(200, { rebuilt: app.workflow.rebuildReadModel() }); }
  // Event governance (Phase 26): catalog, discovery, dependency map, retention, integrity.
  if (method === 'GET' && p === '/api/events/catalog') { requireRole('investigator'); return json(200, { catalog: app.eventRegistry.catalog(), dependencies: app.eventRegistry.dependencyMap() }); }
  if (method === 'GET' && p === '/api/admin/events/governance') { requireRole('admin'); return json(200, { validate: app.eventRegistry.validate(app.events), retention: app.eventRegistry.retentionReport(app.events.readAll()) }); }

  // --- National IAM (Phase 12) + Zero Trust (Phase 19) ---
  if (method === 'POST' && p === '/api/authz/evaluate') { requireRole('admin'); return json(200, app.iam.policies.evaluate({ subject: body.subject, action: body.action, resource: body.resource, env: body.env })); }
  if (method === 'GET' && p === '/api/admin/policies') { requireRole('admin'); return json(200, { policies: app.iam.policies.list() }); }
  if (method === 'POST' && p === '/api/admin/policies') { requireRole('admin'); app.iam.policies.load(body.policies || []); return json(200, { loaded: app.iam.policies.list().length }); }
  // Policy governance (Phase 41) + formal verification (Phase 42).
  if (method === 'GET' && p === '/api/admin/policy-governance') { requireRole('admin'); return json(200, { active: app.policyGovernance.active('access-control'), certification: app.policyGovernance.certify('access-control'), audit: app.policyGovernance.auditTrail() }); }
  // National digital identity (Phase 51) + infrastructure governance (Phase 52).
  if (method === 'GET' && (m = p.match(/^\/api\/identity\/credential\/([^/]+)\/verify$/))) { requireRole('admin'); return json(200, app.digitalIdentity.verifyCredential(dec(m[1]))); }
  if (method === 'GET' && p === '/api/admin/infra-governance') { requireRole('admin'); return json(200, { resources: app.infraGovernance.list(), compliance: app.infraGovernance.validateCompliance(), readiness: app.infraGovernance.readiness() }); }
  // --- Architecture stabilization (v1.9): architecture-of-record + institutional accountability ---
  if (method === 'GET' && p === '/api/architecture/context-map') { requireRole('admin'); return json(200, app.architecture.contextMap()); }
  if (method === 'GET' && (m = p.match(/^\/api\/architecture\/contexts\/([^/]+)$/))) { requireRole('admin'); const id = dec(m[1]); return json(200, { ...app.architecture.describe(id), ...app.architecture.coupling(id), cohesion: app.architecture.cohesion(id), relations: app.architecture.upstreamDownstream(id), accountability: app.ownership.describe(id) }); }
  if (method === 'GET' && p === '/api/governance/ownership') { requireRole('admin'); return json(200, app.ownership.model()); }
  if (method === 'GET' && p === '/api/contracts') { requireRole('admin'); return json(200, app.contracts.catalogue()); }
  if (method === 'GET' && (m = p.match(/^\/api\/contracts\/([^/]+)$/))) { requireRole('admin'); return json(200, { ...app.contracts.describe(dec(m[1])), history: app.contracts.history(dec(m[1])) }); }
  if (method === 'GET' && p === '/api/contracts/openapi') { requireRole('admin'); return json(200, app.contracts.toOpenApi()); }
  // --- Phase 10: executive dashboard + continuous assurance ---
  if (method === 'GET' && p === '/api/executive/dashboard') { requireRole('admin'); return json(200, app.assurance.executiveDashboard()); }
  if (method === 'GET' && p === '/api/executive/evidence-trace') { requireRole('admin'); return json(200, { trace: app.assurance.executive.evidenceTrace() }); }
  if (method === 'GET' && p === '/api/assurance/continuous') { requireRole('admin'); return json(200, app.assurance.dashboard()); }
  if (method === 'GET' && p === '/api/assurance/authorization-package') { requireRole('admin'); return json(200, app.assurance.authorizationPackage()); }
  if (method === 'GET' && p === '/api/assurance/production-readiness') { requireRole('admin'); return json(200, app.assurance.productionReadiness()); }
  // --- Phase 10: AI lifecycle, ADR governance, consumer contracts, operational governance ---
  if (method === 'GET' && p === '/api/ai/lifecycle') { requireRole('admin'); return json(200, app.ai.lifecycle.report()); }
  if (method === 'GET' && p === '/api/ai/pending-decisions') { requireRole('oversight-board'); return json(200, { pending: app.ai.lifecycle.pendingDecisions() }); }
  if (method === 'POST' && (m = p.match(/^\/api\/ai\/inferences\/([^/]+)\/decide$/))) { const u = requireRole('oversight-board'); return json(200, app.ai.lifecycle.decide(dec(m[1]), { by: body.by || u.principal, decision: body.decision, rationale: body.rationale })); }
  if (method === 'GET' && p === '/api/architecture/adr') { requireRole('admin'); return json(200, app.adrGovernance.validateCatalogue()); }
  if (method === 'GET' && p === '/api/contracts/consumers') { requireRole('admin'); return json(200, app.contracts.consumers.report()); }
  if (method === 'POST' && p === '/api/contracts/impact') { requireRole('admin'); return json(200, app.contracts.consumers.impactOfChange(body.contract, body.change || {})); }
  if (method === 'GET' && p === '/api/governance/raci') { requireRole('admin'); const f = [...runTwin(), ...runApp(), ...runInfra()]; return json(200, app.raci.report({ fitnessIds: f.map((r) => r.id), fitnessResults: f.map((r) => ({ id: r.id, pass: r.pass })) })); }
  // --- Phase 10: data governance, supply-chain attestation, multi-region ---
  if (method === 'GET' && p === '/api/data-governance') { requireRole('admin'); return json(200, app.fabric.dataGovernance.report()); }
  if (method === 'GET' && (m = p.match(/^\/api\/data-governance\/([^/]+)\/trace$/))) { requireRole('admin'); return json(200, app.fabric.dataGovernance.traceRecord(dec(m[1]))); }
  if (method === 'GET' && p === '/api/supply-chain/attestations') { requireRole('admin'); return json(200, app.supplyChain.attestation.report({ sbom: require('../scripts/devsecops').sbom(), buildFn: app.supplyChain.sourceDigest })); }
  if (method === 'GET' && p === '/api/resilience/multi-region') { requireRole('admin'); return json(200, app.multiRegion.report()); }
  // --- Phase 10: reliability, telemetry analysis, resilience ---
  if (method === 'GET' && p === '/api/admin/reliability') { requireRole('admin'); return json(200, app.observability.reliability()); }
  if (method === 'GET' && p === '/api/admin/telemetry') { requireRole('admin'); const f = [...runTwin(), ...runApp(), ...runInfra()]; const held = f.filter((r) => r.pass).length / f.length; return json(200, app.observability.telemetry.report({ signals: { architecture: held, reliability: app.evaluateSlo().healthy, security: true, privacy: true, infrastructure: app.infraAssurance.report().healthy, governance: true }, spans: app.tracer.recent(50) })); }
  if (method === 'GET' && (m = p.match(/^\/api\/admin\/telemetry\/failure\/([^/]+)$/))) { requireRole('admin'); return json(200, app.observability.telemetry.failurePropagation([dec(m[1])])); }
  if (method === 'GET' && p === '/api/admin/resilience/suite') { requireRole('admin'); return json(200, app.chaos.runSuite({ light: true })); }
  // --- Phase 11: predictive reliability & business observability ---
  if (method === 'GET' && p === '/api/observability/dependency-risk') { requireRole('admin'); return json(200, app.observability.sre.dependencyRisk()); }
  if (method === 'GET' && p === '/api/observability/business') { requireRole('oversight-board'); return json(200, app.observability.businessMetrics()); }
  // --- Phase 11: data quality, supply-chain trust, AI monitoring ---
  if (method === 'GET' && p === '/api/data/quality') { requireRole('admin'); return json(200, app.fabric.dataGovernance.governanceReadiness()); }
  if (method === 'GET' && p === '/api/ai/monitoring') { requireRole('admin'); return json(200, { models: app.ai.lifecycle.catalogue('model').map((m) => app.ai.lifecycle.monitoringPosture(m.id)), pendingApprovals: app.ai.lifecycle.pendingApprovals() }); }
  if (method === 'GET' && p === '/api/resilience/consistency') { requireRole('admin'); return json(200, { models: app.multiRegion.consistencyModels(), replication: app.multiRegion.replicationPolicies(), contexts: app.multiRegion.contextConsistency(), validation: app.multiRegion.validateConsistency() }); }
  if (method === 'GET' && p === '/api/contracts/consumer-impact') { requireRole('admin'); return json(200, { visualization: app.contracts.consumers.dependencyVisualization(), deprecation: app.contracts.consumers.deprecationAnalytics(), adoption: app.contracts.consumers.report().adoption }); }
  if (method === 'GET' && p === '/api/architecture/adr') { requireRole('admin'); const a = require('./architecture/adr-governance'); return json(200, { catalogue: a.validateCatalogue(), lifecycle: a.lifecycle(), debt: a.architecturalDebt(), schema: a.schema() }); }
  // --- Phase 10: zero trust, threat model, formal policy verification ---
  if (method === 'GET' && p === '/api/security/zero-trust') { requireRole('admin'); return json(200, { architecture: app.iam.zeroTrust.architecture(), policyVersion: app.iam.zeroTrust.pap.version(), policies: app.iam.zeroTrust.pap.registry(), workloads: app.iam.zeroTrust.workloads.list(), boundaries: app.iam.zeroTrust.boundaries.flows() }); }
  if (method === 'POST' && p === '/api/security/zero-trust/decide') { requireRole('admin'); return json(200, app.iam.zeroTrust.pdp.decide(body.request || {})); }
  if (method === 'GET' && p === '/api/security/threat-model') { requireRole('admin'); const fitnessResults = [...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass })); return json(200, app.threat.report({ fitnessResults, knownFitnessIds: fitnessResults.map((r) => r.id) })); }
  if (method === 'GET' && p === '/api/security/risk') { requireRole('admin'); const f = [...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass })); return json(200, app.threat.riskRegister.report({ fitnessResults: f })); }
  if (method === 'GET' && p === '/api/security/formal-policy/catalogue') { requireRole('admin'); return json(200, app.iam.formalPolicy.catalogue()); }
  if (method === 'GET' && p === '/api/security/formal-policy/proof') { requireRole('admin'); return json(200, app.iam.formalPolicy.proofSummary({})); }
  if (method === 'GET' && p === '/api/security/zero-trust/cache') { requireRole('admin'); return json(200, { stats: app.iam.zeroTrust.cache.stats(), revocations: app.iam.zeroTrust.revocations.list(), policySync: app.iam.zeroTrust.policySync.status(app.iam.zeroTrust.pap.version()) }); }
  if (method === 'GET' && p === '/api/security/formal-policy') { requireRole('admin'); return json(200, app.iam.formalPolicy.continuousValidation({ policies: app.iam.policies.list().length ? undefined : undefined })); }
  // --- Stabilization: audience dashboards, correlation governance, usability evidence ---
  if (method === 'GET' && p === '/api/observability/dashboards') { requireRole('admin'); return json(200, { audiences: app.observability.audiences(), dashboards: app.observability.all() }); }
  if (method === 'GET' && (m = p.match(/^\/api\/observability\/dashboards\/([^/]+)$/))) { requireRole('admin'); return json(200, app.observability.dashboard(dec(m[1]))); }
  if (method === 'GET' && p === '/api/intelligence/correlation-governance') { requireRole('oversight-board'); return json(200, app.correlationGovernance.report()); }
  if (method === 'POST' && p === '/api/intelligence/correlations') { const u = requireRole('oversight-board'); return json(201, app.correlationGovernance.authorize({ domains: body.domains, purpose: body.purpose, requestedBy: body.requestedBy || u.principal })); }
  if (method === 'GET' && p === '/api/ux/validation') { requireRole('admin'); return json(200, app.usability.report()); }
  // --- Stabilization: legislative impact, recovery strategy, data exchange, process governance ---
  if (method === 'GET' && p === '/api/legislation/impact') { requireRole('admin'); const fitnessResults = [...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass })); return json(200, app.legislation.impact.report({ fitnessResults })); }
  if (method === 'POST' && (m = p.match(/^\/api\/legislation\/([^/]+)\/simulate$/))) { requireRole('admin'); const fitnessResults = [...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass })); return json(200, app.legislation.impact.simulateChange(dec(m[1]), { proposedControls: body.proposedControls || null, proposedSystems: body.proposedSystems || null, fitnessResults })); }
  if (method === 'POST' && p === '/api/recovery/strategies/evaluate') { requireRole('admin'); return json(200, app.recovery.strategies.recommend({ incidentType: body.incidentType, weights: body.weights, constraints: body.constraints })); }
  if (method === 'POST' && (m = p.match(/^\/api\/recovery\/strategies\/([^/]+)\/authorize$/))) { const u = requireRole('admin'); return json(200, app.recovery.strategies.authorize(dec(m[1]), { by: body.by || u.principal, rationale: body.rationale, strategy: body.strategy })); }
  if (method === 'GET' && p === '/api/data-exchange') { requireRole('admin'); return json(200, app.fabric.dataExchange.report()); }
  if (method === 'POST' && p === '/api/data-exchange/agreements') { requireRole('admin'); return json(201, app.fabric.dataExchange.requestExchange({ datasetId: body.datasetId, consumer: body.consumer, purpose: body.purpose, approver: body.approver, justification: body.justification })); }
  if (method === 'GET' && p === '/api/process/governance') { requireRole('oversight-board'); const fitnessResults = [...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass })); return json(200, app.processGovernance.report(app.events.readAll(), { requiredSequence: ['CaseSubmitted', 'CaseReviewed'], fitnessResults })); }
  if (method === 'GET' && p === '/api/admin/infra-assurance') { requireRole('admin'); return json(200, app.infraAssurance.report()); }
  if (method === 'GET' && p === '/api/admin/quantum-transition') { requireRole('admin'); return json(200, app.quantumTransition.transitionPlan()); }
  if (method === 'GET' && p === '/api/migration/roadmap') { requireRole('admin'); const fitnessResults = [...runTwin(), ...runApp(), ...runInfra()].map((r) => ({ id: r.id, pass: r.pass })); return json(200, app.migration.roadmap({ fitnessResults })); }
  if (method === 'POST' && p === '/api/orchestration/verify') { requireRole('admin'); return json(200, app.formalVerification.proveCorrectness(body.def || {}, { safety: body.safety })); }
  if (method === 'POST' && p === '/api/breakglass') { const u = requireRole('admin'); return json(201, app.iam.breakGlass.request({ principal: body.principal || u.principal, justification: body.justification, approver: body.approver })); }
  if (method === 'GET' && p === '/api/admin/breakglass') { requireRole('admin'); return json(200, { grants: app.iam.breakGlass.ledger() }); }

  // --- Advisory AI (Phase 13) — recommendations only; human approval required ---
  if (method === 'GET' && (m = p.match(/^\/api\/ai\/recommend\/([^/]+)$/))) {
    requireRole('investigator');
    const rows = app.workflow.listReports();
    const cur = app.workflow.status(dec(m[1])); if (!cur) return json(404, { error: 'not-found' });
    const full = { case_code: dec(m[1]), category: (rows.find((r) => r.case_code === dec(m[1])) || {}).category, status: cur.status };
    const rec = app.ai.advisor.recommendPriority(full);
    const q = app.ai.queue.submit(rec, { caseCode: dec(m[1]) });
    return json(200, { recommendation: rec, queued: q });
  }
  if (method === 'GET' && p === '/api/ai/pending') { requireRole('oversight-board'); return json(200, { pending: app.ai.queue.pending() }); }
  // Responsible AI governance (Phase 46) + cryptographic agility (Phase 47).
  if (method === 'GET' && p === '/api/ai/governance') { requireRole('admin'); return json(200, { models: app.ai.governance.catalog(), audit: app.ai.governance.auditTrail() }); }
  if (method === 'GET' && p === '/api/admin/crypto-agility') { requireRole('admin'); return json(200, { signature: app.cryptoAgility.registry.catalog('signature'), pqReadiness: app.cryptoAgility.registry.pqReadiness(), keys: app.cryptoAgility.keys.inventory() }); }
  // Quantum-resilient transition (Phase 57) + national performance observatory (Phase 58).
  if (method === 'GET' && p === '/api/admin/quantum-transition') { requireRole('admin'); return json(200, { roadmap: app.quantumTransition.roadmap(), audit: app.quantumTransition.auditTrail() }); }
  if (method === 'GET' && p === '/api/observatory') { requireRole('oversight-board'); return json(200, app.workflow.observatoryReport()); }
  // Sustainability & lifecycle (Phase 69) + strategic twin 5.0 (Phase 70).
  if (method === 'GET' && p === '/api/admin/sustainability') { requireRole('admin'); return json(200, { metrics: app.sustainability.sustainabilityMetrics(), roadmap: app.sustainability.modernizationRoadmap(), longevity: app.sustainability.longevityAssessment() }); }
  if (method === 'GET' && p === '/api/strategic-twin/report') { requireRole('oversight-board'); return json(200, app.strategic.executiveReport()); }
  if (method === 'POST' && (m = p.match(/^\/api\/ai\/decide\/([^/]+)$/))) { const u = requireRole('oversight-board'); return json(200, app.ai.queue.decide(dec(m[1]), { by: body.by || u.principal, decision: body.decision, note: body.note })); }

  // --- Workflow orchestration (Phase 20) — configurable, versioned ---
  if (method === 'POST' && p === '/api/orchestration/start') { requireRole('investigator'); return json(201, app.orchestration.start(body.defId || 'investigation', { context: body.context })); }
  if (method === 'POST' && (m = p.match(/^\/api\/orchestration\/([^/]+)\/fire$/))) { const u = requireRole('investigator'); return json(200, app.orchestration.fire(dec(m[1]), body.event, { by: u.principal })); }
  if (method === 'GET' && p === '/api/orchestration/analytics') { requireRole('oversight-board'); return json(200, app.orchestration.analytics()); }
  // Workflow simulation (Phase 27): validate a definition before activation.
  if (method === 'POST' && p === '/api/orchestration/simulate') { requireRole('admin'); return json(200, { validation: app.workflowSim.validateForActivation(body.def), execution: app.workflowSim.simulate(body.def, { runs: 200, seed: 1 }) }); }
  // Twin 3.0 predictive operational simulations (Phase 29).
  if (method === 'POST' && p === '/api/twin3/forecast') {
    requireRole('admin');
    const fn = { workload: app.twin3.workloadForecast, staffing: app.twin3.staffingShortage, budget: app.twin3.budgetForecast, incident: app.twin3.incidentTrend }[body.kind];
    if (!fn) throw err(400, 'unknown forecast kind');
    return json(200, fn(body.input || {}));
  }
  // Twin 4.0 national simulation (Phase 44) + resilience validation (Phase 45).
  if (method === 'POST' && p === '/api/twin4/simulate') {
    requireRole('admin');
    const fn = { policy: app.twin4.nationalPolicyChange, budget: app.twin4.budgetReduction, restructuring: app.twin4.agencyRestructuring, legislative: app.twin4.legislativeReform, emergency: app.twin4.emergencyResponse, capacity: app.twin4.longTermCapacity, transformation: app.twin4.nationalTransformation }[body.kind];
    if (!fn) throw err(400, 'unknown national simulation kind');
    return json(200, fn(body.input || {}));
  }
  if (method === 'GET' && p === '/api/admin/resilience') { requireRole('admin'); return json(200, app.resilience.validateResilience()); }
  // Human-governed recovery (Phase 54) + process mining (Phase 56).
  if (method === 'POST' && p === '/api/recovery/recommend') { requireRole('admin'); return json(200, app.recovery.recommend({ incidentType: body.incidentType, context: body.context })); }
  if (method === 'POST' && (m = p.match(/^\/api\/recovery\/([^/]+)\/authorize$/))) { const u = requireRole('admin'); return json(200, app.recovery.authorize(dec(m[1]), { by: u.principal, rationale: body.rationale })); }
  if (method === 'GET' && p === '/api/admin/process-mining') { requireRole('oversight-board'); return json(200, app.workflow.mineProcess()); }
  // National crisis management (Phase 63) + service portfolio (Phase 64).
  if (method === 'POST' && p === '/api/crisis/declare') { requireRole('admin'); return json(201, app.crisis.declare({ type: body.type, severity: body.severity, affectedAgencies: body.affectedAgencies })); }
  if (method === 'POST' && (m = p.match(/^\/api\/crisis\/([^/]+)\/authorize$/))) { const u = requireRole('admin'); return json(200, app.crisis.authorizeOperation(dec(m[1]), { by: u.principal, rationale: body.rationale })); }
  if (method === 'GET' && p === '/api/portfolio') { requireRole('oversight-board'); return json(200, { catalog: app.servicePortfolio.catalog(), recommendations: app.servicePortfolio.recommendations() }); }

  // --- Chain of custody (Phase 16), GIS (Phase 15), compliance (Phase 25) ---
  if (method === 'POST' && p === '/api/custody/record') { const u = requireRole('investigator'); return json(201, app.custody.record({ evidenceId: body.evidenceId, action: body.action, actor: u.principal, contentHash: body.contentHash, witness: body.witness })); }
  if (method === 'GET' && p === '/api/admin/custody/verify') { requireRole('admin'); return json(200, app.custody.verify()); }
  if (method === 'GET' && p === '/api/admin/custody/archive') { requireRole('admin'); return json(200, app.custody.archive()); }
  if (method === 'GET' && p === '/api/geo/heatmap') { requireRole('oversight-board'); return json(200, app.gis.heatmap()); }
  if (method === 'GET' && p === '/api/compliance/assess') { requireRole('admin'); return json(200, app.compliance.assess()); }
  // Privacy engineering (Phase 35) + threat intelligence (Phase 36).
  if (method === 'POST' && p === '/api/privacy/pia') { requireRole('admin'); return json(200, app.privacy.automatedPIA(body.flow || {})); }
  if (method === 'GET' && p === '/api/privacy/anonymization') { requireRole('oversight-board'); return json(200, app.privacy.anonymizationQuality(app.workflow.listReports())); }
  if (method === 'POST' && p === '/api/threat/assess') { requireRole('admin'); return json(200, { device: app.threatIntel.deviceRisk(body.device || {}), anomaly: app.threatIntel.behavioralAnomaly(body.behavior || {}), recommendation: app.threatIntel.recommend(body.context || {}) }); }

  // --- Executive intelligence (Phase 21), Twin 2.0 sims (Phase 17/24), data fabric (Phase 14) ---
  if (method === 'GET' && p === '/api/executive/scorecard') { requireRole('oversight-board'); return json(200, app.workflow.executiveScorecard()); }
  // API governance (Phase 37) + operational decision support (Phase 33, advisory).
  if (method === 'GET' && p === '/api/admin/api-governance') { requireRole('admin'); return json(200, app.apiRegistry.dashboard()); }
  // Capability model (Phase 38), maturity intelligence (Phase 40), developer platform (Phase 39).
  if (method === 'GET' && p === '/api/capability/map') { requireRole('oversight-board'); return json(200, { map: app.capability.map(), heatMap: app.capability.heatMap() }); }
  if (method === 'GET' && p === '/api/admin/maturity') { requireRole('admin'); return json(200, app.maturity.assess()); }
  // Platform evolution intelligence (Phase 49) + National Governance Operations Center (Phase 50).
  if (method === 'GET' && p === '/api/admin/evolution') { requireRole('admin'); return json(200, { ...app.evolution.report(), decisions: app.evolution.adrLog.history(), lifecycle: app.evolution.lifecycle.status() }); }
  if (method === 'GET' && p === '/api/governance/center') { requireRole('oversight-board'); return json(200, app.govOps.snapshot()); }
  // Sovereign Digital Government Command Center (Phase 60) + cross-domain intelligence (Phase 59).
  if (method === 'GET' && p === '/api/command-center') { requireRole('oversight-board'); return json(200, app.commandCenter.snapshot()); }
  if (method === 'GET' && p === '/api/command-center/report') { requireRole('oversight-board'); return json(200, app.commandCenter.strategicReport()); }
  if (method === 'GET' && p === '/api/command-center/readiness') { requireRole('oversight-board'); return json(200, app.commandCenter.nationalReadinessScore()); }
  if (method === 'GET' && p === '/api/developer/sdk') { requireRole('admin'); return { status: 200, body: app.devPlatform.generateClientSdk(), type: 'text/plain' }; }
  if (method === 'GET' && p === '/api/developer/harness') { requireRole('admin'); return json(200, app.devPlatform.testHarness()); }
  // Knowledge repository (Phase 67) + capability marketplace (Phase 68).
  if (method === 'GET' && p === '/api/knowledge') { requireRole('oversight-board'); return json(200, { search: app.knowledge.search(url.searchParams.get('q') || 'adr'), integrity: app.knowledge.verify().ok }); }
  if (method === 'GET' && p === '/api/capability-marketplace') { requireRole('investigator'); return json(200, { catalog: app.capabilityMarketplace.discover() }); }
  if (method === 'GET' && p === '/api/decision-support') { requireRole('oversight-board'); const k = app.workflow.analytics().kpis; return json(200, { predictiveKpis: app.decisionSupport.predictiveKpis({ openCases: k.backlog, arrivalPerDay: 20, resolvedPerDay: 18 }), completion: app.decisionSupport.completionForecast({ openCases: k.backlog, resolvedPerDay: 18 }) }); }
  if (method === 'POST' && p === '/api/twin2/simulate') {
    requireRole('admin');
    const k = body.kind;
    const fn = { capacity: app.twin2.capacityForecast, failure: app.twin2.failurePrediction, recovery: app.twin2.recoverySimulation, deployment: app.twin2.deploymentSimulation, failover: app.twin2.failoverSimulation }[k];
    if (!fn) throw err(400, 'unknown simulation kind');
    return json(200, { kind: k, result: fn(body.input || {}) });
  }
  if (method === 'GET' && p === '/api/fabric/catalog') { requireRole('admin'); return json(200, { subjects: app.fabric.schemaRegistry.subjects(), services: app.fabric.serviceRegistry.list(), canonical: Object.keys(app.fabric.canonical) }); }
  // Data provenance (Phase 43) + interoperability (Phase 48).
  if (method === 'GET' && (m = p.match(/^\/api\/provenance\/([^/]+)$/))) { requireRole('investigator'); return json(200, { trace: app.fabric.provenance.trace(dec(m[1])), roots: app.fabric.provenance.roots(dec(m[1])), verified: app.fabric.provenance.verify().ok }); }
  if (method === 'GET' && p === '/api/interop/profiles') { requireRole('admin'); return json(200, { profile: app.fabric.interop.latest('case-exchange'), vocabulary: app.fabric.vocabulary.all() }); }
  if (method === 'POST' && p === '/api/interop/validate') { requireRole('admin'); return json(200, app.fabric.interop.validateExchange(body.profile || 'case-exchange', body.payload || {})); }
  // Digital legislation (Phase 53) + national data marketplace (Phase 55).
  if (method === 'GET' && p === '/api/legislation') { requireRole('oversight-board'); return json(200, { instruments: app.legislation.registryList(), dependencyGraph: app.legislation.dependencyGraph() }); }
  if (method === 'GET' && (m = p.match(/^\/api\/legislation\/([^/]+)\/impact$/))) { requireRole('oversight-board'); return json(200, app.legislation.impact(dec(m[1]))); }
  if (method === 'GET' && p === '/api/marketplace') { requireRole('investigator'); return json(200, { datasets: app.fabric.marketplace.discover() }); }

  // Enterprise event bus (Phase 28) + federation (Phase 34).
  if (method === 'GET' && p === '/api/eventbus/topics') { requireRole('admin'); return json(200, { topics: app.eventBus.topics(), deadLetters: app.eventBus.deadLetters() }); }
  if (method === 'GET' && (m = p.match(/^\/api\/eventbus\/([^/]+)\/replay$/))) { requireRole('admin'); return json(200, { replay: app.eventBus.replay(dec(m[1]), { fromSeq: Number(url.searchParams.get('fromSeq') || 0) }) }); }
  if (method === 'GET' && p === '/api/federation/grants') { requireRole('admin'); return json(200, { grants: app.federation.grants(), audit: app.federation.auditTrail() }); }
  if (method === 'POST' && p === '/api/federation/authorize') { const u = requireRole('admin'); return json(201, app.federation.authorize({ fromTenant: body.fromTenant, toTenant: body.toTenant, scopes: body.scopes, approver: u.principal, requester: body.requester })); }
  // National ecosystem federation (Phase 61) + digital asset governance (Phase 62).
  if (method === 'GET' && p === '/api/ecosystem/federation') { requireRole('admin'); return json(200, { members: app.ecosystemFederation.members(), agreements: app.ecosystemFederation.agreements() }); }
  if (method === 'GET' && p === '/api/assets') { requireRole('admin'); return json(200, { catalog: app.assetGovernance.catalog(), portfolioHealth: app.assetGovernance.portfolioHealth(), dependencies: app.assetGovernance.dependencyMap() }); }
  if (method === 'GET' && (m = p.match(/^\/api\/assets\/([^/]+)\/trace$/))) { requireRole('admin'); return json(200, { trace: app.assetGovernance.trace(dec(m[1])), health: app.assetGovernance.health(dec(m[1])) }); }
  // Supply-chain governance (Phase 65) + adaptive governance (Phase 66).
  if (method === 'GET' && p === '/api/admin/supply-chain') { requireRole('admin'); const { sbom } = require('../scripts/devsecops'); const s = sbom(); return json(200, { deploymentGate: app.supplyChain.validateForDeployment((s.dependencies || []).map((d) => ({ name: d, version: '*' }))), audit: app.supplyChain.auditTrail() }); }
  if (method === 'GET' && p === '/api/admin/adaptive-governance') { requireRole('admin'); return json(200, app.adaptiveGovernance.assess({ effectivenessScore: 1 })); }

  throw err(404, 'not-found');
}

function json(status, body) { return { status, body, type: 'application/json' }; }
function page(name) { return { status: 200, body: fs.readFileSync(path.join(__dirname, '..', 'ui', name), 'utf8'), type: 'text/html' }; }
function dec(s) { return decodeURIComponent(s); }

function createServer(overrides = {}) {
  const app = overrides.app || createApp(overrides);
  return http.createServer(async (req, res) => {
    // Distributed tracing: continue an incoming trace (traceparent) or start a new one.
    const span = app.tracer.startSpan('http.request', { traceparent: req.headers.traceparent, attrs: { method: req.method } });
    const traceId = span.traceId;
    const start = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req);
    let out;
    try {
      out = await route(app, req, url, body);
    } catch (e) {
      out = json(e.status || 500, { error: e.message, traceId });
      if (!e.status || e.status >= 500) app.logger.error('request.error', { traceId, path: url.pathname, error: e.message });
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    span.setAttr('route', routeLabel(url.pathname)); span.setAttr('status', out.status);
    span.end(out.status >= 500 ? 'error' : 'ok');
    app.metrics.inc('njtip_http_requests_total', { route: routeLabel(url.pathname), status: out.status });
    app.metrics.observe('njtip_http_latency_ms', ms);
    // Structured, PII-redacting access log (never logs body/headers/identity).
    app.logger.info('request', { traceId, method: req.method, path: url.pathname, status: out.status, ms: Math.round(ms) });
    const payload = out.type === 'application/json' ? JSON.stringify(out.body) : out.body;
    res.writeHead(out.status, { 'content-type': out.type, 'x-njtip-synthetic': 'true', 'x-trace-id': traceId, 'traceparent': span.traceparent() });
    res.end(payload);
  });
}

function routeLabel(p) { return p.replace(/NJ-[A-Z0-9]+/g, ':code').replace(/[0-9]+/g, ':n'); }
function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch (_) { r({}); } }); }); }

if (require.main === module) {
  const cfg = configMod.load();
  createServer().listen(cfg.port, () => console.log(`NJTIP v${cfg.version} (${cfg.mode}/${cfg.persistence}) listening on http://localhost:${cfg.port}`));
}

module.exports = { createServer, twinValidate, CREDS };
