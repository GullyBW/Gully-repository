'use strict';
// Evidence lifecycle — a guarded state machine over an evidence item's EVIDENTIARY status,
// layered on top of the Twin's cryptographic chain of custody (which already proves the
// bytes were not altered). This tracks the *handling* status: ingested → sealed →
// under-review → admitted | excluded → (retained) → purged. Pure and deterministic.
//
// The custody chain (hashes) is the integrity proof; this machine governs what may happen
// to the item procedurally, rejecting illegal handling transitions by construction.
const STATES = ['ingested', 'sealed', 'under-review', 'admitted', 'excluded', 'purged'];
const TERMINAL = new Set(['purged']);

const TRANSITIONS = {
  ingested: new Set(['sealed']),           // seal immediately after ingest (tamper-evident)
  sealed: new Set(['under-review']),        // opened for review under authorization
  'under-review': new Set(['admitted', 'excluded', 'sealed']), // decide, or re-seal
  admitted: new Set(['purged']),            // retained until retention policy purges
  excluded: new Set(['purged']),
  purged: new Set(),
};

const EVENT_TARGET = {
  seal: 'sealed',
  open: 'under-review',
  admit: 'admitted',
  exclude: 'excluded',
  purge: 'purged',
};

function isState(s) { return STATES.includes(s); }
function isTerminal(s) { return TERMINAL.has(s); }
function canTransition(from, to) { return !!(TRANSITIONS[from] && TRANSITIONS[from].has(to)); }
function targetFor(event) { return EVENT_TARGET[event] || null; }

function apply(from, event) {
  if (!isState(from)) return { ok: false, reason: `unknown state '${from}'` };
  const to = targetFor(event);
  if (!to) return { ok: false, reason: `unknown event '${event}'` };
  if (!canTransition(from, to)) return { ok: false, reason: `illegal transition ${from} → ${to}` };
  return { ok: true, to };
}

function allowedEvents(from) { return Object.keys(EVENT_TARGET).filter((e) => canTransition(from, EVENT_TARGET[e])); }

module.exports = { STATES, TRANSITIONS, EVENT_TARGET, isState, isTerminal, canTransition, targetFor, apply, allowedEvents };
