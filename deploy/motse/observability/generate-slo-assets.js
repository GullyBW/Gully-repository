'use strict';

/**
 * SLO asset generator (Phase 3). Renders slo.yaml — the single source of
 * truth for evidence-based objectives — into:
 *
 *   dashboards/slo.json          Grafana SLO-compliance dashboard
 *   prometheus-slo-alerts.yaml   violation alert rules (only the alerts the
 *                                base rule set does not already cover)
 *
 * Regenerate with:  node deploy/motse/observability/generate-slo-assets.js
 * CI regenerates both files and fails on drift, so the dashboard and alerts
 * can never diverge from the declared objectives.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const slo = yaml.load(fs.readFileSync(path.join(__dirname, 'slo.yaml'), 'utf8'));

// ── Grafana dashboard: one stat panel (current SLI vs objective) plus a
//    timeseries per objective, threshold-annotated. ─────────────────────
function panels() {
  const out = [];
  slo.objectives.forEach((o, i) => {
    const objectiveLine = typeof o.objective === 'number' ? o.objective : null;
    out.push({
      id: i * 2 + 1,
      title: `${o.name} — current`,
      type: 'stat',
      datasource: { type: 'prometheus', uid: 'prometheus' },
      gridPos: { h: 4, w: 6, x: (i % 4) * 6, y: Math.floor(i / 4) * 12 },
      targets: [{ expr: o.sli.trim(), refId: 'A' }],
      options: { reduceOptions: { calcs: ['lastNotNull'] } },
      fieldConfig: {
        defaults: {
          unit: o.unit === 'ms' ? 'ms' : 'none',
          thresholds: {
            mode: 'absolute',
            steps: [{ color: 'green', value: null }, { color: 'red', value: objectiveLine }],
          },
        },
        overrides: [],
      },
    });
    out.push({
      id: i * 2 + 2,
      title: `${o.name} — trend (objective ${o.comparator || '>='} ${o.objective}${o.unit ? o.unit : ''}, window ${o.window})`,
      type: 'timeseries',
      datasource: { type: 'prometheus', uid: 'prometheus' },
      gridPos: { h: 8, w: 6, x: (i % 4) * 6, y: Math.floor(i / 4) * 12 + 4 },
      targets: [{ expr: o.sli.trim(), refId: 'A' }],
      description: o.basis.trim(),
    });
  });
  return out;
}

const dashboard = {
  uid: 'motse-slo',
  title: 'Motse · SLO Compliance',
  schemaVersion: 39,
  tags: ['motse', 'slo'],
  time: { from: 'now-24h', to: 'now' },
  refresh: '1m',
  panels: panels(),
};

// ── Prometheus alert rules (SLO violations not covered by the base set) ──
const rules = [];
for (const o of slo.objectives) {
  for (const a of o.alerts || []) {
    rules.push({
      alert: a.name,
      expr: a.expr.trim(),
      ...(a.for ? { for: a.for } : {}),
      labels: { severity: a.severity, slo: o.name },
      annotations: { summary: a.summary, basis: o.basis.trim() },
    });
  }
}
const alertDoc = { groups: [{ name: 'motse-slo-objectives', rules }] };

const header = [
  '# GENERATED — do not edit by hand. Source: slo.yaml',
  '# Regenerate: node deploy/motse/observability/generate-slo-assets.js',
  '',
].join('\n');

fs.writeFileSync(
  path.join(__dirname, 'dashboards', 'slo.json'),
  `${JSON.stringify(dashboard, null, 2)}\n`
);
fs.writeFileSync(
  path.join(__dirname, 'prometheus-slo-alerts.yaml'),
  header + yaml.dump(alertDoc, { lineWidth: 100 })
);

// eslint-disable-next-line no-console
console.log(`Generated slo.json (${dashboard.panels.length} panels) + prometheus-slo-alerts.yaml (${rules.length} rules) from ${slo.objectives.length} objectives`);
