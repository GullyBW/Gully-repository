'use strict';
// Case lifecycle — an explicit, guarded state machine for a report/case. Formalizes the
// statuses the workflow already uses ('received' → 'reviewed'/'escalated') and adds the
// resolution/closure states, so illegal transitions are rejected by construction rather
// than by ad-hoc string assignment. Pure and deterministic (no I/O, no clock).
//
// States:
//   received   — intake complete, routed to a conflict-free recipient
//   reviewed   — an investigator has reviewed (no escalation)
//   escalated  — raised for higher/oversight attention
//   resolved   — a substantive outcome has been reached
//   closed     — terminal; no further transitions
const STATES = ['received', 'reviewed', 'escalated', 'resolved', 'closed'];
const TERMINAL = new Set(['closed']);

// Allowed transitions: from → Set(to). Anything not listed is denied (default-deny).
const TRANSITIONS = {
  received: new Set(['reviewed', 'escalated', 'closed']),
  reviewed: new Set(['escalated', 'resolved', 'closed']),
  escalated: new Set(['resolved', 'closed']),
  resolved: new Set(['closed']),
  closed: new Set(),
};

// Events map to a target state (the vocabulary the API/investigator uses).
const EVENT_TARGET = {
  review: 'reviewed',
  escalate: 'escalated',
  resolve: 'resolved',
  close: 'closed',
};

function isState(s) { return STATES.includes(s); }
function isTerminal(s) { return TERMINAL.has(s); }
function canTransition(from, to) { return !!(TRANSITIONS[from] && TRANSITIONS[from].has(to)); }
function targetFor(event) { return EVENT_TARGET[event] || null; }

// Resolve an event against a current state. Returns { ok, to } or { ok:false, reason }.
function apply(from, event) {
  if (!isState(from)) return { ok: false, reason: `unknown state '${from}'` };
  const to = targetFor(event);
  if (!to) return { ok: false, reason: `unknown event '${event}'` };
  if (!canTransition(from, to)) return { ok: false, reason: `illegal transition ${from} → ${to}` };
  return { ok: true, to };
}

function allowedEvents(from) { return Object.keys(EVENT_TARGET).filter((e) => canTransition(from, EVENT_TARGET[e])); }

module.exports = { STATES, TRANSITIONS, EVENT_TARGET, isState, isTerminal, canTransition, targetFor, apply, allowedEvents };
