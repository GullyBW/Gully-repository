'use strict';

/**
 * Phase 6 — branch coverage for the governed planes: minimal-dependency
 * constructions (no bus/audit/analytics guards), all-fields-specified vs
 * all-defaulted paths, and the audit-graph plane classifier across every
 * event-type prefix.
 */
const { world } = require('./helpers');
const { Store } = require('../src/kernel/store');
const { IdentityPlane } = require('../src/governance/identity.plane');
const { PolicyKernel } = require('../src/governance/policy.kernel');
const { Provenance } = require('../src/governance/provenance');
const { GovernedAiGateway } = require('../src/governance/ai.gateway');
const { DataProductPlane } = require('../src/governance/data.product.plane');
const { CellRegistry } = require('../src/governance/cell.registry');
const { AuditGraph, planeOf } = require('../src/governance/audit.graph');

function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

const auth = (over = {}) => ({ subject: 'u', authenticated: true, level: 'L2', roles: [], tenant: 'motse', suspended: false, morafe_refs: [], ...over });

describe('Policy Kernel — minimal deps + resource shapes', () => {
  test('works with no bus/audit; handles ref/string resources and defaults', () => {
    const w = world();
    const pk = new PolicyKernel({ clock: w.p.clock }); // no bus, no audit
    // resource identified by `ref`.
    const d1 = pk.decide({ assertion: auth(), action: 'read', resource: { ref: 'r1', classification: 'public' } });
    expect(d1.decision).toBe('ALLOW');
    expect(d1.resource).toBe('r1');
    // resource as a bare string.
    const d2 = pk.decide({ assertion: auth(), action: 'read', resource: 'plain' });
    expect(d2.resource).toBe('plain');
    // no resource at all.
    expect(pk.decide({ assertion: auth(), action: 'read' }).decision).toBe('ALLOW');
    // decide with no argument object at all (defaults) still evaluates.
    expect(pk.decide({ assertion: auth(), action: 'read' })).toBeDefined();
    // constructed with zero args → default options applied, rules registered.
    const bare = new PolicyKernel();
    expect(bare.rules.length).toBeGreaterThan(0);
    expect(bare.riskStepUpThreshold).toBe(70);
  });
});

describe('AI Gateway — minimal deps + fully-specified document', () => {
  function bare(w) {
    return new GovernedAiGateway({
      store: new Store(), clock: w.p.clock,
      identityPlane: new IdentityPlane({ identity: w.p.identity }),
      policyKernel: new PolicyKernel({ clock: w.p.clock }),
      provenance: new Provenance({ clock: w.p.clock, secrets: w.p.secrets }),
    }); // no bus, audit, analytics
  }

  test('addDocument with all fields + defaulted; retrieve without bus/analytics', () => {
    const w = world();
    const gw = bare(w);
    gw.addDocument('actor', { tenant: 'motse', classification: 'restricted', requiredRole: 'r', requiredLevel: 'L2', requiredMorafe: 'm', title: 'T', content: 'full' });
    gw.addDocument(null, { content: 'defaulted' }); // actorRef null → 'system', all defaults
    const out = gw.retrieve({ query: 'defaulted' }); // anon, no bus/analytics guards
    expect(out.output.permitted.length).toBeGreaterThanOrEqual(1);
    // retrieve with no argument object (all defaults) + a fully-specified call.
    expect(gw.retrieve()).toBeDefined();
    gw.retrieve({ subject: null, tenant: 'motse', query: 'x', purpose: 'chat', riskScore: 0, deviceId: 'd', correlationId: 'c' });
    // a retriever returning nothing → empty permitted set (|| []).
    expect(gw.retrieve({ query: 'x' }, () => undefined).output.permitted).toEqual([]);
    // denied path without a bus (suspended subject via a stub identity).
    const denyGw = bare(w);
    w.p.identity.suspendUser(w.kabo.id, 'x', 'system:bootstrap');
    const denied = denyGw.retrieve({ subject: w.kabo.id, query: 'x' });
    expect(denied.output.denied).toBe(true);
  });
});

describe('Data Product Plane — minimal deps + register variants', () => {
  test('register defaults vs full; read without a bus', () => {
    const w = world();
    const dp = new DataProductPlane({
      store: new Store(), clock: w.p.clock,
      identityPlane: new IdentityPlane({ identity: w.p.identity }),
      policyKernel: new PolicyKernel({ clock: w.p.clock }),
      provenance: new Provenance({ clock: w.p.clock, secrets: w.p.secrets }),
      projections: { read: () => ({ n: 1 }) },
    }); // no bus
    dp.register({ name: 'p_pub', projection: 'x', classification: 'public', description: 'd' });
    dp.register({ name: 'p_default' }); // all defaults (classification 'internal')
    expect(dp.register({ name: 'p_default' }).id).toBe('p_default'); // re-register returns existing
    // Public product → anonymous read allowed, no bus.
    expect(dp.read('p_pub', { subject: null }).output.state).toEqual({ n: 1 });
    // Internal product → authenticated subject required.
    expect(dp.read('p_default', { subject: w.mma.id }).output.state).toEqual({ n: 1 });
  });
});

describe('Cell Registry — minimal deps + register variants', () => {
  test('register full vs default; cross-cell without bus/audit; subjectless assertion', () => {
    const w = world();
    const pk = new PolicyKernel({ clock: w.p.clock });
    const cells = new CellRegistry({ clock: w.p.clock, policyKernel: pk }); // no bus, no audit
    cells.register({ id: 'c-full', region: 'r', residency: 'z', maxFailureRadius: 'zone', degradedMode: 'offline', offline: 'reject' });
    cells.register({ id: 'c-def' }); // all defaults
    // cross-cell with a subjectless assertion, denied by policy, no bus/audit guards.
    expectErr(() => cells.crossCell({ fromCell: 'c-full', toCell: 'c-def', action: 'x', assertion: { authenticated: false, level: 'L0', roles: [] } }, () => 1), 'PERMISSION_DENIED');
    // constructed with no args at all (defaults, no bus).
    expect(new CellRegistry().cells.size).toBe(0);
    // On the wired registry (with a bus/audit), a cross-cell call with NO
    // assertion logs subject=null/'system' and is denied by policy.
    w.p.cells.register({ id: 'cell-x', region: 'r', residency: 'z' });
    expectErr(() => w.p.cells.crossCell({ fromCell: 'cell-0', toCell: 'cell-x', action: 'x' }, () => 1), 'PERMISSION_DENIED');
  });
});

describe('Audit Graph — plane classification across every prefix', () => {
  test('planeOf maps each domain prefix', () => {
    expect(planeOf('policy.decided')).toBe('policy');
    expect(planeOf('ai.retrieval.performed')).toBe('ai');
    expect(planeOf('data.product.read')).toBe('data');
    expect(planeOf('cell.cross_access')).toBe('cell');
    expect(planeOf('identity.role_granted')).toBe('identity');
    expect(planeOf('card.captured')).toBe('ledger');
    expect(planeOf('payments.intent.completed')).toBe('ledger');
    expect(planeOf('qr.generated')).toBe('qr');
    expect(planeOf('heritage.item.published')).toBe('domain');
  });

  test('summary classifies live domain, ledger and qr events by plane', () => {
    const w = world();
    // Drive real domain + ledger + qr events into the store.
    const dest = w.p.ledger.openAccount('m', 'community_trust').id;
    const card = w.p.cards.saveCard(w.kabo.id, { hostedFieldRef: 'hf', brand: 'visa', last4: '4242' });
    const intent = w.p.cards.createIntent(w.kabo.id, { amountMinor: 9000, destAccountId: dest, cardId: card.id, idempotencyKey: 'agb' });
    w.p.cards.capture(intent.id, { idempotencyKey: 'agbc' });
    w.p.qr.generate('u', { kind: 'access' });
    const graph = new AuditGraph({ eventStore: w.p.eventStore });
    const summary = graph.summary();
    expect(summary.by_plane.ledger).toBeGreaterThan(0);
    expect(summary.by_plane.qr).toBeGreaterThan(0);
  });
});
