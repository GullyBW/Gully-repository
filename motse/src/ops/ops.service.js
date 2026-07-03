'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Operational readiness (Phase 2, WS10): incident management,
 * maintenance mode, live (redacted) configuration, health and capacity
 * reports. Sev-1 conditions auto-open incidents from the event bus —
 * reconciliation variance and high-severity security events never rely
 * on a human watching a dashboard.
 */
const SEVERITIES = ['sev1', 'sev2', 'sev3'];

class OpsService {
  constructor({ store, clock, bus, audit, platform }) {
    this.incidents = store.collection('incidents');
    this.clock = clock;
    this.bus = bus;
    this.audit = audit;
    this.platform = platform;
    this.maintenance = { on: false, message: null, since: null, by: null };
    this.startedAtMs = clock.nowMs();

    bus.register('ops.incident.opened', 1, ['incident_id', 'severity']);

    // Auto-open incidents on Sev-1 conditions (doc §16 incident mgmt).
    bus.subscribe('ledger.reconciliation.variance', 'ops-incidents', (e) =>
      this.openIncident(
        {
          severity: 'sev1',
          title: 'Reconciliation variance detected',
          source: 'ledger.reconciliation.variance',
          context: { variance_minor: e.data.variance_minor },
        },
        'system:ops'
      )
    );
    bus.subscribe('security.event.raised', 'ops-incidents', (e) => {
      if (e.data.severity === 'high') {
        this.openIncident(
          {
            severity: 'sev2',
            title: `Security: ${e.data.type}`,
            source: `security:${e.data.type}`,
            context: { event_id: e.data.event_id, subject_ref: e.data.subject_ref },
          },
          'system:ops'
        );
      }
    });
  }

  // ── Incidents ──────────────────────────────────────────────────────

  openIncident({ severity, title, source, context = {} }, actor) {
    if (!SEVERITIES.includes(severity)) {
      throw err('INVALID_ARGUMENT', `severity must be one of ${SEVERITIES.join('|')}`);
    }
    // Dedupe: one OPEN incident per source.
    const existing = this.incidents.findOne((i) => i.source === source && i.state !== 'resolved');
    if (existing) {
      this._timeline(existing.id, 'system:ops', 'recurrence recorded');
      return this.incidents.get(existing.id);
    }
    const incident = this.incidents.insert({
      id: id('inc'),
      severity,
      title,
      source,
      context,
      state: 'open', // open → acknowledged → resolved
      timeline: [{ at: this.clock.nowIso(), by: actor, note: 'opened' }],
      opened_at: this.clock.nowIso(),
    });
    this.audit.append(actor, 'ops.incident_opened', `incident:${incident.id}`, null, {
      severity,
      title,
    });
    this.bus.publish('ops.incident.opened', { incident_id: incident.id, severity });
    return incident;
  }

  acknowledgeIncident(incidentId, actor, note) {
    const incident = this._incident(incidentId);
    if (incident.state !== 'open') throw err('STATE_CONFLICT', `Incident is ${incident.state}`);
    this.incidents.update(incidentId, { state: 'acknowledged', acknowledged_by: actor });
    this._timeline(incidentId, actor, note || 'acknowledged');
    return this.incidents.get(incidentId);
  }

  resolveIncident(incidentId, actor, resolution) {
    const incident = this._incident(incidentId);
    if (incident.state === 'resolved') return incident;
    if (!resolution) throw err('INVALID_ARGUMENT', 'A resolution note is required');
    this.incidents.update(incidentId, {
      state: 'resolved',
      resolution,
      resolved_at: this.clock.nowIso(),
    });
    this._timeline(incidentId, actor, `resolved: ${resolution}`);
    this.audit.append(actor, 'ops.incident_resolved', `incident:${incidentId}`, null, { resolution });
    return this.incidents.get(incidentId);
  }

  addTimelineNote(incidentId, actor, note) {
    this._incident(incidentId);
    return this._timeline(incidentId, actor, note);
  }

  _timeline(incidentId, by, note) {
    const incident = this.incidents.get(incidentId);
    return this.incidents.update(incidentId, {
      timeline: [...incident.timeline, { at: this.clock.nowIso(), by, note }],
    });
  }

  _incident(incidentId) {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw err('NOT_FOUND', `No incident ${incidentId}`);
    return incident;
  }

  listIncidents({ state } = {}) {
    return this.incidents.find((i) => !state || i.state === state);
  }

  // ── Maintenance mode ───────────────────────────────────────────────

  setMaintenance(on, message, actor) {
    this.maintenance = {
      on: !!on,
      message: message || null,
      since: on ? this.clock.nowIso() : null,
      by: actor,
    };
    this.audit.append(actor, on ? 'ops.maintenance_on' : 'ops.maintenance_off', 'platform:motse',
      null, { message: message || null });
    return this.maintenance;
  }

  /**
   * Gateway middleware: while ON, member-facing mutations 503 with a
   * retryable MAINTENANCE error; reads, health, webhooks (money safety)
   * and the admin surface stay available.
   */
  maintenanceMiddleware() {
    const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    return (req, res, next) => {
      if (!this.maintenance.on || !MUTATING.has(req.method)) return next();
      if (req.path.startsWith('/admin') || req.path.startsWith('/payments/webhooks/')) {
        return next();
      }
      return next(err('MAINTENANCE', this.maintenance.message || undefined));
    };
  }

  // ── Live configuration (redacted) ──────────────────────────────────

  configView() {
    const p = this.platform;
    return {
      env: {
        node_env: process.env.NODE_ENV || 'development',
        log_level: process.env.MOTSE_LOG_LEVEL || 'info',
        rate_capacity: Number(process.env.MOTSE_RATE_CAPACITY || 300),
        rate_refill: Number(process.env.MOTSE_RATE_REFILL || 5),
      },
      payment_providers: [...p.payments.providers.values()].map((provider) => ({
        name: provider.name,
        mode: provider.live ? 'live' : 'sandbox',
        capabilities: provider.capabilities,
      })),
      secrets: p.secrets.describe(), // names + versions only, never values
      flags: p.flags ? p.flags.list().map((f) => ({ key: f.key, overrides: f.overrides.length })) : [],
      maintenance: this.maintenance,
      ai_capabilities: p.ai ? [...p.ai.providers.keys()] : [],
      integrations: p.integrations ? p.integrations.describe() : [],
    };
  }

  // ── Health & capacity reports ──────────────────────────────────────

  healthReport() {
    const p = this.platform;
    return {
      generated_at: this.clock.nowIso(),
      readiness: p.monitoring.readiness(),
      trial_balance: p.ledger.trialBalance(),
      open_incidents: this.listIncidents({ state: 'open' }).length,
      stuck_escrows: p.monitoring.stuckEscrows().length,
      payment_retry_depth: p.payments.retryQueue.depth(),
      payment_dead_letters: p.payments.retryQueue.deadLetters.length,
      reconciliation_variances: p.ledger.reconciliationRuns.count((r) => r.variance_minor > 0),
      security: {
        high_events: p.assurance ? p.assurance.listEvents({ severity: 'high' }).length : 0,
        open_fraud_reviews: p.fraud.openReviews().length,
      },
      maintenance: this.maintenance,
    };
  }

  /** Capacity vs the doc §15.2 design targets, with headroom. */
  capacityReport() {
    const p = this.platform;
    const uptimeDays = Math.max((this.clock.nowMs() - this.startedAtMs) / 86400000, 1 / 24);
    const users = p.identity.users.count();
    const postingsPerDay = p.ledger.postings.count() / uptimeDays;
    const mediaPerMonth = (p.media.items.count() / uptimeDays) * 30;
    const targets = {
      year1_mau: 50000,
      year3_mau: 1000000,
      media_items_per_month: 100000,
      peak_write_multiplier: 20,
    };
    return {
      generated_at: this.clock.nowIso(),
      observed: {
        users,
        postings_per_day: Math.round(postingsPerDay * 100) / 100,
        media_items_per_month: Math.round(mediaPerMonth * 100) / 100,
        audit_events: p.audit.events.count(),
      },
      targets,
      utilization: {
        users_vs_year1_pct: Math.round((users / targets.year1_mau) * 10000) / 100,
        media_vs_target_pct:
          Math.round((mediaPerMonth / targets.media_items_per_month) * 10000) / 100,
      },
      // Architecture reviews re-run at every 5× growth step (§15.2).
      next_architecture_review_at_users: Math.max(users * 5, 250),
    };
  }
}

module.exports = { OpsService };
