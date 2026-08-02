'use strict';
// Enterprise Threat Model (Phase 10, Part 2). Security analysis beyond STRIDE and LINDDUN:
// attack trees, abuse cases, adversary playbooks, kill-chain and MITRE ATT&CK / CAPEC
// mapping, insider, supply-chain, third-party, cloud and AI-assisted threat classes.
//
// The point of the model is the TRACE. For every threat the platform can answer, mechanically:
//
//     Threat → Control → Evidence → Verification → Responsible Owner
//
// A threat with no control, a control that names a fitness function which does not exist, or
// an owner that is not a real bounded context all fail the build. Deterministic; no wall-clock.
const contextMap = require('../architecture/context-map');

const KILL_CHAIN = ['reconnaissance', 'weaponization', 'delivery', 'exploitation', 'installation', 'command-and-control', 'actions-on-objectives'];
const CLASSES = ['stride', 'linddun', 'insider', 'supply-chain', 'third-party', 'cloud', 'ai'];

// Attack tree node: { goal, operator: 'OR'|'AND', children: [...] }. Leaves are concrete steps.
const t = (goal, operator, children) => ({ goal, operator, children });

const THREATS = {
  'TH-DEANON': {
    title: 'De-anonymisation of a reporter', class: 'linddun', killChain: 'actions-on-objectives',
    attck: ['T1213 Data from Information Repositories'], capec: ['CAPEC-116 Excavation'],
    owner: 'privacy', severity: 'critical',
    abuseCases: [
      'An investigator correlates submission timing with building access logs to identify a reporter.',
      'An analyst joins case metadata with a demographic dataset until a cell contains one person.',
      'An operator with database access reads a stored identifier that should never have existed.',
    ],
    attackTree: t('Identify an anonymous reporter', 'OR', [
      t('Read a stored identity', 'OR', [{ goal: 'Query an identity column' }, { goal: 'Recover identity from a backup' }]),
      t('Infer identity from metadata', 'AND', [{ goal: 'Obtain case metadata' }, { goal: 'Obtain an external dataset to join against' }]),
      t('Observe the reporting channel', 'OR', [{ goal: 'Correlate submission timing' }, { goal: 'Read network-level source data' }]),
    ]),
    controls: ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-ANONYMITY-BOUNDARY', 'APP-FIT-NO-IDENTITY-COLUMN', 'APP-FIT-ANALYTICS-PRIVACY', 'APP-FIT-CORRELATION-GOVERNANCE'],
    evidence: 'Identity fields are refused at write, no identity column exists in any zone schema, small cells are suppressed, and reporter-linkage correlation is a named prohibition.',
  },
  'TH-EVIDENCE-TAMPER': {
    title: 'Tampering with evidence or its custody record', class: 'stride', killChain: 'actions-on-objectives',
    attck: ['T1565 Data Manipulation', 'T1070 Indicator Removal'], capec: ['CAPEC-268 Audit Log Manipulation'],
    owner: 'custody', severity: 'critical',
    abuseCases: ['An insider edits a custody entry to hide a handling gap.', 'An operator replaces stored ciphertext and re-signs it.'],
    attackTree: t('Alter evidence undetectably', 'AND', [
      { goal: 'Modify the stored artifact' },
      t('Defeat integrity verification', 'OR', [{ goal: 'Forge the chain hash' }, { goal: 'Forge the signature' }, { goal: 'Suppress verification' }]),
    ]),
    controls: ['FIT-CHAIN-OF-CUSTODY', 'APP-FIT-CUSTODY-SIGNED-CHAIN', 'FIT-AUDITABILITY', 'APP-FIT-PERSISTENCE-INTEGRITY'],
    evidence: 'Hash-chained custody with signed entries; integrity is re-verified on every health check and by the fitness gate.',
  },
  'TH-PRIV-ESCALATION': {
    title: 'Privilege escalation through identity federation', class: 'stride', killChain: 'exploitation',
    attck: ['T1078 Valid Accounts', 'T1550 Use Alternate Authentication Material'], capec: ['CAPEC-233 Privilege Escalation'],
    owner: 'identity-access', severity: 'high',
    abuseCases: ['A misconfigured IdP asserts a role the platform never intended to exist.', 'A long-lived token is replayed after the holder loses the role.'],
    attackTree: t('Act with privileges not granted', 'OR', [
      t('Obtain a token', 'OR', [{ goal: 'Replay a stale token' }, { goal: 'Obtain a credential with an excessive TTL' }]),
      { goal: 'Claim a role the IdP asserts but the platform never granted' },
    ]),
    controls: ['APP-FIT-OIDC-NO-IMPLICIT-PRIVILEGE', 'APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-CREDENTIAL-HYGIENE', 'APP-FIT-ZERO-TRUST-ARCHITECTURE'],
    evidence: 'An IdP claim never grants privilege by itself; the RBAC matrix is the ceiling; credentials are short-lived and revocable; every request is re-evaluated at the PDP.',
  },
  'TH-INSIDER-SOD': {
    title: 'Insider drives a case end to end without a second pair of eyes', class: 'insider', killChain: 'actions-on-objectives',
    attck: ['T1078 Valid Accounts'], capec: ['CAPEC-560 Use of Known Credentials'],
    owner: 'governance-oversight', severity: 'high',
    abuseCases: ['One investigator both reviews and approves the same case.', 'A requester approves their own break-glass grant.'],
    attackTree: t('Unilaterally control an outcome', 'OR', [
      { goal: 'Perform both halves of a conflicting duty pair' },
      { goal: 'Approve own emergency access' },
      { goal: 'Rubber-stamp an approval faster than a real review' },
    ]),
    controls: ['APP-FIT-FORMAL-VERIFICATION', 'APP-FIT-PROCESS-GOVERNANCE', 'APP-FIT-GOVERNANCE-OWNERSHIP', 'APP-FIT-FORMAL-POLICY'],
    evidence: 'Separation of duties is formally verified over the workflow and the policy set; process mining detects SoD breaches and rubber-stamping; the responsible authority may never approve its own subsystem.',
  },
  'TH-SUPPLY-CHAIN': {
    title: 'Compromised dependency or build artifact', class: 'supply-chain', killChain: 'delivery',
    attck: ['T1195 Supply Chain Compromise', 'T1554 Compromise Host Software Binary'], capec: ['CAPEC-437 Supply Chain'],
    owner: 'supply-chain', severity: 'critical',
    abuseCases: ['A transitive dependency ships a backdoor.', 'A build artifact is swapped between build and deploy.'],
    attackTree: t('Execute attacker code in production', 'OR', [
      t('Poison a dependency', 'AND', [{ goal: 'Publish a malicious version' }, { goal: 'Have it resolved into the build' }]),
      t('Tamper with the artifact', 'OR', [{ goal: 'Modify the built image' }, { goal: 'Defeat artifact signature verification' }]),
    ]),
    controls: ['APP-FIT-SUPPLY-CHAIN-GOVERNANCE', 'APP-FIT-SUPPLY-CHAIN-ATTESTATION', 'INFRA-FIT-DEVSECOPS', 'INFRA-FIT-PLATFORM-LIFECYCLE', 'APP-FIT-DEVSECOPS-CLASSIFICATION'],
    evidence: 'Zero third-party runtime dependencies (no transitive closure to poison); SBOM generated per build; deployment is gated by supply-chain validation that fails closed.',
  },
  'TH-THIRD-PARTY': {
    title: 'A partner agency or external service abuses an integration', class: 'third-party', killChain: 'exploitation',
    attck: ['T1199 Trusted Relationship'], capec: ['CAPEC-679 Exploitation of Improperly Configured Components'],
    owner: 'data-exchange', severity: 'high',
    abuseCases: ['Data shared for statistics is reused for enforcement.', 'A federated catalogue exposes a restricted dataset.'],
    attackTree: t('Obtain data beyond the agreement', 'OR', [
      { goal: 'Reuse exchanged data for another purpose' },
      { goal: 'Retain data past the agreed retention' },
      { goal: 'Discover a restricted dataset through federation' },
    ]),
    controls: ['APP-FIT-DATA-EXCHANGE-PURPOSE', 'APP-FIT-DATA-GOVERNANCE', 'APP-FIT-TENANT-ISOLATION', 'APP-FIT-INTEGRATION-ISOLATION'],
    evidence: 'Purpose limitation is enforced at request and at use; retention bounds every agreement; restricted datasets are never publicly discoverable; outbound integrations refuse PII and fail fast.',
  },
  'TH-CLOUD-MISCONFIG': {
    title: 'Cloud or infrastructure misconfiguration exposes data or breaks residency', class: 'cloud', killChain: 'installation',
    attck: ['T1580 Cloud Infrastructure Discovery', 'T1530 Data from Cloud Storage'], capec: ['CAPEC-180 Exploiting Incorrectly Configured Access Control'],
    owner: 'infrastructure', severity: 'high',
    abuseCases: ['A bucket policy exposes evidence ciphertext metadata.', 'A workload is scheduled outside the sovereign region.'],
    attackTree: t('Reach data through the platform substrate', 'OR', [
      { goal: 'Exploit an over-permissive storage policy' },
      { goal: 'Move a workload outside the residency boundary' },
      { goal: 'Apply an unreviewed manifest change' },
    ]),
    controls: ['INFRA-FIT-K8S-HARDENING', 'INFRA-FIT-NETWORK-DEFAULT-DENY', 'INFRA-FIT-DRIFT', 'APP-FIT-INFRA-GOVERNANCE', 'APP-FIT-INFRA-ASSURANCE'],
    evidence: 'Hardened pods, default-deny networking, residency policy validated per resource, and drift detected against a human-reviewed baseline.',
  },
  'TH-AI-OVERREACH': {
    title: 'An AI recommendation becomes a decision', class: 'ai', killChain: 'actions-on-objectives',
    attck: ['T1565 Data Manipulation'], capec: ['CAPEC-586 Object Injection'],
    owner: 'ai-advisory', severity: 'high',
    abuseCases: ['A convenience feature auto-applies a model recommendation.', 'A model output is recorded as a governance decision.', 'A prompt injection steers a recommendation.'],
    attackTree: t('Have the platform act on model output', 'OR', [
      { goal: 'Bypass the human approval queue' },
      { goal: 'Record model output directly in the governance ledger' },
      t('Manipulate the model', 'OR', [{ goal: 'Poison the input' }, { goal: 'Inject instructions through content' }]),
    ]),
    controls: ['APP-FIT-AI-ADVISORY-ONLY', 'APP-FIT-AI-GOVERNANCE', 'APP-FIT-AI-LIFECYCLE', 'FIT-GOVERNANCE'],
    evidence: 'Every recommendation exits only through a human approval queue; models are registered and approved before use; the governance ledger records human decisions only.',
  },
  'TH-AVAILABILITY': {
    title: 'Denial of the reporting channel', class: 'stride', killChain: 'actions-on-objectives',
    attck: ['T1499 Endpoint Denial of Service'], capec: ['CAPEC-125 Flooding'],
    owner: 'resilience', severity: 'high',
    abuseCases: ['Load is driven high enough that anonymous intake stops accepting reports.', 'A regional failure takes the only path offline.'],
    attackTree: t('Prevent reports being filed', 'OR', [
      { goal: 'Exhaust capacity' }, { goal: 'Cause a regional outage' }, { goal: 'Break a critical dependency' },
    ]),
    controls: ['APP-FIT-NATIONAL-RESILIENCE', 'INFRA-FIT-HA-SCALABILITY', 'APP-FIT-RECOVERY-STRATEGIES', 'APP-FIT-SRE-RELIABILITY', 'APP-FIT-CHAOS-RESILIENCE', 'APP-FIT-MULTI-REGION'],
    evidence: 'HA with autoscaling and disruption budgets, a validated resilience suite, degraded mode that preserves anonymous intake, and rehearsed multi-region failover.',
  },
  'TH-AUDIT-SUPPRESSION': {
    title: 'Suppressing or rewriting the audit trail', class: 'insider', killChain: 'actions-on-objectives',
    attck: ['T1070.001 Clear Windows Event Logs', 'T1562 Impair Defenses'], capec: ['CAPEC-93 Log Injection-Tampering-Forging'],
    owner: 'assurance', severity: 'critical',
    abuseCases: ['An operator truncates the audit log after acting.', 'A decision is recorded without the rationale that justified it.'],
    attackTree: t('Act without a trace', 'OR', [
      t('Remove the record', 'OR', [{ goal: 'Truncate the log' }, { goal: 'Rewrite a chained entry' }]),
      { goal: 'Perform the action on a path that is not audited' },
    ]),
    controls: ['FIT-AUDITABILITY', 'APP-FIT-EVENT-SOURCING', 'APP-FIT-EVENT-GOVERNANCE', 'APP-FIT-CONTINUOUS-ASSURANCE'],
    evidence: 'Append-only hash-chained audit and event log, verified continuously; every governed action emits an event; assurance evidence is reproducible and signed.',
  },
};

// Adversary playbooks: ordered technique sequences with the control that breaks the chain.
const PLAYBOOKS = {
  'PB-INSIDER-EXFIL': {
    adversary: 'Privileged insider seeking a reporter identity', threats: ['TH-DEANON', 'TH-AUDIT-SUPPRESSION'],
    sequence: [
      { phase: 'reconnaissance', technique: 'T1213 Data from Information Repositories', breaksAt: 'APP-FIT-ANALYTICS-PRIVACY' },
      { phase: 'exploitation', technique: 'T1078 Valid Accounts', breaksAt: 'APP-FIT-AUTHZ-DEFAULT-DENY' },
      { phase: 'actions-on-objectives', technique: 'T1565 Data Manipulation', breaksAt: 'FIT-IDENTITY-MINIMIZATION' },
    ],
  },
  'PB-SUPPLY-CHAIN': {
    adversary: 'Upstream supply-chain attacker', threats: ['TH-SUPPLY-CHAIN'],
    sequence: [
      { phase: 'weaponization', technique: 'T1195 Supply Chain Compromise', breaksAt: 'INFRA-FIT-DEVSECOPS' },
      { phase: 'delivery', technique: 'T1554 Compromise Host Software Binary', breaksAt: 'APP-FIT-SUPPLY-CHAIN-GOVERNANCE' },
      { phase: 'installation', technique: 'T1543 Create or Modify System Process', breaksAt: 'INFRA-FIT-K8S-HARDENING' },
    ],
  },
  'PB-EXTERNAL-INTRUSION': {
    adversary: 'External actor with a stolen credential', threats: ['TH-PRIV-ESCALATION', 'TH-EVIDENCE-TAMPER'],
    sequence: [
      { phase: 'delivery', technique: 'T1550 Use Alternate Authentication Material', breaksAt: 'APP-FIT-CREDENTIAL-HYGIENE' },
      { phase: 'exploitation', technique: 'T1078 Valid Accounts', breaksAt: 'APP-FIT-ZERO-TRUST-ARCHITECTURE' },
      { phase: 'actions-on-objectives', technique: 'T1565 Data Manipulation', breaksAt: 'APP-FIT-CUSTODY-SIGNED-CHAIN' },
    ],
  },
};

const ids = () => Object.keys(THREATS);
function describe(id) { const th = THREATS[id]; if (!th) throw new Error('unknown threat: ' + id); return JSON.parse(JSON.stringify({ id, ...th })); }
function threats({ threatClass = null } = {}) { return ids().map(describe).filter((t2) => !threatClass || t2.class === threatClass); }

// Flatten an attack tree into its leaf paths (the concrete ways the goal is reached).
function attackPaths(id) {
  const root = describe(id).attackTree;
  const paths = [];
  const walk = (node, prefix) => {
    const here = [...prefix, node.goal];
    if (!node.children || !node.children.length) { paths.push({ path: here, operator: null }); return; }
    if (node.operator === 'AND') paths.push({ path: [...here, node.children.map((c) => c.goal).join(' AND ')], operator: 'AND' });
    for (const child of node.children) walk(child, here);
  };
  walk(root, []);
  return { threat: id, paths };
}

// Coverage views.
function killChainCoverage() {
  const out = {};
  for (const phase of KILL_CHAIN) out[phase] = ids().filter((id) => THREATS[id].killChain === phase);
  return out;
}
function attckCoverage() {
  const out = {};
  for (const id of ids()) for (const tech of THREATS[id].attck) (out[tech] = out[tech] || []).push(id);
  return out;
}
function capecCoverage() {
  const out = {};
  for (const id of ids()) for (const c of THREATS[id].capec) (out[c] = out[c] || []).push(id);
  return out;
}
function playbooks() { return Object.entries(PLAYBOOKS).map(([id, p]) => ({ id, ...p })); }

// The trace this model exists for: Threat → Control → Evidence → Verification → Owner.
function traceability({ fitnessResults = [] } = {}) {
  const state = new Map(fitnessResults.map((r) => [r.id, r.pass]));
  return ids().map((id) => {
    const th = THREATS[id];
    const controls = th.controls.map((c) => ({ control: c, implemented: state.has(c), verified: state.get(c) ?? null }));
    let accountability = null;
    try { accountability = require('../governance/ownership').describe(th.owner); } catch (_) { accountability = null; }
    return {
      threat: id, title: th.title, class: th.class, severity: th.severity,
      controls, evidence: th.evidence,
      verification: state.size ? (controls.every((c) => c.verified === true) ? 'all controls verified by the fitness gate' : 'one or more controls unverified') : 'fitness results not supplied',
      owner: th.owner,
      responsibleAuthority: accountability ? accountability.responsibleAuthority : null,
      approvingAuthority: accountability ? accountability.approvingAuthority : null,
      governanceBoard: accountability ? accountability.governanceBoard : null,
    };
  });
}

// Residual risk: threats whose controls are missing or failing, weighted by severity.
function residualRisk({ fitnessResults = [] } = {}) {
  const state = new Map(fitnessResults.map((r) => [r.id, r.pass]));
  const weight = { critical: 4, high: 3, medium: 2, low: 1 };
  const rows = ids().map((id) => {
    const th = THREATS[id];
    const unimplemented = th.controls.filter((c) => !state.has(c));
    const failing = th.controls.filter((c) => state.get(c) === false);
    const exposure = (unimplemented.length + failing.length * 2) * (weight[th.severity] || 1);
    return { threat: id, severity: th.severity, unimplemented, failing, exposure };
  }).filter((r) => r.exposure > 0);
  const total = rows.reduce((a, r) => a + r.exposure, 0);
  return { residual: rows.sort((a, b) => b.exposure - a.exposure), totalExposure: total, clean: rows.every((r) => r.failing.length === 0), note: 'Advisory exposure signal. A failing control counts double a missing one: it was relied upon.' };
}

// Every threat must be complete, owned by a real context, and controlled by real fitness ids.
function validate({ knownFitnessIds = [] } = {}) {
  const violations = [];
  const contexts = new Set(contextMap.ids());
  const known = new Set(knownFitnessIds);
  for (const id of ids()) {
    const th = THREATS[id];
    if (!CLASSES.includes(th.class)) violations.push(`${id}: unknown threat class '${th.class}'`);
    if (!KILL_CHAIN.includes(th.killChain)) violations.push(`${id}: unknown kill-chain phase '${th.killChain}'`);
    if (!th.attck.length) violations.push(`${id}: no MITRE ATT&CK mapping`);
    if (!th.capec.length) violations.push(`${id}: no CAPEC mapping`);
    if (!th.abuseCases.length) violations.push(`${id}: no abuse cases`);
    if (!th.attackTree || !th.attackTree.children) violations.push(`${id}: no attack tree`);
    if (!th.evidence) violations.push(`${id}: no evidence statement`);
    if (!th.controls.length) violations.push(`${id}: no controls — an uncontrolled threat`);
    if (!contexts.has(th.owner)) violations.push(`${id}: owner '${th.owner}' is not a bounded context`);
    if (known.size) for (const c of th.controls) if (!known.has(c)) violations.push(`${id}: control '${c}' is not a real fitness function`);
  }
  for (const [pid, pb] of Object.entries(PLAYBOOKS)) {
    for (const th of pb.threats) if (!THREATS[th]) violations.push(`${pid}: references unknown threat '${th}'`);
    for (const s of pb.sequence) {
      if (!KILL_CHAIN.includes(s.phase)) violations.push(`${pid}: unknown kill-chain phase '${s.phase}'`);
      if (known.size && !known.has(s.breaksAt)) violations.push(`${pid}: breaksAt '${s.breaksAt}' is not a real fitness function`);
    }
  }
  // Every threat class the model claims to cover must actually have a threat in it.
  for (const cls of CLASSES) if (!ids().some((id) => THREATS[id].class === cls)) violations.push(`no threat modelled for class '${cls}'`);
  return { valid: violations.length === 0, violations, threats: ids().length, playbooks: Object.keys(PLAYBOOKS).length };
}

// --- Enterprise Risk Intelligence (Phase 11, Part 2) ---------------------------------------
//
// Extends the threat trace with the full risk lifecycle:
//   Threat → Risk → Control → Evidence → Verification → Residual Risk → Owner → Review Date
//
// Risk is not a static label: it is accepted by a named human, it EXPIRES, it is reassessed,
// and control effectiveness is scored from the live gate rather than asserted.

// Control effectiveness weights. A control that is implemented and holding is worth more than
// one that merely exists — and one that is failing is worth LESS than nothing, because it was
// relied upon.
const EFFECTIVENESS = { holding: 1, failing: -0.5, unimplemented: 0 };
// How long a risk acceptance may stand before it must be re-taken by a human.
const DEFAULT_ACCEPTANCE_DAYS = 90;
// How often a risk must be reassessed, by severity.
const REVIEW_CADENCE_DAYS = { critical: 30, high: 90, medium: 180, low: 365 };

class RiskRegister {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._acceptances = new Map(); this._reassessments = []; this._intel = []; this._trend = []; this._seq = 0; }

  // Control effectiveness for one threat, scored from the live fitness gate.
  controlEffectiveness(threatId, fitnessResults = []) {
    const th = describe(threatId);
    const state = new Map(fitnessResults.map((r) => [r.id, r.pass]));
    const rows = th.controls.map((c) => {
      const status = !state.has(c) ? 'unimplemented' : state.get(c) ? 'holding' : 'failing';
      return { control: c, status, weight: EFFECTIVENESS[status] };
    });
    const max = rows.length;
    const raw = rows.reduce((a, r) => a + r.weight, 0);
    return { threat: threatId, controls: rows, score: max ? +Math.max(0, raw / max).toFixed(3) : 0, holding: rows.filter((r) => r.status === 'holding').length, failing: rows.filter((r) => r.status === 'failing').length, unimplemented: rows.filter((r) => r.status === 'unimplemented').length };
  }

  // Residual risk for one threat: inherent severity reduced by control effectiveness, then
  // reduced again only if a CURRENT human acceptance stands.
  residual(threatId, { fitnessResults = [], now = null } = {}) {
    const th = describe(threatId);
    const at = now ?? this._clock();
    const inherent = { critical: 1, high: 0.75, medium: 0.5, low: 0.25 }[th.severity] ?? 0.5;
    const eff = this.controlEffectiveness(threatId, fitnessResults);
    const residual = +Math.max(0, inherent * (1 - eff.score)).toFixed(3);
    const acceptance = this.acceptanceFor(threatId, { now: at });
    return {
      threat: threatId, severity: th.severity, inherent, controlEffectiveness: eff.score, residual,
      band: residual >= 0.6 ? 'critical' : residual >= 0.35 ? 'high' : residual >= 0.15 ? 'medium' : residual > 0 ? 'low' : 'none',
      owner: th.owner, acceptance,
      treatment: residual === 0 ? 'controlled' : acceptance && acceptance.current ? 'accepted (time-boxed)' : 'open — treat or accept',
      reviewDue: this.reviewDue(threatId, { now: at }),
    };
  }

  // Risk acceptance: a NAMED human accepts a residual risk, with a rationale and an expiry.
  // An acceptance without an expiry is not an acceptance, it is an omission.
  accept(threatId, { by, rationale, days = DEFAULT_ACCEPTANCE_DAYS, now = null } = {}) {
    describe(threatId);
    if (!by || !rationale) { const e = new Error('risk acceptance requires a named human authority and a rationale'); e.failClosed = true; throw e; }
    if (!Number.isInteger(days) || days <= 0 || days > 365) { const e = new Error('a risk acceptance must expire within 365 days'); e.failClosed = true; throw e; }
    const at = now ?? this._clock();
    const record = { id: 'RA-' + (++this._seq).toString().padStart(4, '0'), threat: threatId, by, rationale, acceptedAt: at, expiresAt: at + days * 24 * 3600_000, revoked: false };
    if (!this._acceptances.has(threatId)) this._acceptances.set(threatId, []);
    this._acceptances.get(threatId).push(record);
    return { ...record };
  }
  revokeAcceptance(id, { by, reason } = {}) {
    for (const list of this._acceptances.values()) {
      const rec = list.find((r) => r.id === id);
      if (rec) { if (!by || !reason) throw new Error('revoking an acceptance requires a named human and a reason'); rec.revoked = true; rec.revokedBy = by; rec.revokedReason = reason; return { ...rec }; }
    }
    throw new Error('unknown risk acceptance: ' + id);
  }
  acceptanceFor(threatId, { now = null } = {}) {
    const at = now ?? this._clock();
    const list = (this._acceptances.get(threatId) || []).filter((r) => !r.revoked);
    if (!list.length) return null;
    const latest = list[list.length - 1];
    return { ...latest, current: at <= latest.expiresAt, expired: at > latest.expiresAt };
  }
  // Acceptances that have lapsed — the risk is open again and nobody was told.
  expiredAcceptances({ now = null } = {}) {
    const at = now ?? this._clock();
    const out = [];
    for (const [threat, list] of this._acceptances) for (const r of list) if (!r.revoked && at > r.expiresAt) out.push({ threat, id: r.id, by: r.by, expiredAt: r.expiresAt, daysOverdue: Math.floor((at - r.expiresAt) / (24 * 3600_000)) });
    return out;
  }

  // Reassessment: a recorded re-evaluation of a threat, which resets its review clock.
  reassess(threatId, { by, findings, now = null } = {}) {
    describe(threatId);
    if (!by || !findings) throw new Error('a reassessment requires a named human and findings');
    const rec = { threat: threatId, by, findings, at: now ?? this._clock() };
    this._reassessments.push(rec);
    return { ...rec };
  }
  lastReassessment(threatId) { const rows = this._reassessments.filter((r) => r.threat === threatId); return rows.length ? { ...rows[rows.length - 1] } : null; }
  // Review date: cadence by severity, from the last reassessment (or never assessed).
  reviewDue(threatId, { now = null } = {}) {
    const th = describe(threatId);
    const at = now ?? this._clock();
    const last = this.lastReassessment(threatId);
    const cadenceDays = REVIEW_CADENCE_DAYS[th.severity] ?? 180;
    const dueAt = last ? last.at + cadenceDays * 24 * 3600_000 : at;
    return { threat: threatId, cadenceDays, lastReassessedAt: last ? last.at : null, dueAt, overdue: !last || at > dueAt, neverAssessed: !last };
  }
  // Automatic review reminders — every threat whose review is due or overdue.
  reviewReminders({ now = null } = {}) {
    const at = now ?? this._clock();
    return ids().map((id) => this.reviewDue(id, { now: at })).filter((r) => r.overdue)
      .map((r) => ({ ...r, reminder: r.neverAssessed ? 'never reassessed since the threat was modelled' : `overdue by ${Math.floor((at - r.dueAt) / (24 * 3600_000))} day(s)` }));
  }

  // Threat intelligence ingestion. External intel may RAISE a threat's attention but never
  // lowers a severity by itself — the same trust-lowering-only rule the feed already follows.
  ingestIntelligence({ source, threat, indicator, severity = 'medium', confidence = 0.5, now = null } = {}) {
    if (!source || !threat || !indicator) throw new Error('threat intelligence requires a source, a threat and an indicator');
    if (!THREATS[threat]) throw new Error('intelligence references an unknown threat: ' + threat);
    if (/@|omang|nationalid/i.test(JSON.stringify({ source, indicator }))) { const e = new Error('threat intelligence refuses identity data'); e.failClosed = true; throw e; }
    const rec = { id: 'TI-' + (this._intel.length + 1).toString().padStart(4, '0'), source, threat, indicator, severity, confidence, at: now ?? this._clock(), effect: 'raises-attention-only' };
    this._intel.push(rec);
    return { ...rec, note: 'Intelligence raises attention on a threat. It never lowers a severity or grants trust.' };
  }
  intelligence(threatId = null) { return this._intel.filter((i) => !threatId || i.threat === threatId).map((i) => ({ ...i })); }

  // Risk heat map: residual band × severity, with the intel signal overlaid.
  heatMap({ fitnessResults = [], now = null } = {}) {
    const cells = ids().map((id) => {
      const r = this.residual(id, { fitnessResults, now });
      return { threat: id, severity: r.severity, residual: r.residual, band: r.band, owner: r.owner, treatment: r.treatment, intelligence: this.intelligence(id).length, reviewOverdue: r.reviewDue.overdue };
    }).sort((a, b) => b.residual - a.residual || a.threat.localeCompare(b.threat));
    return { cells, byBand: cells.reduce((m, c) => ((m[c.band] = (m[c.band] || 0) + 1), m), {}), worst: cells[0] || null, clean: cells.every((c) => c.residual === 0) };
  }

  // Trend analysis over recorded snapshots (deterministic least-squares slope).
  snapshot({ fitnessResults = [], now = null } = {}) {
    const heat = this.heatMap({ fitnessResults, now });
    const total = +heat.cells.reduce((a, c) => a + c.residual, 0).toFixed(3);
    const rec = { at: now ?? this._clock(), totalResidual: total, critical: heat.byBand.critical || 0, high: heat.byBand.high || 0 };
    this._trend.push(rec);
    return { ...rec };
  }
  trend() {
    const xs = this._trend.map((t) => t.totalResidual);
    if (xs.length < 2) return { direction: 'flat', slope: 0, basis: xs.length, history: this._trend.map((t) => ({ ...t })) };
    const n = xs.length, mx = (n - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - mx) * (xs[i] - my); den += (i - mx) ** 2; }
    const slope = den ? num / den : 0;
    return { direction: slope < -1e-9 ? 'improving' : slope > 1e-9 ? 'worsening' : 'stable', slope: +slope.toFixed(5), basis: n, history: this._trend.map((t) => ({ ...t })) };
  }

  // The full lifecycle view: Threat → Risk → Control → Evidence → Verification → Residual →
  // Owner → Review Date, in one row per threat.
  lifecycle({ fitnessResults = [], now = null } = {}) {
    const trace = traceability({ fitnessResults });
    return trace.map((t) => {
      const r = this.residual(t.threat, { fitnessResults, now });
      return {
        threat: t.threat, title: t.title, severity: t.severity,
        inherentRisk: r.inherent,
        controls: t.controls, evidence: t.evidence, verification: t.verification,
        controlEffectiveness: r.controlEffectiveness, residualRisk: r.residual, residualBand: r.band,
        treatment: r.treatment, acceptance: r.acceptance,
        owner: t.owner, responsibleAuthority: t.responsibleAuthority, governanceBoard: t.governanceBoard,
        reviewDate: r.reviewDue.dueAt, reviewOverdue: r.reviewDue.overdue,
      };
    });
  }

  validate({ fitnessResults = [], now = null } = {}) {
    const violations = [];
    for (const row of this.lifecycle({ fitnessResults, now })) {
      if (!row.owner) violations.push(`${row.threat}: no risk owner`);
      if (row.reviewDate === null || row.reviewDate === undefined) violations.push(`${row.threat}: no review date`);
      if (row.residualRisk > 0 && row.treatment === 'controlled') violations.push(`${row.threat}: residual risk with no treatment`);
    }
    for (const e of this.expiredAcceptances({ now })) violations.push(`${e.threat}: risk acceptance ${e.id} expired ${e.daysOverdue} day(s) ago and was not re-taken`);
    return { valid: violations.length === 0, violations, threats: ids().length };
  }

  report({ fitnessResults = [], now = null } = {}) {
    return {
      lifecycle: this.lifecycle({ fitnessResults, now }),
      heatMap: this.heatMap({ fitnessResults, now }),
      trend: this.trend(),
      reviewReminders: this.reviewReminders({ now }),
      expiredAcceptances: this.expiredAcceptances({ now }),
      intelligence: this.intelligence(),
      validation: this.validate({ fitnessResults, now }),
      advisoryOnly: true, authorizes: false,
      note: 'Risk is time-bound: an acceptance expires, a review comes due, and neither renews itself.',
    };
  }
}

function report({ fitnessResults = [], knownFitnessIds = [] } = {}) {
  return {
    threats: threats(), traceability: traceability({ fitnessResults }),
    killChainCoverage: killChainCoverage(), attckCoverage: attckCoverage(), capecCoverage: capecCoverage(),
    playbooks: playbooks(), residualRisk: residualRisk({ fitnessResults }),
    validation: validate({ knownFitnessIds }),
    advisoryOnly: true, authorizes: false,
    note: 'Threat model with executable traceability. A control is only credited when a fitness function verifies it.',
  };
}

module.exports = { THREATS, PLAYBOOKS, KILL_CHAIN, CLASSES, RiskRegister, REVIEW_CADENCE_DAYS, EFFECTIVENESS, ids, describe, threats, attackPaths, killChainCoverage, attckCoverage, capecCoverage, playbooks, traceability, residualRisk, validate, report };
