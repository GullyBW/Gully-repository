'use strict';

/**
 * Evidence-integrity gate (FINAL Phase 5). The capstone CI check: it fails the
 * build whenever the platform's EVIDENCE QUALITY regresses —
 *
 *   - a dashboard or alert references a metric the code no longer emits;
 *   - a recommendation lacks evidence / confidence / remediation;
 *   - a confidence score is out of range or not backed by sourced components;
 *   - a runtime knob is unvalidated or ungoverned;
 *   - a domain report drops an evidence field.
 *
 * It builds the catalog of metrics the code actually EMITS (literal
 * inc/setGauge/observe/gaugeFn calls, plus whatever a driven platform renders),
 * the catalog REFERENCED by the Grafana dashboards and Prometheus alerts, and
 * runs the dynamic evidence checks against a live platform.
 *
 *   node motse/scripts/evidence-integrity.js
 *
 * Exit 0 = every metric has a source, every recommendation has evidence, every
 * dashboard references live metrics, every confidence score is justified.
 * Exit 1 = at least one regression (CI fails).
 */
const fs = require('fs');
const path = require('path');

const { createPlatform } = require('../src/container');
const {
  EvidenceIntegrity, metricsInCode, dashboardMetrics, alertMetrics,
} = require('../src/observability/evidence.integrity');

const ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(__dirname, '..', 'src');
const DASH_DIR = path.join(ROOT, 'deploy', 'motse', 'observability', 'dashboards');
const ALERT_FILES = [
  path.join(ROOT, 'deploy', 'motse', 'observability', 'prometheus-slo-alerts.yaml'),
  path.join(ROOT, 'deploy', 'motse', 'observability', 'prometheus-alerts.yaml'),
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Every metric the code emits (literal calls) ∪ everything a driven platform renders. */
function emittedCatalog() {
  const emitted = new Set();
  for (const file of walk(SRC_DIR)) {
    for (const m of metricsInCode(fs.readFileSync(file, 'utf8'))) emitted.add(m);
  }
  try {
    const platform = drivePlatform();
    for (const line of platform.metrics.render().split('\n')) {
      const name = line.match(/^([a-zA-Z_][\w]*)/);
      if (name && (name[1].startsWith('motse_') || name[1].startsWith('foundation_'))) emitted.add(name[1]);
    }
  } catch (e) {
    // Rendering is a best-effort union; the code catalog is authoritative.
    // eslint-disable-next-line no-console
    console.warn(`  (render union skipped: ${e.message})`);
  }
  return emitted;
}

/** Exercise the analytics so their gauges are emitted into the registry. */
function drivePlatform() {
  const platform = createPlatform();
  for (let i = 0; i < 14; i += 1) { platform.runtime.sample(); platform.capacity.record(); }
  const g = platform.recommendationEffectiveness.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
  platform.recommendationEffectiveness.accept(g.id);
  platform.recommendationEffectiveness.resolve(g.id, { success: true, incident_prevented: true, financial_exposure_minor: 1000 });
  platform.reconciliation.reconcile();
  platform.governanceAnalytics.report();
  platform.forecastAccuracy.report();
  platform.recommendationEffectiveness.effectiveness();
  platform.executive.report();
  platform.continuousLearning.observe();
  platform.continuousLearning.learn();
  return platform;
}

/** Metric → sources referenced by every dashboard and alert file. */
function referencedCatalog() {
  const referenced = new Map();
  const add = (metric, source) => {
    if (!referenced.has(metric)) referenced.set(metric, []);
    referenced.get(metric).push(source);
  };
  for (const file of fs.readdirSync(DASH_DIR).filter((f) => f.endsWith('.json'))) {
    const dash = JSON.parse(fs.readFileSync(path.join(DASH_DIR, file), 'utf8'));
    for (const [metric, panels] of dashboardMetrics(dash)) {
      for (const panel of panels) add(metric, `dashboard:${file}:${panel}`);
    }
  }
  for (const alertFile of ALERT_FILES) {
    if (!fs.existsSync(alertFile)) continue;
    for (const metric of alertMetrics(fs.readFileSync(alertFile, 'utf8'))) add(metric, `alert:${path.basename(alertFile)}`);
  }
  return referenced;
}

function main() {
  // eslint-disable-next-line no-console
  console.log('Evidence integrity gate (FINAL Phase 5)\n');
  const emitted = emittedCatalog();
  const referenced = referencedCatalog();
  const platform = drivePlatform();
  const result = new EvidenceIntegrity({ platform }).report({ emitted, referenced });

  const byCategory = {};
  for (const f of result.findings) (byCategory[f.category] = byCategory[f.category] || []).push(f);

  const CHECKS = [
    ['metric/dashboard/alert integrity', 'dashboard_integrity'],
    ['recommendation evidence', 'recommendation_evidence'],
    ['confidence justification', 'confidence_justification'],
    ['configuration integrity', 'configuration_integrity'],
    ['governance', 'governance'], ['forecast accuracy', 'forecast_accuracy'],
    ['recommendation accuracy', 'recommendation_accuracy'], ['business validation', 'business_validation'],
    ['disaster recovery', 'disaster_recovery'], ['operational intelligence', 'operational_intelligence'],
    ['executive dashboards', 'executive_dashboards'],
  ];
  for (const [label, category] of CHECKS) {
    const fails = byCategory[category] || [];
    // eslint-disable-next-line no-console
    console.log(`  ${fails.length === 0 ? 'PASS' : 'FAIL'}  ${label}${fails.length ? ` (${fails.length})` : ''}`);
    for (const f of fails) console.log(`        - ${f.message}`);
  }

  const evidence = {
    at: new Date().toISOString(),
    metrics_emitted: emitted.size,
    metrics_referenced: referenced.size,
    verdict: result.ok ? 'PASS' : 'FAIL',
    findings: result.findings,
  };
  const outDir = path.join(__dirname, '..', 'docs', 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'evidence-integrity.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`\n${emitted.size} metrics emitted · ${referenced.size} referenced · ${result.findings.length} finding(s)`);
  // eslint-disable-next-line no-console
  console.log(`verdict: ${evidence.verdict}`);
  process.exit(result.ok ? 0 : 1);
}

main();
