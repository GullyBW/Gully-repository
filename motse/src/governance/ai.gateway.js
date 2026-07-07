'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Governed AI Retrieval Gateway (DPI governed plane #3). ALL AI retrieval
 * flows through here. The gateway:
 *   1. resolves an identity assertion (Identity Plane);
 *   2. asks the Policy Kernel to authorize the retrieval action itself;
 *   3. fetches candidates from a governed corpus/projection — NEVER from a
 *      raw domain store (no `heritage.items`, no `identity.users`, no ledger);
 *   4. filters every candidate through tenant isolation, data classification
 *      and a per-document Policy Kernel decision;
 *   5. sanitizes what remains and returns it inside a signed provenance
 *      envelope, emitting an audited `ai.retrieval.performed` event.
 *
 * The corpus is a curated, classified read model of AI-approved content —
 * the model never sees anything the scanning subject is not authorized to
 * see, and restricted heritage / PII can never leak into a prompt.
 */
class GovernedAiGateway {
  constructor({ store, clock, identityPlane, policyKernel, provenance, audit, bus, analytics }) {
    this.corpus = store.collection('ai_corpus');
    this.clock = clock;
    this.identityPlane = identityPlane;
    this.policyKernel = policyKernel;
    this.provenance = provenance;
    this.audit = audit;
    this.bus = bus;
    this.analytics = analytics;
    if (bus) bus.register('ai.retrieval.performed', 1, ['request_id', 'decision']);
  }

  /** Add a classified document to the AI corpus (governed ingestion). */
  addDocument(actorRef, { tenant = 'motse', classification = 'public', requiredRole = null, requiredLevel = null, requiredMorafe = null, title = null, content }) {
    if (!content) throw err('INVALID_ARGUMENT', 'content is required');
    const doc = this.corpus.insert({
      id: id('doc'), tenant, classification, required_role: requiredRole, required_level: requiredLevel,
      required_morafe: requiredMorafe, title: title || null, content, added_by: actorRef || 'system', at: this.clock.nowIso(),
    });
    if (this.audit) this.audit.append(actorRef || 'system', 'ai.corpus_added', `doc:${doc.id}`, null, { tenant, classification });
    return { id: doc.id, tenant, classification };
  }

  /**
   * Governed retrieval. `retriever` is optional; when omitted the built-in
   * corpus retriever is used (a projection, never a raw store).
   */
  retrieve({ subject = null, tenant = 'motse', query, purpose = 'qa', riskScore = 0, deviceId = null, correlationId = null } = {}, retriever = null) {
    const requestId = id('air');
    const assertion = this.identityPlane.assert(subject, { deviceId, tenant });

    // (2) Authorize the retrieval action itself. The act of querying is open
    // (even anonymously) for public corpora; the PER-DOCUMENT decisions below
    // enforce what the subject may actually see — the governed-RAG posture.
    const gate = this.policyKernel.decide({
      assertion, tenant, action: 'ai.read',
      resource: { id: `ai:${purpose}`, classification: 'public' },
      context: { correlationId, purpose }, riskScore,
    });
    if (!isAllow(gate)) return this._deny(requestId, gate, tenant, correlationId, subject);

    // (3) Candidate fetch — corpus/projection only.
    const fetch = retriever || ((q, opts) => this._corpusRetriever(q, opts));
    const candidates = fetch(query, { tenant, limit: 20 }) || [];

    // (4) Per-document tenant + classification + policy filtering.
    const permitted = [];
    const filtered = [];
    for (const doc of candidates) {
      if (doc.tenant && doc.tenant !== tenant) {
        filtered.push({ id: doc.id, reason: 'cross_tenant' });
        continue;
      }
      const d = this.policyKernel.decide({
        assertion, tenant, action: 'read',
        resource: {
          id: doc.id, classification: doc.classification || 'public',
          required_role: doc.required_role, required_level: doc.required_level, required_morafe: doc.required_morafe,
          tenant: doc.tenant,
        },
        context: { correlationId },
      });
      if (isAllow(d)) permitted.push(this._sanitize(doc));
      else filtered.push({ id: doc.id, reason: d.reason, policy_decision_id: d.policy_decision_id });
    }

    // (5) Audit + event + provenance.
    const output = {
      request_id: requestId, query: String(query || ''), permitted, filtered_count: filtered.length,
      context: permitted.map((p) => p.content),
    };
    if (this.audit) this.audit.append(subject || 'anonymous', 'ai.retrieval', `ai:${requestId}`, null, { permitted: permitted.length, filtered: filtered.length });
    if (this.bus) {
      this.bus.publish('ai.retrieval.performed', {
        request_id: requestId, decision: gate.decision, tenant, subject: subject || null,
        permitted: permitted.length, filtered: filtered.length, policy_decision_id: gate.policy_decision_id,
        correlation_id: correlationId, plane: 'ai', stream_id: `ai:${requestId}`,
      });
    }
    if (this.analytics) this.analytics._bump('ai.retrieval');
    return this.provenance.sign({ output, eventRefs: [`ai:${requestId}`], policyDecisionId: gate.policy_decision_id, tenant, correlationId });
  }

  _corpusRetriever(query, { tenant, limit }) {
    const q = String(query || '').toLowerCase();
    return this.corpus
      .find((d) => d.tenant === tenant && (!q || String(d.content).toLowerCase().includes(q) || String(d.title || '').toLowerCase().includes(q)))
      .slice(0, limit);
  }

  _sanitize(doc) {
    // The model only ever sees id, classification and bounded content —
    // never internal metadata, ownership or PII fields.
    return { id: doc.id, classification: doc.classification || 'public', content: String(doc.content == null ? '' : doc.content).slice(0, 4000) };
  }

  _deny(requestId, gate, tenant, correlationId, subject) {
    if (this.bus) {
      this.bus.publish('ai.retrieval.performed', {
        request_id: requestId, decision: gate.decision, tenant, subject: subject || null,
        permitted: 0, filtered: 0, policy_decision_id: gate.policy_decision_id,
        correlation_id: correlationId, plane: 'ai', stream_id: `ai:${requestId}`,
      });
    }
    if (this.analytics) this.analytics._bump('ai.retrieval.denied');
    return this.provenance.sign({
      output: { request_id: requestId, denied: true, decision: gate.decision, reason: gate.reason, permitted: [] },
      eventRefs: [`ai:${requestId}`], policyDecisionId: gate.policy_decision_id, tenant, correlationId,
    });
  }
}

function isAllow(decision) {
  return decision.decision === 'ALLOW';
}

module.exports = { GovernedAiGateway };
