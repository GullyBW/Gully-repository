'use strict';
// System orchestrator: wires the bounded-context modules into a running Digital
// Engineering Twin and exposes an introspectable model for the fitness functions.
// Deterministic: everything is seeded and uses the logical clock.
const { ZONES } = require('../zones');
const { logicalClock } = require('../util/rng');
const { ReportStore } = require('../model/report-store');
const { EvidenceStore } = require('../model/evidence-store');
const { AuditLog } = require('../model/audit-log');
const { IAM } = require('../model/iam');
const { ThresholdCustody, RecipientDirectory } = require('../model/governance');
const { PolicyEngine } = require('../policy/policy-engine');
const { EventBus } = require('../platform/event-bus');
const crypto = require('./crypto');

// Deployment topology (config the zone-isolation fitness function inspects).
// Each service connects to its OWN zone's DB only. usesEventBus for cross-zone.
function defaultTopology() {
  return [
    { name: 'reporting', zone: ZONES.INDEPENDENT, dbZones: [ZONES.INDEPENDENT], usesEventBus: true, telemetry: { retainsIp: false, minimalIntakeSignal: true } },
    { name: 'governance', zone: ZONES.INDEPENDENT, dbZones: [ZONES.INDEPENDENT], usesEventBus: true, telemetry: { retainsIp: false } },
    { name: 'audit', zone: ZONES.INDEPENDENT, dbZones: [ZONES.INDEPENDENT], usesEventBus: true, telemetry: { retainsIp: false } },
    { name: 'investigation', zone: ZONES.EXECUTIVE, dbZones: [ZONES.EXECUTIVE], usesEventBus: true, telemetry: { retainsIp: false } },
    { name: 'prosecution', zone: ZONES.EXECUTIVE, dbZones: [ZONES.EXECUTIVE], usesEventBus: true, telemetry: { retainsIp: false } },
    { name: 'adjudication', zone: ZONES.JUDICIARY, dbZones: [ZONES.JUDICIARY], usesEventBus: true, telemetry: { retainsIp: false } },
    { name: 'court-admin', zone: ZONES.JUDICIARY, dbZones: [ZONES.JUDICIARY], usesEventBus: true, telemetry: { retainsIp: false } },
  ];
}

function build(opts = {}) {
  const clock = logicalClock();
  const twin = {
    seed: opts.seed ?? 42,
    zones: ZONES,
    crypto,
    clock,
    services: opts.topology || defaultTopology(),
    stores: {
      report: new ReportStore(clock),
      evidenceExec: new EvidenceStore(ZONES.EXECUTIVE, clock),
    },
    audit: new AuditLog(clock),
    iam: new IAM(clock),
    policy: new PolicyEngine(),
    bus: new EventBus(),
    threshold: new ThresholdCustody({ M: 3, custodians: ['c1', 'c2', 'c3', 'c4', 'c5'] }),
    recipients: new RecipientDirectory(),
  };

  // Baseline policy: everything default-deny; explicitly allow a couple of safe reads.
  twin.policy.addRule({ action: 'submit-report', effect: 'allow' });
  twin.policy.addRule({ action: 'get-status', effect: 'allow' });

  // Signed recipient directory with conflict metadata (police report must not route to police).
  twin.recipients.add('dcec', 'dcec', ['police']);
  twin.recipients.add('ombudsman', 'ombudsman', ['courts']);
  twin.recipients.add('judicial-oversight', 'judicial-oversight', ['prosecution']);
  twin.recipients.sign();

  // Anchor the (empty) audit head so anchoring capability is demonstrably active.
  twin.audit.anchor();

  // Network policy: a service may read a DB only in its OWN zone. Cross-zone raw
  // reads are refused here (defense in depth alongside the config fitness check).
  twin.attemptDbRead = function attemptDbRead(serviceName, targetZone) {
    const svc = twin.services.find((s) => s.name === serviceName);
    if (!svc) return { allowed: false, reason: 'unknown-service' };
    if (svc.zone !== targetZone) {
      twin.audit.append({ actor: serviceName, action: 'cross-zone-db-read-denied', purpose: 'probe', zone: targetZone });
      return { allowed: false, reason: 'cross-zone-db-read-forbidden' };
    }
    return { allowed: true };
  };

  return twin;
}

module.exports = { build, defaultTopology };
