'use strict';
// Stable Integration Contracts (Stabilization Part 3). Every interaction between bounded
// contexts is declared here as a VERSIONED CONTRACT: API operations, domain events and
// canonical data schemas, each with its owner, consumers, field set, authentication,
// authorization, error model and stability.
//
// The rule this module enforces: INTERFACES STAY STABLE WHILE INTERNALS EVOLVE. A revision
// that breaks a consumer is REFUSED unless the caller explicitly takes a major version and
// records a deprecation window — fail-closed, deterministic, no wall-clock.
const contextMap = require('../architecture/context-map');

// The canonical error model. Every contract may only declare errors from this closed set,
// so a consumer can handle failures uniformly across contexts.
const CANONICAL_ERRORS = {
  VALIDATION_FAILED: { status: 400, retryable: false, meaning: 'The request violated the declared schema or field rules.' },
  IDENTITY_REFUSED: { status: 400, retryable: false, meaning: 'An identity or content field was supplied where the contract forbids one.' },
  UNAUTHENTICATED: { status: 401, retryable: false, meaning: 'No valid session or federated token was presented.' },
  POLICY_DENIED: { status: 403, retryable: false, meaning: 'Default-deny authorization refused the action.' },
  NOT_FOUND: { status: 404, retryable: false, meaning: 'The addressed resource does not exist (or is not visible to this principal).' },
  STATE_CONFLICT: { status: 409, retryable: false, meaning: 'The requested transition is illegal for the current lifecycle state.' },
  HUMAN_APPROVAL_REQUIRED: { status: 409, retryable: false, meaning: 'The action requires a recorded decision by a named human authority.' },
  RATE_LIMITED: { status: 429, retryable: true, meaning: 'The consumer exceeded its governed rate allocation.' },
  UPSTREAM_UNAVAILABLE: { status: 503, retryable: true, meaning: 'A downstream port failed closed; the platform did not degrade silently.' },
};

const KINDS = new Set(['api', 'event', 'schema']);
const STABILITY = new Set(['stable', 'beta', 'deprecated']);
// Authentication modes. `anonymous` is a first-class, deliberate mode: the reporting path
// must never require an identity.
const AUTHENTICATION = new Set(['anonymous', 'case-code', 'session', 'federated-oidc', 'internal']);

// Identity/content fields no contract may ever carry (privacy shared kernel).
const FORBIDDEN_FIELDS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'dob', 'ip', 'content', 'reporter']);

const c = (id, spec) => [id, spec];

// The published contract set (v1). Field lists are contract surface, never payload data.
const DEFAULT_CONTRACTS = Object.fromEntries([
  // --- API contracts (open host service) ---
  c('api.reports.submit', { kind: 'api', operation: 'POST /api/reports', owner: 'intake', consumers: ['external-consumer'],
    fields: { required: ['category'], optional: ['extra'] },
    authentication: 'anonymous', authorization: 'none — anonymous intake is a constitutional guarantee',
    errors: ['VALIDATION_FAILED', 'IDENTITY_REFUSED', 'POLICY_DENIED'], stability: 'stable',
    note: 'Identity fields are refused, not ignored.' }),
  c('api.reports.status', { kind: 'api', operation: 'GET /api/reports/{case_code}/status', owner: 'intake', consumers: ['external-consumer'],
    fields: { required: ['case_code'], optional: [] }, authentication: 'case-code', authorization: 'possession of the case code only',
    errors: ['NOT_FOUND'], stability: 'stable' }),
  c('api.evidence.attach', { kind: 'api', operation: 'POST /api/reports/{case_code}/evidence', owner: 'custody', consumers: ['external-consumer'],
    fields: { required: ['case_code'], optional: [] }, authentication: 'case-code', authorization: 'possession of the case code only',
    errors: ['NOT_FOUND', 'VALIDATION_FAILED'], stability: 'stable', note: 'Payload is encrypted at the boundary; the store refuses plaintext.' }),
  c('api.investigator.review', { kind: 'api', operation: 'POST /api/investigator/{case_code}/review', owner: 'investigation', consumers: ['external-consumer'],
    fields: { required: ['case_code'], optional: ['note', 'disposition'] }, authentication: 'session', authorization: 'role=investigator, matter-scoped, JIT',
    errors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'NOT_FOUND'], stability: 'stable' }),
  c('api.case.transition', { kind: 'api', operation: 'POST /api/investigator/{case_code}/transition', owner: 'investigation', consumers: ['external-consumer'],
    fields: { required: ['case_code', 'event'], optional: [] }, authentication: 'session', authorization: 'RBAC+ABAC permission=transition-case',
    errors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'STATE_CONFLICT'], stability: 'stable' }),
  c('api.oversight.dashboard', { kind: 'api', operation: 'GET /api/oversight/dashboard', owner: 'analytics', consumers: ['external-consumer'],
    fields: { required: [], optional: ['from', 'to'] }, authentication: 'session', authorization: 'role=oversight-board',
    errors: ['UNAUTHENTICATED', 'POLICY_DENIED'], stability: 'stable', note: 'Aggregate only; small cells suppressed.' }),
  c('api.governance.decision', { kind: 'api', operation: 'POST /api/governance/decisions', owner: 'governance-oversight', consumers: ['external-consumer'],
    fields: { required: ['subject', 'verdict', 'rationale'], optional: ['reviewer'] }, authentication: 'session', authorization: 'role=oversight-board',
    errors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'VALIDATION_FAILED'], stability: 'stable', note: 'Human-only. The platform records the decision; it never makes one.' }),
  c('api.assurance.evidence', { kind: 'api', operation: 'GET /api/assurance/evidence-package', owner: 'assurance', consumers: ['external-consumer'],
    fields: { required: [], optional: [] }, authentication: 'session', authorization: 'role=admin',
    errors: ['UNAUTHENTICATED', 'POLICY_DENIED'], stability: 'stable', note: 'Evidence ≠ authorization.' }),
  c('api.data-exchange.request', { kind: 'api', operation: 'POST /api/data-exchange/agreements', owner: 'data-exchange', consumers: ['external-agency-consumer'],
    fields: { required: ['datasetId', 'consumer', 'purpose'], optional: ['approver'] }, authentication: 'federated-oidc', authorization: 'data steward approval; purpose must be permitted',
    errors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'HUMAN_APPROVAL_REQUIRED', 'VALIDATION_FAILED'], stability: 'stable' }),

  // --- Event contracts (published language; PII-free by construction) ---
  c('event.case.submitted', { kind: 'event', operation: 'CaseSubmitted', owner: 'intake', consumers: ['investigation', 'analytics', 'orchestration'],
    fields: { required: ['case_code', 'category', 'at'], optional: ['recipient'] }, authentication: 'internal', authorization: 'topic ACL: case.events',
    errors: ['VALIDATION_FAILED', 'IDENTITY_REFUSED'], stability: 'stable', ordered: true }),
  c('event.case.reviewed', { kind: 'event', operation: 'CaseReviewed', owner: 'investigation', consumers: ['analytics', 'orchestration'],
    fields: { required: ['case_code', 'actor', 'at'], optional: ['disposition'] }, authentication: 'internal', authorization: 'topic ACL: case.events',
    errors: ['VALIDATION_FAILED'], stability: 'stable', ordered: true }),
  c('event.case.transitioned', { kind: 'event', operation: 'CaseTransitioned', owner: 'investigation', consumers: ['analytics', 'orchestration', 'observability'],
    fields: { required: ['case_code', 'from', 'to', 'at'], optional: [] }, authentication: 'internal', authorization: 'topic ACL: case.events',
    errors: ['VALIDATION_FAILED', 'STATE_CONFLICT'], stability: 'stable', ordered: true }),
  c('event.evidence.attached', { kind: 'event', operation: 'EvidenceAttached', owner: 'custody', consumers: ['investigation', 'analytics'],
    fields: { required: ['case_code', 'evidence_id', 'at'], optional: [] }, authentication: 'internal', authorization: 'topic ACL: case.events',
    errors: ['VALIDATION_FAILED'], stability: 'stable', ordered: true }),
  c('event.governance.decided', { kind: 'event', operation: 'GovernanceDecided', owner: 'governance-oversight', consumers: ['assurance', 'knowledge', 'observability'],
    fields: { required: ['subject', 'verdict', 'at'], optional: [] }, authentication: 'internal', authorization: 'topic ACL: governance.events',
    errors: ['VALIDATION_FAILED'], stability: 'stable', ordered: true, note: 'Emitted only after a named human recorded the decision.' }),

  // --- Canonical schema contracts (shared kernel: canonical-model / pii-free-event-language) ---
  c('schema.EventEnvelope', { kind: 'schema', operation: 'EventEnvelope', owner: 'platform-events',
    consumers: ['intake', 'investigation', 'custody', 'orchestration', 'analytics', 'governance-oversight', 'observability'],
    fields: { required: ['eventId', 'type', 'streamId', 'sequence', 'at', 'digest'], optional: ['actor', 'previousDigest'] },
    authentication: 'internal', authorization: 'published language — every producer conforms',
    errors: ['VALIDATION_FAILED', 'IDENTITY_REFUSED'], stability: 'stable',
    note: 'The envelope every cross-context notification conforms to. The payload is PII-free by construction; the log is hash-chained (digest ← previousDigest).' }),
  c('schema.Case', { kind: 'schema', operation: 'Case', owner: 'data-fabric', consumers: ['data-exchange', 'api-governance', 'analytics'],
    fields: { required: ['caseCode', 'category', 'status'], optional: ['recipient', 'stage'] }, authentication: 'internal', authorization: 'canonical model — read by contract',
    errors: ['VALIDATION_FAILED'], stability: 'stable', note: 'Mirrors CANONICAL_MODEL.Case; the HTTP surface exposes the same value as case_code.' }),
  c('schema.EvidenceRef', { kind: 'schema', operation: 'EvidenceRef', owner: 'data-fabric', consumers: ['data-exchange', 'api-governance'],
    fields: { required: ['evidenceId', 'contentHash'], optional: ['state'] }, authentication: 'internal', authorization: 'canonical model — read by contract',
    errors: ['VALIDATION_FAILED'], stability: 'stable', note: 'Mirrors CANONICAL_MODEL.EvidenceRef.' }),
  c('schema.Agency', { kind: 'schema', operation: 'Agency', owner: 'data-fabric', consumers: ['data-exchange', 'tenancy-federation'],
    fields: { required: ['agencyId'], optional: ['agencyName', 'jurisdiction'] }, authentication: 'internal', authorization: 'canonical model — read by contract',
    errors: ['VALIDATION_FAILED'], stability: 'stable',
    note: 'CANONICAL_MODEL.Agency.name is published as agencyName so that a bare `name` never appears on a wire contract — the identity denylist stays absolute.' }),
]);

// Versioning policy (published so consumers can plan).
const VERSIONING_POLICY = {
  scheme: 'semver per contract; the HTTP surface is additionally versioned by path prefix (/v1)',
  major: 'A breaking change: a field removed, a required field added, a type changed, an error code removed, or authentication/authorization tightened or relaxed.',
  minor: 'A backward-compatible addition: an optional field or a new error code.',
  patch: 'Documentation, stability label, or note only.',
  breakingChangeProcess: 'New major version published side by side → consumers migrated → previous major deprecated with a recorded sunset → retired. Dual-run is mandatory; a silent break is a build failure.',
  deprecation: 'A contract may only be retired from the deprecated state, and only after its sunset window is recorded.',
};

class ContractRegistry {
  constructor({ seed = DEFAULT_CONTRACTS } = {}) {
    this._contracts = new Map();
    for (const [id, spec] of Object.entries(seed)) this.register(id, spec);
  }

  register(id, spec) {
    if (!id) throw new Error('contract id is required');
    if (this._contracts.has(id)) throw new Error('contract already registered (use revise)');
    const c0 = this._normalize(id, spec, 1);
    this._contracts.set(id, { id, versions: [c0], deprecatedFrom: null, sunsetAt: null });
    return this.describe(id);
  }

  _normalize(id, spec, version) {
    if (!KINDS.has(spec.kind)) throw new Error(`${id}: unknown contract kind '${spec.kind}'`);
    if (!AUTHENTICATION.has(spec.authentication)) throw new Error(`${id}: unknown authentication '${spec.authentication}'`);
    if (!STABILITY.has(spec.stability || 'stable')) throw new Error(`${id}: unknown stability '${spec.stability}'`);
    for (const e of spec.errors || []) if (!CANONICAL_ERRORS[e]) throw new Error(`${id}: error '${e}' is outside the canonical error model`);
    const fields = { required: [...(spec.fields?.required || [])], optional: [...(spec.fields?.optional || [])] };
    const leaked = [...fields.required, ...fields.optional].filter((f) => FORBIDDEN_FIELDS.has(String(f).toLowerCase()));
    if (leaked.length) { const e = new Error(`${id}: contract refuses identity/content fields: ${leaked.join(', ')}`); e.failClosed = true; throw e; }
    return {
      version, kind: spec.kind, operation: spec.operation, owner: spec.owner, consumers: [...(spec.consumers || [])],
      fields, authentication: spec.authentication, authorization: spec.authorization || 'default-deny',
      errors: [...(spec.errors || [])], stability: spec.stability || 'stable', ordered: !!spec.ordered, note: spec.note || null,
    };
  }

  ids() { return [...this._contracts.keys()].sort(); }
  has(id) { return this._contracts.has(id); }
  current(id) { const c1 = this._must(id); return { ...c1.versions[c1.versions.length - 1] }; }
  history(id) { return this._must(id).versions.map((v) => ({ ...v })); }
  describe(id) { const c1 = this._must(id); return { id, ...this.current(id), versions: c1.versions.length, deprecatedFrom: c1.deprecatedFrom, sunsetAt: c1.sunsetAt }; }
  list({ kind } = {}) { return this.ids().map((id) => this.describe(id)).filter((c1) => !kind || c1.kind === kind); }

  // --- Compatibility -------------------------------------------------------------------

  // Compare two contract versions and classify the change. Deterministic and explainable.
  static compatibility(prev, next) {
    const changes = [];
    const prevAll = new Set([...prev.fields.required, ...prev.fields.optional]);
    const nextAll = new Set([...next.fields.required, ...next.fields.optional]);
    for (const f of prevAll) if (!nextAll.has(f)) changes.push({ change: 'field-removed', detail: f, breaking: true });
    for (const f of next.fields.required) if (!prev.fields.required.includes(f)) changes.push({ change: 'required-field-added', detail: f, breaking: true });
    for (const f of next.fields.optional) if (!prevAll.has(f)) changes.push({ change: 'optional-field-added', detail: f, breaking: false });
    for (const e of prev.errors) if (!next.errors.includes(e)) changes.push({ change: 'error-removed', detail: e, breaking: true });
    for (const e of next.errors) if (!prev.errors.includes(e)) changes.push({ change: 'error-added', detail: e, breaking: false });
    if (prev.authentication !== next.authentication) changes.push({ change: 'authentication-changed', detail: `${prev.authentication} → ${next.authentication}`, breaking: true, securityRelevant: true });
    if (prev.authorization !== next.authorization) changes.push({ change: 'authorization-changed', detail: `${prev.authorization} → ${next.authorization}`, breaking: true, securityRelevant: true });
    if (prev.kind !== next.kind) changes.push({ change: 'kind-changed', detail: `${prev.kind} → ${next.kind}`, breaking: true });
    if (prev.operation !== next.operation) changes.push({ change: 'operation-changed', detail: `${prev.operation} → ${next.operation}`, breaking: true });
    const breaking = changes.some((x) => x.breaking);
    const requiredBump = breaking ? 'major' : changes.length ? 'minor' : 'patch';
    return { compatible: !breaking, breaking, changes, requiredBump, securityReview: changes.some((x) => x.securityRelevant) };
  }
  compatibility(id, spec) { return ContractRegistry.compatibility(this.current(id), this._normalize(id, { ...this.current(id), ...spec }, 0)); }

  // Revise a contract. A BREAKING revision is refused unless `major: true` is declared AND a
  // sunset window is recorded for the previous major — interfaces do not break silently.
  revise(id, spec, { major = false, sunsetAt = null } = {}) {
    const cur = this.current(id);
    const candidate = this._normalize(id, { ...cur, ...spec }, cur.version + 1);
    const compat = ContractRegistry.compatibility(cur, candidate);
    if (compat.breaking && !major) {
      const e = new Error(`${id}: breaking contract change refused (${compat.changes.filter((x) => x.breaking).map((x) => x.change).join(', ')}) — publish a new major version with a sunset window`);
      e.failClosed = true; e.compatibility = compat; throw e;
    }
    if (compat.breaking && !sunsetAt) { const e = new Error(`${id}: a major contract version requires a recorded sunset for the previous major`); e.failClosed = true; throw e; }
    const rec = this._must(id);
    rec.versions.push(candidate);
    if (compat.breaking) { rec.deprecatedFrom = cur.version; rec.sunsetAt = sunsetAt; }
    return { id, version: candidate.version, ...compat };
  }

  deprecate(id, { sunsetAt }) { const rec = this._must(id); if (!sunsetAt) throw new Error('deprecation requires a recorded sunset'); const cur = this.current(id); cur.stability = 'deprecated'; rec.deprecatedFrom = cur.version; rec.sunsetAt = sunsetAt; return this.describe(id); }

  // --- Traceability & validation -------------------------------------------------------

  // Which contexts exchange data over a declared contract (producer → consumer edges).
  interactions() {
    const out = [];
    for (const id of this.ids()) { const c1 = this.current(id); for (const consumer of c1.consumers) out.push({ contract: id, kind: c1.kind, from: c1.owner, to: consumer }); }
    return out;
  }
  // Contexts that cross a boundary by event or HTTP but have no registered contract.
  coverage() {
    const covered = new Set();
    for (const id of this.ids()) { const c1 = this.current(id); covered.add(c1.owner); for (const x of c1.consumers) covered.add(x); }
    const needsContract = new Set();
    for (const p of contextMap.communicationPaths()) if (p.mechanism === 'domain-event' || p.mechanism === 'http-api') { needsContract.add(p.from); needsContract.add(p.to); }
    const uncovered = [...needsContract].filter((ctx) => !covered.has(ctx)).sort();
    return { needsContract: [...needsContract].sort(), covered: [...covered].sort(), uncovered };
  }

  validate() {
    const violations = [];
    const known = new Set(contextMap.ids());
    for (const id of this.ids()) {
      const c1 = this.current(id);
      if (!known.has(c1.owner)) violations.push(`${id}: owner '${c1.owner}' is not a bounded context`);
      if (!c1.operation) violations.push(`${id}: no operation declared`);
      if (!c1.authorization) violations.push(`${id}: no authorization rule declared`);
      if (!c1.errors.length) violations.push(`${id}: declares no errors (the canonical error model is mandatory)`);
      for (const e of c1.errors) if (!CANONICAL_ERRORS[e]) violations.push(`${id}: non-canonical error '${e}'`);
      for (const f of [...c1.fields.required, ...c1.fields.optional]) if (FORBIDDEN_FIELDS.has(String(f).toLowerCase())) violations.push(`${id}: identity/content field '${f}' in the contract surface`);
      if (c1.kind === 'event' && !c1.ordered) violations.push(`${id}: event contracts must declare their ordering guarantee`);
      // Internal consumers must be real contexts; external ones must be declared ACL targets.
      const aclTargets = new Set(contextMap.antiCorruptionLayers().flatMap((a) => a.translates));
      for (const consumer of c1.consumers) if (!known.has(consumer) && !aclTargets.has(consumer)) violations.push(`${id}: consumer '${consumer}' is neither a bounded context nor a declared ACL target`);
      const rec = this._must(id);
      if (rec.deprecatedFrom !== null && !rec.sunsetAt) violations.push(`${id}: deprecated without a recorded sunset`);
    }
    for (const ctx of this.coverage().uncovered) violations.push(`bounded context '${ctx}' crosses a boundary with no registered contract`);
    return { valid: violations.length === 0, violations, contracts: this.ids().length };
  }

  // --- Generated artifacts --------------------------------------------------------------

  // OpenAPI path fragment for the registered API contracts (deterministic; merges with the
  // hand-built spec in src/openapi.js rather than replacing it).
  toOpenApi() {
    const paths = {};
    for (const c1 of this.list({ kind: 'api' })) {
      const [method, route] = c1.operation.split(' ');
      const op = {
        operationId: c1.id.replace(/[.-]/g, '_'),
        summary: `${c1.id} (owner: ${c1.owner})`,
        'x-contract': { id: c1.id, version: c1.version, stability: c1.stability, owner: c1.owner, authentication: c1.authentication, authorization: c1.authorization },
        responses: Object.fromEntries(c1.errors.map((e) => [String(CANONICAL_ERRORS[e].status), { description: `${e}: ${CANONICAL_ERRORS[e].meaning}` }]).concat([['200', { description: 'Success' }]])),
      };
      if (c1.authentication === 'session' || c1.authentication === 'federated-oidc') op.security = [{ bearerAuth: [] }];
      paths[route] = { ...(paths[route] || {}), [method.toLowerCase()]: op };
    }
    return { openapi: '3.1.0', info: { title: 'NJTIP integration contracts', version: '1.0.0' }, paths };
  }
  // Event definitions in a broker-neutral shape (topic, ordering, payload contract).
  eventDefinitions() {
    return this.list({ kind: 'event' }).map((c1) => ({ event: c1.operation, contract: c1.id, version: c1.version, producer: c1.owner, consumers: c1.consumers, ordered: c1.ordered, payload: c1.fields, piiFree: true, errors: c1.errors }));
  }
  // The whole catalogue, as served to the API and rendered into docs/integration-contracts.md.
  catalogue() {
    return {
      versioningPolicy: VERSIONING_POLICY, errorModel: CANONICAL_ERRORS,
      contracts: this.list(), interactions: this.interactions(), coverage: this.coverage(),
      eventDefinitions: this.eventDefinitions(), validation: this.validate(),
      note: 'Interfaces are stable while internals evolve. A breaking revision is refused unless a major version and a sunset are declared.',
    };
  }
  _must(id) { const c1 = this._contracts.get(id); if (!c1) throw new Error('unknown contract: ' + id); return c1; }
}

module.exports = { ContractRegistry, CANONICAL_ERRORS, VERSIONING_POLICY, DEFAULT_CONTRACTS, FORBIDDEN_FIELDS, KINDS, STABILITY, AUTHENTICATION };
