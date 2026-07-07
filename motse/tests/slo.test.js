'use strict';

/**
 * Phase 3 — evidence-based SLOs. Guards the telemetry contract end-to-end:
 * slo.yaml is well-formed and every threshold cites measured evidence; the
 * SLIs and alert expressions reference only metrics the platform actually
 * emits; the generated Grafana/Prometheus assets stay consistent with the
 * declared objectives; and the checked-in validation evidence is a PASS.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createPlatform } = require('../src/container');

const DEPLOY = path.join(__dirname, '../../deploy/motse/observability');
const EVIDENCE = path.join(__dirname, '../docs/evidence/production-validation.json');

const slo = yaml.load(fs.readFileSync(path.join(DEPLOY, 'slo.yaml'), 'utf8'));

describe('slo.yaml — structure & evidence basis', () => {
  test('parses with the expected top-level shape', () => {
    expect(slo.version).toBe(1);
    expect(slo.service).toBe('motse-core');
    expect(slo.evidence).toContain('production-validation.json');
    expect(Array.isArray(slo.objectives)).toBe(true);
    expect(slo.objectives.length).toBeGreaterThanOrEqual(8);
  });

  test('every objective is complete: name, description, sli, objective, window, measured basis', () => {
    for (const o of slo.objectives) {
      expect(o.name).toMatch(/^[a-z_0-9]+$/);
      expect(o.description).toBeTruthy();
      expect(o.sli).toBeTruthy();
      expect(o.objective).not.toBeUndefined();
      expect(o.window).toBeTruthy();
      // Evidence-based, not arbitrary: the basis must cite a validation scenario.
      expect(o.basis).toMatch(/validation W\d/);
      expect(Array.isArray(o.alerts)).toBe(true);
    }
  });

  test('core objectives cover the mission surface', () => {
    const names = slo.objectives.map((o) => o.name);
    expect(names).toEqual(expect.arrayContaining([
      'availability', 'api_latency_p95', 'api_latency_p99', 'transaction_success',
      'outbox_backlog', 'outbox_dead_letters', 'lock_failure_rate', 'telemetry_delivery',
    ]));
  });

  test('every SLO alert has a name, expression, severity and summary', () => {
    const alerts = slo.objectives.flatMap((o) => o.alerts);
    expect(alerts.length).toBeGreaterThanOrEqual(4);
    for (const a of alerts) {
      expect(a.name).toMatch(/^Slo[A-Za-z0-9]+$/);
      expect(a.expr).toBeTruthy();
      expect(a.severity).toMatch(/^sev[123]$/);
      expect(a.summary).toBeTruthy();
    }
  });
});

describe('SLO telemetry contract — SLIs reference only emitted metrics', () => {
  const baseName = (t) => t.replace(/_(bucket|sum|count)$/, '');

  test('the platform emits every metric the SLIs and SLO alerts use', async () => {
    const platform = createPlatform();
    // Touch the Foundation so counter families exist alongside the gauges.
    platform.store.transaction(() => platform.store.collection('slo_probe').insert({ id: 'x' }));
    await platform.distributed.lock.withLock('slo', async () => {});
    platform.bus.register('slo.probe', 1, ['n']);
    platform.outbox.run(({ stage }) => stage('slo.probe', { n: 1 }));
    const { createApp } = require('../src/app');
    const request = require('supertest');
    const { app } = createApp(platform);
    await request(app).get('/health/live');
    const rendered = platform.metrics.render();

    const exprs = slo.objectives.map((o) => o.sli).concat(slo.objectives.flatMap((o) => (o.alerts || []).map((a) => a.expr))).join(' ');
    const tokens = [...new Set(exprs.match(/\b(foundation|motse)_[a-z_0-9]+/g) || [])];
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(rendered.includes(baseName(token))).toBe(true);
    }
  });

  test('the otel dropped-spans gauge tracks the exporter', () => {
    const platform = createPlatform();
    expect(platform.metrics.render()).toMatch(/motse_otel_dropped_spans 0/);
    platform.otel.dropped = 7; // simulate a broken collector window
    expect(platform.metrics.render()).toMatch(/motse_otel_dropped_spans 7/);
  });
});

describe('generated SLO assets — consistent with the declared objectives', () => {
  test('the Grafana SLO dashboard has a stat + trend panel per objective', () => {
    const dash = JSON.parse(fs.readFileSync(path.join(DEPLOY, 'dashboards', 'slo.json'), 'utf8'));
    expect(dash.uid).toBe('motse-slo');
    expect(dash.panels).toHaveLength(slo.objectives.length * 2);
    // Trend panels carry the evidence basis as the panel description.
    const trends = dash.panels.filter((p) => p.type === 'timeseries');
    for (const p of trends) expect(p.description).toMatch(/validation W\d/);
  });

  test('the generated Prometheus SLO rules mirror the declared alerts exactly', () => {
    const doc = yaml.load(fs.readFileSync(path.join(DEPLOY, 'prometheus-slo-alerts.yaml'), 'utf8'));
    const group = doc.groups.find((g) => g.name === 'motse-slo-objectives');
    const declared = slo.objectives.flatMap((o) => (o.alerts || []).map((a) => a.name)).sort();
    const generated = group.rules.map((r) => r.alert).sort();
    expect(generated).toEqual(declared);
    for (const rule of group.rules) {
      expect(rule.labels.slo).toBeTruthy();
      expect(rule.annotations.basis).toMatch(/validation W\d/);
    }
  });

  test('SLO alert names never collide with the base alert rules', () => {
    const base = yaml.load(fs.readFileSync(path.join(DEPLOY, 'prometheus-alerts.yaml'), 'utf8'));
    const baseNames = new Set(base.groups.flatMap((g) => g.rules.map((r) => r.alert)));
    for (const o of slo.objectives) {
      for (const a of o.alerts || []) expect(baseNames.has(a.name)).toBe(false);
    }
  });
});

describe('checked-in validation evidence', () => {
  test('the evidence file exists, is a PASS, and covers the scenarios the SLO bases cite', () => {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
    expect(evidence.verdict).toBe('PASS');
    expect(evidence.checks.every((c) => c.pass)).toBe(true);
    expect(Object.keys(evidence.scenarios)).toEqual(expect.arrayContaining([
      'sustained_load', 'duplicate_requests', 'transaction_volume',
      'outbox_reliability', 'contention', 'chaos', 'exporter', 'overhead', 'log_correlation',
    ]));
    // The alert-quality matrix must show zero false positives/negatives.
    for (const row of evidence.alert_evaluation) expect(row.fired).toBe(row.expected);
  });
});
