'use strict';
// Workflow Simulation Platform (Phase 27). Deterministic STATIC ANALYSIS + synthetic MASS
// EXECUTION of workflow definitions, so a workflow VERSION can be validated BEFORE activation.
// The Twin becomes the authoritative workflow-validation environment. Pure/deterministic.
const { rng } = require('../twin');

// Static analysis of a workflow definition (from workflow-engine.js).
function analyze(def) {
  const states = Object.keys(def.states);
  const edges = (s) => Object.entries(def.states[s].on || {}).map(([ev, to]) => ({ ev, to }));
  const terminal = new Set(def.terminal || []);

  // Reachability from start (BFS).
  const reachable = new Set([def.start]); const q = [def.start];
  while (q.length) { const s = q.shift(); for (const { to } of edges(s)) if (!reachable.has(to)) { reachable.add(to); q.push(to); } }
  const unreachable = states.filter((s) => !reachable.has(s));

  // Deadlocks: a reachable NON-terminal state with no outgoing transitions.
  const deadlocks = states.filter((s) => reachable.has(s) && !terminal.has(s) && edges(s).length === 0);

  // Cycles (potential infinite loops) via DFS; report cycles that cannot reach a terminal.
  const cycles = findCycles(def, edges);
  const canReachTerminal = (s, seen = new Set()) => { if (terminal.has(s)) return true; if (seen.has(s)) return false; seen.add(s); return edges(s).some(({ to }) => canReachTerminal(to, seen)); };
  const livelocks = cycles.filter((c) => c.every((s) => !canReachTerminal(s)));

  // Escalation validity: every SLA state points at an existing escalation target.
  const escalationIssues = states.filter((s) => def.states[s].slaMs && def.states[s].escalateTo && !def.states[def.states[s].escalateTo]).map((s) => `${s} → ${def.states[s].escalateTo}`);

  // Approval bottlenecks: states needing many approvers.
  const approvalBottlenecks = states.filter((s) => (def.states[s].approvals || []).length >= 2);

  // Longest cumulative SLA along a simple path (SLA violation prediction).
  const maxSlaMs = longestSla(def, edges);

  return { states: states.length, reachable: [...reachable].sort(), unreachable, deadlocks, cycles, livelocks, escalationIssues, approvalBottlenecks, maxSlaMs };
}

function findCycles(def, edges) {
  const cycles = []; const color = new Map(); const stack = [];
  const dfs = (s) => {
    color.set(s, 'grey'); stack.push(s);
    for (const { to } of edges(s)) {
      if (color.get(to) === 'grey') { const i = stack.indexOf(to); cycles.push(stack.slice(i)); }
      else if (!color.get(to)) dfs(to);
    }
    stack.pop(); color.set(s, 'black');
  };
  for (const s of Object.keys(def.states)) if (!color.get(s)) dfs(s);
  return cycles;
}
function longestSla(def, edges) {
  const memo = new Map();
  const dfs = (s, seen) => {
    if (seen.has(s)) return 0; // avoid cycles
    if (memo.has(s)) return memo.get(s);
    const here = def.states[s].slaMs || 0;
    let best = 0; for (const { to } of edges(s)) best = Math.max(best, dfs(to, new Set([...seen, s])));
    const total = here + best; memo.set(s, total); return total;
  };
  return dfs(def.start, new Set());
}

// A workflow VERSION must pass this before activation (deadlock-free, no unreachable terminal,
// escalation valid, no livelocks). Returns { ok, issues }.
function validateForActivation(def) {
  const a = analyze(def);
  const issues = [];
  if (a.deadlocks.length) issues.push(`deadlocks: ${a.deadlocks.join(', ')}`);
  if (a.livelocks.length) issues.push(`livelocks (cannot reach terminal): ${a.livelocks.map((c) => c.join('→')).join('; ')}`);
  if (a.escalationIssues.length) issues.push(`invalid escalation targets: ${a.escalationIssues.join(', ')}`);
  const reachableTerminal = (def.terminal || []).some((t) => a.reachable.includes(t));
  if ((def.terminal || []).length && !reachableTerminal) issues.push('no terminal state is reachable');
  return { ok: issues.length === 0, issues, analysis: a };
}

// Synthetic mass execution: run `runs` seeded instances, each firing random VALID events until
// terminal or a step cap; collect deterministic statistics (state reachability + path lengths).
function simulate(def, { runs = 500, seed = 1, maxSteps = 50 } = {}) {
  const rand = rng.mulberry32(seed);
  const visited = {}; let completed = 0; let capped = 0; const lengths = [];
  for (let r = 0; r < runs; r++) {
    let state = def.start; let steps = 0;
    while (steps < maxSteps) {
      visited[state] = (visited[state] || 0) + 1;
      if ((def.terminal || []).includes(state)) { completed++; break; }
      const events = Object.keys(def.states[state].on || {});
      if (!events.length) break; // deadlock in this run
      // Skip approval-gated states deterministically by "granting" (simulation of approvals).
      const ev = events[Math.floor(rand() * events.length)];
      state = def.states[state].on[ev]; steps++;
    }
    if (steps >= maxSteps) capped++;
    lengths.push(steps);
  }
  lengths.sort((a, b) => a - b);
  return { runs, completed, capped, completionRate: +(completed / runs).toFixed(3), visited, pathLength: { p50: lengths[Math.floor(runs * 0.5)] || 0, p95: lengths[Math.floor(runs * 0.95)] || 0, max: lengths[lengths.length - 1] || 0 } };
}

// Workflow regression: compare two versions' reachable states + transitions.
function regression(defA, defB) {
  const ra = new Set(analyze(defA).reachable); const rb = new Set(analyze(defB).reachable);
  const removedStates = [...ra].filter((s) => !rb.has(s));
  const addedStates = [...rb].filter((s) => !ra.has(s));
  return { removedStates, addedStates, breaking: removedStates.length > 0 };
}

module.exports = { analyze, validateForActivation, simulate, regression };
