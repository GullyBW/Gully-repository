'use strict';
// Digital Twin version management: the twin is itself a governed engineering
// artifact. This records its version and an "assurance surface" snapshot (the count
// and identity of every verifier), so changes to the twin's assurance capability are
// tracked and can be diffed across versions.
const fitness = require('../verification/fitness');
const adversarial = require('../adversarial');
const formal = require('../formal');
const chaos = require('../chaos/chaos');
const requirements = require('./traceability/requirements');

const VERSION = '0.2.0';

const CHANGELOG = [
  { version: '0.1.0', summary: 'Initial twin: 9 fitness functions, 12 adversarial scenarios, evidence pipeline, CI gate.' },
  { version: '0.2.0', summary: 'Assurance platform: +5 fitness functions, +23 simulations, chaos framework, formal verification, traceability engine, compliance mapping, signed/archived evidence, drift detection, maturity model, governance portal, multi-audience reports, dashboard.' },
];

function surface() {
  return {
    version: VERSION,
    assuranceSurface: {
      fitnessFunctions: fitness.map((f) => f.id),
      adversarialScenarios: adversarial.list().map((s) => s.id),
      formalChecks: formal.list().map((f) => f.id),
      chaosExperiments: chaos.experiments.map((e) => e.id),
      requirements: requirements.map((r) => r.id),
    },
    counts: {
      fitness: fitness.length, adversarial: adversarial.scenarios.length,
      formal: formal.checks.length, chaos: chaos.experiments.length, requirements: requirements.length,
    },
    changelog: CHANGELOG,
  };
}

module.exports = { VERSION, CHANGELOG, surface };
