'use strict';
// National Data Exchange (Stabilization Part 9). The governance layer over the dataset
// registry, renamed from "National Data Marketplace" by ADR-0003: the capability implements
// secure inter-agency exchange and controlled sharing, NOT a commercial marketplace, and the
// name now says so.
//
// It adds what a marketplace metaphor left unstated: an explicit, CLOSED purpose taxonomy;
// PURPOSE LIMITATION enforced at request time; purpose-scoped approval by a named human;
// retention bound to the agreement; and a single exchange audit trail.
//
// `DataMarketplace` is unchanged and remains the registry implementation underneath — this is
// additive governance, not a rewrite.
const { DataMarketplace, CLASSIFICATIONS } = require('./marketplace');

// The closed set of purposes for which government data may be exchanged.
const PERMITTED_PURPOSES = {
  'inter-agency-exchange': { description: 'Transfer between public bodies for a statutory function of the receiving body.', requiresApprover: true },
  'controlled-sharing': { description: 'Scoped, time-bound sharing under a recorded agreement (e.g. a joint investigation).', requiresApprover: true },
  'open-government-data': { description: 'Publication of non-identifying, public-classification data for transparency.', requiresApprover: false },
  'analytics': { description: 'Aggregate statistical analysis producing non-attributable outputs.', requiresApprover: true },
};
// Purposes the platform refuses outright. Named explicitly so the refusal is a rule, not an omission.
const PROHIBITED_PURPOSES = {
  'commercial-exchange': 'Public data is not a tradable commodity; there is no pricing, settlement or brokerage model and there will not be one.',
  'commercial': 'Same as commercial-exchange.',
  'profiling': 'Building profiles of individuals from exchanged data is outside every permitted purpose.',
  'law-enforcement-fishing': 'Exchange requires a stated, specific statutory function — not speculative search.',
};

const RESTRICTED = new Set(['restricted', 'secret']);

class NationalDataExchange {
  constructor({ clock = () => Date.now(), registry = null } = {}) {
    this._clock = clock;
    this._registry = registry || new DataMarketplace({ clock });
    this._governance = new Map();   // datasetId → { permittedPurposes, retentionDays, steward }
    this._agreements = new Map();   // agreementId → agreement
    this._audit = [];
    this._seq = 0;
  }

  // The governance model, published so participants can see what this is and is not.
  governanceModel() {
    return {
      capability: 'National Data Exchange',
      formerly: 'National Data Marketplace (renamed by ADR-0003)',
      purpose: 'Secure inter-agency data exchange and controlled sharing under purpose limitation, classification enforcement and named human approval.',
      isNot: ['a commercial marketplace', 'a brokerage', 'a pricing or settlement system', 'a bulk export channel'],
      permittedPurposes: PERMITTED_PURPOSES,
      prohibitedPurposes: PROHIBITED_PURPOSES,
      classifications: CLASSIFICATIONS,
      controls: ['privacy validation (identity fields refused)', 'classification enforcement', 'purpose limitation', 'named human approval', 'retention bound to the agreement', 'full exchange audit'],
    };
  }
  purposeTaxonomy() { return { permitted: Object.keys(PERMITTED_PURPOSES), prohibited: Object.keys(PROHIBITED_PURPOSES) }; }

  // --- Dataset registration -------------------------------------------------------------

  // Register a dataset WITH its permitted purposes. A dataset that declares no purpose cannot
  // be exchanged for any purpose — purpose limitation is opt-in, never implied.
  registerDataset(id, { owner, classification = 'internal', schemaFields = [], permittedPurposes = [], retentionDays = 365, steward = null, tags = [], license = 'gov-open' } = {}) {
    if (!permittedPurposes.length) { const e = new Error('a dataset must declare at least one permitted purpose (purpose limitation)'); e.failClosed = true; throw e; }
    for (const p of permittedPurposes) {
      if (PROHIBITED_PURPOSES[p]) { const e = new Error(`purpose '${p}' is prohibited: ${PROHIBITED_PURPOSES[p]}`); e.failClosed = true; throw e; }
      if (!PERMITTED_PURPOSES[p]) { const e = new Error(`unknown purpose '${p}' — the purpose taxonomy is closed`); e.failClosed = true; throw e; }
    }
    if (!Number.isInteger(retentionDays) || retentionDays <= 0) throw new Error('a positive retention period is required');
    // Privacy validation and classification enforcement stay in the registry (unchanged).
    const described = this._registry.register(id, { owner, classification, schemaFields, license, tags });
    this._governance.set(id, { permittedPurposes: [...permittedPurposes], retentionDays, steward: steward || owner });
    this._log('dataset-registered', id, owner);
    return this.describeDataset(id);
  }

  describeDataset(id) {
    const base = this._registry.describe(id);
    const gov = this._governance.get(id) || { permittedPurposes: [], retentionDays: null, steward: null };
    return { ...base, permittedPurposes: [...gov.permittedPurposes], retentionDays: gov.retentionDays, steward: gov.steward };
  }
  approveDataset(id, { by, rationale }) { const r = this._registry.approve(id, { by, rationale }); this._log('dataset-approved', id, by); return { ...r, ...this.describeDataset(id) }; }

  // Discovery is purpose-aware: a consumer only sees datasets they could actually receive.
  discover({ purpose = null, tag = null } = {}) {
    if (purpose && PROHIBITED_PURPOSES[purpose]) { const e = new Error(`purpose '${purpose}' is prohibited`); e.failClosed = true; throw e; }
    return this._registry.discover({ tag })
      .filter((d) => !purpose || (this._governance.get(d.id)?.permittedPurposes || []).includes(purpose))
      .map((d) => this.describeDataset(d.id));
  }

  // --- Exchange (purpose-limited, approval-gated) -----------------------------------------

  // Request an exchange. Fail-closed on: an unapproved dataset, a prohibited purpose, a purpose
  // the dataset does not permit, or a restricted/secret dataset without a named approver.
  requestExchange({ datasetId, consumer, purpose, approver = null, justification = null, now = null } = {}) {
    const gov = this._governance.get(datasetId);
    if (!gov) { const e = new Error('dataset is not governed by the exchange'); e.failClosed = true; throw e; }
    const dataset = this._registry.describe(datasetId);
    if (!consumer) throw new Error('a consuming body is required');
    if (dataset.status !== 'approved') { const e = new Error('dataset is not approved for exchange'); e.failClosed = true; throw e; }
    if (!purpose) { const e = new Error('an explicit purpose is required (purpose limitation)'); e.failClosed = true; throw e; }
    if (PROHIBITED_PURPOSES[purpose]) { const e = new Error(`purpose '${purpose}' is prohibited: ${PROHIBITED_PURPOSES[purpose]}`); e.failClosed = true; throw e; }
    if (!PERMITTED_PURPOSES[purpose]) { const e = new Error(`unknown purpose '${purpose}' — the purpose taxonomy is closed`); e.failClosed = true; throw e; }
    if (!gov.permittedPurposes.includes(purpose)) { const e = new Error(`dataset '${datasetId}' does not permit the purpose '${purpose}'`); e.failClosed = true; throw e; }
    const needsApprover = PERMITTED_PURPOSES[purpose].requiresApprover || RESTRICTED.has(dataset.classification);
    if (needsApprover && (!approver || !justification)) { const e = new Error('this exchange requires a named human approver and a written justification'); e.failClosed = true; throw e; }
    // The underlying registry records the usage agreement (unchanged behaviour).
    const base = this._registry.requestExchange({ datasetId, consumer, purpose, approver });
    const at = now ?? this._clock();
    const agreement = {
      id: 'DXA-' + (++this._seq).toString().padStart(4, '0'),
      datasetId, consumer, purpose, approver, justification,
      classification: dataset.classification, license: base.license,
      grantedAt: at, expiresAt: at + gov.retentionDays * 24 * 3600_000, retentionDays: gov.retentionDays,
      status: 'active', underlying: base.id,
    };
    this._agreements.set(agreement.id, agreement);
    this._log('exchange-granted', datasetId, consumer, purpose);
    return { ...agreement, purposeLimited: true, note: 'Data may be used ONLY for the stated purpose and only until the agreement expires.' };
  }

  agreement(id) { const a = this._agreements.get(id); return a ? { ...a } : null; }
  agreements({ datasetId = null, consumer = null } = {}) {
    return [...this._agreements.values()].filter((a) => (!datasetId || a.datasetId === datasetId) && (!consumer || a.consumer === consumer)).map((a) => ({ ...a }));
  }

  // Purpose limitation at USE time: reusing exchanged data for another purpose is refused.
  checkUse({ agreementId, purpose, now = null } = {}) {
    const a = this._agreements.get(agreementId);
    if (!a) return { permitted: false, reason: 'unknown agreement' };
    const at = now ?? this._clock();
    if (a.status !== 'active') return { permitted: false, reason: `agreement is ${a.status}` };
    if (at > a.expiresAt) return { permitted: false, reason: 'agreement expired — retention period elapsed' };
    if (purpose !== a.purpose) return { permitted: false, reason: `purpose limitation: agreement covers '${a.purpose}', not '${purpose}'` };
    return { permitted: true, purpose: a.purpose, expiresAt: a.expiresAt };
  }

  // Agreements whose retention window has elapsed — the data must be destroyed or renewed.
  retentionDue({ now = null } = {}) {
    const at = now ?? this._clock();
    return this.agreements().filter((a) => a.status === 'active' && at > a.expiresAt).map((a) => ({ id: a.id, datasetId: a.datasetId, consumer: a.consumer, expiredAt: a.expiresAt }));
  }
  revoke(agreementId, { by, reason }) {
    const a = this._agreements.get(agreementId); if (!a) throw new Error('unknown agreement');
    if (!by || !reason) throw new Error('revocation requires a named human and a reason');
    a.status = 'revoked'; a.revokedBy = by; a.revokedReason = reason;
    this._log('exchange-revoked', a.datasetId, by, a.purpose);
    return { id: agreementId, status: 'revoked', by };
  }

  // --- Audit ---------------------------------------------------------------------------------

  // One trail across registration, approval, exchange and revocation (registry + exchange).
  auditTrail() {
    return [...this._registry.auditTrail().map((a) => ({ ...a, source: 'registry' })), ...this._audit.map((a) => ({ ...a, source: 'exchange' }))]
      .sort((a, b) => a.at - b.at || String(a.event).localeCompare(String(b.event)));
  }
  _log(event, dataset, actor, purpose = null) { this._audit.push({ at: this._clock(), event, dataset, actor: actor || 'system', purpose }); }

  report({ now = null } = {}) {
    return {
      governanceModel: this.governanceModel(),
      datasets: this._registry.ownerCatalogue ? [...this._governance.keys()].map((id) => this.describeDataset(id)) : [],
      agreements: this.agreements(),
      retentionDue: this.retentionDue({ now }),
      audit: this.auditTrail(),
      note: 'Purpose-limited, classification-enforced, approval-gated exchange. Approval and revocation are human decisions.',
    };
  }
}

module.exports = { NationalDataExchange, PERMITTED_PURPOSES, PROHIBITED_PURPOSES };
