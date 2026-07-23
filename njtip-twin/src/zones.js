'use strict';
// Constitutional Architecture (DDR-01/04/06 of the blueprint): three
// non-collapsible data zones. Each owns storage/keys/admin. Cross-zone flow is
// ONLY via audited API/event — never a shared DB. Directional rules encode
// separation of powers (A-JUS-01/03).
const ZONES = Object.freeze({
  INDEPENDENT: 'independent', // Confidential Reporting, Governance, Oversight, Audit, Analytics
  EXECUTIVE: 'executive', // Investigation, Prosecution, Corrections
  JUDICIARY: 'judiciary', // Adjudication, Court Admin, Archive
});

// Allowed cross-zone *event/API* directions (raw DB reads are NEVER allowed).
// executive -> judiciary : case handoff. judiciary -> executive : scoped disclosure.
// independent -> {exec,jud} : read aggregates/audit only (modeled as 'aggregate').
const CROSS_ZONE_FLOWS = Object.freeze([
  { from: ZONES.EXECUTIVE, to: ZONES.JUDICIARY, kind: 'handoff-event' },
  { from: ZONES.JUDICIARY, to: ZONES.EXECUTIVE, kind: 'scoped-disclosure' },
  { from: ZONES.INDEPENDENT, to: ZONES.EXECUTIVE, kind: 'aggregate' },
  { from: ZONES.INDEPENDENT, to: ZONES.JUDICIARY, kind: 'aggregate' },
]);

function isZone(z) {
  return Object.values(ZONES).includes(z);
}

module.exports = { ZONES, CROSS_ZONE_FLOWS, isZone };
