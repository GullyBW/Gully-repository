'use strict';
// Cross-Domain Correlation Governance (Stabilization Part 13). Cross-domain intelligence is the
// platform's highest-risk analytical capability: correlating signals across domains is exactly
// how a privacy-preserving system stops being one. So correlation is GOVERNED, not merely
// available.
//
// The register below states, for every correlation the platform may perform: which domains it
// may join, for what purpose, how long the result may be retained, who oversees it and who is
// accountable. Anything not in the register is REFUSED (default-deny), and a small set of
// correlations is refused permanently and by name.
//
// Deterministic; every authorization and use is audited.

// The analytical domains that may appear in a correlation.
const DOMAINS = ['engineering', 'security', 'privacy', 'operations', 'compliance', 'governance', 'service-delivery', 'infrastructure', 'legislation', 'resilience'];

// PERMITTED correlations. Each entry is a complete governance record — a correlation without a
// purpose, a retention period, an overseer and an accountable authority is not permitted.
const PERMITTED = [
  { id: 'platform-reliability', domains: ['engineering', 'operations'], purpose: 'Explain reliability incidents in terms of engineering health.', retentionDays: 365, oversight: 'ORB', accountable: 'Office of the Chief Technology Officer' },
  { id: 'security-operations', domains: ['security', 'operations'], purpose: 'Correlate security posture with operational degradation.', retentionDays: 365, oversight: 'ISRB', accountable: 'National Computer Incident Response Team' },
  { id: 'assurance-compliance', domains: ['engineering', 'compliance'], purpose: 'Trace compliance coverage to the architectural controls that produce it.', retentionDays: 1825, oversight: 'ARB', accountable: 'Office of the Chief Architect' },
  { id: 'governance-effectiveness', domains: ['governance', 'compliance'], purpose: 'Assess whether human governance is keeping pace with platform change.', retentionDays: 1825, oversight: 'OB', accountable: 'Oversight Board Secretariat' },
  { id: 'legislative-traceability', domains: ['legislation', 'compliance'], purpose: 'Trace legal mandates to the controls that implement them.', retentionDays: 3650, oversight: 'OB', accountable: 'Attorney General Chambers' },
  { id: 'continuity-posture', domains: ['resilience', 'infrastructure'], purpose: 'Assess recoverability against the state of the estate.', retentionDays: 365, oversight: 'ORB', accountable: 'National Disaster Management Office' },
  { id: 'service-quality', domains: ['service-delivery', 'operations'], purpose: 'Explain service outcomes in terms of operational performance.', retentionDays: 730, oversight: 'SDB', accountable: 'Ministry of Public Administration' },
  { id: 'privacy-assurance', domains: ['privacy', 'engineering'], purpose: 'Verify that privacy controls are implemented and holding.', retentionDays: 1825, oversight: 'OB', accountable: 'Data Protection Commissioner' },
];

// PROHIBITED correlations — refused permanently, by name, with the reason recorded. Naming them
// matters: a prohibition that exists only as an omission is one feature request away from gone.
const PROHIBITED = [
  { id: 'reporter-linkage', domains: ['privacy', 'service-delivery'], reason: 'Joining reporter-facing signals with service records is the shortest path to re-identifying an anonymous reporter. The anonymity boundary is a constitutional invariant.' },
  { id: 'case-content-demographics', domains: ['service-delivery', 'legislation'], reason: 'Correlating case content with demographic or legal-status attributes enables profiling of communities; no permitted purpose requires it.' },
  { id: 'staff-performance-profiling', domains: ['governance', 'operations'], reason: 'Correlating individual actor activity with governance outcomes turns operational telemetry into staff surveillance. Aggregate process mining already answers the legitimate question.' },
  { id: 'security-to-privilege', domains: ['security', 'governance'], reason: 'Threat intelligence may only LOWER trust. Correlating it into a governance signal risks it becoming a privilege source.' },
];

const key = (domains) => [...domains].map(String).sort().join('+');
const PERMITTED_BY_KEY = new Map(PERMITTED.map((p) => [key(p.domains), p]));
const PROHIBITED_BY_KEY = new Map(PROHIBITED.map((p) => [key(p.domains), p]));

class CorrelationGovernance {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._authorizations = new Map(); this._audit = []; this._seq = 0; }

  register() { return { permitted: PERMITTED.map((p) => ({ ...p })), prohibited: PROHIBITED.map((p) => ({ ...p })), domains: [...DOMAINS] }; }
  lookup(domains) {
    const k = key(domains);
    if (PROHIBITED_BY_KEY.has(k)) return { status: 'prohibited', entry: PROHIBITED_BY_KEY.get(k) };
    if (PERMITTED_BY_KEY.has(k)) return { status: 'permitted', entry: PERMITTED_BY_KEY.get(k) };
    return { status: 'unregistered', entry: null };
  }

  // Authorize a correlation. Default-deny: prohibited and unregistered pairs are both refused,
  // and the stated purpose must match the purpose the register permits.
  authorize({ domains = [], purpose, requestedBy, now = null } = {}) {
    if (!Array.isArray(domains) || domains.length < 2) { const e = new Error('a correlation requires at least two domains'); e.failClosed = true; throw e; }
    for (const d of domains) if (!DOMAINS.includes(d)) { const e = new Error(`unknown analytical domain '${d}'`); e.failClosed = true; throw e; }
    if (!purpose) { const e = new Error('a correlation requires a stated purpose (purpose limitation)'); e.failClosed = true; throw e; }
    if (!requestedBy) { const e = new Error('a correlation requires a named requesting authority'); e.failClosed = true; throw e; }
    const found = this.lookup(domains);
    if (found.status === 'prohibited') { this._log('refused', domains, requestedBy, purpose); const e = new Error(`correlation refused (prohibited): ${found.entry.reason}`); e.failClosed = true; e.prohibited = found.entry.id; throw e; }
    if (found.status === 'unregistered') { this._log('refused', domains, requestedBy, purpose); const e = new Error(`correlation refused: [${domains.join(', ')}] is not in the permitted correlation register (default-deny)`); e.failClosed = true; throw e; }
    if (purpose !== found.entry.id && purpose !== found.entry.purpose) { this._log('refused', domains, requestedBy, purpose); const e = new Error(`purpose limitation: [${domains.join(', ')}] is permitted only for '${found.entry.id}'`); e.failClosed = true; throw e; }
    const at = now ?? this._clock();
    const id = 'COR-' + (++this._seq).toString().padStart(4, '0');
    const rec = { id, domains: [...domains].sort(), purpose: found.entry.id, requestedBy, oversight: found.entry.oversight, accountable: found.entry.accountable, retentionDays: found.entry.retentionDays, grantedAt: at, expiresAt: at + found.entry.retentionDays * 24 * 3600_000, uses: 0 };
    this._authorizations.set(id, rec);
    this._log('authorized', domains, requestedBy, found.entry.id);
    return { ...rec, note: 'Authorized for the registered purpose only, and only until retention elapses.' };
  }

  // Guard a correlation at USE time — the point where purpose creep actually happens.
  guard(authorizationId, { purpose, now = null } = {}) {
    const rec = this._authorizations.get(authorizationId);
    if (!rec) return { permitted: false, reason: 'unknown correlation authorization' };
    const at = now ?? this._clock();
    if (at > rec.expiresAt) return { permitted: false, reason: 'authorization expired — retention period elapsed' };
    if (purpose && purpose !== rec.purpose) return { permitted: false, reason: `purpose limitation: authorized for '${rec.purpose}', not '${purpose}'` };
    rec.uses += 1;
    this._log('used', rec.domains, rec.requestedBy, rec.purpose);
    return { permitted: true, purpose: rec.purpose, oversight: rec.oversight, accountable: rec.accountable, expiresAt: rec.expiresAt };
  }

  authorization(id) { const r = this._authorizations.get(id); return r ? { ...r } : null; }
  authorizations() { return [...this._authorizations.values()].map((r) => ({ ...r })); }
  retentionDue({ now = null } = {}) { const at = now ?? this._clock(); return this.authorizations().filter((r) => at > r.expiresAt).map((r) => ({ id: r.id, domains: r.domains, expiredAt: r.expiresAt })); }

  // Every permitted correlation must be a complete governance record.
  validate({ boards = [] } = {}) {
    const violations = [];
    const known = new Set(boards);
    for (const p of PERMITTED) {
      if (p.domains.length < 2) violations.push(`${p.id}: fewer than two domains`);
      for (const d of p.domains) if (!DOMAINS.includes(d)) violations.push(`${p.id}: unknown domain '${d}'`);
      if (!p.purpose) violations.push(`${p.id}: no stated purpose`);
      if (!Number.isInteger(p.retentionDays) || p.retentionDays <= 0) violations.push(`${p.id}: no retention period`);
      if (!p.oversight) violations.push(`${p.id}: no oversight body`);
      if (!p.accountable) violations.push(`${p.id}: no accountable authority`);
      if (known.size && !known.has(p.oversight)) violations.push(`${p.id}: oversight '${p.oversight}' is not a recognised governance board`);
      if (PROHIBITED_BY_KEY.has(key(p.domains))) violations.push(`${p.id}: permitted and prohibited at the same time`);
    }
    for (const p of PROHIBITED) if (!p.reason || p.reason.length < 30) violations.push(`${p.id}: prohibition without a recorded reason`);
    return { valid: violations.length === 0, violations, permitted: PERMITTED.length, prohibited: PROHIBITED.length };
  }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, domains, actor, purpose) { this._audit.push({ at: this._clock(), event, domains: [...domains].sort(), actor: actor || 'system', purpose: purpose || null }); }

  report({ now = null } = {}) {
    return {
      register: this.register(),
      authorizations: this.authorizations(),
      retentionDue: this.retentionDue({ now }),
      audit: this.auditTrail(),
      validation: this.validate(),
      defaultDeny: true, authorizes: false,
      note: 'Correlation is default-deny: only registered pairs, only for the registered purpose, only for the registered retention. Refusals are audited too.',
    };
  }
}

module.exports = { CorrelationGovernance, PERMITTED, PROHIBITED, DOMAINS };
