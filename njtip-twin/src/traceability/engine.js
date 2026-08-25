'use strict';
// Traceability engine: resolves each requirement's verifiers to live results and
// answers "show me all evidence proving Requirement X is continuously enforced."
const requirements = require('./requirements');

function indexBy(arr, key) {
  const m = new Map();
  for (const x of arr) m.set(x[key] || x.id, x);
  return m;
}

// results: { fitness: [{id,pass,...}], sims: [{id,pass,...}], formal: [{id,pass,...}] }
function buildMatrix(results) {
  const fIdx = indexBy(results.fitness || [], 'id');
  const sIdx = indexBy(results.sims || [], 'id');
  const mIdx = indexBy(results.formal || [], 'id');

  const rows = requirements.map((req) => {
    const resolve = (ids, idx) => (ids || []).map((id) => ({ id, present: idx.has(id), pass: idx.has(id) ? !!idx.get(id).pass : null }));
    const fitness = resolve(req.verifiers.fitness, fIdx);
    const sims = resolve(req.verifiers.sims, sIdx);
    const formal = resolve(req.verifiers.formal, mIdx);
    const all = [...fitness, ...sims, ...formal];
    const verifierCount = all.length;
    const missing = all.filter((v) => !v.present).map((v) => v.id);
    const failing = all.filter((v) => v.present && v.pass === false).map((v) => v.id);
    const covered = verifierCount > 0 && missing.length === 0;
    const enforced = covered && failing.length === 0;
    return {
      id: req.id, type: req.type, priority: req.priority, statement: req.statement, refs: req.refs,
      fitness, sims, formal, verifierCount, missing, failing, covered, enforced,
    };
  });

  const coverage = {
    total: rows.length,
    covered: rows.filter((r) => r.covered).length,
    enforced: rows.filter((r) => r.enforced).length,
    uncovered: rows.filter((r) => !r.covered).map((r) => ({ id: r.id, missing: r.missing })),
    notEnforced: rows.filter((r) => r.covered && !r.enforced).map((r) => ({ id: r.id, failing: r.failing })),
    percentCovered: rows.length ? Math.round((rows.filter((r) => r.covered).length / rows.length) * 100) : 0,
    percentEnforced: rows.length ? Math.round((rows.filter((r) => r.enforced).length / rows.length) * 100) : 0,
  };
  return { rows, coverage };
}

// "Show me all evidence proving Requirement X is continuously enforced."
function evidenceForRequirement(reqId, results) {
  const { rows } = buildMatrix(results);
  const row = rows.find((r) => r.id === reqId);
  if (!row) return null;
  return {
    requirement: reqId, statement: row.statement, enforced: row.enforced,
    evidence: [...row.fitness, ...row.sims, ...row.formal].map((v) => ({
      verifier: v.id, present: v.present, result: v.pass === null ? 'MISSING' : v.pass ? 'PASS' : 'FAIL',
    })),
    caveat: 'Automated enforcement evidence only. Legal/constitutional interpretation remains a human decision.',
  };
}

module.exports = { buildMatrix, evidenceForRequirement, requirements };
