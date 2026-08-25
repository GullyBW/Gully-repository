'use strict';
// AI-Assisted Investigation Support (Phase 13) — ADVISORY ONLY. This layer NEVER makes or
// executes a decision. Every output is a RECOMMENDATION that is deterministic, EXPLAINABLE
// (carries its reasons), CONFIDENCE-scored, fully AUDITABLE, and requires HUMAN APPROVAL
// before anyone acts on it.
//
// Honesty: these are transparent, deterministic HEURISTICS — not a machine-learning model.
// That is a feature here: outputs are reproducible and explainable, which is what a justice
// setting requires. Nothing about an output authorizes an action.
const investigation = require('../domain/investigation');

function advisory(kind, recommendation, confidence, explanation) {
  return { kind, recommendation, confidence: +Math.max(0, Math.min(1, confidence)).toFixed(2), explanation, advisoryOnly: true, requiresHumanApproval: true, autonomous: false };
}

// Prioritisation recommendation (basis: the deterministic priority score).
function recommendPriority(caseRow) {
  const p = investigation.scorePriority({ category: caseRow.category, escalated: caseRow.status === 'escalated', ageMs: (caseRow.now || 0) - (caseRow.createdAt || 0) });
  return advisory('priority', p.band, p.band === 'P1' ? 0.9 : p.band === 'P2' ? 0.75 : 0.6, [
    `category '${caseRow.category}' severity contributes to the score`,
    caseRow.status === 'escalated' ? 'case is escalated (+priority)' : 'case not escalated',
    `computed band ${p.band} (score ${p.score})`,
  ]);
}

// Duplicate / similar-case detection by non-identifying feature overlap (Jaccard-ish).
function _features(c) { return [`cat:${c.category}`, `rcpt:${c.recipient}`, `stage:${c.stage}`, `band:${(c.priority || {}).band}`].filter((f) => !/undefined|null/.test(f)); }
function detectDuplicates(caseRow, others, { threshold = 0.75 } = {}) {
  const fa = new Set(_features(caseRow));
  const scored = others.filter((o) => o.case_code !== caseRow.case_code).map((o) => {
    const fb = new Set(_features(o));
    const inter = [...fa].filter((f) => fb.has(f)).length; const uni = new Set([...fa, ...fb]).size;
    return { case_code: o.case_code, similarity: uni ? +(inter / uni).toFixed(2) : 0 };
  }).filter((s) => s.similarity >= threshold).sort((a, b) => b.similarity - a.similarity);
  return advisory('duplicate-detection', scored, scored.length ? scored[0].similarity : 0, [
    `compared non-identifying features: ${[...fa].join(', ')}`,
    `${scored.length} candidate(s) at or above similarity ${threshold}`,
    'human review required to confirm any duplicate',
  ]);
}

// Risk score from non-identifying signals (0..100), explained.
function riskScore(caseRow) {
  let score = 0; const reasons = [];
  const sev = { police: 30, prosecution: 30, courts: 25, official: 25, prison: 15, regulatory: 10, other: 5 }[caseRow.category] || 5;
  score += sev; reasons.push(`category severity +${sev}`);
  if (caseRow.status === 'escalated') { score += 25; reasons.push('escalated +25'); }
  if ((caseRow.evidenceCount || 0) >= 3) { score += 15; reasons.push('multiple evidence items +15'); }
  if (caseRow.slaBreached) { score += 15; reasons.push('SLA breached +15'); }
  score = Math.min(100, score);
  const band = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return advisory('risk-score', { score, band }, score >= 70 ? 0.8 : 0.6, reasons);
}

// Fraud/coordination pattern detection over aggregate rows (non-identifying).
function fraudPatterns(rows) {
  const byRecipient = {};
  for (const r of rows) { const k = r.recipient || 'unknown'; (byRecipient[k] = byRecipient[k] || { total: 0, escalated: 0 }); byRecipient[k].total++; if (r.status === 'escalated') byRecipient[k].escalated++; }
  const flags = Object.entries(byRecipient)
    .filter(([, s]) => s.total >= 5 && s.escalated / s.total >= 0.5)
    .map(([recipient, s]) => ({ recipient, total: s.total, escalationRate: +(s.escalated / s.total).toFixed(2) }));
  return advisory('fraud-pattern', flags, flags.length ? 0.7 : 0.3, [
    'signal: recipient with ≥5 cases and ≥50% escalation rate',
    `${flags.length} cluster(s) flagged for HUMAN review (not a determination of fraud)`,
  ]);
}

// Report summarisation over non-identifying metadata (never case content).
function summarize(rows) {
  const byStatus = {}; for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return advisory('summary', { total: rows.length, byStatus }, 0.95, ['aggregate counts over non-identifying metadata only', 'no case content or identity is summarised']);
}

module.exports = { advisory, recommendPriority, detectDuplicates, riskScore, fraudPatterns, summarize };
