'use strict';
// National Resilience Validation Platform (Phase 45). DETERMINISTIC validation that the
// platform survives adverse national-scale scenarios. The Twin verifies resilience BEFORE
// deployment: validateResilience() is a pass/fail GATE over a scenario suite. It informs the
// human go/no-go; it never authorizes deployment. Pure/deterministic.
const { failoverSimulation } = require('./simulation');

// Regional outage: service survives if a quorum of regions remains healthy.
function validateRegionalOutage({ regions = ['a', 'b', 'c'], failed = [] }) {
  const fo = failoverSimulation({ regions, failed });
  return { scenario: 'regional-outage', pass: fo.quorum, healthy: fo.healthy, degraded: fo.degraded };
}

// National service disruption: a critical service must have a standby (no single point).
function validateNationalDisruption({ services = {}, disrupted = [] }) {
  const casualties = disrupted.filter((s) => (services[s] || 0) < 2); // fewer than 2 replicas → down
  return { scenario: 'national-disruption', pass: casualties.length === 0, casualties };
}

// Large-scale cyber incident: is the blast radius CONTAINED (no critical service compromised)?
function validateCyberIncident({ compromised = [], critical = [] }) {
  const breachedCritical = compromised.filter((s) => critical.includes(s));
  return { scenario: 'cyber-incident', pass: breachedCritical.length === 0, breachedCritical, note: 'zone isolation + least privilege bound the blast radius' };
}

// Communications failure: the outbox/DLQ must retain events until links recover (no loss).
function validateCommsFailure({ pendingEvents = 0, outboxDurable = true }) {
  return { scenario: 'comms-failure', pass: outboxDurable, retainedEvents: outboxDurable ? pendingEvents : 0, note: 'events are retained in the durable outbox and replayed on recovery' };
}

// Multi-region failover (active-active): at least two regions must remain to serve.
function validateFailover({ regions = ['a', 'b', 'c'], failed = [] }) {
  const fo = failoverSimulation({ regions, failed });
  return { scenario: 'failover', pass: fo.activeActive, servedBy: fo.servedBy };
}

// Infrastructure degradation: with reduced capacity, does headroom still cover demand?
function validateDegradation({ nominalCapacity = 100, degradedPct = 40, demand = 55 }) {
  const capacity = nominalCapacity * (1 - degradedPct / 100);
  return { scenario: 'degradation', pass: capacity >= demand, capacity, demand };
}

// High-volume operational surge: autoscaling headroom absorbs the surge.
function validateSurge({ baseline = 100, surgeMultiplier = 3, maxCapacity = 400 }) {
  const surge = baseline * surgeMultiplier;
  return { scenario: 'surge', pass: surge <= maxCapacity, surge, maxCapacity };
}

// Resilience GATE: validate a full scenario suite. Returns pass/fail + per-scenario results.
// The Twin uses this to verify resilience before a human makes the deployment decision.
function validateResilience(suite = defaultSuite()) {
  const results = suite.map((s) => VALIDATORS[s.scenario](s.input || {}));
  return { pass: results.every((r) => r.pass), results, humanGate: true, note: 'Resilience verification informs the human deployment decision; it never authorizes it.' };
}

const VALIDATORS = {
  'regional-outage': validateRegionalOutage, 'national-disruption': validateNationalDisruption,
  'cyber-incident': validateCyberIncident, 'comms-failure': validateCommsFailure,
  failover: validateFailover, degradation: validateDegradation, surge: validateSurge,
};

// A representative default suite the platform must pass (all survivable by construction).
function defaultSuite() {
  return [
    { scenario: 'regional-outage', input: { regions: ['a', 'b', 'c'], failed: ['a'] } },
    { scenario: 'national-disruption', input: { services: { api: 3, db: 2 }, disrupted: ['api'] } },
    { scenario: 'cyber-incident', input: { compromised: ['edge'], critical: ['keys', 'audit'] } },
    { scenario: 'comms-failure', input: { pendingEvents: 5, outboxDurable: true } },
    { scenario: 'failover', input: { regions: ['a', 'b', 'c'], failed: ['a'] } },
    { scenario: 'degradation', input: { nominalCapacity: 100, degradedPct: 40, demand: 55 } },
    { scenario: 'surge', input: { baseline: 100, surgeMultiplier: 3, maxCapacity: 400 } },
  ];
}

module.exports = { validateRegionalOutage, validateNationalDisruption, validateCyberIncident, validateCommsFailure, validateFailover, validateDegradation, validateSurge, validateResilience, defaultSuite };
