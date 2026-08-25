'use strict';
// Human-approval workflow for AI recommendations (Phase 13). The AI proposes; a HUMAN
// disposes. A recommendation is enqueued as 'pending'; only a named human can approve or
// reject it, and the disposition is recorded immutably. Nothing is ever auto-applied — the
// queue records intent, never executes it.
class RecommendationQueue {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._items = []; this._seq = 0; }

  // Enqueue an advisory recommendation for human review (must be advisory-only + non-autonomous).
  submit(recommendation, { caseCode } = {}) {
    if (!recommendation || recommendation.advisoryOnly !== true || recommendation.autonomous !== false) {
      throw new Error('only advisory, non-autonomous recommendations may be queued');
    }
    const id = 'REC-' + (++this._seq).toString().padStart(5, '0');
    const item = { id, caseCode: caseCode || null, kind: recommendation.kind, recommendation, status: 'pending', submittedAt: this._clock(), decidedBy: null, decidedAt: null, note: null };
    this._items.push(item);
    return { id, status: 'pending' };
  }

  // A named human approves/rejects. Returns the disposition; NEVER applies the recommendation.
  decide(id, { by, decision, note }) {
    const item = this._items.find((i) => i.id === id); if (!item) throw new Error('recommendation not found');
    if (!by) throw new Error('an accountable human reviewer is required');
    if (!['approved', 'rejected'].includes(decision)) throw new Error('decision must be approved or rejected');
    if (item.status !== 'pending') throw new Error('recommendation already decided');
    item.status = decision; item.decidedBy = by; item.decidedAt = this._clock(); item.note = note || null;
    return { id, status: item.status, decidedBy: by, appliesAutomatically: false };
  }
  pending() { return this._items.filter((i) => i.status === 'pending').map(view); }
  audit() { return this._items.map(view); }
}
function view(i) { return { id: i.id, caseCode: i.caseCode, kind: i.kind, status: i.status, confidence: i.recommendation.confidence, submittedAt: i.submittedAt, decidedBy: i.decidedBy, decidedAt: i.decidedAt }; }

module.exports = { RecommendationQueue };
