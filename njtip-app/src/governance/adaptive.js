'use strict';
// Adaptive Governance Framework (Phase 66). Introduces CONTINUOUS governance improvement:
// governance-effectiveness metrics, policy/workflow review cycles, legislative-review
// recommendations, organizational governance analytics, governance-maturity evolution,
// continuous governance assessment, and governance simulation. Recommendations require
// EXPLICIT HUMAN APPROVAL before adoption. Deterministic; nothing is auto-applied.

// Governance-effectiveness metrics from non-identifying governance signals.
function effectiveness({ decisionsRecorded = 0, automatedActions = 0, policyChanges = 0, auditCoverage = 1 } = {}) {
  const humanGovernanceDensity = automatedActions ? +(decisionsRecorded / automatedActions).toFixed(2) : null;
  return { decisionsRecorded, automatedActions, humanGovernanceDensity, policyChanges, auditCoverage, note: 'Automated actions never authorize; humans decide.' };
}

// Review cycles: given the age of the last review and a cadence, is a review DUE?
function reviewCycle({ kind, lastReviewedAt = 0, cadenceMs, now }) {
  const dueAt = lastReviewedAt + cadenceMs;
  return { kind, dueAt, due: now >= dueAt, note: 'Review is advisory; scheduling/adoption is human-governed.' };
}

// Legislative-review recommendations: laws whose mapped controls are failing → review advised.
function legislativeReviewRecommendations(instruments = [], failingControls = new Set()) {
  const recs = [];
  for (const inst of instruments) { const affected = (inst.mapsToControls || []).filter((c) => failingControls.has(c)); if (affected.length) recs.push({ instrument: inst.id, reason: 'mapped control(s) failing', controls: affected }); }
  return { recommendations: recs, requiresHumanApproval: true, note: 'Advisory — legislative change is a human/parliamentary decision.' };
}

// Governance-maturity evolution: a transparent trend over recorded maturity scores.
function maturityEvolution(history = []) {
  const scores = history.map((h) => h.score ?? h.overallLevel).filter((x) => typeof x === 'number');
  if (scores.length < 2) return { direction: 'flat', slope: 0, basis: scores.length };
  const n = scores.length; const mx = (n - 1) / 2; const my = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (i - mx) * (scores[i] - my); den += (i - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { direction: slope > 1e-6 ? 'improving' : slope < -1e-6 ? 'declining' : 'stable', slope: +slope.toFixed(5), basis: n };
}

// Continuous governance assessment: aggregate a governance posture score with reasons.
function assess({ effectivenessScore = 1, dueReviews = 0, openGovernanceGaps = 0 } = {}) {
  let score = effectivenessScore;
  score -= Math.min(0.3, dueReviews * 0.05);
  score -= Math.min(0.4, openGovernanceGaps * 0.1);
  score = +Math.max(0, Math.min(1, score)).toFixed(2);
  return { score, band: score >= 0.85 ? 'strong' : score >= 0.6 ? 'adequate' : 'attention', dueReviews, openGovernanceGaps, humanGate: true, note: 'Advisory governance assessment; adoption of any change requires human approval.' };
}

// Governance simulation: model the effect of a proposed governance change (deterministic).
function simulate({ proposedReviewCadenceMs, currentDueReviews = 0 }) {
  // A tighter cadence reduces the backlog of due reviews over time (illustrative model).
  const projectedDue = proposedReviewCadenceMs && proposedReviewCadenceMs < 30 * 24 * 3600_000 ? Math.max(0, currentDueReviews - 1) : currentDueReviews;
  return { projectedDueReviews: projectedDue, note: 'Deterministic governance simulation; advisory. Adoption requires human approval.' };
}

module.exports = { effectiveness, reviewCycle, legislativeReviewRecommendations, maturityEvolution, assess, simulate };
