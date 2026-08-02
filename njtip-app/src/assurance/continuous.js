'use strict';
// Continuous Assurance Framework (Phase 10, Part 15). Sixteen assurance domains, evaluated on
// every build from live sources, producing: the assurance dashboard, a readiness score, a risk
// register, an evidence register, a compliance register, a deployment authorization package and
// a production readiness package.
//
// FAIL-CLOSED: any failed assurance gate blocks production authorization until a named human
// authority explicitly accepts the risk — and even a fully green run does not authorize a
// deployment. The package is PREPARED FOR a human decision; it never substitutes for one.
//
// Deterministic: domains are evaluated in declaration order from injected sources, so the same
// platform state always produces the same package digest.
const { hash, signing } = require('../twin');

// The sixteen domains. Each names the sources it reads and the controls that verify it, so a
// domain result is always traceable to something the build actually checked.
const DOMAINS = {
  architecture: { title: 'Architecture', reads: ['fitness', 'architecture'], controls: ['APP-FIT-CONTEXT-MAP', 'APP-FIT-MIGRATION-ROADMAP'], evaluate: (s) => ({ pass: !!(s.architecture && s.architecture.valid) && !!(s.fitness && s.fitness.allHold), detail: s.architecture ? `${s.architecture.contexts} contexts, ${s.architecture.modules} modules owned` : 'no architecture evidence' }) },
  security: { title: 'Security', reads: ['security'], controls: ['APP-FIT-ZERO-TRUST-ARCHITECTURE', 'APP-FIT-THREAT-MODEL', 'INFRA-FIT-DEVSECOPS'], evaluate: (s) => ({ pass: !!(s.security && s.security.policiesCertified && s.security.credentialFindings === 0 && s.security.algorithmIndependence), detail: s.security ? `${s.security.credentialFindings} credential finding(s)` : 'no security evidence' }) },
  privacy: { title: 'Privacy', reads: ['privacy'], controls: ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-ANONYMITY-BOUNDARY', 'APP-FIT-CORRELATION-GOVERNANCE'], evaluate: (s) => ({ pass: !!(s.privacy && s.privacy.identityMinimized && s.privacy.correlationDefaultDeny), detail: s.privacy ? 'identity minimization and correlation default-deny hold' : 'no privacy evidence' }) },
  compliance: { title: 'Compliance', reads: ['compliance'], controls: ['APP-FIT-LEGISLATIVE-IMPACT'], evaluate: (s) => ({ pass: !!(s.compliance && s.compliance.overallCoverage >= 0.9), detail: s.compliance ? `coverage ${s.compliance.overallCoverage}` : 'no compliance evidence' }) },
  performance: { title: 'Performance', reads: ['reliability'], controls: ['APP-FIT-SRE-RELIABILITY'], evaluate: (s) => ({ pass: !!(s.reliability && (s.reliability.latencyP95Ms === null || s.reliability.latencyP95Ms <= 500)), detail: s.reliability ? `p95 ${s.reliability.latencyP95Ms ?? 'n/a'} ms` : 'no performance evidence' }) },
  reliability: { title: 'Reliability', reads: ['reliability'], controls: ['APP-FIT-SRE-RELIABILITY', 'APP-FIT-CHAOS-RESILIENCE'], evaluate: (s) => ({ pass: !!(s.reliability && s.reliability.allSlosMet), detail: s.reliability ? (s.reliability.allSlosMet ? 'all SLOs met' : 'an SLO is breached') : 'no reliability evidence' }) },
  governance: { title: 'Governance', reads: ['governance'], controls: ['APP-FIT-GOVERNANCE-OWNERSHIP', 'APP-FIT-RACI-GOVERNANCE', 'FIT-GOVERNANCE'], evaluate: (s) => ({ pass: !!(s.governance && s.governance.ownershipComplete && s.governance.noSelfApproval), detail: s.governance ? `maturity level ${s.governance.maturityLevel ?? 'n/a'}` : 'no governance evidence' }) },
  recovery: { title: 'Recovery', reads: ['recovery'], controls: ['APP-FIT-RECOVERY-STRATEGIES', 'APP-FIT-MULTI-REGION', 'INFRA-FIT-DR-BACKUP-RESTORE'], evaluate: (s) => ({ pass: !!(s.recovery && s.recovery.allScenariosMatch && s.recovery.backupVerified), detail: s.recovery ? 'failover scenarios match and backups restore-verified' : 'no recovery evidence' }) },
  supplyChain: { title: 'Supply chain', reads: ['supplyChain'], controls: ['APP-FIT-SUPPLY-CHAIN-GOVERNANCE', 'APP-FIT-SUPPLY-CHAIN-ATTESTATION'], evaluate: (s) => ({ pass: !!(s.supplyChain && s.supplyChain.thirdPartyCount === 0 && s.supplyChain.attestationsVerified), detail: s.supplyChain ? `${s.supplyChain.thirdPartyCount} third-party dependencies` : 'no supply-chain evidence' }) },
  infrastructure: { title: 'Infrastructure', reads: ['infrastructure'], controls: ['APP-FIT-INFRA-ASSURANCE', 'INFRA-FIT-DRIFT', 'INFRA-FIT-PLATFORM-LIFECYCLE'], evaluate: (s) => ({ pass: !!(s.infrastructure && s.infrastructure.healthy && !s.infrastructure.drift), detail: s.infrastructure ? (s.infrastructure.drift ? 'unreviewed drift' : 'compliant, no drift') : 'no infrastructure evidence' }) },
  legislation: { title: 'Legislation', reads: ['legislation'], controls: ['APP-FIT-LEGISLATIVE-IMPACT', 'APP-FIT-FORMAL-POLICY'], evaluate: (s) => ({ pass: !!(s.legislation && s.legislation.unimplementedMandates === 0), detail: s.legislation ? `${s.legislation.unimplementedMandates} unimplemented mandate(s)` : 'no legislative evidence' }) },
  identity: { title: 'Identity', reads: ['identity'], controls: ['APP-FIT-ZERO-TRUST-ARCHITECTURE', 'APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE', 'APP-FIT-DIGITAL-IDENTITY'], evaluate: (s) => ({ pass: !!(s.identity && s.identity.trustedIssuer && s.identity.shortLivedCredentials), detail: s.identity ? 'trust anchor present, credentials short-lived' : 'no identity evidence' }) },
  policies: { title: 'Policies', reads: ['policies'], controls: ['APP-FIT-POLICY-AS-DATA', 'APP-FIT-FORMAL-POLICY', 'APP-FIT-POLICY-GOVERNANCE'], evaluate: (s) => ({ pass: !!(s.policies && s.policies.certified && s.policies.allSpecsProven), detail: s.policies ? `${s.policies.specsProven ?? '?'} policy specifications proven` : 'no policy evidence' }) },
  observability: { title: 'Observability', reads: ['observability'], controls: ['APP-FIT-OBSERVABILITY-TELEMETRY', 'APP-FIT-OBSERVABILITY-DOMAINS', 'APP-FIT-TRACE-PRIVACY'], evaluate: (s) => ({ pass: !!(s.observability && s.observability.topologyValid && s.observability.identityFree), detail: s.observability ? 'topology valid, telemetry identity-free' : 'no observability evidence' }) },
  // Phase 11, Part 7: data QUALITY is an input to this domain, not a report beside it. A fully
  // traced but poorly-measured estate does not assure — poor quality reduces governance readiness.
  dataGovernance: { title: 'Data governance', reads: ['data'], controls: ['APP-FIT-DATA-GOVERNANCE', 'APP-FIT-DATA-QUALITY', 'APP-FIT-DATA-EXCHANGE-PURPOSE'], evaluate: (s) => ({ pass: !!(s.data && s.data.tracedRatio === 1 && s.data.qualityAcceptable !== false), detail: s.data ? `${Math.round((s.data.tracedRatio ?? 0) * 100)}% of records fully traced; quality readiness ${s.data.qualityReadiness ?? 'n/a'}` : 'no data-governance evidence' }) },
  aiGovernance: { title: 'AI governance', reads: ['ai'], controls: ['APP-FIT-AI-LIFECYCLE', 'APP-FIT-AI-ADVISORY-ONLY', 'APP-FIT-AI-GOVERNANCE'], evaluate: (s) => ({ pass: !!(s.ai && s.ai.allArtifactsApproved && s.ai.noAutonomousAction), detail: s.ai ? 'every artifact approved; no autonomous action surface' : 'no AI governance evidence' }) },
};

const domainIds = () => Object.keys(DOMAINS);

// Evaluate every domain against the supplied evidence sources.
function evaluate(sources = {}) {
  const results = domainIds().map((id) => {
    const d = DOMAINS[id];
    let outcome;
    try { outcome = d.evaluate(sources); } catch (e) { outcome = { pass: false, detail: 'evaluation threw: ' + e.message }; }
    const evidencePresent = d.reads.every((r) => sources[r] !== undefined && sources[r] !== null);
    return {
      domain: id, title: d.title, controls: [...d.controls],
      pass: !!outcome.pass && evidencePresent,
      evidencePresent, detail: outcome.detail,
      reason: !evidencePresent ? `no evidence supplied for ${d.reads.filter((r) => sources[r] == null).join(', ')} — a domain cannot be assured blind` : outcome.pass ? 'assured' : outcome.detail,
    };
  });
  const failed = results.filter((r) => !r.pass);
  return { domains: results, total: results.length, passed: results.length - failed.length, failed: failed.map((r) => r.domain), allPass: failed.length === 0 };
}

// Readiness score: the fraction of domains assured, weighted equally because a platform is only
// as deployable as its weakest assurance domain.
function readinessScore(evaluation) {
  const score = evaluation.total ? +(evaluation.passed / evaluation.total).toFixed(3) : 0;
  return {
    score, passed: evaluation.passed, total: evaluation.total,
    band: score === 1 ? 'fully assured' : score >= 0.9 ? 'near-ready' : score >= 0.7 ? 'gaps present' : 'not ready',
    humanGate: true, authorizes: false,
    note: 'A readiness score is an input to a human decision. It has never authorized anything and it does not now.',
  };
}

// Risk register: one entry per failed domain, plus residual threat exposure.
function riskRegister(evaluation, { residualRisk = [] } = {}) {
  const fromDomains = evaluation.domains.filter((d) => !d.pass).map((d) => ({
    id: `RISK-DOMAIN-${d.domain}`, source: 'assurance-domain', domain: d.domain,
    description: `${d.title} assurance is not met: ${d.reason}`,
    severity: ['privacy', 'security', 'governance', 'legislation'].includes(d.domain) ? 'critical' : 'high',
    controls: d.controls, status: 'open', treatment: 'Fix the failing control, or record a human risk acceptance.',
  }));
  const fromThreats = residualRisk.map((r) => ({
    id: `RISK-THREAT-${r.threat}`, source: 'threat-model', domain: 'security',
    description: `${r.threat}: ${(r.failing || []).length} failing and ${(r.unimplemented || []).length} missing control(s)`,
    severity: r.severity, controls: [...(r.failing || []), ...(r.unimplemented || [])], status: 'open', treatment: 'Implement or repair the named controls.',
  }));
  const register = [...fromDomains, ...fromThreats];
  return { register, open: register.length, bySeverity: register.reduce((m, r) => ((m[r.severity] = (m[r.severity] || 0) + 1), m), {}), clean: register.length === 0 };
}

// Evidence register: what was checked, by which control, and what it showed.
function evidenceRegister(evaluation, sources = {}) {
  const entries = evaluation.domains.map((d) => ({
    domain: d.domain, controls: d.controls,
    evidence: d.detail, present: d.evidencePresent,
    sources: DOMAINS[d.domain].reads.map((r) => ({ source: r, supplied: sources[r] !== undefined && sources[r] !== null })),
  }));
  return { entries, complete: entries.every((e) => e.present), note: 'Every assurance claim names the source it was derived from. A claim without a source is not made.' };
}

// Compliance register: legal mandates → implementing control → current state.
function complianceRegister({ mandates = [] } = {}) {
  const rows = mandates.map((m) => ({
    instrument: m.instrument, control: m.control,
    implemented: !!m.implemented, holding: m.holding ?? null,
    state: !m.implemented ? 'gap — no control implements this mandate' : m.holding === false ? 'BREACH — the mandated control is failing' : 'compliant',
  }));
  return {
    register: rows, mandates: rows.length,
    gaps: rows.filter((r) => !r.implemented).length,
    breaches: rows.filter((r) => r.implemented && r.holding === false).length,
    compliant: rows.every((r) => r.implemented && r.holding !== false),
  };
}

// The deployment authorization package. It is PREPARED FOR a human authority; it authorizes
// nothing, and it says so in every field a reader might mistake for permission.
function deploymentAuthorizationPackage({ sources = {}, residualRisk = [], mandates = [], riskAcceptedBy = null, riskRationale = null } = {}) {
  const evaluation = evaluate(sources);
  const readiness = readinessScore(evaluation);
  const risks = riskRegister(evaluation, { residualRisk });
  const evidence = evidenceRegister(evaluation, sources);
  const compliance = complianceRegister({ mandates });
  const blockers = [
    ...evaluation.failed.map((d) => ({ blocker: `assurance domain '${d}' not met`, kind: 'assurance' })),
    ...(compliance.breaches ? [{ blocker: `${compliance.breaches} legal mandate(s) in breach`, kind: 'compliance' }] : []),
    ...(compliance.gaps ? [{ blocker: `${compliance.gaps} legal mandate(s) with no implementing control`, kind: 'compliance' }] : []),
  ];
  const clean = blockers.length === 0;
  const accepted = !clean && !!(riskAcceptedBy && riskRationale);
  const core = {
    domains: evaluation.domains.map((d) => ({ domain: d.domain, pass: d.pass })),
    readiness: readiness.score, risks: risks.open, compliance: { gaps: compliance.gaps, breaches: compliance.breaches },
  };
  const digest = hash.sha256(core);
  return {
    kind: 'deployment-authorization-package', platform: 'NJTIP',
    assurance: evaluation, readiness, riskRegister: risks, evidenceRegister: evidence, complianceRegister: compliance,
    blockers, clean,
    riskAcceptance: accepted ? { by: riskAcceptedBy, rationale: riskRationale } : null,
    gateOutcome: clean ? 'ALL ASSURANCE GATES PASS' : accepted ? 'GATES FAILED — risk accepted by a named human authority' : 'BLOCKED — one or more assurance gates failed',
    digest, signature: signing.sign(digest),
    failClosed: true,
    authorized: false,
    authorizationDecision: 'NOT AUTHORIZED — production go-live requires a recorded decision by the approving authority for this deployment.',
    note: 'This package is PREPARED FOR a human authority. A complete, green, signed package is evidence that the platform is ready to be considered. It is not permission, and nothing in it becomes permission by being green.',
  };
}

// Production readiness package: the authorization package plus what a human still has to do.
function productionReadinessPackage(options = {}) {
  const pkg = deploymentAuthorizationPackage(options);
  const humanItems = [
    { item: 'Production cryptography', detail: '🔒 HSM/KMS keys generated and custodied by humans under ISRB sign-off. Never machine-generated.', done: false },
    { item: 'Production adapters', detail: 'Synthetic reference drivers replaced per the component migration roadmap, each with a rehearsed rollback.', done: false },
    { item: 'Infrastructure provisioning', detail: 'Sovereign-cloud estate provisioned, reviewed and baselined; residency policy confirmed by the data steward.', done: false },
    { item: 'Legal and constitutional validation', detail: 'Attorney General Chambers and the Oversight Board confirm the platform as deployed satisfies the enacted instruments.', done: false },
    { item: 'User validation with real participants', detail: 'The usability round re-run with recruited participants per role; blockers resolved.', done: false },
    { item: 'Recorded governance decision', detail: 'The approving authority records the go-live decision in the governance ledger.', done: false },
  ];
  return {
    ...pkg, kind: 'production-readiness-package',
    humanItems, outstandingHumanItems: humanItems.filter((i) => !i.done).length,
    productionReady: false,
    note: 'Automated assurance is necessary and not sufficient. Six items require named humans; none of them can be closed by a build.',
  };
}

// Continuous assurance dashboard — the per-build view.
function dashboard({ sources = {}, residualRisk = [], mandates = [] } = {}) {
  const evaluation = evaluate(sources);
  return {
    domains: evaluation.domains, passed: evaluation.passed, total: evaluation.total,
    readiness: readinessScore(evaluation),
    riskRegister: riskRegister(evaluation, { residualRisk }),
    complianceRegister: complianceRegister({ mandates }),
    evidenceRegister: evidenceRegister(evaluation, sources),
    failClosed: true, authorizes: false,
    note: 'Sixteen assurance domains evaluated on every build. A failed gate blocks production authorization until a named human authority accepts the risk.',
  };
}

function validate({ knownFitnessIds = [] } = {}) {
  const violations = [];
  const known = new Set(knownFitnessIds);
  const required = ['architecture', 'security', 'privacy', 'compliance', 'performance', 'reliability', 'governance', 'recovery', 'supplyChain', 'infrastructure', 'legislation', 'identity', 'policies', 'observability', 'dataGovernance', 'aiGovernance'];
  for (const id of required) if (!DOMAINS[id]) violations.push(`continuous assurance is missing the '${id}' domain`);
  for (const [id, d] of Object.entries(DOMAINS)) {
    if (!d.controls.length) violations.push(`${id}: names no verifying control`);
    if (!d.reads.length) violations.push(`${id}: reads no evidence source`);
    if (typeof d.evaluate !== 'function') violations.push(`${id}: has no evaluation`);
    if (known.size) for (const c of d.controls) if (!known.has(c)) violations.push(`${id}: control '${c}' is not a real fitness function`);
  }
  return { valid: violations.length === 0, violations, domains: domainIds().length };
}

module.exports = { DOMAINS, domainIds, evaluate, readinessScore, riskRegister, evidenceRegister, complianceRegister, deploymentAuthorizationPackage, productionReadinessPackage, dashboard, validate };
