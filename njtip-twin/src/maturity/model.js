'use strict';
// Engineering Assurance Maturity Model. Automated evidence can substantiate levels
// 1–6. Levels 7–10 require HUMAN attestation and are NEVER set by automation — this
// encodes the human-accountability boundary directly into the maturity assessment.
const LEVELS = [
  { level: 1, name: 'Architecture documented', automatable: true },
  { level: 2, name: 'Reference implementation', automatable: true },
  { level: 3, name: 'Executable fitness functions', automatable: true },
  { level: 4, name: 'Adversarial simulations', automatable: true },
  { level: 5, name: 'Automated evidence generation', automatable: true },
  { level: 6, name: 'Continuous verification', automatable: true },
  { level: 7, name: 'Independent expert validation', automatable: false },
  { level: 8, name: 'Pilot validation with synthetic workloads', automatable: false },
  { level: 9, name: 'Operational readiness recommendation', automatable: false },
  { level: 10, name: 'Production assurance with continuous monitoring', automatable: false },
];
const AUTOMATED_CAP = 6;

function assess(state) {
  const human = state.humanAttestations || {};
  let achieved = 1; // architecture documented
  if (state.referenceImplementation) achieved = 2;
  if (state.fitnessPass) achieved = 3;
  if (state.adversarialPass) achieved = 4;
  if (state.evidenceGenerated) achieved = 5;
  if (state.ciPassed) achieved = 6;
  // Levels 7–10 only advance with a valid sequential human attestation.
  for (let L = 7; L <= 10; L++) {
    if (achieved === L - 1 && human[L] && human[L].attestedBy) achieved = L; else break;
  }
  return {
    achievedLevel: achieved,
    achievedName: LEVELS[achieved - 1].name,
    automatedCap: AUTOMATED_CAP,
    levels: LEVELS,
    humanAttestedLevels: Object.keys(human).map(Number).sort((a, b) => a - b),
    note: achieved <= AUTOMATED_CAP
      ? `Automated evidence supports up to level ${AUTOMATED_CAP} (continuous verification). Levels 7–10 require independent human validation and are NOT set by automation.`
      : `Level ${achieved} reflects human attestation on top of automated evidence.`,
  };
}

module.exports = { assess, LEVELS, AUTOMATED_CAP };
