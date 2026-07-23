'use strict';
// Architectural drift detector: compares the approved architecture-of-record to the
// ACTUAL running twin + registries and reports deviations. Treats the twin itself as
// a governed artifact — undocumented change is drift.
const approved = require('./approved-architecture');
const { CROSS_ZONE_FLOWS } = require('../zones');

function detect(twin) {
  const deviations = [];
  const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  // Zones
  const actualZones = Object.values(twin.zones);
  if (!setEq(actualZones, approved.zones)) deviations.push({ area: 'zones', expected: approved.zones, actual: actualZones });

  // Services (name+zone)
  const actualSvc = twin.services.map((s) => `${s.name}:${s.zone}`).sort();
  const approvedSvc = approved.services.map((s) => `${s.name}:${s.zone}`).sort();
  if (!setEq(actualSvc, approvedSvc)) deviations.push({ area: 'services', expected: approvedSvc, actual: actualSvc });

  // Policy default
  if (twin.policy.introspect().defaultEffect !== approved.policyDefault) {
    deviations.push({ area: 'policyDefault', expected: approved.policyDefault, actual: twin.policy.introspect().defaultEffect });
  }

  // Fitness registry
  const actualFitness = require('../../verification/fitness').map((f) => f.id).sort();
  if (!setEq(actualFitness, [...approved.expectedFitness].sort())) {
    const added = actualFitness.filter((x) => !approved.expectedFitness.includes(x));
    const removed = approved.expectedFitness.filter((x) => !actualFitness.includes(x));
    deviations.push({ area: 'fitness', added, removed });
  }

  // Cross-zone flows
  const actualFlows = CROSS_ZONE_FLOWS.map((f) => `${f.from}->${f.to}`).sort();
  if (!setEq(actualFlows, [...approved.crossZoneFlows].sort())) {
    deviations.push({ area: 'crossZoneFlows', expected: approved.crossZoneFlows, actual: actualFlows });
  }

  return { drift: deviations.length > 0, deviations, approvedVersion: approved.version };
}

module.exports = { detect };
