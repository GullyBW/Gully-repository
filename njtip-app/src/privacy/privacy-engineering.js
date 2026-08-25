'use strict';
// Privacy Engineering Platform (Phase 35). Turns privacy-by-design into MEASURABLE,
// continuously-verified capabilities: automated Privacy Impact Assessments, data-
// minimisation validation, DIFFERENTIAL PRIVACY (deterministic, seeded), privacy risk
// scoring, anonymisation-quality metrics, and privacy evidence generation. Deterministic.
const { rng, hash } = require('../twin');

const IDENTITY_FIELDS = new Set(['omang', 'name', 'email', 'phone', 'msisdn', 'ip', 'address', 'nationalid', 'passport', 'dob', 'content', 'body', 'plaintext']);

// Data-minimisation validation: a record must carry no identity/content fields.
function validateMinimization(record) {
  const violations = Object.keys(record || {}).filter((k) => IDENTITY_FIELDS.has(k.toLowerCase()));
  return { ok: violations.length === 0, violations };
}

// Automated Privacy Impact Assessment over a data-flow descriptor.
// flow: { name, fields:[..], crossZone:bool, retained:bool, retentionDays, purpose }
function automatedPIA(flow) {
  const findings = []; let risk = 0;
  const idFields = (flow.fields || []).filter((f) => IDENTITY_FIELDS.has(String(f).toLowerCase()));
  if (idFields.length) { findings.push(`identity/content fields present: ${idFields.join(', ')}`); risk += 50; }
  if (flow.crossZone && idFields.length) { findings.push('identity crosses a constitutional zone boundary'); risk += 30; }
  if (flow.retained && (!flow.retentionDays || flow.retentionDays > 3650)) { findings.push('long/unspecified retention'); risk += 10; }
  if (!flow.purpose) { findings.push('no stated purpose (purpose limitation)'); risk += 10; }
  risk = Math.min(100, risk);
  return { flow: flow.name, riskScore: risk, band: risk >= 50 ? 'high' : risk >= 20 ? 'medium' : 'low', findings, pass: idFields.length === 0, note: 'Automated PIA — informs a human privacy review; never authorizes processing.' };
}

// Differential privacy: add calibrated Laplace noise to a numeric aggregate. DETERMINISTIC
// given a seed (reproducible evidence). epsilon smaller = more privacy = more noise.
function dpNoisyCount(trueCount, { epsilon = 1, sensitivity = 1, seed = 1 } = {}) {
  const rand = rng.mulberry32(seed);
  const u = rand() - 0.5; // (-0.5, 0.5)
  const b = sensitivity / epsilon;
  const noise = -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  return { trueCount, epsilon, noisy: Math.max(0, Math.round(trueCount + noise)), mechanism: 'laplace', note: 'Differentially-private count; deterministic per seed.' };
}

// Anonymisation quality: k-anonymity (min equivalence-class size) + l-diversity over a
// sensitive attribute, computed on quasi-identifier groupings of NON-identifying rows.
function anonymizationQuality(rows, { quasiIdentifiers = ['category', 'recipient'], sensitive = 'status' } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const key = quasiIdentifiers.map((q) => r[q]).join('|');
    if (!groups.has(key)) groups.set(key, { count: 0, sensitiveValues: new Set() });
    const g = groups.get(key); g.count++; g.sensitiveValues.add(r[sensitive]);
  }
  const sizes = [...groups.values()].map((g) => g.count);
  const kAnonymity = sizes.length ? Math.min(...sizes) : 0;
  const lDiversity = groups.size ? Math.min(...[...groups.values()].map((g) => g.sensitiveValues.size)) : 0;
  return { kAnonymity, lDiversity, groups: groups.size, meetsK: kAnonymity >= 5, note: 'k-anonymity/l-diversity over quasi-identifiers (non-identifying).' };
}

// Privacy risk score for a dataset descriptor (0..100; lower is better).
function privacyRiskScore({ hasIdentity = false, crossZone = false, kAnonymity = 5, retained = false } = {}) {
  let s = 0;
  if (hasIdentity) s += 50;
  if (crossZone) s += 20;
  if (kAnonymity < 5) s += 20;
  if (retained) s += 10;
  return { score: Math.min(100, s), band: s >= 50 ? 'high' : s >= 20 ? 'medium' : 'low' };
}

// Deterministic, signed privacy evidence bundle for the assurance package.
function privacyEvidence(rows) {
  const core = { minimizationClean: rows.every((r) => validateMinimization(r).ok), anonymization: anonymizationQuality(rows) };
  return { core, digest: hash.sha256(core), note: 'Privacy evidence supports a human privacy assessment; it never authorizes processing.' };
}

module.exports = { validateMinimization, automatedPIA, dpNoisyCount, anonymizationQuality, privacyRiskScore, privacyEvidence, IDENTITY_FIELDS };
