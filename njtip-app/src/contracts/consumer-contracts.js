'use strict';
// Consumer-Driven Contract Testing (Phase 10, Part 12). The provider's contract registry says
// what the platform OFFERS. This says what each consumer actually DEPENDS ON — and verifies the
// provider still satisfies every consumer expectation before a change ships.
//
// The asymmetry that makes it useful: a provider may add freely, but may only remove or tighten
// something NO consumer depends on. `verifyAll()` is the gate; `impactOfChange()` answers "who
// breaks if I do this?" before the change is made rather than after it is deployed.
//
// Deterministic; no wall-clock.
const { ContractRegistry, CANONICAL_ERRORS } = require('./integration-contracts');

// Impact is weighted by whom a change breaks. Breaking the constitutional path once is worse than
// inconveniencing several internal pipelines, and the score has to say so.
const CRITICALITY_WEIGHT = { constitutional: 60, critical: 30, important: 10 };

// Consumer expectations against the published provider contracts. Each names the consumer, the
// contract it depends on, and precisely WHICH parts of it — fields it reads, fields it sends,
// error codes it handles, and the authentication mode it is built for.
const CONSUMER_EXPECTATIONS = {
  'citizen-web': {
    consumer: 'Citizen web client', owner: 'intake', criticality: 'constitutional',
    expectations: [
      { contract: 'api.reports.submit', sends: ['category'], reads: [], handlesErrors: ['VALIDATION_FAILED', 'IDENTITY_REFUSED'], authentication: 'anonymous' },
      { contract: 'api.reports.status', sends: ['case_code'], reads: [], handlesErrors: ['NOT_FOUND'], authentication: 'case-code' },
    ],
  },
  'investigator-console': {
    consumer: 'Investigator console', owner: 'investigation', criticality: 'critical',
    expectations: [
      { contract: 'api.investigator.review', sends: ['case_code'], reads: [], handlesErrors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'NOT_FOUND'], authentication: 'session' },
      { contract: 'api.case.transition', sends: ['case_code', 'event'], reads: [], handlesErrors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'STATE_CONFLICT'], authentication: 'session' },
    ],
  },
  'oversight-portal': {
    consumer: 'Oversight portal', owner: 'governance-oversight', criticality: 'critical',
    expectations: [
      { contract: 'api.oversight.dashboard', sends: [], reads: [], handlesErrors: ['UNAUTHENTICATED', 'POLICY_DENIED'], authentication: 'session' },
      { contract: 'api.governance.decision', sends: ['subject', 'verdict', 'rationale'], reads: [], handlesErrors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'VALIDATION_FAILED'], authentication: 'session' },
    ],
  },
  'partner-agency': {
    consumer: 'Partner agency integration', owner: 'data-exchange', criticality: 'important',
    expectations: [
      { contract: 'api.data-exchange.request', sends: ['datasetId', 'consumer', 'purpose'], reads: [], handlesErrors: ['UNAUTHENTICATED', 'POLICY_DENIED', 'HUMAN_APPROVAL_REQUIRED'], authentication: 'federated-oidc' },
      { contract: 'schema.Case', sends: [], reads: ['caseCode', 'category', 'status'], handlesErrors: ['VALIDATION_FAILED'], authentication: 'internal' },
    ],
  },
  'analytics-pipeline': {
    consumer: 'Analytics pipeline', owner: 'analytics', criticality: 'important',
    expectations: [
      { contract: 'event.case.submitted', sends: [], reads: ['case_code', 'category', 'at'], handlesErrors: ['VALIDATION_FAILED'], authentication: 'internal' },
      { contract: 'event.case.transitioned', sends: [], reads: ['case_code', 'from', 'to', 'at'], handlesErrors: ['VALIDATION_FAILED'], authentication: 'internal' },
    ],
  },
  'audit-archive': {
    consumer: 'Audit archive', owner: 'assurance', criticality: 'critical',
    expectations: [
      { contract: 'schema.EventEnvelope', sends: [], reads: ['eventId', 'type', 'streamId', 'sequence', 'at', 'digest'], handlesErrors: ['VALIDATION_FAILED'], authentication: 'internal' },
      { contract: 'event.governance.decided', sends: [], reads: ['subject', 'verdict', 'at'], handlesErrors: ['VALIDATION_FAILED'], authentication: 'internal' },
    ],
  },
};

class ConsumerContracts {
  constructor({ registry = null, expectations = CONSUMER_EXPECTATIONS } = {}) {
    this._registry = registry || new ContractRegistry();
    this._expectations = JSON.parse(JSON.stringify(expectations));
  }

  consumers() { return Object.keys(this._expectations).sort(); }
  describe(id) { const c = this._expectations[id]; if (!c) throw new Error('unknown consumer: ' + id); return JSON.parse(JSON.stringify({ id, ...c })); }

  // Register a new consumer expectation (a consumer declares what it depends on).
  register(id, { consumer, owner, criticality = 'important', expectations = [] }) {
    if (!consumer || !owner || !expectations.length) throw new Error('a consumer must name itself, its owner and at least one expectation');
    this._expectations[id] = { consumer, owner, criticality, expectations: JSON.parse(JSON.stringify(expectations)) };
    return this.describe(id);
  }

  // --- Verification ------------------------------------------------------------------------

  // Verify one consumer against the CURRENT provider contracts.
  verify(id, { registry = this._registry } = {}) {
    const c = this.describe(id);
    const results = c.expectations.map((e) => {
      const issues = [];
      if (!registry.has(e.contract)) {
        issues.push(`provider contract '${e.contract}' does not exist`);
        return { contract: e.contract, satisfied: false, issues };
      }
      const provider = registry.current(e.contract);
      const providerFields = new Set([...provider.fields.required, ...provider.fields.optional]);
      for (const f of e.reads) if (!providerFields.has(f)) issues.push(`consumer reads '${f}', which the provider no longer offers`);
      for (const f of e.sends) if (!providerFields.has(f)) issues.push(`consumer sends '${f}', which the provider no longer accepts`);
      // A required field the consumer does not send breaks it just as hard.
      for (const f of provider.fields.required) if (e.sends.length && !e.sends.includes(f)) issues.push(`provider requires '${f}', which this consumer does not send`);
      for (const err of e.handlesErrors) if (!provider.errors.includes(err)) issues.push(`consumer handles '${err}', which the provider no longer declares`);
      // An error the provider added that the consumer does not handle is a warning, not a break.
      const unhandled = provider.errors.filter((err) => !e.handlesErrors.includes(err));
      if (e.authentication !== provider.authentication) issues.push(`authentication changed: consumer expects '${e.authentication}', provider requires '${provider.authentication}'`);
      return { contract: e.contract, satisfied: issues.length === 0, issues, unhandledErrors: unhandled, providerVersion: provider.version, providerStability: provider.stability };
    });
    return { consumer: id, criticality: c.criticality, owner: c.owner, results, satisfied: results.every((r) => r.satisfied), broken: results.filter((r) => !r.satisfied).map((r) => r.contract) };
  }

  // Verify every consumer — the CI gate. Fail-closed.
  verifyAll({ registry = this._registry } = {}) {
    const results = this.consumers().map((id) => this.verify(id, { registry }));
    const broken = results.filter((r) => !r.satisfied);
    return {
      consumers: results.length, results,
      broken: broken.map((r) => ({ consumer: r.consumer, criticality: r.criticality, contracts: r.broken })),
      allSatisfied: broken.length === 0,
      failClosed: true, authorizes: false,
      note: broken.length ? 'A consumer expectation is unmet — the change is a breaking change for a real consumer.' : 'Every consumer expectation is satisfied by the current provider contracts.',
    };
  }

  // --- Impact analysis ------------------------------------------------------------------------

  // Who breaks if this change ships? Answered BEFORE the change, not after the deploy.
  impactOfChange(contractId, spec) {
    const trial = new ContractRegistry();
    if (!trial.has(contractId)) throw new Error('unknown contract: ' + contractId);
    const compat = trial.compatibility(contractId, spec);
    // Apply the candidate to a throwaway registry so consumers can be verified against it.
    const candidate = { ...trial.current(contractId), ...spec };
    const probe = {
      has: (id) => trial.has(id),
      current: (id) => (id === contractId ? candidate : trial.current(id)),
    };
    const before = this.verifyAll({ registry: trial });
    const after = this.verifyAll({ registry: probe });
    const newlyBroken = after.results.filter((a) => !a.satisfied && before.results.find((b) => b.consumer === a.consumer).satisfied);
    return {
      contract: contractId, compatibility: compat,
      affectedConsumers: newlyBroken.map((r) => ({ consumer: r.consumer, criticality: r.criticality, owner: r.owner, issues: r.results.filter((x) => !x.satisfied).flatMap((x) => x.issues) })),
      safe: newlyBroken.length === 0,
      constitutionalImpact: newlyBroken.some((r) => r.criticality === 'constitutional'),
      verdict: newlyBroken.length === 0
        ? (compat.breaking ? 'technically breaking, but no registered consumer depends on the removed surface' : 'backward compatible')
        : `BREAKS ${newlyBroken.length} consumer(s) — publish a new major version with a sunset and migrate them first`,
      note: 'A provider may add freely, but may only remove or tighten something no consumer depends on.',
    };
  }

  // --- Compatibility & lifecycle reporting -----------------------------------------------------------

  // Which consumers depend on each contract (the provider's view of its obligations).
  dependencyMatrix() {
    const matrix = {};
    for (const id of this.consumers()) {
      for (const e of this._expectations[id].expectations) {
        (matrix[e.contract] = matrix[e.contract] || []).push({ consumer: id, criticality: this._expectations[id].criticality });
      }
    }
    for (const k of Object.keys(matrix)) matrix[k].sort((a, b) => a.consumer.localeCompare(b.consumer));
    return matrix;
  }
  // Contracts nobody depends on — candidates for deprecation rather than perpetual maintenance.
  unconsumedContracts() {
    const consumed = new Set(Object.keys(this.dependencyMatrix()));
    return this._registry.ids().filter((id) => !consumed.has(id));
  }
  // Deprecation tracking: a deprecated contract with live consumers is a migration obligation.
  deprecationReport() {
    const matrix = this.dependencyMatrix();
    return this._registry.list().filter((c) => c.stability === 'deprecated' || c.sunsetAt).map((c) => ({
      contract: c.id, stability: c.stability, sunsetAt: c.sunsetAt,
      liveConsumers: (matrix[c.id] || []).map((x) => x.consumer),
      blocked: !!(matrix[c.id] || []).length,
      action: (matrix[c.id] || []).length ? 'migrate the listed consumers before the sunset' : 'safe to retire',
    }));
  }
  // Version lifecycle across the published surface.
  versionLifecycle() {
    return this._registry.list().map((c) => ({ contract: c.id, version: c.version, stability: c.stability, deprecatedFrom: c.deprecatedFrom, sunsetAt: c.sunsetAt, consumers: (this.dependencyMatrix()[c.id] || []).length }));
  }

  // --- Consumer impact analysis (Phase 11, Part 12) --------------------------------------------

  // Impact score, 0 (safe) to 100 (do not ship without a migration). Weighted by who breaks, not
  // by how many — breaking the constitutional path once is worse than inconveniencing five
  // internal pipelines.
  impactScore(contractId, spec) {
    const impact = this.impactOfChange(contractId, spec);
    const matrix = this.dependencyMatrix();
    const dependents = (matrix[contractId] || []).length;
    let score = 0;
    const reasons = [];
    for (const c of impact.affectedConsumers) {
      const w = CRITICALITY_WEIGHT[c.criticality] ?? 10;
      score += w;
      reasons.push(`breaks ${c.consumer} (${c.criticality})`);
    }
    if (impact.compatibility.breaking) { score += 15; reasons.push('the change is technically breaking'); }
    if (dependents >= 3) { score += 10; reasons.push(`${dependents} consumers depend on this contract`); }
    const final = Math.min(100, score);
    return {
      contract: contractId, score: final,
      band: final >= 60 ? 'severe' : final >= 30 ? 'high' : final > 0 ? 'moderate' : 'none',
      dependents, affected: impact.affectedConsumers.map((c) => c.consumer),
      constitutionalImpact: impact.constitutionalImpact,
      safe: impact.safe, reasons,
      requiredAction: impact.safe
        ? (impact.compatibility.breaking ? 'publish as a new major version; no registered consumer depends on the removed surface' : 'ship — backward compatible')
        : 'publish a new major version, announce a sunset, and migrate every affected consumer first',
      note: 'Impact is weighted by whom it breaks. One constitutional consumer outweighs several internal ones.',
    };
  }

  // Dependency visualization as data — nodes and edges a renderer can draw, plus a deterministic
  // text rendering so the graph is readable from a terminal and diffable in a review.
  dependencyVisualization() {
    const matrix = this.dependencyMatrix();
    const nodes = [];
    const edges = [];
    for (const id of this.consumers()) {
      const c = this._expectations[id];
      nodes.push({ id, kind: 'consumer', label: c.consumer, criticality: c.criticality, owner: c.owner });
    }
    for (const contract of Object.keys(matrix).sort()) {
      const meta = this._registry.has(contract) ? this._registry.current(contract) : null;
      nodes.push({ id: contract, kind: 'contract', label: contract, version: meta ? meta.version : null, stability: meta ? meta.stability : 'unregistered' });
      for (const dep of matrix[contract]) edges.push({ from: dep.consumer, to: contract, criticality: dep.criticality });
    }
    const lines = [];
    for (const contract of Object.keys(matrix).sort()) {
      const meta = this._registry.has(contract) ? this._registry.current(contract) : null;
      lines.push(`${contract}${meta ? ` (v${meta.version}, ${meta.stability})` : ' (unregistered)'}`);
      const deps = matrix[contract];
      deps.forEach((d, i) => lines.push(`  ${i === deps.length - 1 ? '└─' : '├─'} ${d.consumer} [${d.criticality}]`));
    }
    for (const orphan of this.unconsumedContracts()) lines.push(`${orphan} — no registered consumer`);
    return {
      nodes: nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
      edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
      text: lines.join('\n'),
      contracts: Object.keys(matrix).length, consumers: this.consumers().length,
    };
  }

  // Compatibility forecasting: walk a planned sequence of changes and report the FIRST step that
  // breaks someone. A roadmap that breaks a consumer at step four is a roadmap you want to know
  // about at step zero.
  compatibilityForecast({ contract, steps = [] } = {}) {
    if (!this._registry.has(contract)) throw new Error('unknown contract: ' + contract);
    const base = this._registry.current(contract);
    let cumulative = { ...base };
    const evaluated = [];
    let firstBreak = null;
    steps.forEach((step, i) => {
      cumulative = { ...cumulative, ...step.spec };
      const impact = this.impactScore(contract, cumulative);
      const row = {
        step: i, name: step.name || `step-${i}`, spec: step.spec,
        score: impact.score, band: impact.band, safe: impact.safe,
        affected: impact.affected, breaking: impact.compatibility === undefined ? null : undefined,
      };
      delete row.breaking;
      evaluated.push(row);
      if (!impact.safe && firstBreak === null) firstBreak = i;
    });
    return {
      contract, baseVersion: base.version, steps: evaluated,
      firstBreakingStep: firstBreak,
      safeThrough: firstBreak === null ? steps.length : firstBreak,
      cumulativeSafe: firstBreak === null,
      recommendation: firstBreak === null
        ? 'the whole sequence is backward compatible for every registered consumer'
        : `steps 0–${firstBreak - 1} are safe; step ${firstBreak} ('${evaluated[firstBreak].name}') requires a major version and a migration`,
      note: 'Changes are applied cumulatively, because that is how they will actually land.',
    };
  }

  // --- Adoption tracking -------------------------------------------------------------------------

  // Record that a consumer is running against a particular contract version. Adoption is observed,
  // never assumed: a provider that assumes its consumers have upgraded is a provider about to
  // break one.
  recordAdoption(consumerId, contractId, { version, at = 0 } = {}) {
    if (!this._expectations[consumerId]) throw new Error('unknown consumer: ' + consumerId);
    if (!this._registry.has(contractId)) throw new Error('unknown contract: ' + contractId);
    if (!Number.isInteger(version) || version < 1) throw new Error('adoption must record an integer contract version');
    if (!this._adoption) this._adoption = new Map();
    this._adoption.set(`${consumerId}:${contractId}`, { consumer: consumerId, contract: contractId, version, at });
    return { consumer: consumerId, contract: contractId, version };
  }
  adoption(contractId) {
    if (!this._registry.has(contractId)) throw new Error('unknown contract: ' + contractId);
    const current = this._registry.current(contractId).version;
    const dependents = (this.dependencyMatrix()[contractId] || []).map((d) => d.consumer);
    const rows = dependents.map((consumer) => {
      const rec = this._adoption && this._adoption.get(`${consumer}:${contractId}`);
      return {
        consumer, criticality: this._expectations[consumer].criticality,
        adoptedVersion: rec ? rec.version : null,
        current: rec ? rec.version === current : null,
        behindBy: rec ? current - rec.version : null,
        reported: !!rec,
      };
    });
    const reported = rows.filter((r) => r.reported);
    return {
      contract: contractId, currentVersion: current, consumers: rows,
      reportedCount: reported.length, totalConsumers: rows.length,
      // Unreported adoption is not adoption. Coverage below 1 means the provider is flying blind.
      coverage: rows.length ? +(reported.length / rows.length).toFixed(3) : 1,
      onCurrent: reported.filter((r) => r.current).map((r) => r.consumer),
      behind: reported.filter((r) => !r.current).map((r) => ({ consumer: r.consumer, behindBy: r.behindBy })),
      unreported: rows.filter((r) => !r.reported).map((r) => r.consumer),
      fullyAdopted: rows.length > 0 && reported.length === rows.length && reported.every((r) => r.current),
    };
  }

  // --- Deprecation analytics & migration readiness ------------------------------------------------

  deprecationAnalytics({ now = 0 } = {}) {
    const matrix = this.dependencyMatrix();
    const rows = this._registry.list().filter((c) => c.stability === 'deprecated' || c.sunsetAt).map((c) => {
      const consumers = (matrix[c.id] || []).map((x) => x.consumer);
      const adoption = this.adoption(c.id);
      const daysToSunset = c.sunsetAt ? Math.floor((c.sunsetAt - now) / (24 * 3600_000)) : null;
      const migrated = adoption.onCurrent.length;
      const weight = consumers.reduce((a, id) => a + (CRITICALITY_WEIGHT[this._expectations[id].criticality] ?? 10), 0);
      return {
        contract: c.id, stability: c.stability, sunsetAt: c.sunsetAt, daysToSunset,
        liveConsumers: consumers, migrated, remaining: consumers.length - migrated,
        migrationBurden: weight,
        overdue: daysToSunset !== null && daysToSunset < 0 && consumers.length > migrated,
        atRisk: daysToSunset !== null && daysToSunset >= 0 && daysToSunset < 90 && consumers.length > migrated,
        action: consumers.length === migrated ? 'safe to retire'
          : daysToSunset !== null && daysToSunset < 0 ? 'OVERDUE: consumers remain past the sunset — retiring now would break them'
            : 'migrate the remaining consumers before the sunset',
      };
    });
    return {
      deprecated: rows, count: rows.length,
      overdue: rows.filter((r) => r.overdue).map((r) => r.contract),
      atRisk: rows.filter((r) => r.atRisk).map((r) => r.contract),
      totalBurden: rows.reduce((a, r) => a + r.migrationBurden, 0),
      clean: rows.every((r) => r.remaining === 0),
      note: 'A sunset date with live consumers is a commitment somebody has to keep, not a plan.',
    };
  }

  // Migration readiness for a specific change. FAIL-CLOSED: unknown readiness is not readiness.
  migrationReadiness({ contract, spec = null, now = 0 } = {}) {
    if (!this._registry.has(contract)) throw new Error('unknown contract: ' + contract);
    const adoption = this.adoption(contract);
    const impact = spec ? this.impactScore(contract, spec) : null;
    const affected = impact ? new Set(impact.affected) : new Set(adoption.consumers.map((c) => c.consumer));
    const rows = adoption.consumers.map((c) => {
      const blockers = [];
      if (affected.has(c.consumer) && !c.reported) blockers.push('adoption not reported — the provider cannot tell what this consumer is running');
      if (affected.has(c.consumer) && c.reported && !c.current) blockers.push(`running v${c.adoptedVersion}, ${c.behindBy} version(s) behind`);
      return { consumer: c.consumer, criticality: c.criticality, affected: affected.has(c.consumer), ready: blockers.length === 0, blockers };
    });
    const notReady = rows.filter((r) => !r.ready);
    return {
      contract, spec: spec || null, impact, consumers: rows,
      ready: notReady.length === 0,
      blockedBy: notReady.map((r) => r.consumer),
      constitutionalBlocked: notReady.some((r) => r.criticality === 'constitutional'),
      adoptionCoverage: adoption.coverage,
      failClosed: true, authorizes: false,
      note: notReady.length === 0
        ? 'Every affected consumer is on the current version. The change may proceed on the normal versioning rules.'
        : 'Migration is NOT ready. An unreported consumer is treated as not ready, because a provider that assumes is a provider that breaks something.',
    };
  }

  validate() {
    const violations = [];
    for (const id of this.consumers()) {
      const c = this._expectations[id];
      if (!c.owner) violations.push(`${id}: no owning context`);
      if (!['constitutional', 'critical', 'important'].includes(c.criticality)) violations.push(`${id}: unknown criticality '${c.criticality}'`);
      for (const e of c.expectations) {
        if (!this._registry.has(e.contract)) violations.push(`${id}: expects unknown contract '${e.contract}'`);
        if (!e.handlesErrors.length) violations.push(`${id}/${e.contract}: handles no errors — a consumer that ignores failure is a consumer that fails silently`);
        for (const err of e.handlesErrors) if (!CANONICAL_ERRORS[err]) violations.push(`${id}/${e.contract}: non-canonical error '${err}'`);
        if (!e.authentication) violations.push(`${id}/${e.contract}: no expected authentication mode`);
      }
    }
    // Every published API/event contract should have at least one registered consumer, or be
    // explicitly unconsumed — an unowned interface is maintenance without a beneficiary.
    return { valid: violations.length === 0, violations, consumers: this.consumers().length, unconsumed: this.unconsumedContracts() };
  }

  report() {
    return {
      consumers: this.consumers().map((id) => this.describe(id)),
      verification: this.verifyAll(),
      dependencyMatrix: this.dependencyMatrix(),
      unconsumedContracts: this.unconsumedContracts(),
      deprecation: this.deprecationReport(),
      deprecationAnalytics: this.deprecationAnalytics(),
      dependencyVisualization: this.dependencyVisualization(),
      adoption: Object.keys(this.dependencyMatrix()).filter((c) => this._registry.has(c)).sort().map((c) => this.adoption(c)),
      versionLifecycle: this.versionLifecycle(),
      validation: this.validate(),
      note: 'Consumer-driven: the provider may add freely, but may only remove or tighten what no consumer depends on.',
    };
  }
}

module.exports = { ConsumerContracts, CONSUMER_EXPECTATIONS, CRITICALITY_WEIGHT };
