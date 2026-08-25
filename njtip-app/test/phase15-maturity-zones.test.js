'use strict';
// Phase 15, Parts 1, 6 & 7 — assumption maturity, zone governance and assumption criticality.
const test = require('node:test');
const assert = require('node:assert');
const asm = require('../src/architecture/assumptions');
const contextMap = require('../src/architecture/context-map');

const DAY = 24 * 3600_000;
const YEAR = 365 * DAY;
const CONTROLS = [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }];
const BASE = {
  statement: 's', rationale: 'r', evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'],
  owner: 'ARB', reviewCadenceDays: 3650, expiresAt: 10 * YEAR, verificationMethod: 'executable-check',
};

// --- Part 1: assumption maturity -------------------------------------------------------------------

test('six maturity levels, each saying what it means and what comes next', () => {
  assert.deepStrictEqual(asm.MATURITY_ORDER, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
  for (const [id, m] of Object.entries(asm.MATURITY_LEVELS)) {
    assert.ok(m.means.length > 25, id);
    assert.ok(m.next, id);
    assert.strictEqual(typeof m.level, 'number', id);
  }
});

test('maturity is derived — a hand-declared level is ignored', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('X', { ...BASE, maturity: 'A5' });
  assert.strictEqual(r.maturity('X', { now: 0, controls: CONTROLS }).maturity, 'A2');
});

test('every level is reached by doing the thing that level names', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  const at = (id) => r.maturity(id, { now: 0, controls: CONTROLS }).maturity;

  r.register('L1', { ...BASE, evidence: [] });
  assert.strictEqual(at('L1'), 'A1');

  r.register('L2', { ...BASE });
  assert.strictEqual(at('L2'), 'A2');

  r.register('L3', { ...BASE });
  r.recordVerification('L3', { holds: true, by: 'Independent Assurance', at: 0 });
  assert.strictEqual(at('L3'), 'A3');

  r.register('L5', { ...BASE });
  r.recordVerification('L5', { holds: true, by: 'Independent Assurance', at: 0 });
  r.recordVerification('L5', { holds: true, by: 'Independent Assurance', at: 1 });
  assert.strictEqual(at('L5'), 'A5');

  // Only an executable check can reach A5; attestation stops at A4.
  r.register('L4', { ...BASE, verificationMethod: 'human-attestation' });
  r.recordVerification('L4', { holds: true, by: 'Independent Assurance', at: 0 });
  r.recordVerification('L4', { holds: true, by: 'Independent Assurance', at: 1 });
  assert.strictEqual(at('L4'), 'A4');
});

test('an owner verifying their own assumption has not verified it', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('SELF', { ...BASE });
  r.recordVerification('SELF', { holds: true, by: 'ARB', at: 0 });   // ARB is the owner
  const m = r.maturity('SELF', { now: 0, controls: CONTROLS });
  assert.strictEqual(m.maturity, 'A2');
  assert.ok(m.blockers.some((b) => /self-check/.test(b)));
});

test('failing or absent evidence pulls an assumption back to A1', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('E', { ...BASE });
  assert.strictEqual(r.maturity('E', { now: 0, controls: CONTROLS }).maturity, 'A2');
  assert.strictEqual(r.maturity('E', { now: 0, controls: [{ id: 'APP-FIT-CONTEXT-MAP', pass: false }] }).maturity, 'A1');
  assert.strictEqual(r.maturity('E', { now: 0, controls: [] }).maturity, 'A1');
});

test('expiry pulls a continuously monitored assumption back below monitoring', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('OLD', { ...BASE, reviewCadenceDays: 30, expiresAt: 100 * DAY });
  r.recordVerification('OLD', { holds: true, by: 'Assurance', at: 0 });
  r.recordVerification('OLD', { holds: true, by: 'Assurance', at: 1 });
  assert.strictEqual(r.maturity('OLD', { now: 0, controls: CONTROLS }).maturity, 'A5');
  assert.strictEqual(r.maturity('OLD', { now: 200 * DAY, controls: CONTROLS }).maturity, 'A3');
});

test('a regression is named and never netted off against improvements', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  const down = r.maturityTrend([{ A: 'A5' }, { A: 'A3' }]);
  assert.strictEqual(down.direction, 'regressed');
  assert.deepStrictEqual(down.regressions.map((x) => x.assumption), ['A']);

  // Three improvements must not hide one regression.
  const mixed = r.maturityTrend([{ A: 'A5', B: 'A1', C: 'A1' }, { A: 'A2', B: 'A4', C: 'A4' }]);
  assert.strictEqual(mixed.direction, 'regressed');
  assert.strictEqual(mixed.improvements.length, 2);
  assert.match(mixed.reason, /Reported separately/);

  assert.strictEqual(r.maturityTrend([{ A: 'A1' }]).direction, 'insufficient-data');
  assert.strictEqual(r.maturityTrend([{ A: 'A1' }, { A: 'A3' }]).direction, 'improving');
});

// --- Part 7: criticality ----------------------------------------------------------------------------

test('verification frequency scales with criticality, and a slow declared cadence is named', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('F', { ...BASE, criticality: 'foundational', reviewCadenceDays: 3650 });
  r.register('I', { ...BASE, criticality: 'informational', reviewCadenceDays: 3650 });
  const f = r.verificationSchedule('F', { now: 0 });
  const i = r.verificationSchedule('I', { now: 0 });
  assert.ok(f.requiredCadenceDays < i.requiredCadenceDays);
  assert.strictEqual(f.cadenceTooSlow, true);
  assert.match(f.reason, /slower than/);
  assert.strictEqual(r.verificationSchedule('F', { now: 200 * DAY }).overdue, true);
});

test('an undeclared criticality is refused, and the default is the middle', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  assert.throws(() => r.register('B', { ...BASE, criticality: 'quite-important' }), /unknown criticality/);
  r.register('D', { ...BASE });
  // Nobody having judged the consequence is a different state from somebody choosing the middle.
  assert.strictEqual(r.criticality('D').declared, false);
  assert.strictEqual(r.criticality('D').criticality, 'important');
  assert.match(r.criticality('D').note, /nobody has judged/);
  r.register('J', { ...BASE, criticality: 'important' });
  assert.strictEqual(r.criticality('J').declared, true);
  assert.strictEqual(r.criticality('J').note, null);
});

test('the estate report is a work queue ordered by criticality, aggregated to the weakest', () => {
  const controls = require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true }));
  const r = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
  const report = r.maturityReport({ now: 0, controls });

  const weakest = report.assumptions.reduce((w, x) => (asm.MATURITY_ORDER.indexOf(x.maturity) < asm.MATURITY_ORDER.indexOf(w) ? x.maturity : w), 'A5');
  assert.strictEqual(report.organizationalMaturity, weakest);
  assert.match(report.maturityBasis, /least mature/);

  assert.ok(report.verificationBacklog.length, 'nothing has been verified, so the backlog cannot be empty');
  for (let n = 1; n < report.verificationBacklog.length; n++) {
    const prev = asm.CRITICALITY_LEVELS[report.verificationBacklog[n - 1].criticality].rank;
    const cur = asm.CRITICALITY_LEVELS[report.verificationBacklog[n].criticality].rank;
    assert.ok(cur <= prev, 'backlog is not ordered by criticality');
  }
  for (const row of report.assumptions) assert.ok(row.nextStep, row.assumption);
  assert.ok(report.belowMinimum.length);
  assert.strictEqual(report.authorizes, false);
});

test('the platform declares its own load-bearing assumptions as foundational', () => {
  const r = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
  const foundational = r.all().filter((a) => a.criticality === 'foundational').map((a) => a.id);
  // ASM-0006 carries seven of the nine; ASM-0001 carries three.
  assert.ok(foundational.includes('ASM-0006'));
  assert.ok(foundational.includes('ASM-0001'));
});

// --- Part 6: zone governance ------------------------------------------------------------------------

test('every bounded context declares all six governance properties with a rationale', () => {
  assert.strictEqual(contextMap.ids().length, 30);
  for (const id of contextMap.ids()) {
    const g = contextMap.zoneGovernance(id);
    for (const p of contextMap.ZONE_PROPERTIES) {
      assert.ok(g[p.field] !== undefined && g[p.field] !== null, `${id}.${p.field}`);
      assert.ok(p.set.has(g[p.field]), `${id}.${p.field} = ${g[p.field]}`);
    }
    assert.ok(g.zoneRationale.length > 30, id);
  }
  assert.strictEqual(contextMap.validate().zoneGovernanceDeclared, 30);
});

test('an undeclared or unknown value refuses composition', () => {
  const probe = (patch) => {
    const original = { ...contextMap.ZONE_GOVERNANCE.intake };
    Object.assign(contextMap.ZONE_GOVERNANCE.intake, patch);
    const result = contextMap.validate();
    Object.assign(contextMap.ZONE_GOVERNANCE.intake, original);
    for (const k of Object.keys(patch)) if (!(k in original)) delete contextMap.ZONE_GOVERNANCE.intake[k];
    return result;
  };
  assert.strictEqual(probe({ zone: undefined }).valid, false);
  assert.strictEqual(probe({ zone: 'atlantis' }).valid, false);
  assert.strictEqual(probe({ classification: 'quite-sensitive' }).valid, false);
  assert.strictEqual(probe({ zoneRationale: null }).valid, false);
  // The probe restores what it changed.
  assert.strictEqual(contextMap.validate().valid, true);
});

test('the architecture-of-record now answers the zone question ADR-0009 recorded as a debt', () => {
  assert.strictEqual(contextMap.zoneGovernance('intake').zone, 'independent');
  assert.strictEqual(contextMap.zoneGovernance('investigation').zone, 'executive');
  assert.strictEqual(contextMap.zoneGovernance('governance-oversight').zone, 'judiciary');

  assert.strictEqual(contextMap.crossesZoneBoundary(['intake', 'investigation']).crosses, true);
  assert.strictEqual(contextMap.crossesZoneBoundary(['intake', 'custody']).crosses, false);
  // A cross-zone context is deployed into every zone and causes no crossing by itself.
  assert.strictEqual(contextMap.crossesZoneBoundary(['assurance', 'resilience']).crosses, false);
  assert.deepStrictEqual(contextMap.crossesZoneBoundary(['intake', 'nowhere']).unknown, ['nowhere']);
});

test('constitutional contexts carry the strongest constraints, and the vocabulary is actually used', () => {
  for (const id of ['intake', 'custody', 'governance-oversight', 'identity-access', 'policy-governance', 'privacy']) {
    const g = contextMap.zoneGovernance(id);
    assert.strictEqual(g.classification, 'constitutional', id);
    assert.strictEqual(g.residency, 'sovereign-only', id);
  }
  assert.strictEqual(contextMap.zoneGovernance('intake').collaboration, 'no-sharing');
  // Every value in each vocabulary should be a real decision somewhere, or it is a setting with one option.
  const all = contextMap.zoneGovernanceAll();
  assert.ok(all.some((g) => g.collaboration === 'open-sharing'));
  assert.ok(all.some((g) => g.failover === 'no-failover'));
  assert.ok(all.some((g) => g.residency === 'unrestricted'));
});
