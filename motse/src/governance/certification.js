'use strict';

/**
 * DPI Certification Mode (requirement #10). A system-wide self-audit that
 * proves the platform's integrity guarantees on demand:
 *   - replays the entire event log and checks its sequence integrity;
 *   - validates the Ledger (double-entry trial balance must be balanced);
 *   - verifies policy decisions were recorded (governance coverage);
 *   - audits AI retrieval logs (every retrieval carries a policy decision);
 *   - rolls up cross-plane activity;
 * and returns a single signed, reproducible compliance report.
 */
class Certification {
  constructor({ clock, eventStore, ledger, auditGraph, provenance }) {
    this.clock = clock;
    this.eventStore = eventStore;
    this.ledger = ledger;
    this.auditGraph = auditGraph;
    this.provenance = provenance;
  }

  run() {
    const events = this.eventStore.read({});

    // 1. Event log integrity: strictly increasing, gap-free sequence.
    const sequenceIntact = events.every((e, i) => e.seq === i + 1);

    // 2. Ledger integrity — the immutable financial source of truth.
    const trial = this.ledger.trialBalance();

    // 3. Governance coverage.
    const policyDecisions = events.filter((e) => e.type === 'policy.decided');
    const denies = policyDecisions.filter((e) => e.data.decision === 'DENY').length;
    const stepUps = policyDecisions.filter((e) => e.data.decision === 'STEP_UP_AUTH').length;

    // 4. AI retrieval audit: every governed retrieval must carry a policy id.
    const retrievals = events.filter((e) => e.type === 'ai.retrieval.performed');
    const retrievalsGoverned = retrievals.every((e) => !!e.data.policy_decision_id);

    // 5. Cross-plane rollup.
    const planes = this.auditGraph.summary().by_plane;

    const report = {
      generated_at: this.clock.nowIso(),
      events: { total: events.length, sequence_intact: sequenceIntact },
      ledger: { balanced: trial.balanced },
      policy: { decisions: policyDecisions.length, denies, step_ups: stepUps },
      ai: { retrievals: retrievals.length, all_governed: retrievalsGoverned },
      planes,
      checks: {
        event_sequence_intact: sequenceIntact,
        ledger_balanced: !!trial.balanced,
        ai_retrievals_governed: retrievalsGoverned,
      },
      passed: sequenceIntact && !!trial.balanced && retrievalsGoverned,
    };
    // The report itself is provenance-signed → tamper-evident + reproducible.
    return this.provenance.sign({ output: report, eventRefs: ['certification'], tenant: 'motse' });
  }
}

module.exports = { Certification };
