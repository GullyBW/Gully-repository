'use strict';
// Component Migration Roadmap (Stabilization Part 4). Which subsystems are still SYNTHETIC
// reference implementations, what each must become in production, and how it gets there —
// as verified data rather than a prose table that drifts.
//
// For every subsystem: current implementation, production target, migration strategy,
// dependencies, risks, required validations (real fitness-function ids), and a ROLLBACK
// strategy. Migration is incremental: an item may not reach 'production' before every
// dependency does, and readiness is ADVISORY — cutover is a recorded human decision.
const contextMap = require('../architecture/context-map');

const STATUSES = ['synthetic', 'in-progress', 'production'];
// Waves order the work; a dependency may never sit in a later wave than its dependent.
const WAVES = { 1: 'Security spine', 2: 'State & transport', 3: 'Governance surfaces', 4: 'Insight & operations' };

const ITEMS = {
  identity: {
    subsystem: 'Identity', context: 'identity-access', wave: 1, status: 'synthetic',
    current: 'HMAC session manager + offline HS256 OidcVerifier; principals are role-coded, no reporter identity anywhere.',
    target: 'Federated OIDC/OAuth2 IdP with JWKS rotation and FIDO2/WebAuthn step-up for privileged actions; SAML for legacy agencies.',
    strategy: 'Implement verify(token) → {principal, role} against the real IdP behind the existing auth port; run dual-accept (session OR federated) during migration, then retire the synthetic issuer.',
    dependsOn: [], risks: ['A misconfigured IdP grants a role the platform never intended (privilege escalation).', 'Weakened MFA re-opens the phishing path.', 'Claim mapping leaks personal data into logs or events.'],
    validations: ['APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE', 'APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-CREDENTIAL-HYGIENE', 'FIT-ZERO-TRUST'],
    rollback: 'Flip NJTIP_OIDC_* back to the reference verifier; sessions keep working because the server accepts either. No data migration is involved, so rollback is immediate.',
  },
  cryptography: {
    subsystem: 'Cryptography 🔒', context: 'crypto-agility', wave: 1, status: 'synthetic',
    current: 'Synthetic envelope encryption and Ed25519 signing with clearly-labelled synthetic keys; NJTIP_KMS=kms fails closed.',
    target: 'HSM/KMS-backed envelope encryption, M-of-N threshold custody, and human-built signing identities. Keys never leave the HSM.',
    strategy: 'Implement encrypt/decrypt/isCiphertext and the signing port against the real KMS. Key material is generated and custodied by humans under ISRB sign-off — never machine-generated. Re-wrap existing ciphertext under the new master key before cutover.',
    dependsOn: [], risks: ['Key mismanagement makes historical evidence unreadable (irreversible).', 'A synthetic key mistaken for a real one.', 'Re-wrap interrupted mid-flight leaves mixed key generations.'],
    validations: ['APP-FIT-CIPHERTEXT-ONLY', 'APP-FIT-CUSTODY-SIGNED-CHAIN', 'APP-FIT-CRYPTO-ALGORITHM-INDEPENDENCE', 'FIT-ENCRYPTION', 'FIT-GOVERNANCE'],
    rollback: 'Retain the previous key generation in the HSM for the full re-wrap window and keep both decryptable (dual-generation read). Rollback is only possible while both generations exist — the window is a governance decision, not a technical default.',
  },
  secrets: {
    subsystem: 'Secrets management', context: 'identity-access', wave: 1, status: 'synthetic',
    current: 'Environment-sourced SecretsManager with redaction; values never appear in list()/status().',
    target: 'Vault or cloud KMS-secrets with leasing, automatic rotation and audit.',
    strategy: 'Implement the same lease/rotate contract; rotate the session signing key first, then per-adapter credentials.',
    dependsOn: ['cryptography'], risks: ['Rotation invalidates live sessions unexpectedly.', 'A secret is logged during adapter bring-up.'],
    validations: ['APP-FIT-SECRETS-REDACTED', 'INFRA-FIT-DEVSECOPS', 'APP-FIT-DEVSECOPS-CLASSIFICATION'],
    rollback: 'NJTIP_SECRETS=env restores the reference manager; secrets are re-read at composition, so a restart is sufficient.',
  },
  certificates: {
    subsystem: 'Certificate lifecycle', context: 'crypto-agility', wave: 1, status: 'synthetic',
    current: 'Reference certificate manager tracking issuance and rotation due-dates; a health check fails when a rotation is past due.',
    target: 'Real CA/ACME issuance with automated renewal, revocation checking and an inventory that alerts before expiry.',
    strategy: 'Implement issuance/renewal behind the certificate port; keep the rotation health check as the invariant.',
    dependsOn: ['cryptography'], risks: ['An expired certificate causes an outage.', 'Revocation is not checked, so a compromised certificate stays trusted.'],
    validations: ['INFRA-FIT-K8S-HARDENING', 'APP-FIT-INFRA-ASSURANCE'],
    rollback: 'Reference manager plus a manually issued certificate; the port is unchanged.',
  },
  storage: {
    subsystem: 'Storage', context: 'persistence', wave: 2, status: 'synthetic',
    current: 'MemoryStore / FileStore / SqlStore over MemorySqlDriver; per-zone collections, no identity column.',
    target: 'PostgreSQL with per-zone schemas and roles, connection pooling, backups and point-in-time recovery.',
    strategy: 'Apply db/migrations/*.sql, implement the five-method PgDriver, run SqlStore against it zone by zone (independent first), and keep the no-identity-column invariant.',
    dependsOn: ['cryptography'], risks: ['A shared schema silently collapses zone isolation.', 'An identity column is introduced by a well-meaning DBA.', 'Restore loses records or breaks the audit chain.'],
    validations: ['APP-FIT-NO-IDENTITY-COLUMN', 'APP-FIT-PERSISTENCE-INTEGRITY', 'FIT-ZONE-ISOLATION', 'INFRA-FIT-DR-BACKUP-RESTORE'],
    rollback: 'NJTIP_PERSISTENCE=file with the pre-cutover dump restored. Cut over one zone at a time so a rollback is never platform-wide.',
  },
  objectstore: {
    subsystem: 'Evidence object storage', context: 'persistence', wave: 2, status: 'synthetic',
    current: 'In-memory ciphertext-only object store; plaintext is refused, not silently encrypted.',
    target: 'S3 / MinIO / GCS with per-zone buckets, SSE-KMS, object lock for legal hold and versioning.',
    strategy: 'Implement put/get against the provider behind the object-store port; keep ciphertext-only enforcement client-side so provider-side encryption is defence in depth, not the only control.',
    dependsOn: ['cryptography', 'storage'], risks: ['A bucket policy exposes ciphertext metadata.', 'Object lock is missing, so a legal hold is not enforceable.'],
    validations: ['APP-FIT-CIPHERTEXT-ONLY', 'FIT-BACKUP'],
    rollback: 'NJTIP_OBJECT_STORE=memory with re-ingest from the retained source bucket; objects are content-addressed, so re-ingest is idempotent.',
  },
  messaging: {
    subsystem: 'Messaging / event bus', context: 'platform-events', wave: 2, status: 'synthetic',
    current: 'In-memory PII-free transactional outbox with ordering, replay and DLQ governance.',
    target: 'Kafka / RabbitMQ / NATS with durable partitions, consumer groups and a real dead-letter queue.',
    strategy: 'Implement publish/subscribe/drain behind the broker port; keep the outbox so a broker failure cannot lose an event; migrate topic by topic starting with case.events.',
    dependsOn: ['storage'], risks: ['Duplicate delivery breaks a non-idempotent consumer.', 'Reordering corrupts a projection.', 'A payload gains PII once a real producer is attached.'],
    validations: ['APP-FIT-PII-FREE-EVENTS', 'APP-FIT-EVENTBUS-FEDERATION', 'FIT-SECURE-DATA-FLOWS'],
    rollback: 'NJTIP_BROKER=memory; the outbox retains undelivered events, so no event is lost on the way back.',
  },
  cache: {
    subsystem: 'Cache & sessions', context: 'persistence', wave: 2, status: 'synthetic',
    current: 'In-memory cache implementing get/set/ttl/incr.',
    target: 'Redis with TTL eviction and replication.',
    strategy: 'Same contract behind the cache port; the cache is never authoritative, so migration carries no data.',
    dependsOn: ['storage'], risks: ['Cached authorization decisions outlive a revocation.'],
    validations: ['APP-FIT-AUTHZ-DEFAULT-DENY'],
    rollback: 'NJTIP_CACHE=memory; a cold cache is a performance event, not a correctness one.',
  },
  audit: {
    subsystem: 'Audit', context: 'assurance', wave: 2, status: 'synthetic',
    current: 'In-memory append-only hash-chained audit and event log with a synthetic anchor; integrity is verified on every health check.',
    target: 'Durable append-only storage with digests anchored to an external transparency log an operator cannot rewrite.',
    strategy: 'Persist the chain alongside the event store, then publish periodic digests to the external log; verification stays local so anchoring adds evidence without adding trust.',
    dependsOn: ['storage', 'cryptography'], risks: ['Tampering is undetectable if anchoring lapses.', 'Anchor latency is mistaken for an integrity failure.'],
    validations: ['FIT-AUDITABILITY', 'APP-FIT-EVENT-SOURCING', 'APP-FIT-PERSISTENCE-INTEGRITY'],
    rollback: 'Continue with the local chain and a manual anchoring record; the chain itself never depends on the anchor being available.',
  },
  policyengine: {
    subsystem: 'Policy Engine', context: 'policy-governance', wave: 3, status: 'synthetic',
    current: 'In-process policy-as-data engine (default-deny, deny-precedence) with a validated activation lifecycle.',
    target: 'Externalized policy (e.g. OPA/Rego) evaluated at the gateway and in-process, with a policy-as-code release pipeline.',
    strategy: 'Export the current policy set as the first external bundle; run shadow evaluation (external vs in-process) until decisions agree on the full validation suite, then switch enforcement. Fail-closed semantics are non-negotiable in both.',
    dependsOn: ['identity'], risks: ['An authoring error opens access (the classic externalization failure).', 'Shadow-mode divergence goes unnoticed.', 'External evaluator unavailability must deny, never allow.'],
    validations: ['APP-FIT-POLICY-AS-DATA', 'APP-FIT-POLICY-GOVERNANCE', 'APP-FIT-AUTHZ-DEFAULT-DENY', 'FIT-POLICY-ENFORCEMENT'],
    rollback: 'Deactivate the external bundle; the in-process engine remains loaded and authoritative, so rollback is a configuration flip with no gap in enforcement.',
  },
  governanceportal: {
    subsystem: 'Governance Portal', context: 'governance-oversight', wave: 3, status: 'synthetic',
    current: 'Append-only hash-chained governance ledger with API endpoints and a prototype UI; decisions are human-only by construction.',
    target: 'Persistent ledger, reviewer workspace, threshold-signed decisions and board-scoped access — still human-only.',
    strategy: 'Persist the ledger, add federated auth for board members and M-of-N signature capture on each decision. Automation of a decision is permanently out of scope.',
    dependsOn: ['storage', 'identity', 'cryptography'], risks: ['Automation creep: a convenience feature starts deciding (forbidden).', 'Signature capture becomes a rubber stamp without quorum enforcement.'],
    validations: ['FIT-GOVERNANCE', 'APP-FIT-EVOLUTION-GOVOPS', 'APP-FIT-GOVERNANCE-OWNERSHIP'],
    rollback: 'Ledger file plus CLI recording; the chain format is unchanged, so entries written either way verify identically.',
  },
  dataexchange: {
    subsystem: 'Data Exchange', context: 'data-exchange', wave: 3, status: 'synthetic',
    current: 'In-memory dataset registry with privacy validation, classification enforcement, human approval and recorded agreements.',
    target: 'Persistent registry federated with participating agencies, purpose-limited access tokens, and retention enforcement.',
    strategy: 'Persist the registry, then federate discovery per agreement. Purpose limitation and named approval stay in the exchange, never in the consumer.',
    dependsOn: ['storage', 'identity'], risks: ['Purpose creep: data shared for one purpose is reused for another.', 'A restricted dataset becomes discoverable through a federated catalogue.', 'Retention is not enforced after the agreement expires.'],
    validations: ['APP-FIT-LEGISLATION-MARKETPLACE', 'APP-FIT-PRIVACY-ENGINEERING'],
    rollback: 'Suspend federation and revert to owner-local catalogues; existing agreements remain valid and auditable.',
  },
  processmining: {
    subsystem: 'Process Mining', context: 'orchestration', wave: 4, status: 'synthetic',
    current: 'Deterministic mining over the in-memory event log: discovery, conformance, bottlenecks, SLA deviation, governance and fraud indicators.',
    target: 'Mining over the durable event store at national volume, incremental rather than full-scan, with findings correlated to fitness functions.',
    strategy: 'Point the miner at the persisted log, add windowed incremental computation, keep every output advisory and explainable.',
    dependsOn: ['audit', 'messaging'], risks: ['Volume makes full-scan mining infeasible and silently truncates.', 'An actor identifier becomes personally identifying at scale.', 'A finding is treated as a verdict rather than a signal.'],
    validations: ['APP-FIT-PROCESS-MINING', 'APP-FIT-ANALYTICS-PRIVACY'],
    rollback: 'Fall back to windowed mining over a bounded replay; outputs are advisory, so degradation has no authorization impact.',
  },
  observatory: {
    subsystem: 'Performance Observatory', context: 'observability', wave: 4, status: 'synthetic',
    current: 'Deterministic KPIs, cross-agency analytics with small-cell suppression, benchmarking and seeded forecasts; dashboards are informational only.',
    target: 'Real telemetry pipeline (metrics store + trace backend) feeding audience-specific dashboards, with suppression enforced at query time.',
    strategy: 'Export metrics/traces to the platform observability stack; keep aggregation and suppression server-side so no dashboard can bypass them.',
    dependsOn: ['messaging'], risks: ['A dashboard query re-identifies a small cell.', 'Trace attributes carry identity once real producers are attached.', 'Benchmarking is read as a ranking of agencies rather than a signal.'],
    validations: ['APP-FIT-TRACE-PRIVACY', 'APP-FIT-ANALYTICS-PRIVACY'],
    rollback: 'Serve dashboards from the in-process metrics snapshot; informational only, so no decision depends on the richer pipeline.',
  },
  search: {
    subsystem: 'Search', context: 'analytics', wave: 4, status: 'synthetic',
    current: 'In-memory index with a strict identity-free allow-list; non-allowlisted fields are not indexed.',
    target: 'OpenSearch / Elasticsearch / Postgres FTS with the same allow-list applied at index time.',
    strategy: 'Implement the index/search port against the engine; the allow-list moves with the port so the engine never sees a denied field.',
    dependsOn: ['storage'], risks: ['An engine-side mapping indexes a field the allow-list refuses.', 'Query logs capture sensitive terms.'],
    validations: ['APP-FIT-ANALYTICS-PRIVACY', 'APP-FIT-SEMANTIC-GRAPH-ADVISORY'],
    rollback: 'Reference in-memory index rebuilt from read models; the index is derived data, so nothing is lost.',
  },
  notifications: {
    subsystem: 'Notifications', context: 'intake', wave: 4, status: 'synthetic',
    current: 'Capture providers for email/SMS/push with the anonymity boundary enforced; reporter contact details are never held.',
    target: 'Real transport (SES / Twilio / FCM) for staff notifications only, with minimal, non-attributable payloads.',
    strategy: 'Implement the provider port; keep reporter-facing updates pull-only by case code — the platform must never be able to contact a reporter.',
    dependsOn: ['identity'], risks: ['A provider requires a recipient identity, breaching the anonymity boundary.', 'Notification metadata leaks case detail to a transport provider.'],
    validations: ['APP-FIT-ANONYMITY-BOUNDARY', 'FIT-IDENTITY-MINIMIZATION'],
    rollback: 'Capture provider; staff fall back to in-platform queues, and reporter-facing behaviour is unchanged because it was never push-based.',
  },
  infrastructure: {
    subsystem: 'Infrastructure', context: 'infrastructure', wave: 4, status: 'synthetic',
    current: 'Reference Kubernetes and pilot manifests, a resource registry with residency policy, a reviewed baseline and drift detection.',
    target: 'Provisioned sovereign-cloud infrastructure managed as code, with drift detection against the human-reviewed baseline.',
    strategy: 'Apply the manifests, review every placeholder, record the infra baseline after human review, then let INFRA-FIT-DRIFT hold it.',
    dependsOn: ['storage', 'messaging', 'certificates'], risks: ['An unreviewed manifest change lands in production.', 'Residency policy is violated by a provider default.', 'A deployment bypasses the supply-chain gate.'],
    validations: ['INFRA-FIT-K8S-HARDENING', 'INFRA-FIT-NETWORK-DEFAULT-DENY', 'INFRA-FIT-DRIFT', 'INFRA-FIT-PLATFORM-LIFECYCLE', 'APP-FIT-INFRA-GOVERNANCE', 'APP-FIT-SUPPLY-CHAIN-GOVERNANCE'],
    rollback: 'Re-apply the previous reviewed baseline revision; manifests are declarative, and the drift check names exactly what changed.',
  },
};

function ids() { return Object.keys(ITEMS); }
function describe(id) { const i = ITEMS[id]; if (!i) throw new Error('unknown migration item: ' + id); return JSON.parse(JSON.stringify({ id, ...i })); }
function items() { return ids().map(describe); }

// Dependency-respecting order (deterministic: stable within a wave, by declaration order).
function sequence() {
  const done = new Set(); const order = [];
  const remaining = ids().slice().sort((a, b) => ITEMS[a].wave - ITEMS[b].wave || ids().indexOf(a) - ids().indexOf(b));
  let guard = remaining.length + 1;
  while (remaining.length && guard-- > 0) {
    for (let i = 0; i < remaining.length; i++) {
      const id = remaining[i];
      if (ITEMS[id].dependsOn.every((dep) => done.has(dep))) { done.add(id); order.push(id); remaining.splice(i, 1); i--; }
    }
  }
  return { order, unresolved: remaining };
}
function waves() {
  const out = {};
  for (const [w, name] of Object.entries(WAVES)) out[w] = { name, items: ids().filter((id) => String(ITEMS[id].wave) === w) };
  return out;
}
function progress() {
  const byStatus = { synthetic: 0, 'in-progress': 0, production: 0 };
  for (const id of ids()) byStatus[ITEMS[id].status]++;
  return { total: ids().length, byStatus, productionPct: +(byStatus.production / ids().length).toFixed(2) };
}
// Items that cannot start because a dependency is not yet in production (incremental order).
function blockers() {
  return ids().map((id) => ({ id, blockedBy: ITEMS[id].dependsOn.filter((dep) => ITEMS[dep] && ITEMS[dep].status !== 'production') }))
    .filter((x) => x.blockedBy.length);
}
function rollbackPlan(id) { const i = describe(id); return { id, subsystem: i.subsystem, rollback: i.rollback, validations: i.validations, note: 'Rollback is rehearsed before cutover; a migration without a rehearsed rollback is not ready.' }; }

// Migration readiness for one item — ADVISORY and human-gated. It never authorizes a cutover.
function readiness(id, { fitnessResults = [] } = {}) {
  const i = describe(id);
  const pass = new Set(fitnessResults.filter((r) => r.pass).map((r) => r.id));
  const known = new Set(fitnessResults.map((r) => r.id));
  const checked = i.validations.filter((v) => known.has(v));
  const failing = checked.filter((v) => !pass.has(v));
  const blocked = i.dependsOn.filter((dep) => ITEMS[dep] && ITEMS[dep].status !== 'production');
  return {
    id, subsystem: i.subsystem, status: i.status,
    validationsChecked: checked.length, validationsFailing: failing,
    dependenciesOutstanding: blocked,
    ready: failing.length === 0 && blocked.length === 0 && checked.length > 0,
    humanGate: true, authorizes: false,
    note: 'Advisory readiness only. Cutover is a recorded decision by the approving authority for this context.',
  };
}

function validate() {
  const violations = [];
  const known = new Set(contextMap.ids());
  for (const id of ids()) {
    const i = ITEMS[id];
    if (!known.has(i.context)) violations.push(`${id}: context '${i.context}' is not a bounded context`);
    if (!STATUSES.includes(i.status)) violations.push(`${id}: unknown status '${i.status}'`);
    if (!WAVES[i.wave]) violations.push(`${id}: unknown wave '${i.wave}'`);
    for (const field of ['current', 'target', 'strategy', 'rollback']) if (!i[field] || i[field].length < 20) violations.push(`${id}: ${field} is missing or not specific`);
    if (!i.risks.length) violations.push(`${id}: no risks named`);
    if (!i.validations.length) violations.push(`${id}: no required validations`);
    for (const dep of i.dependsOn) {
      if (!ITEMS[dep]) violations.push(`${id}: depends on unknown item '${dep}'`);
      else if (ITEMS[dep].wave > i.wave) violations.push(`${id}: depends on '${dep}' from a later wave (${ITEMS[dep].wave} > ${i.wave})`);
    }
    // Incremental discipline: nothing reaches production ahead of what it depends on.
    if (i.status === 'production') for (const dep of i.dependsOn) if (ITEMS[dep] && ITEMS[dep].status !== 'production') violations.push(`${id}: marked production while dependency '${dep}' is ${ITEMS[dep].status}`);
  }
  const seq = sequence();
  if (seq.unresolved.length) violations.push('dependency cycle among migration items: ' + seq.unresolved.join(', '));
  return { valid: violations.length === 0, violations, items: ids().length };
}

// The whole roadmap, as served to the API and rendered into docs/component-migration-roadmap.md.
function roadmap({ fitnessResults = [] } = {}) {
  return {
    waves: waves(), sequence: sequence().order, items: items(), progress: progress(), blockers: blockers(),
    readiness: ids().map((id) => readiness(id, { fitnessResults })), validation: validate(),
    note: 'Incremental migration behind stable ports. Deterministic testing and continuous assurance are preserved at every step. Readiness never authorizes a cutover.',
  };
}

module.exports = { ITEMS, WAVES, STATUSES, ids, describe, items, sequence, waves, progress, blockers, rollbackPlan, readiness, validate, roadmap };
