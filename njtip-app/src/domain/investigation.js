'use strict';
// Investigation operations — pure, deterministic domain helpers for the enterprise case
// workflow: prioritisation, assignment + workload balancing, SLA targets, a multi-stage
// review chain, appeals, and retention policy. No I/O, no wall-clock (the caller passes a
// clock/now), so every result is reproducible and Twin-verifiable.

// --- Prioritisation ---------------------------------------------------------------
// Category severity weights (higher = more severe). Non-identifying; purely operational.
const CATEGORY_WEIGHT = { police: 5, prosecution: 5, courts: 4, official: 4, prison: 3, regulatory: 2, other: 1 };
const DAY = 24 * 3600_000;

// Score = severity + escalation bump + ageing (older open cases rise). Banded P1..P4.
function scorePriority({ category, escalated = false, ageMs = 0 }) {
  const severity = CATEGORY_WEIGHT[category] || 1;
  const ageBump = Math.min(3, Math.floor(ageMs / (3 * DAY))); // +1 per 3 days, capped at +3
  const score = severity + (escalated ? 3 : 0) + ageBump;
  const band = score >= 8 ? 'P1' : score >= 6 ? 'P2' : score >= 4 ? 'P3' : 'P4';
  return { score, band };
}

// --- SLA targets ------------------------------------------------------------------
const SLA = {
  P1: { firstReviewMs: 1 * DAY, resolutionMs: 7 * DAY },
  P2: { firstReviewMs: 3 * DAY, resolutionMs: 21 * DAY },
  P3: { firstReviewMs: 7 * DAY, resolutionMs: 45 * DAY },
  P4: { firstReviewMs: 14 * DAY, resolutionMs: 90 * DAY },
};
function slaFor(band) { return SLA[band] || SLA.P4; }
function slaStatus({ band, createdAt, firstReviewedAt, resolvedAt, now }) {
  const t = slaFor(band);
  const firstReviewDueAt = createdAt + t.firstReviewMs;
  const resolutionDueAt = createdAt + t.resolutionMs;
  const firstReviewBreached = firstReviewedAt ? firstReviewedAt > firstReviewDueAt : now > firstReviewDueAt;
  const resolutionBreached = resolvedAt ? resolvedAt > resolutionDueAt : now > resolutionDueAt;
  return { band, firstReviewDueAt, resolutionDueAt, firstReviewBreached, resolutionBreached, breached: firstReviewBreached || resolutionBreached };
}

// --- Assignment + workload balancing ----------------------------------------------
// Pick the LEAST-loaded investigator, PREFERRING the recipient agency (preferUnit) that
// the conflict-of-interest router already selected; fall back to the whole roster if that
// agency has no free investigator. `exclude` drops specific principals (explicit CoI).
// Deterministic tie-break by id so the choice is reproducible.
function assign({ roster, loads = {}, preferUnit, exclude = [] }) {
  const pool = roster.filter((r) => !exclude.includes(r.id));
  const preferred = preferUnit ? pool.filter((r) => r.unit === preferUnit) : [];
  const candidates = (preferred.length ? preferred : pool)
    .map((r) => ({ id: r.id, unit: r.unit, load: loads[r.id] || 0 }))
    .sort((a, b) => (a.load - b.load) || a.id.localeCompare(b.id));
  return candidates[0] || null;
}

// --- Multi-stage review chain -----------------------------------------------------
// The ordered chain a case travels through. Appeals re-enter at 'appeal-review'.
const REVIEW_CHAIN = ['intake-review', 'investigation', 'oversight-review', 'decision'];
const APPEAL_CHAIN = ['appeal-review', 'appeal-decision'];
function nextStage(chain, current) { const i = chain.indexOf(current); return i === -1 || i === chain.length - 1 ? null : chain[i + 1]; }

// --- Retention policy -------------------------------------------------------------
// Retention window by category + outcome (illustrative operational policy). Returns the
// disposition date and action. Legal hold (handled at the object store) overrides purge.
const RETENTION = { admitted: 10 * 365 * DAY, resolved: 7 * 365 * DAY, excluded: 2 * 365 * DAY, closed: 5 * 365 * DAY, default: 5 * 365 * DAY };
function retentionFor({ outcome, decidedAt }) {
  const windowMs = RETENTION[outcome] || RETENTION.default;
  return { windowMs, disposeAt: decidedAt + windowMs, action: 'review-then-purge', note: 'Legal hold overrides purge.' };
}

module.exports = {
  CATEGORY_WEIGHT, SLA, REVIEW_CHAIN, APPEAL_CHAIN, RETENTION,
  scorePriority, slaFor, slaStatus, assign, nextStage, retentionFor,
};
