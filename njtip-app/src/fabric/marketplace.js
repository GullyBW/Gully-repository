'use strict';
// National Data Marketplace (Phase 55). Expands the Data Fabric into a secure data-exchange
// ecosystem: a dataset registry + marketplace, discovery, an approval workflow, sharing
// policies, usage agreements, a licensing registry, PRIVACY VALIDATION, data-classification
// ENFORCEMENT, exchange audit trails, and data-federation governance. Privacy-by-design is
// enforced: a dataset carrying identity fields cannot be registered/listed (fail-closed).
// Deterministic. Datasets are metadata + non-identifying sample schemas, never raw records.
const IDENTITY_FIELDS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'dob', 'content']);
const CLASSIFICATIONS = ['public', 'internal', 'restricted', 'secret'];
const LISTABLE = new Set(['public', 'internal']); // restricted/secret are never publicly listed

class DataMarketplace {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._datasets = new Map(); this._agreements = []; this._audit = []; }

  // Register a dataset (metadata + declared schema fields). Privacy validation is fail-closed.
  register(id, { owner, classification = 'internal', schemaFields = [], license = 'gov-open', tags = [] } = {}) {
    if (!id || !owner) throw new Error('dataset id and owner are required');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error('invalid classification');
    const identityFields = schemaFields.filter((f) => IDENTITY_FIELDS.has(String(f).toLowerCase()));
    if (identityFields.length) throw new Error(`dataset refuses identity fields (privacy-by-design): ${identityFields.join(', ')}`);
    this._datasets.set(id, { id, owner, classification, schemaFields: [...schemaFields], license, tags: [...tags], status: 'registered', approvedBy: null });
    this._log('registered', id, owner);
    return this.describe(id);
  }
  describe(id) { const d = this._must(id); return { id: d.id, owner: d.owner, classification: d.classification, license: d.license, tags: [...d.tags], status: d.status }; }

  // Approval workflow: a dataset must be human-APPROVED before it can be shared/listed.
  approve(id, { by, rationale } = {}) { const d = this._must(id); if (!by || !rationale) throw new Error('dataset approval requires a named human and a rationale'); d.status = 'approved'; d.approvedBy = by; this._log('approved', id, by); return this.describe(id); }

  // Discovery: only APPROVED, LISTABLE-classification datasets appear in the public catalogue.
  discover({ tag, classification } = {}) {
    return [...this._datasets.values()]
      .filter((d) => d.status === 'approved' && LISTABLE.has(d.classification))
      .filter((d) => (!tag || d.tags.includes(tag)) && (!classification || d.classification === classification))
      .map((d) => this.describe(d.id));
  }
  // Restricted/secret datasets are discoverable only to their owner (classification enforcement).
  ownerCatalogue(owner) { return [...this._datasets.values()].filter((d) => d.owner === owner).map((d) => this.describe(d.id)); }

  // Usage agreement: an approved dataset may be exchanged under a recorded agreement. A
  // restricted/secret dataset requires an explicit purpose + human approver (federation gov).
  requestExchange({ datasetId, consumer, purpose, approver }) {
    const d = this._must(datasetId);
    if (d.status !== 'approved') throw new Error('dataset is not approved for exchange');
    if (!LISTABLE.has(d.classification) && (!purpose || !approver)) throw new Error('restricted/secret dataset exchange requires a purpose and a human approver');
    const agreement = { id: 'DUA-' + (this._agreements.length + 1), datasetId, consumer, purpose: purpose || null, license: d.license, at: this._clock() };
    this._agreements.push(agreement); this._log('exchanged', datasetId, consumer);
    return { ...agreement };
  }
  agreements() { return this._agreements.map((a) => ({ ...a })); }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, dataset, actor) { this._audit.push({ at: this._clock(), event, dataset, actor: actor || 'system' }); }
  _must(id) { const d = this._datasets.get(id); if (!d) throw new Error('unknown dataset: ' + id); return d; }
}

module.exports = { DataMarketplace, CLASSIFICATIONS };
