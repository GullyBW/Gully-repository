'use strict';
// Bounded-Context Map (Stabilization Part 1). The architecture-of-record as DATA: every
// bounded context implemented in the platform, its purpose, the modules that realize it,
// its institutional steward, and its declared relationships to neighbouring contexts
// (DDD relationship patterns + the mechanism each interaction uses).
//
// This module ADDS NO DOMAIN BEHAVIOUR. It describes what already exists so that
// boundaries, cohesion, coupling, overlap, and module ownership can be VERIFIED by a
// fitness function rather than asserted in prose. Deterministic; no wall-clock.
const fs = require('node:fs');
const path = require('node:path');

// Recognised DDD relationship patterns (a declaration outside this set is a violation).
const RELATIONSHIPS = new Set([
  'open-host-service', 'published-language', 'shared-kernel', 'customer-supplier',
  'conformist', 'anti-corruption-layer', 'partnership', 'separate-ways',
]);
// How an interaction physically happens (kept explicit so "integration" is never implied).
const MECHANISMS = new Set(['in-process-port', 'domain-event', 'http-api', 'read-model-query']);

const KINDS = new Set(['core-domain', 'supporting', 'generic', 'composition-root']);

// --- Zone governance (Phase 15, Part 6) -----------------------------------------------------------
//
// ADR-0009 recorded a debt: this platform did not record which deployment zone a bounded context sits
// in. The topology knew the zone of every service and nothing connected a service back to a context,
// so the zone-isolation check on a cross-government collaboration proposal had nothing to check
// against and the proposal had to declare it. That debt is closed here.
//
// Six governance properties per context, and the rule that makes the closure real:
//
//   NO INFERRED VALUES. An undeclared property fails validation, which refuses composition.
//
// It would have been much less work to derive the zone from the governance board, or the residency
// policy from the domain. Both would have been guesses that looked like records, and the failure mode
// of a guess that looks like a record is that nobody ever checks it.
const ZONES = new Set(['independent', 'executive', 'judiciary', 'cross-zone']);
const TRUST_BOUNDARIES = new Set(['citizen-facing', 'inter-zone', 'intra-zone', 'external-institution', 'platform-internal']);
const RESIDENCY_POLICIES = new Set(['sovereign-only', 'sovereign-preferred', 'unrestricted']);
const CLASSIFICATIONS = new Set(['constitutional', 'restricted', 'official', 'public']);
const FAILOVER_POLICIES = new Set(['no-failover', 'read-only-failover', 'full-failover', 'manual-failover']);
const COLLABORATION_CONSTRAINTS = new Set(['no-sharing', 'aggregate-only', 'governed-sharing', 'open-sharing']);

// The declarations. Each is an architectural decision somebody has to be able to disagree with, so
// each carries a `zoneRationale` saying why the zone is what it is.
const ZONE_GOVERNANCE = {
  'identity-access': { zone: 'cross-zone', trustBoundary: 'inter-zone', residency: 'sovereign-only', classification: 'constitutional', failover: 'full-failover', collaboration: 'no-sharing', zoneRationale: 'Every zone conforms to its decisions, so it cannot sit inside one of them. Identity is never shared outward.' },
  'policy-governance': { zone: 'cross-zone', trustBoundary: 'inter-zone', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'no-sharing', zoneRationale: 'Policy is authored once and enforced in all three zones; a per-zone policy set would let the zones diverge.' },
  persistence: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'no-sharing', zoneRationale: 'The store abstraction spans zones; each concrete store is zone-bound and may never be read across one.' },
  'crypto-agility': { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'no-sharing', zoneRationale: '🔒 Key state that differed between zones would make ciphertext unreadable across a failover.' },
  'platform-events': { zone: 'cross-zone', trustBoundary: 'intra-zone', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'no-sharing', zoneRationale: 'The published language is shared; the brokers carrying it are per-zone and do not bridge.' },
  privacy: { zone: 'cross-zone', trustBoundary: 'citizen-facing', residency: 'sovereign-only', classification: 'constitutional', failover: 'no-failover', collaboration: 'no-sharing', zoneRationale: 'Identity minimisation is enforced wherever data enters, which is all three zones. It has no degraded mode: a privacy control that fails open is not a privacy control.' },
  intake: { zone: 'independent', trustBoundary: 'citizen-facing', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'no-sharing', zoneRationale: 'Anonymous reporting sits in the independent zone precisely so the executive cannot reach it. Nothing about a report is ever shared.' },
  custody: { zone: 'independent', trustBoundary: 'intra-zone', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'governed-sharing', zoneRationale: 'Evidence integrity must be provable independently of the body being investigated. Sharing is possible under a governed agreement, for a court.' },
  investigation: { zone: 'executive', trustBoundary: 'intra-zone', residency: 'sovereign-only', classification: 'restricted', failover: 'read-only-failover', collaboration: 'governed-sharing', zoneRationale: 'Investigation is an executive function; it reads from intake across a boundary rather than sharing a store with it.' },
  orchestration: { zone: 'executive', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'official', failover: 'full-failover', collaboration: 'no-sharing', zoneRationale: 'Workflow state belongs to the body running the process.' },
  'data-fabric': { zone: 'cross-zone', trustBoundary: 'inter-zone', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'governed-sharing', zoneRationale: 'The canonical model is shared vocabulary, not shared data; the vocabulary crosses zones and the data does not.' },
  'data-exchange': { zone: 'cross-zone', trustBoundary: 'external-institution', residency: 'sovereign-preferred', classification: 'official', failover: 'full-failover', collaboration: 'governed-sharing', zoneRationale: 'This context exists to cross an institutional boundary; that is its whole purpose, and every crossing is purpose-limited and approved.' },
  analytics: { zone: 'executive', trustBoundary: 'intra-zone', residency: 'sovereign-only', classification: 'official', failover: 'full-failover', collaboration: 'aggregate-only', zoneRationale: 'Analytics reads from the executive zone and publishes only non-attributable aggregates.' },
  'ai-advisory': { zone: 'executive', trustBoundary: 'intra-zone', residency: 'sovereign-only', classification: 'restricted', failover: 'no-failover', collaboration: 'no-sharing', zoneRationale: 'A recommendation engine that keeps running while its governance is degraded is worse than one that stops.' },
  security: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'governed-sharing', zoneRationale: 'Threat intelligence is only useful across the whole estate, and is shared with the national CIRT under agreement.' },
  'tenancy-federation': { zone: 'cross-zone', trustBoundary: 'external-institution', residency: 'sovereign-preferred', classification: 'official', failover: 'full-failover', collaboration: 'governed-sharing', zoneRationale: 'Federation is the boundary at which another institution appears; isolation between tenants is enforced here.' },
  infrastructure: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'no-sharing', zoneRationale: 'Infrastructure realises all three zones and must never let one observe another.' },
  'supply-chain': { zone: 'cross-zone', trustBoundary: 'external-institution', residency: 'unrestricted', classification: 'official', failover: 'full-failover', collaboration: 'open-sharing', zoneRationale: 'Provenance and SBOM data is deliberately open: the auditability of the supply chain is worth more than its confidentiality.' },
  observability: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'aggregate-only', zoneRationale: 'Telemetry spans zones by necessity and carries no identity, so it can be aggregated outward.' },
  resilience: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'no-sharing', zoneRationale: 'Recovery must work when a zone is gone, so it cannot live in one.' },
  assurance: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'official', failover: 'full-failover', collaboration: 'governed-sharing', zoneRationale: 'Evidence about the whole estate; shared with an independent auditor under a governed agreement.' },
  legislation: { zone: 'judiciary', trustBoundary: 'inter-zone', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'open-sharing', zoneRationale: 'The law is public and its interpretation is not an executive function. Legal instruments are open by nature.' },
  'api-governance': { zone: 'cross-zone', trustBoundary: 'external-institution', residency: 'unrestricted', classification: 'public', failover: 'full-failover', collaboration: 'open-sharing', zoneRationale: 'The published contract surface is public; an integrator cannot build against something they cannot read.' },
  'developer-platform': { zone: 'cross-zone', trustBoundary: 'external-institution', residency: 'unrestricted', classification: 'public', failover: 'full-failover', collaboration: 'open-sharing', zoneRationale: 'SDKs and templates carry no data and are more useful shared than withheld.' },
  knowledge: { zone: 'judiciary', trustBoundary: 'inter-zone', residency: 'sovereign-only', classification: 'official', failover: 'read-only-failover', collaboration: 'governed-sharing', zoneRationale: 'The archival record must outlive the executive that produced it, which is why it does not sit with it.' },
  portfolio: { zone: 'executive', trustBoundary: 'citizen-facing', residency: 'sovereign-only', classification: 'public', failover: 'full-failover', collaboration: 'open-sharing', zoneRationale: 'What services exist and how they are performing is information citizens are owed.' },
  'governance-oversight': { zone: 'judiciary', trustBoundary: 'inter-zone', residency: 'sovereign-only', classification: 'constitutional', failover: 'read-only-failover', collaboration: 'governed-sharing', zoneRationale: 'Oversight of the executive cannot be hosted by the executive. The decision ledger is the record that makes a decision challengeable.' },
  intelligence: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'restricted', failover: 'full-failover', collaboration: 'aggregate-only', zoneRationale: 'Correlation across the estate is the point; it publishes only what carries no attribution.' },
  geo: { zone: 'executive', trustBoundary: 'intra-zone', residency: 'sovereign-only', classification: 'official', failover: 'full-failover', collaboration: 'aggregate-only', zoneRationale: 'Location is re-identifying at fine granularity, so it stays inside the executive zone and leaves only aggregated.' },
  composition: { zone: 'cross-zone', trustBoundary: 'platform-internal', residency: 'sovereign-only', classification: 'constitutional', failover: 'no-failover', collaboration: 'no-sharing', zoneRationale: 'The composition root wires every zone. If it is unavailable nothing composes, and a partially composed platform is more dangerous than none.' },
};

const ZONE_PROPERTIES = [
  { field: 'zone', set: ZONES, why: 'Which constitutional zone this context is deployed into. Zone isolation is the platform\'s oldest invariant and it cannot be enforced against an unrecorded value.' },
  { field: 'trustBoundary', set: TRUST_BOUNDARIES, why: 'What kind of boundary this context sits on, which decides what an interaction with it has to prove.' },
  { field: 'residency', set: RESIDENCY_POLICIES, why: 'Where this context\'s data may physically be held.' },
  { field: 'classification', set: CLASSIFICATIONS, why: 'The security classification of what it holds, which decides who may see it and where it may go.' },
  { field: 'failover', set: FAILOVER_POLICIES, why: 'What this context does when its region is lost. `no-failover` is a deliberate answer, not a missing one.' },
  { field: 'collaboration', set: COLLABORATION_CONSTRAINTS, why: 'What may be shared with another institution, and under what governance.' },
];

// The declared governance of one context. Throws rather than returning a default: a caller that asks
// for an undeclared context needs to know, not to receive a plausible shape.
function zoneGovernance(id) {
  const g = ZONE_GOVERNANCE[id];
  if (!g) throw new Error(`no zone governance is declared for bounded context '${id}' — undeclared is not a value`);
  return { context: id, ...g };
}
function zoneGovernanceAll() { return ids().map((id) => zoneGovernance(id)); }

// Contexts in a given zone, and whether two contexts may share. The question the Phase 14
// collaboration scenario had to ask the proposal is now answerable from the architecture-of-record.
function contextsInZone(zone) { return ids().filter((id) => ZONE_GOVERNANCE[id] && ZONE_GOVERNANCE[id].zone === zone).sort(); }
function crossesZoneBoundary(contexts = []) {
  const zones = [...new Set(contexts.map((c) => (ZONE_GOVERNANCE[c] ? ZONE_GOVERNANCE[c].zone : null)))];
  const unknown = contexts.filter((c) => !ZONE_GOVERNANCE[c]);
  // `cross-zone` contexts are deployed into every zone, so they do not themselves cause a crossing.
  const bound = zones.filter((z) => z && z !== 'cross-zone');
  return {
    contexts: [...contexts].sort(), zones: zones.filter(Boolean).sort(), unknown,
    crosses: bound.length > 1,
    boundZones: bound.sort(),
    reason: unknown.length ? `zone governance is not declared for: ${unknown.join(', ')}`
      : bound.length > 1 ? `spans ${bound.length} constitutional zones: ${bound.sort().join(', ')}`
        : bound.length === 1 ? `every zone-bound context sits in '${bound[0]}'`
          : 'every context is cross-zone, so no constitutional boundary is crossed',
  };
}

// d(context, mechanism, relationship) — compact dependency declaration.
const d = (context, relationship, mechanism) => ({ context, relationship, mechanism });

// The context map. `modules` are repo-relative paths: an exact file, or a directory prefix
// (trailing '/') meaning every .js file beneath it.
const CONTEXTS = {
  'identity-access': {
    kind: 'supporting', domain: 'Security',
    purpose: 'Authenticate principals and authorize actions; zero standing privilege, default deny.',
    responsibilities: ['authentication', 'authorization', 'session-lifecycle', 'device-trust', 'digital-identity', 'workload-identity', 'trust-boundary-enforcement'],
    modules: ['src/authz.js', 'src/iam/digital-identity.js', 'src/iam/zero-trust.js', 'src/iam/zero-trust-architecture.js', 'src/adapters/session.js', 'src/adapters/oidc.js', 'src/adapters/secrets.js'],
    dependsOn: [], acl: ['external-idp'], sharedKernel: [],
    status: 'stable',
    rationale: 'Highest fan-in context. Kept independent because every other context conforms to its decisions; merging it would couple security policy to domain logic.',
  },
  'policy-governance': {
    kind: 'supporting', domain: 'Security',
    purpose: 'Author, version, validate and certify access policy as data (never as code).',
    responsibilities: ['policy-as-data', 'policy-versioning', 'policy-validation', 'policy-certification', 'formal-policy-verification'],
    modules: ['src/iam/policy-engine.js', 'src/iam/policy-governance.js', 'src/iam/formal-policy.js'],
    dependsOn: [d('identity-access', 'customer-supplier', 'in-process-port')],
    acl: [], sharedKernel: [], status: 'stable',
    rationale: 'Split from identity-access because policy AUTHORING has a governance lifecycle (propose → validate → activate) that must not share a release cadence with the enforcement path.',
  },
  'persistence': {
    kind: 'generic', domain: 'Platform',
    purpose: 'Zone-isolated repositories, unit of work, caching and object storage behind stable ports.',
    responsibilities: ['repository', 'unit-of-work', 'connection-pooling', 'caching', 'object-storage'],
    modules: ['src/adapters/store.js', 'src/adapters/sql-store.js', 'src/adapters/uow.js', 'src/adapters/pool.js', 'src/adapters/cache.js', 'src/adapters/object-store.js', 'src/adapters/drivers/'],
    dependsOn: [d('crypto-agility', 'customer-supplier', 'in-process-port')],
    acl: ['external-database', 'external-object-store'], sharedKernel: [], status: 'stable',
    rationale: 'Generic subdomain. Isolated so a driver swap (memory → file → SQL) never reaches domain code.',
  },
  'crypto-agility': {
    kind: 'supporting', domain: 'Security',
    purpose: 'Govern WHICH cryptographic algorithms are used and HOW they migrate — never key material.',
    responsibilities: ['algorithm-policy', 'key-lifecycle', 'certificate-lifecycle', 'quantum-migration'],
    modules: ['src/adapters/kms.js', 'src/adapters/certificates.js', 'src/adapters/crypto-agility.js', 'src/adapters/quantum-transition.js'],
    dependsOn: [], acl: ['external-kms-hsm'], sharedKernel: [], status: 'stable',
    rationale: '🔒 Human-built in production. Independent so algorithm migration is a policy change, not an architecture change.',
  },
  'platform-events': {
    kind: 'supporting', domain: 'Platform',
    purpose: 'Immutable hash-chained event log, event contracts, and the PII-free publish/subscribe fabric.',
    responsibilities: ['event-sourcing', 'event-contracts', 'event-replay', 'publish-subscribe'],
    modules: ['src/eventsourcing/', 'src/fabric/event-bus.js', 'src/adapters/broker.js'],
    dependsOn: [d('persistence', 'customer-supplier', 'in-process-port')],
    acl: ['external-broker'], sharedKernel: ['pii-free-event-language'], status: 'stable',
    rationale: 'Published language for every cross-context notification. Kept independent so contexts integrate through contracts rather than shared tables.',
  },
  'privacy': {
    kind: 'core-domain', domain: 'Security',
    purpose: 'Enforce identity minimization, k-anonymity, differential privacy and the anonymity boundary.',
    responsibilities: ['identity-minimization', 'anonymity-boundary', 'k-anonymity', 'differential-privacy'],
    modules: ['src/privacy/'],
    dependsOn: [], acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'Constitutional invariant. Published as a SHARED KERNEL because every data-touching context must apply the identical rule; divergence would be a privacy breach.',
  },
  'intake': {
    kind: 'core-domain', domain: 'Justice',
    purpose: 'Accept anonymous reports (no identity accepted), route them, and notify by case code only.',
    responsibilities: ['anonymous-intake', 'case-code-issuance', 'conflict-of-interest-routing', 'reporter-notification'],
    modules: ['src/workflow.js', 'src/adapters/notifications.js', 'src/adapters/notify-providers.js'],
    dependsOn: [d('privacy', 'shared-kernel', 'in-process-port'), d('platform-events', 'published-language', 'domain-event'), d('persistence', 'customer-supplier', 'in-process-port')],
    acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'The platform\'s reason to exist. Deliberately upstream of investigation so the anonymity boundary is crossed exactly once, at one place.',
  },
  'custody': {
    kind: 'core-domain', domain: 'Justice',
    purpose: 'Preserve evidence integrity through a signed, hash-chained chain of custody.',
    responsibilities: ['chain-of-custody', 'evidence-integrity', 'legal-hold'],
    modules: ['src/custody/'],
    dependsOn: [d('crypto-agility', 'customer-supplier', 'in-process-port'), d('platform-events', 'published-language', 'domain-event')],
    acl: [], sharedKernel: [], status: 'stable',
    rationale: 'Admissibility depends on an unbroken, independently verifiable chain; merging it into investigation would let case logic mutate custody records.',
  },
  'investigation': {
    kind: 'core-domain', domain: 'Justice',
    purpose: 'Guarded case and evidence lifecycles, investigator review, prioritisation and SLA.',
    responsibilities: ['case-lifecycle', 'evidence-lifecycle', 'investigator-review', 'prioritisation', 'sla'],
    modules: ['src/domain/'],
    dependsOn: [d('intake', 'customer-supplier', 'in-process-port'), d('custody', 'customer-supplier', 'in-process-port'), d('identity-access', 'conformist', 'in-process-port'), d('platform-events', 'published-language', 'domain-event')],
    acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'Downstream of intake by design: an investigator can never reach the reporter, only the case.',
  },
  'orchestration': {
    kind: 'supporting', domain: 'Platform',
    purpose: 'Configurable workflow definition, simulation, formal verification, process mining and release flags.',
    responsibilities: ['workflow-definition', 'workflow-simulation', 'formal-verification', 'process-mining', 'feature-flags'],
    modules: ['src/orchestration/', 'src/adapters/flags.js'],
    dependsOn: [d('platform-events', 'published-language', 'domain-event')],
    acl: [], sharedKernel: [], status: 'stable',
    rationale: 'Workflow is data, not code. Independent so a process change is a validated configuration change, never a redeploy of the domain.',
  },
  'data-fabric': {
    kind: 'supporting', domain: 'Data',
    purpose: 'Canonical schemas, metadata catalogue, lineage, provenance and semantic interoperability.',
    responsibilities: ['canonical-model', 'metadata-catalogue', 'data-lineage', 'provenance', 'semantic-mapping', 'retention-and-legal-hold', 'consent-lifecycle', 'data-quality', 'reference-and-master-data'],
    modules: ['src/fabric/registry.js', 'src/fabric/metadata.js', 'src/fabric/provenance.js', 'src/fabric/interoperability.js', 'src/fabric/data-governance.js'],
    dependsOn: [d('platform-events', 'published-language', 'domain-event'), d('privacy', 'shared-kernel', 'in-process-port')],
    acl: ['external-agency-schema'], sharedKernel: ['canonical-model', 'privacy-invariants'], status: 'stable',
    rationale: 'Owns the published language for data. Its canonical model is a shared kernel with data-exchange and api-governance so one definition serves all three.',
  },
  'data-exchange': {
    kind: 'supporting', domain: 'Data',
    purpose: 'Governed inter-agency data exchange: purpose-limited, classified, approval-gated, audited.',
    responsibilities: ['dataset-registry', 'purpose-limitation', 'exchange-approval', 'data-classification', 'exchange-audit'],
    modules: ['src/fabric/marketplace.js', 'src/fabric/data-exchange.js'],
    dependsOn: [d('data-fabric', 'shared-kernel', 'in-process-port'), d('privacy', 'shared-kernel', 'in-process-port'), d('identity-access', 'conformist', 'in-process-port')],
    acl: ['external-agency-consumer'], sharedKernel: ['canonical-model', 'privacy-invariants'], status: 'stable',
    rationale: 'Retained as its own context (ADR-0003) because its governance model — purpose limitation and named approval — differs fundamentally from the catalogue duties of data-fabric.',
  },
  'analytics': {
    kind: 'supporting', domain: 'Insight',
    purpose: 'Aggregate, non-attributable analytics, identity-free search and relationship graphs.',
    responsibilities: ['aggregate-analytics', 'small-cell-suppression', 'search-index', 'knowledge-graph'],
    modules: ['src/analytics.js', 'src/adapters/search.js', 'src/search/', 'src/graph/'],
    dependsOn: [d('investigation', 'customer-supplier', 'read-model-query'), d('privacy', 'shared-kernel', 'in-process-port'), d('data-fabric', 'conformist', 'in-process-port')],
    acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'Read-only, downstream. Queries read models so analytical load and privacy suppression never affect the transactional path.',
  },
  'ai-advisory': {
    kind: 'supporting', domain: 'Insight',
    purpose: 'Explainable, advisory-only recommendations with a mandatory human-approval queue.',
    responsibilities: ['recommendation', 'explainability', 'model-governance', 'human-approval-queue', 'ai-risk-classification', 'inference-audit'],
    modules: ['src/ai/'],
    dependsOn: [d('analytics', 'customer-supplier', 'read-model-query'), d('privacy', 'shared-kernel', 'in-process-port')],
    acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'Isolated so that "the model suggested it" can never become "the system did it": the approval queue is the only exit.',
  },
  'security': {
    kind: 'supporting', domain: 'Security',
    purpose: 'Threat intelligence that may only LOWER trust, never grant it.',
    responsibilities: ['threat-feed', 'risk-scoring', 'anomaly-correlation', 'threat-modelling', 'adversary-playbooks'],
    modules: ['src/security/'],
    dependsOn: [d('identity-access', 'customer-supplier', 'in-process-port')],
    acl: ['external-threat-feed'], sharedKernel: [], status: 'stable',
    rationale: 'Separated from identity-access so an external feed can never become a privilege source; the ACL enforces trust-lowering-only translation.',
  },
  'tenancy-federation': {
    kind: 'supporting', domain: 'Collaboration',
    purpose: 'Multi-agency tenancy, isolation by default, and governed ecosystem federation.',
    responsibilities: ['tenant-isolation', 'collaboration-agreement', 'federation-trust', 'service-discovery'],
    modules: ['src/tenancy/'],
    dependsOn: [d('identity-access', 'conformist', 'in-process-port'), d('data-fabric', 'conformist', 'in-process-port')],
    acl: ['external-jurisdiction'], sharedKernel: [], status: 'stable',
    rationale: 'Both tenant and ecosystem federation share one isolation model; consolidating them (ADR-0003) removed a duplicated trust concept.',
  },
  'infrastructure': {
    kind: 'supporting', domain: 'Operations',
    purpose: 'Sovereign infrastructure governance: residency policy, compliance, drift and platform assurance.',
    responsibilities: ['resource-registry', 'residency-policy', 'infra-compliance', 'drift-detection', 'iac-validation', 'backup-verification', 'platform-lifecycle'],
    modules: ['src/infra/'],
    dependsOn: [d('crypto-agility', 'customer-supplier', 'in-process-port'), d('observability', 'customer-supplier', 'in-process-port')],
    acl: ['external-cloud-provider'], sharedKernel: [], status: 'stable',
    rationale: 'Infrastructure decisions are governed like domain decisions; keeping them in-model lets the Twin gate them.',
  },
  'supply-chain': {
    kind: 'supporting', domain: 'Operations',
    purpose: 'Supplier and component integrity; no deployment bypasses the supply-chain gate.',
    responsibilities: ['supplier-registry', 'component-integrity', 'sbom-validation', 'deployment-gate', 'build-provenance', 'artifact-attestation'],
    modules: ['src/supplychain/'],
    dependsOn: [d('infrastructure', 'customer-supplier', 'in-process-port')],
    acl: ['external-supplier'], sharedKernel: [], status: 'stable',
    rationale: 'Fail-closed deployment gate. Independent so the gate cannot be relaxed by an infrastructure change.',
  },
  'observability': {
    kind: 'generic', domain: 'Operations',
    purpose: 'Identity-free logs, metrics, traces, SLOs and audience-specific dashboards.',
    responsibilities: ['logging', 'metrics', 'tracing', 'slo', 'dashboards', 'national-performance', 'service-level-objectives', 'runtime-topology', 'executive-reporting'],
    modules: ['src/adapters/observability.js', 'src/observability/', 'src/observatory/'],
    dependsOn: [d('privacy', 'shared-kernel', 'in-process-port')],
    acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'Generic subdomain with one domain-specific rule: spans and dashboards must never carry identity, enforced by fitness.',
  },
  'resilience': {
    kind: 'supporting', domain: 'Operations',
    purpose: 'Deterministic simulation, resilience validation, recovery strategy and crisis coordination.',
    responsibilities: ['simulation', 'monte-carlo', 'resilience-validation', 'recovery-strategy', 'crisis-coordination', 'chaos-engineering', 'multi-region-failover'],
    modules: ['src/twin2/'],
    dependsOn: [d('orchestration', 'conformist', 'in-process-port'), d('infrastructure', 'customer-supplier', 'in-process-port'), d('observability', 'customer-supplier', 'read-model-query')],
    acl: [], sharedKernel: [], status: 'stable',
    rationale: 'All simulation shares one determinism contract (seeded RNG, logical clocks); splitting it would fragment that guarantee.',
  },
  'assurance': {
    kind: 'core-domain', domain: 'Governance',
    purpose: 'The Digital Engineering Twin: fitness gate, compliance, maturity, capability, evolution and the architecture-of-record.',
    responsibilities: ['fitness-gate', 'compliance-assessment', 'maturity-assessment', 'capability-model', 'evolution-intelligence', 'context-map', 'migration-roadmap', 'adr-governance', 'continuous-assurance'],
    modules: ['src/twin.js', 'src/twin-validate.js', 'src/compliance/', 'src/maturity/', 'src/capability/', 'src/evolution/', 'src/architecture/', 'src/migration/', 'src/assurance/'],
    dependsOn: [d('orchestration', 'conformist', 'in-process-port'), d('identity-access', 'conformist', 'in-process-port'), d('privacy', 'shared-kernel', 'in-process-port'), d('platform-events', 'published-language', 'read-model-query'), d('infrastructure', 'customer-supplier', 'read-model-query')],
    acl: [], sharedKernel: ['fitness-contract', 'privacy-invariants'], status: 'stable',
    rationale: 'The permanent quality gate. It reads every other context but is depended upon only through the fitness-contract shared kernel, so assurance can never be bypassed or forked.',
  },
  'legislation': {
    kind: 'supporting', domain: 'Governance',
    purpose: 'Legal instruments as versioned, simulatable artifacts mapped to controls and systems.',
    responsibilities: ['legal-instrument-registry', 'regulatory-dependency-graph', 'legislative-impact', 'change-simulation', 'obsolescence-detection'],
    modules: ['src/legislation/'],
    dependsOn: [d('policy-governance', 'customer-supplier', 'in-process-port'), d('assurance', 'conformist', 'read-model-query')],
    acl: [], sharedKernel: ['fitness-contract'], status: 'stable',
    rationale: 'Downstream of assurance (it reads control ids) and never upstream: a legal record must not be able to change a fitness result.',
  },
  'api-governance': {
    kind: 'supporting', domain: 'Platform',
    purpose: 'API and event contracts, versioning strategy, quality metrics and outbound integration.',
    responsibilities: ['api-registry', 'contract-registry', 'versioning-strategy', 'contract-compatibility', 'outbound-integration', 'consumer-driven-contracts'],
    modules: ['src/apigov/', 'src/openapi.js', 'src/contracts/', 'src/adapters/integrations.js'],
    dependsOn: [d('identity-access', 'conformist', 'in-process-port'), d('data-fabric', 'shared-kernel', 'in-process-port')],
    acl: ['external-consumer'], sharedKernel: ['canonical-model'], status: 'stable',
    rationale: 'Owns the open-host service. Contracts live here, not with the implementing context, so an internal refactor cannot silently break a consumer.',
  },
  'developer-platform': {
    kind: 'generic', domain: 'Platform',
    purpose: 'SDK generation, mocks, test harnesses and the governed capability marketplace.',
    responsibilities: ['sdk-generation', 'mock-service', 'test-harness', 'capability-publication'],
    modules: ['src/devplatform/'],
    dependsOn: [d('api-governance', 'customer-supplier', 'in-process-port')],
    acl: [], sharedKernel: [], status: 'stable',
    rationale: 'Pure consumer of the contract registry; generates from contracts so published artifacts cannot drift from them.',
  },
  'knowledge': {
    kind: 'supporting', domain: 'Governance',
    purpose: 'Immutable, hash-chained institutional memory of decisions and rationale.',
    responsibilities: ['decision-record', 'institutional-memory', 'immutable-trace'],
    modules: ['src/knowledge/'],
    dependsOn: [d('crypto-agility', 'customer-supplier', 'in-process-port')],
    acl: [], sharedKernel: [], status: 'stable',
    rationale: 'Append-only and dependency-light on purpose: institutional memory must outlive every other context.',
  },
  'portfolio': {
    kind: 'supporting', domain: 'Service Delivery',
    purpose: 'Government services as products: lifecycle, maturity, sustainability and usability validation.',
    responsibilities: ['service-portfolio', 'lifecycle-management', 'obsolescence-planning', 'usability-validation'],
    modules: ['src/portfolio/', 'src/sustainability/', 'src/ux/'],
    dependsOn: [d('assurance', 'conformist', 'read-model-query'), d('observability', 'customer-supplier', 'read-model-query')],
    acl: [], sharedKernel: ['fitness-contract'], status: 'stable',
    rationale: 'Usability validation was consolidated here (ADR-0003): user evidence about a service belongs with that service\'s portfolio record.',
  },
  'governance-oversight': {
    kind: 'core-domain', domain: 'Governance',
    purpose: 'Human governance: decision recording, institutional ownership, asset and adaptive governance, oversight centres.',
    responsibilities: ['governance-decision', 'institutional-ownership', 'asset-governance', 'adaptive-governance', 'oversight-dashboard', 'raci-and-decision-traceability'],
    modules: ['src/govops/', 'src/governance/'],
    dependsOn: [d('assurance', 'conformist', 'read-model-query'), d('intelligence', 'customer-supplier', 'read-model-query'), d('observability', 'customer-supplier', 'read-model-query'), d('identity-access', 'conformist', 'in-process-port')],
    acl: [], sharedKernel: ['fitness-contract'], status: 'stable',
    rationale: 'The only context permitted to record an authoritative decision, and it records only what a named human decided.',
  },
  'intelligence': {
    kind: 'supporting', domain: 'Governance',
    purpose: 'Cross-domain correlation under explicit correlation governance and purpose limitation.',
    responsibilities: ['cross-domain-correlation', 'systemic-risk', 'correlation-governance', 'correlation-purpose-limitation'],
    modules: ['src/intelligence/'],
    dependsOn: [d('assurance', 'conformist', 'read-model-query'), d('privacy', 'shared-kernel', 'in-process-port')],
    acl: [], sharedKernel: ['fitness-contract', 'privacy-invariants'], status: 'stable',
    rationale: 'Correlation is the highest-risk analytical capability, so it is a named context with its own permitted/prohibited register rather than a feature of analytics.',
  },
  'geo': {
    kind: 'generic', domain: 'Insight',
    purpose: 'Coarse spatial indexing at a privacy-preserving resolution.',
    responsibilities: ['spatial-index', 'geographic-generalization'],
    modules: ['src/geo/'],
    dependsOn: [d('privacy', 'shared-kernel', 'in-process-port')],
    acl: [], sharedKernel: ['privacy-invariants'], status: 'stable',
    rationale: 'Small and generic, but retained separately because its privacy rule (coarsening) is unlike any other context\'s.',
  },
  'composition': {
    kind: 'composition-root', domain: 'Platform',
    purpose: 'Wire configuration, adapters and contexts; the ONLY place synthetic vs production drivers are chosen.',
    responsibilities: ['composition-root', 'configuration', 'http-delivery'],
    modules: ['src/app.js', 'src/server.js', 'src/config.js'],
    dependsOn: [], acl: [], sharedKernel: [], status: 'stable',
    rationale: 'Not a bounded context but the assembly point. Excluded from coupling metrics: depending on everything is its job.',
  },
};

// Shared kernels — definitions that MUST be identical across their member contexts.
const SHARED_KERNELS = {
  'privacy-invariants': { description: 'Identity minimization, anonymity boundary, small-cell suppression.', authority: 'privacy' },
  'canonical-model': { description: 'Canonical Case/EvidenceRef/Agency definitions and their required fields.', authority: 'data-fabric' },
  'pii-free-event-language': { description: 'Event envelope + PII-free payload rule for every cross-context notification.', authority: 'platform-events' },
  'fitness-contract': { description: 'The {id, pass, violations} result shape every fitness function returns.', authority: 'assurance' },
};

const ids = () => Object.keys(CONTEXTS);
function describe(id) {
  const c = CONTEXTS[id];
  if (!c) throw new Error('unknown bounded context: ' + id);
  return JSON.parse(JSON.stringify({ id, ...c }));
}
function contexts() { return ids().map(describe); }

// --- Structure -------------------------------------------------------------------------

function dependencyGraph() { const g = {}; for (const id of ids()) g[id] = CONTEXTS[id].dependsOn.map((x) => x.context); return g; }

// Every declared interaction, as an explicit path (from → to, pattern, mechanism).
function communicationPaths() {
  const out = [];
  for (const id of ids()) for (const dep of CONTEXTS[id].dependsOn) out.push({ from: id, to: dep.context, relationship: dep.relationship, mechanism: dep.mechanism });
  return out.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
}
function antiCorruptionLayers() { return ids().filter((id) => CONTEXTS[id].acl.length).map((id) => ({ context: id, translates: [...CONTEXTS[id].acl] })); }
function sharedKernels() {
  const out = {};
  for (const [k, meta] of Object.entries(SHARED_KERNELS)) out[k] = { ...meta, members: ids().filter((id) => CONTEXTS[id].sharedKernel.includes(k)) };
  return out;
}
// Upstream/downstream: who supplies me (upstream) and who consumes me (downstream).
function upstreamDownstream(id) {
  describe(id);
  return { context: id, upstream: CONTEXTS[id].dependsOn.map((x) => x.context), downstream: ids().filter((o) => CONTEXTS[o].dependsOn.some((x) => x.context === id)) };
}

// Dependency cycles (DFS). A cycle in a context map is an architecture violation.
function cycles() {
  const g = dependencyGraph(); const found = []; const state = {};
  const walk = (n, stack) => {
    if (state[n] === 'done') return;
    if (state[n] === 'open') { found.push([...stack.slice(stack.indexOf(n)), n]); return; }
    state[n] = 'open'; stack.push(n);
    for (const next of g[n] || []) walk(next, stack);
    stack.pop(); state[n] = 'done';
  };
  for (const id of ids()) walk(id, []);
  return found;
}

// --- Cohesion & coupling ---------------------------------------------------------------

// Coupling: afferent (who depends on me), efferent (who I depend on), instability = Ce/(Ce+Ca).
function coupling(id) {
  const ud = upstreamDownstream(id);
  const ce = ud.upstream.length, ca = ud.downstream.length;
  return { context: id, efferent: ce, afferent: ca, instability: ce + ca === 0 ? 0 : +(ce / (ce + ca)).toFixed(3) };
}
// Cohesion: the fraction of a context's responsibilities that no other context also claims.
function cohesion(id) {
  const own = CONTEXTS[describe(id).id].responsibilities;
  const others = new Set(); for (const o of ids()) if (o !== id) for (const r of CONTEXTS[o].responsibilities) others.add(r);
  const unique = own.filter((r) => !others.has(r));
  return { context: id, responsibilities: own.length, unique: unique.length, cohesion: own.length ? +(unique.length / own.length).toFixed(3) : 0, shared: own.filter((r) => others.has(r)) };
}
// Overlaps the boundary review examined and consciously ACCEPTED (each needs a rationale).
// An overlap outside this register is an unreviewed boundary blur and fails the fitness gate.
const ACCEPTED_OVERLAPS = [];

// Overlap: context pairs claiming the same responsibility (candidates for merge or clarification).
function overlaps() {
  const out = []; const all = ids();
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const shared = CONTEXTS[all[i]].responsibilities.filter((r) => CONTEXTS[all[j]].responsibilities.includes(r));
    if (shared.length) out.push({ contexts: [all[i], all[j]], responsibilities: shared });
  }
  return out;
}
// Contexts whose boundary review concluded "merge" or "refactor" (recorded, with the target).
function consolidationCandidates() { return ids().filter((id) => CONTEXTS[id].status !== 'stable').map((id) => ({ context: id, status: CONTEXTS[id].status, consolidateInto: CONTEXTS[id].consolidateInto || null, rationale: CONTEXTS[id].rationale })); }

// --- Module ownership ------------------------------------------------------------------

const SRC = path.join(__dirname, '..');
function sourceModules(dir = SRC, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sourceModules(full, out);
    else if (full.endsWith('.js')) out.push('src/' + path.relative(SRC, full).split(path.sep).join('/'));
  }
  return out;
}
const claims = (mod, patterns) => patterns.some((p) => (p.endsWith('/') ? mod.startsWith(p) : mod === p));
// Every source module must belong to exactly one bounded context.
function moduleOwnership() {
  const unmapped = [], multiple = [], owner = {};
  for (const mod of sourceModules()) {
    const owners = ids().filter((id) => claims(mod, CONTEXTS[id].modules));
    if (owners.length === 0) unmapped.push(mod);
    else if (owners.length > 1) multiple.push({ module: mod, contexts: owners });
    else owner[mod] = owners[0];
  }
  return { owner, unmapped, multiple, modules: Object.keys(owner).length };
}

// --- Validation ------------------------------------------------------------------------

function validate() {
  const violations = [];
  for (const id of ids()) {
    const c = CONTEXTS[id];
    if (!c.purpose) violations.push(`${id}: no declared purpose`);
    if (!KINDS.has(c.kind)) violations.push(`${id}: unknown kind '${c.kind}'`);
    if (!c.rationale) violations.push(`${id}: no architectural rationale recorded`);
    if (!c.modules.length) violations.push(`${id}: owns no modules`);
    if (!c.responsibilities.length) violations.push(`${id}: no declared responsibilities`);
    for (const dep of c.dependsOn) {
      if (!CONTEXTS[dep.context]) violations.push(`${id}: depends on unknown context '${dep.context}'`);
      if (!RELATIONSHIPS.has(dep.relationship)) violations.push(`${id}→${dep.context}: unknown relationship '${dep.relationship}'`);
      if (!MECHANISMS.has(dep.mechanism)) violations.push(`${id}→${dep.context}: unknown mechanism '${dep.mechanism}'`);
      if (dep.context === id) violations.push(`${id}: depends on itself`);
    }
    for (const k of c.sharedKernel) if (!SHARED_KERNELS[k]) violations.push(`${id}: unknown shared kernel '${k}'`);
    if (c.status !== 'stable' && !c.consolidateInto) violations.push(`${id}: status '${c.status}' without a consolidation target`);
  }
  // Phase 15, Part 6: zone governance is declared, never inferred. An undeclared property refuses
  // composition, which is what makes "no inferred values" a rule rather than a preference.
  for (const id of ids()) {
    const g = ZONE_GOVERNANCE[id];
    if (!g) { violations.push(`${id}: no zone governance declared — an undeclared constitutional zone cannot be enforced against`); continue; }
    for (const { field, set } of ZONE_PROPERTIES) {
      if (g[field] === undefined || g[field] === null) violations.push(`${id}: zone governance declares no '${field}'`);
      else if (!set.has(g[field])) violations.push(`${id}: zone governance declares unknown ${field} '${g[field]}'`);
    }
    if (!g.zoneRationale) violations.push(`${id}: zone governance states no rationale for its zone — a placement nobody can disagree with is one nobody reviewed`);
  }
  for (const id of Object.keys(ZONE_GOVERNANCE)) {
    if (!CONTEXTS[id]) violations.push(`zone governance is declared for '${id}', which is not a bounded context`);
  }
  for (const cyc of cycles()) violations.push('dependency cycle: ' + cyc.join(' → '));
  for (const o of overlaps()) {
    const accepted = ACCEPTED_OVERLAPS.some((a) => a.contexts.slice().sort().join() === o.contexts.slice().sort().join());
    if (!accepted) violations.push(`unreviewed responsibility overlap between ${o.contexts.join(' and ')}: ${o.responsibilities.join(', ')}`);
  }
  for (const [k, meta] of Object.entries(SHARED_KERNELS)) if (!CONTEXTS[meta.authority]) violations.push(`shared kernel '${k}': unknown authority '${meta.authority}'`);
  const mo = moduleOwnership();
  for (const m of mo.unmapped) violations.push(`module not owned by any bounded context: ${m}`);
  for (const m of mo.multiple) violations.push(`module claimed by multiple contexts: ${m.module} (${m.contexts.join(', ')})`);
  return { valid: violations.length === 0, violations, contexts: ids().length, modules: mo.modules, zoneGovernanceDeclared: ids().filter((id) => ZONE_GOVERNANCE[id]).length };
}

// The full map, as served to the API and rendered into docs/context-map.md.
function contextMap() {
  return {
    baseline: 'Architecture Baseline v1.7 (frozen)',
    contexts: contexts().map((c) => ({ ...c, ...coupling(c.id), cohesion: cohesion(c.id).cohesion })),
    communicationPaths: communicationPaths(),
    antiCorruptionLayers: antiCorruptionLayers(),
    sharedKernels: sharedKernels(),
    overlaps: overlaps(),
    consolidationCandidates: consolidationCandidates(),
    validation: validate(),
    note: 'Descriptive architecture-of-record. Changes to it require an ADR (docs/architecture-governance.md).',
  };
}

module.exports = {
  CONTEXTS, SHARED_KERNELS, RELATIONSHIPS, MECHANISMS, ACCEPTED_OVERLAPS,
  ids, describe, contexts, dependencyGraph, communicationPaths, antiCorruptionLayers,
  sharedKernels, upstreamDownstream, cycles, coupling, cohesion, overlaps,
  consolidationCandidates, moduleOwnership, sourceModules, validate, contextMap,
  ZONES, TRUST_BOUNDARIES, RESIDENCY_POLICIES, CLASSIFICATIONS, FAILOVER_POLICIES,
  COLLABORATION_CONSTRAINTS, ZONE_GOVERNANCE, ZONE_PROPERTIES,
  zoneGovernance, zoneGovernanceAll, contextsInZone, crossesZoneBoundary,
};
