'use strict';
// Analytics & intelligence over the case projection — AGGREGATE and NON-ATTRIBUTABLE.
// Pure/deterministic (the caller passes rows + now). Privacy is enforced by SMALL-CELL
// SUPPRESSION: any fine-grained count below a k-anonymity threshold is suppressed so no
// individual case can be singled out. Rows carry only non-identifying operational fields
// (case_code, category, status, stage, priority band, timestamps) — never identity/content.
const DAY = 24 * 3600_000;
const K_ANON = 5; // suppress cross-tab cells with fewer than this many cases

function suppress(count, k = K_ANON) { return count > 0 && count < k ? { count: null, suppressed: true } : { count }; }

// KPIs for operational + executive dashboards.
function kpis(rows, now) {
  const total = rows.length;
  const open = rows.filter((r) => !['resolved', 'closed'].includes(r.status)).length;
  const resolved = rows.filter((r) => ['resolved', 'closed'].includes(r.status)).length;
  const reviewed = rows.filter((r) => r.firstReviewedAt);
  const avgTimeToFirstReviewMs = reviewed.length ? Math.round(reviewed.reduce((a, r) => a + (r.firstReviewedAt - r.createdAt), 0) / reviewed.length) : null;
  const breaches = rows.filter((r) => r.slaBreached).length;
  return {
    total, open, resolved,
    resolutionRate: total ? +(resolved / total).toFixed(3) : 0,
    slaBreachRate: total ? +(breaches / total).toFixed(3) : 0,
    avgTimeToFirstReviewMs,
    backlog: open,
  };
}

// Aggregate counts grouped by a non-identifying field, with small-cell suppression.
function aggregate(rows, { by = 'category', k = K_ANON } = {}) {
  const counts = {};
  for (const r of rows) { const key = r[by] ?? 'unknown'; counts[key] = (counts[key] || 0) + 1; }
  const out = {};
  for (const [key, c] of Object.entries(counts)) out[key] = suppress(c, k);
  return { by, total: rows.length, groups: out };
}

// Trend: counts per day bucket for a field (default status). Buckets are UTC-day indices
// relative to the earliest createdAt so the series is deterministic and offset-free.
function trends(rows, { field = 'status', now } = {}) {
  if (!rows.length) return { field, buckets: [] };
  const base = Math.min(...rows.map((r) => r.createdAt));
  const byDay = new Map();
  for (const r of rows) {
    const day = Math.floor((r.createdAt - base) / DAY);
    if (!byDay.has(day)) byDay.set(day, {});
    const b = byDay.get(day); const key = r[field] ?? 'unknown';
    b[key] = (b[key] || 0) + 1;
  }
  return { field, buckets: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, counts]) => ({ day, counts })) };
}

// Investigation timeline for a single case (audit-derived, non-identifying event labels).
function timeline(caseRow, auditEntries = []) {
  const events = auditEntries
    .filter((e) => e.purpose === caseRow.case_code || (e.action && caseRow.timelineActions && caseRow.timelineActions.includes(e.action)))
    .map((e) => ({ at: e.at, action: e.action }));
  return { case_code: caseRow.case_code, status: caseRow.status, stage: caseRow.stage, band: (caseRow.priority || {}).band, events };
}

// Advanced filtering over non-identifying criteria.
function filter(rows, criteria = {}) {
  return rows.filter((r) => Object.entries(criteria).every(([k, val]) => {
    if (val === undefined || val === null || val === '') return true;
    if (k === 'band') return (r.priority || {}).band === val;
    return r[k] === val;
  }));
}

// Export NON-IDENTIFYING rows (CSV or JSON). Only the allow-listed columns are emitted.
const EXPORT_COLS = ['case_code', 'category', 'status', 'stage', 'recipient', 'band', 'createdAt'];
function exportRows(rows, { format = 'json' } = {}) {
  const shaped = rows.map((r) => ({ case_code: r.case_code, category: r.category, status: r.status, stage: r.stage, recipient: r.recipient, band: (r.priority || {}).band, createdAt: r.createdAt }));
  if (format === 'csv') {
    const head = EXPORT_COLS.join(',');
    const body = shaped.map((r) => EXPORT_COLS.map((c) => JSON.stringify(r[c] ?? '')).join(',')).join('\n');
    return `${head}\n${body}`;
  }
  return shaped;
}

// Executive Intelligence (Phase 21): a governance-level scorecard over non-identifying rows.
// Aggregate and privacy-preserving (reuses suppression); informs strategy, never identifies.
function executiveScorecard(rows, now) {
  const k = kpis(rows, now);
  const byRegion = aggregate(rows.filter((r) => r.region), { by: 'region' });
  const byCategory = aggregate(rows, { by: 'category' });
  const slaCompliance = k.total ? +(1 - k.slaBreachRate).toFixed(3) : 1;
  return {
    nationalKpis: k,
    slaCompliancePct: slaCompliance,
    backlog: k.backlog,
    byCategory: byCategory.groups,
    byRegion: byRegion.groups,
    scorecard: {
      throughput: k.resolved,
      efficiency: k.total ? +(k.resolved / k.total).toFixed(3) : 0,
      timeliness: slaCompliance,
      grade: slaCompliance >= 0.9 ? 'A' : slaCompliance >= 0.75 ? 'B' : 'C',
    },
    note: 'Aggregate, non-attributable, small cells suppressed. Strategic signal only.',
  };
}

module.exports = { K_ANON, kpis, aggregate, trends, timeline, filter, exportRows, suppress, executiveScorecard, EXPORT_COLS };
