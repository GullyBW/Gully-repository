'use strict';
// CQRS read-side projections (Phase 11). A projection folds the event log into a read model
// that answers queries cheaply. Projections are REBUILDABLE from the log (the write side is
// the source of truth), which enables time-travel and projection versioning: to change a
// read model, bump its version and rebuild from events.
//
// This is additive: the existing statusRepo read model still works; these projections prove
// the read side can be reconstructed deterministically from events alone.

// Case read-model projection: fold case events → { caseCode -> non-identifying view }.
function caseReadModel(events) {
  const model = new Map();
  for (const e of events) {
    const id = e.streamId;
    const cur = model.get(id) || { caseCode: id, evidenceCount: 0 };
    switch (e.type) {
      case 'CaseSubmitted': Object.assign(cur, { status: 'received', category: e.data.category, recipient: e.data.recipient, stage: e.data.stage }); break;
      case 'EvidenceAttached': cur.evidenceCount += 1; break;
      case 'CaseReviewed': cur.status = e.data.status; break;
      case 'CaseTransitioned': cur.status = e.data.to; break;
      case 'CaseAssigned': cur.assignee = e.data.assignee; break;
      case 'StageAdvanced': cur.stage = e.data.stage; break;
      case 'AppealFiled': cur.appealed = true; break;
      default: break;
    }
    cur.version = e.version;
    model.set(id, cur);
  }
  return model;
}

// A generic, versioned projection runner: rebuilds a named read model from the whole log.
class ProjectionEngine {
  constructor() { this._projections = new Map(); }
  register(name, version, fold) { this._projections.set(name, { version, fold }); return this; }
  rebuild(name, events) { const p = this._projections.get(name); if (!p) throw new Error('unknown projection: ' + name); return { name, version: p.version, model: p.fold(events) }; }
  names() { return [...this._projections.keys()]; }
}

module.exports = { caseReadModel, ProjectionEngine };
