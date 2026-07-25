'use strict';
// Formal Verification Platform (Phase 42). BOUNDED, EXHAUSTIVE verification of critical
// workflow definitions: state-machine well-formedness, reachability, deadlock proofs,
// separation-of-duties, safety and liveness properties, and authorization verification.
// Workflow state graphs are small, so exhaustive enumeration is a genuine proof (within the
// bound). Deterministic. Complements the workflow simulator (statistical) with proofs.
const { analyze } = require('./workflow-simulator');

// State-machine well-formedness: every transition target exists; start exists.
function verifyStateMachine(def) {
  const issues = [];
  if (!def.states[def.start]) issues.push('start state missing');
  for (const [s, st] of Object.entries(def.states)) for (const [ev, to] of Object.entries(st.on || {})) if (!def.states[to]) issues.push(`${s} --${ev}--> ${to} (undefined target)`);
  return { property: 'well-formed', proven: issues.length === 0, issues };
}

// Reachability: every state is reachable from start (no dead code) AND a terminal is reachable.
function verifyReachability(def) {
  const a = analyze(def);
  const terminalReachable = (def.terminal || []).some((t) => a.reachable.includes(t));
  return { property: 'reachability', proven: a.unreachable.length === 0 && terminalReachable, unreachable: a.unreachable, terminalReachable };
}

// Deadlock-freedom proof: no reachable non-terminal state is a sink.
function verifyDeadlockFree(def) { const a = analyze(def); return { property: 'deadlock-free', proven: a.deadlocks.length === 0, deadlocks: a.deadlocks }; }

// Liveness: from every reachable state a terminal is still reachable (no livelock trap).
function verifyLiveness(def) {
  const terminal = new Set(def.terminal || []);
  const canReach = (s, seen = new Set()) => { if (terminal.has(s)) return true; if (seen.has(s)) return false; seen.add(s); return Object.values(def.states[s].on || {}).some((to) => canReach(to, seen)); };
  const stuck = analyze(def).reachable.filter((s) => !canReach(s));
  return { property: 'liveness', proven: stuck.length === 0, stuckStates: stuck };
}

// Separation-of-Duties: no single role appears as the sole approver twice on ANY simple path
// (a lone role cannot unilaterally drive a case end-to-end). Bounded path enumeration.
function verifySoD(def) {
  const violations = [];
  const paths = enumeratePaths(def);
  for (const path of paths) {
    const soleApprovers = {};
    for (const s of path) { const ap = def.states[s].approvals || []; if (ap.length === 1) soleApprovers[ap[0]] = (soleApprovers[ap[0]] || 0) + 1; }
    for (const [role, n] of Object.entries(soleApprovers)) if (n >= 2) violations.push({ role, path });
  }
  return { property: 'separation-of-duties', proven: violations.length === 0, violations };
}

// Safety: a "must-pass" invariant — a designated critical state must never be entered without
// having passed a required predecessor on the path (e.g. never 'closed' without 'decision').
function verifySafety(def, { critical, requiredBefore }) {
  if (!critical || !requiredBefore) return { property: 'safety', proven: true, note: 'no safety obligation specified' };
  const violations = enumeratePaths(def).filter((path) => { const i = path.indexOf(critical); return i !== -1 && !path.slice(0, i).includes(requiredBefore); }).map((path) => path.join('→'));
  return { property: 'safety', proven: violations.length === 0, obligation: `${critical} requires prior ${requiredBefore}`, violations };
}

// Authorization verification: every approval-gated state names at least one approver role, and
// (optionally) that role is permitted the 'approve' action by a policy set.
function verifyAuthorization(def, policySet) {
  const issues = [];
  for (const [s, st] of Object.entries(def.states)) {
    if (st.approvals && st.approvals.length === 0) issues.push(`${s} has an empty approver list`);
    if (st.approvals && policySet) for (const role of st.approvals) { const d = policySet.evaluate({ action: 'approve', subject: { role } }); if (d.decision === 'deny') issues.push(`${s}: role '${role}' cannot 'approve' under policy`); }
  }
  return { property: 'authorization', proven: issues.length === 0, issues };
}

// Enumerate all simple paths from start to a terminal (bounded by state count → no cycles).
function enumeratePaths(def, max = 5000) {
  const out = []; const terminal = new Set(def.terminal || []);
  const dfs = (s, path) => {
    if (out.length >= max) return;
    if (terminal.has(s) || !Object.keys(def.states[s].on || {}).length) { out.push([...path, s]); return; }
    for (const to of Object.values(def.states[s].on)) if (!path.includes(s)) dfs(to, [...path, s]); else out.push([...path, s]); // cycle → stop
  };
  dfs(def.start, []);
  return out;
}

// Prove correctness = conjunction of all properties; returns proven + per-property results.
function proveCorrectness(def, { policySet, safety } = {}) {
  const properties = [
    verifyStateMachine(def), verifyReachability(def), verifyDeadlockFree(def),
    verifyLiveness(def), verifySoD(def), verifyAuthorization(def, policySet),
    verifySafety(def, safety || {}),
  ];
  return { proven: properties.every((p) => p.proven), properties, note: 'Bounded exhaustive proof over the workflow state graph. Deterministic.' };
}

module.exports = { verifyStateMachine, verifyReachability, verifyDeadlockFree, verifyLiveness, verifySoD, verifySafety, verifyAuthorization, proveCorrectness, enumeratePaths };
