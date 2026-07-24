'use strict';
// Stable API contract for the v1.0 MVP vertical slice (OpenAPI 3.1). Generated
// programmatically so it stays in lock-step with the server. Versioned under /v1.
function spec() {
  return {
    openapi: '3.1.0',
    info: { title: 'NJTIP MVP API', version: '1.0.0', description: 'Anonymous reporting → governance vertical slice. SYNTHETIC ONLY.' },
    servers: [{ url: '/', description: 'v1' }],
    paths: {
      '/api/reports': { post: {
        summary: 'Submit an anonymous report (no identity is accepted)', operationId: 'submitReport',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSubmission' } } } },
        responses: { 201: { description: 'Accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/CaseHandle' } } } }, 400: ref('Error'), 403: ref('Error') } } },
      '/api/reports/{case_code}/status': { get: {
        summary: 'Get status by case code (no identifier required)', operationId: 'getStatus',
        parameters: [pathParam('case_code')], responses: { 200: { description: 'Status' }, 404: ref('Error') } } },
      '/api/reports/{case_code}/evidence': { post: {
        summary: 'Attach evidence (chain of custody)', operationId: 'attachEvidence',
        parameters: [pathParam('case_code')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } } } },
        responses: { 201: { description: 'Ingested' }, 404: ref('Error') } } },
      '/api/investigator/{case_code}/review': { post: {
        summary: 'Investigator review (JIT, FIDO2, matter-scoped)', operationId: 'investigatorReview', security: [{ bearerAuth: [] }],
        parameters: [pathParam('case_code')], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' }, disposition: { type: 'string', enum: ['reviewed', 'escalate'] } } } } } },
        responses: { 200: { description: 'Reviewed' }, 401: ref('Error'), 403: ref('Error') } } },
      '/api/investigator/{case_code}/transition': { post: {
        summary: 'Advance a case through its lifecycle (RBAC+ABAC gated)', operationId: 'transitionCase', security: [{ bearerAuth: [] }],
        parameters: [pathParam('case_code')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['event'], properties: { event: { type: 'string', enum: ['review', 'escalate', 'resolve', 'close'] } } } } } },
        responses: { 200: { description: 'Transitioned' }, 401: ref('Error'), 403: ref('Error'), 409: ref('Error') } } },
      '/api/investigator/{case_code}/evidence/{evidence_id}/transition': { post: {
        summary: 'Advance an evidence item through its handling lifecycle', operationId: 'transitionEvidence', security: [{ bearerAuth: [] }],
        parameters: [pathParam('case_code'), pathParam('evidence_id')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['event'], properties: { event: { type: 'string', enum: ['seal', 'open', 'admit', 'exclude', 'purge'] } } } } } },
        responses: { 200: { description: 'Transitioned' }, 401: ref('Error'), 403: ref('Error'), 409: ref('Error') } } },
      '/api/investigator/{case_code}/assign': { post: { summary: 'Assign a case to the least-loaded eligible investigator', operationId: 'assignCase', security: [{ bearerAuth: [] }], parameters: [pathParam('case_code')], responses: { 200: { description: 'Assigned' }, 401: ref('Error'), 409: ref('Error') } } },
      '/api/investigator/{case_code}/stage': { post: { summary: 'Advance the multi-stage review chain', operationId: 'advanceStage', security: [{ bearerAuth: [] }], parameters: [pathParam('case_code')], responses: { 200: { description: 'Advanced' }, 401: ref('Error'), 409: ref('Error') } } },
      '/api/investigator/workloads': { get: { summary: 'Investigator workload balance (non-identifying)', operationId: 'workloads', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Workloads' }, 401: ref('Error') } } },
      '/api/reports/{case_code}/sla': { get: { summary: 'SLA status (due dates + breach)', operationId: 'slaStatus', parameters: [pathParam('case_code')], responses: { 200: { description: 'SLA status' }, 404: ref('Error') } } },
      '/api/reports/{case_code}/retention': { get: { summary: 'Retention plan (read-only; legal hold overrides)', operationId: 'retentionPlan', security: [{ bearerAuth: [] }], parameters: [pathParam('case_code')], responses: { 200: { description: 'Retention plan' }, 401: ref('Error') } } },
      '/api/reports/{case_code}/appeal': { post: { summary: 'File an appeal against a resolved/closed case', operationId: 'fileAppeal', parameters: [pathParam('case_code')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['by', 'reason'], properties: { by: { type: 'string' }, reason: { type: 'string' } } } } } }, responses: { 201: { description: 'Appeal filed' }, 400: ref('Error'), 409: ref('Error') } } },
      '/api/oversight/dashboard': { get: { summary: 'Non-attributable aggregate dashboard', operationId: 'oversightDashboard', responses: { 200: { description: 'Aggregates' } } } },
      '/api/governance/decisions': { post: {
        summary: 'Record a HUMAN governance decision (never automated)', operationId: 'recordGovernanceDecision', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/GovernanceDecision' } } } },
        responses: { 201: { description: 'Recorded' }, 401: ref('Error') } } },
      '/api/search': { get: { summary: 'Full-text case search (non-identifying fields only)', operationId: 'searchCases', security: [{ bearerAuth: [] }], parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Results' }, 401: ref('Error') } } },
      '/api/analytics': { get: { summary: 'Aggregate analytics (KPIs, trends, suppressed small cells)', operationId: 'analytics', parameters: [{ name: 'by', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Analytics' } } } },
      '/api/analytics/export': { get: { summary: 'Export non-identifying rows (json|csv)', operationId: 'analyticsExport', security: [{ bearerAuth: [] }], parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } }], responses: { 200: { description: 'Export' }, 401: ref('Error') } } },
      '/api/reports/{case_code}/timeline': { get: { summary: 'Investigation timeline (non-identifying events)', operationId: 'caseTimeline', security: [{ bearerAuth: [] }], parameters: [pathParam('case_code')], responses: { 200: { description: 'Timeline' }, 401: ref('Error'), 404: ref('Error') } } },
      '/api/evidence/bundle': { get: { summary: 'Generate deterministic workflow evidence', operationId: 'generateEvidence', responses: { 200: { description: 'Evidence bundle' } } } },
      '/api/twin/validate': { get: { summary: 'Run the Twin + application fitness gates', operationId: 'twinValidate', responses: { 200: { description: 'Invariant results (twin + app)' } } } },
      '/api/assurance/evidence-package': { get: { summary: 'Deterministic, signed assurance evidence package (admin)', operationId: 'evidencePackage', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Signed package' }, 401: ref('Error') } } },
      '/api/assurance/readiness': { get: { summary: 'Human-gated operational readiness assessment (admin) — never authorizes', operationId: 'readiness', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Readiness signals; decision is human-gated' }, 401: ref('Error') } } },
      '/api/auth/session': { post: { summary: 'Synthetic login → session token (prod: OIDC/FIDO2)', operationId: 'login', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['credential'], properties: { credential: { type: 'string' } } } } } }, responses: { 200: { description: 'Token issued' }, 401: ref('Error') } } },
      '/api/reports/{case_code}/notifications': { get: { summary: 'Poll non-identifying notifications by case code', operationId: 'notifications', parameters: [pathParam('case_code')], responses: { 200: { description: 'Notifications' }, 404: ref('Error') } } },
      '/api/reports?': { get: { summary: 'Investigator queue (search/filter)', operationId: 'investigatorQueue', security: [{ bearerAuth: [] }], parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Queue' }, 401: ref('Error') } } },
      '/api/oversight/report': { get: { summary: 'Aggregate oversight report', operationId: 'oversightReport', responses: { 200: { description: 'Report' } } } },
      '/api/admin/health': { get: { summary: 'System health (admin)', operationId: 'adminHealth', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Health' }, 401: ref('Error') } } },
      '/api/admin/metrics': { get: { summary: 'Metrics snapshot (admin)', operationId: 'adminMetrics', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Metrics' } } } },
      '/api/admin/config': { get: { summary: 'Redacted configuration (admin)', operationId: 'adminConfig', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Config (secrets redacted)' } } } },
      '/api/admin/slo': { get: { summary: 'SLO/SLI evaluation with error budgets + alerts (admin)', operationId: 'adminSlo', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SLO status' }, 401: ref('Error') } } },
      '/api/admin/traces': { get: { summary: 'Recent distributed-trace spans (admin; non-identifying)', operationId: 'adminTraces', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Spans' }, 401: ref('Error') } } },
      '/api/reports/{case_code}/events': { get: { summary: 'Case event stream + replayed state (event sourcing)', operationId: 'caseEvents', security: [{ bearerAuth: [] }], parameters: [pathParam('case_code')], responses: { 200: { description: 'Events + replay' }, 401: ref('Error') } } },
      '/api/admin/events/verify': { get: { summary: 'Verify the immutable event-log hash chain (admin)', operationId: 'verifyEvents', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Chain status' }, 401: ref('Error') } } },
      '/api/admin/readmodel/rebuild': { get: { summary: 'Rebuild the CQRS read model from events (admin)', operationId: 'rebuildReadModel', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Rebuilt model' }, 401: ref('Error') } } },
      '/healthz': { get: { summary: 'Liveness/health', operationId: 'healthz', responses: { 200: { description: 'Healthy' }, 503: { description: 'Unhealthy' } } } },
      '/readyz': { get: { summary: 'Readiness (architecture invariants held)', operationId: 'readyz', responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } } },
      '/metrics': { get: { summary: 'Prometheus metrics', operationId: 'metrics', responses: { 200: { description: 'text/plain metrics' } } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        ReportSubmission: { type: 'object', required: ['category', 'content'], additionalProperties: false,
          properties: { category: { type: 'string', enum: ['police', 'courts', 'prosecution', 'prison', 'official', 'regulatory', 'other'] }, content: { type: 'string' }, extra: { type: 'object', description: 'MUST NOT contain identity — rejected if it does' } } },
        CaseHandle: { type: 'object', properties: { case_code: { type: 'string' }, recipient: { type: 'string' }, coi: { type: 'string' } } },
        GovernanceDecision: { type: 'object', required: ['verdict', 'rationale'], properties: { reviewer: { type: 'string' }, subject: { type: 'string' }, verdict: { type: 'string' }, rationale: { type: 'string' } } },
        Error: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  };
}
function ref(name) { return { description: name, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } }; }
function pathParam(name) { return { name, in: 'path', required: true, schema: { type: 'string' } }; }

module.exports = { spec };
