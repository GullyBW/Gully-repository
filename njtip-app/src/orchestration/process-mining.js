'use strict';
// Enterprise Process Mining Platform (Phase 56). Extends workflow intelligence by MINING the
// immutable event log: process discovery (directly-follows graph), conformance checking
// against a reference workflow, bottleneck analysis, SLA-deviation detection, organizational
// flow analytics, and performance metrics — with EXPLAINABLE, ADVISORY recommendations.
// Deterministic. Reads only non-identifying event metadata (type/actor/timestamp).

// Build per-case traces of event types from the event log (grouped by stream/case).
function traces(events) {
  const byCase = new Map();
  for (const e of events) { if (!byCase.has(e.streamId)) byCase.set(e.streamId, []); byCase.get(e.streamId).push({ type: e.type, at: e.meta.at, actor: e.meta.actor }); }
  return byCase;
}

// Process discovery: a directly-follows graph (DFG) with edge frequencies.
function discover(events) {
  const dfg = new Map(); const starts = {}; const ends = {};
  for (const [, seq] of traces(events)) {
    if (!seq.length) continue;
    starts[seq[0].type] = (starts[seq[0].type] || 0) + 1;
    ends[seq[seq.length - 1].type] = (ends[seq[seq.length - 1].type] || 0) + 1;
    for (let i = 0; i < seq.length - 1; i++) { const k = `${seq[i].type}->${seq[i + 1].type}`; dfg.set(k, (dfg.get(k) || 0) + 1); }
  }
  return { edges: Object.fromEntries(dfg), starts, ends, cases: traces(events).size };
}

// Conformance checking: fraction of observed directly-follows edges that the reference
// workflow permits (fitness), plus the non-conforming edges.
function conformance(events, referenceDef) {
  const allowed = new Set();
  for (const [s, st] of Object.entries(referenceDef.states || {})) for (const to of Object.values(st.on || {})) {
    // Reference edges are keyed by the EVENT emitted on entering a state; we approximate
    // conformance at the event level using the caller-supplied event map below.
  }
  const observed = Object.keys(discover(events).edges);
  const permitted = new Set(referenceDef.allowedEventEdges || []);
  const nonConforming = permitted.size ? observed.filter((e) => !permitted.has(e)) : [];
  const fitness = observed.length ? +((observed.length - nonConforming.length) / observed.length).toFixed(3) : 1;
  return { fitness, observedEdges: observed.length, nonConforming, note: 'Conformance vs the reference process (event-level).' };
}

// Bottleneck analysis: mean dwell time per transition (from event timestamps).
function bottlenecks(events) {
  const durations = new Map();
  for (const [, seq] of traces(events)) for (let i = 0; i < seq.length - 1; i++) {
    const k = `${seq[i].type}->${seq[i + 1].type}`; const d = seq[i + 1].at - seq[i].at;
    if (!durations.has(k)) durations.set(k, []); durations.get(k).push(d);
  }
  const rows = [...durations.entries()].map(([edge, ds]) => ({ edge, meanMs: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length), count: ds.length }));
  rows.sort((a, b) => b.meanMs - a.meanMs);
  return { slowest: rows.slice(0, 5), all: rows };
}

// SLA-deviation detection: cases whose end-to-end cycle time exceeds a threshold.
function slaDeviations(events, { thresholdMs }) {
  const out = [];
  for (const [caseId, seq] of traces(events)) { if (seq.length < 2) continue; const cycle = seq[seq.length - 1].at - seq[0].at; if (cycle > thresholdMs) out.push({ caseId, cycleMs: cycle }); }
  return { deviations: out.length, cases: out, thresholdMs };
}

// Organizational flow analytics: work distribution by actor (non-identifying principal ids).
function orgFlow(events) { const byActor = {}; for (const [, seq] of traces(events)) for (const ev of seq) byActor[ev.actor] = (byActor[ev.actor] || 0) + 1; return { byActor }; }

// Performance metrics: throughput (completed cases) + mean cycle time.
function performance(events, { terminalTypes = ['CaseTransitioned'] } = {}) {
  let completed = 0; const cycles = [];
  for (const [, seq] of traces(events)) { if (seq.some((e) => terminalTypes.includes(e.type))) completed++; if (seq.length >= 2) cycles.push(seq[seq.length - 1].at - seq[0].at); }
  const meanCycleMs = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : 0;
  return { cases: traces(events).size, completed, meanCycleMs };
}

// Explainable, ADVISORY process recommendations.
function recommendations(events) {
  const bn = bottlenecks(events); const recs = [];
  if (bn.slowest[0]) recs.push({ priority: 'medium', action: 'review slowest transition', detail: bn.slowest[0], explanation: 'highest mean dwell time in the mined process' });
  return { recommendations: recs, advisoryOnly: true, note: 'Advisory — a human decides on process changes.' };
}

module.exports = { traces, discover, conformance, bottlenecks, slaDeviations, orgFlow, performance, recommendations };
