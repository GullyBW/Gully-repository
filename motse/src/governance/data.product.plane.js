'use strict';

const { err } = require('../kernel/errors');

/**
 * Data Product Plane (DPI governed plane #4). Exposes ONLY projections /
 * analytics views / signed datasets — never raw events or database rows.
 * Every read is authorized by the Policy Kernel and returned inside a
 * signed provenance envelope, so downstream consumers (dashboards, BI,
 * partners) get tamper-evident, access-controlled data products.
 */
class DataProductPlane {
  constructor({ store, clock, identityPlane, policyKernel, provenance, projections, bus }) {
    this.catalog = store.collection('data_products');
    this.clock = clock;
    this.identityPlane = identityPlane;
    this.policyKernel = policyKernel;
    this.provenance = provenance;
    this.projections = projections;
    this.bus = bus;
    if (bus) bus.register('data.product.read', 1, ['product', 'decision']);
  }

  /** Register a data product: a named projection with a classification. */
  register({ name, projection = null, classification = 'internal', requiredRole = null, requiredLevel = null, description = null }) {
    if (this.catalog.get(name)) return this.catalog.get(name);
    return this.catalog.insert({
      id: name, projection: projection || name, classification, required_role: requiredRole,
      required_level: requiredLevel, description, registered_at: this.clock.nowIso(),
    });
  }

  list() {
    return this.catalog.find().map((p) => ({
      name: p.id, classification: p.classification, required_role: p.required_role,
      required_level: p.required_level, description: p.description,
    }));
  }

  /** Authorized, provenance-signed read of a data product. */
  read(name, { subject = null, tenant = 'motse', correlationId = null } = {}) {
    const product = this.catalog.get(name);
    if (!product) throw err('NOT_FOUND', `No data product ${name}`);
    const assertion = this.identityPlane.assert(subject, { tenant });
    const decision = this.policyKernel.decide({
      assertion, tenant, action: 'data.read',
      resource: {
        id: `product:${name}`, classification: product.classification,
        required_role: product.required_role, required_level: product.required_level,
      },
      context: { correlationId },
    });
    if (this.bus) {
      this.bus.publish('data.product.read', {
        product: name, decision: decision.decision, tenant, subject: subject || null,
        policy_decision_id: decision.policy_decision_id, correlation_id: correlationId,
        plane: 'data', stream_id: `product:${name}`,
      });
    }
    if (decision.decision !== 'ALLOW') {
      throw err('PERMISSION_DENIED', `data product ${name} access ${decision.decision}`, {
        decision: decision.decision, reason: decision.reason,
      });
    }
    const state = this.projections.read(product.projection); // projection ONLY — never raw events
    return this.provenance.sign({
      output: { product: name, classification: product.classification, state },
      eventRefs: [`product:${name}`], policyDecisionId: decision.policy_decision_id, tenant, correlationId,
    });
  }
}

module.exports = { DataProductPlane };
