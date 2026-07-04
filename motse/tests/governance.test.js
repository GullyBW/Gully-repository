'use strict';

/**
 * Phase 6 — the four governed DPI planes. Identity Plane (assertions only),
 * Policy Decision Kernel (deterministic, deny-by-default, audited), Governed
 * AI Retrieval Gateway (per-document policy filtering, no raw-store access),
 * Data Product Plane (projections only, signed), cryptographic provenance,
 * cross-plane audit graph, cell-based sovereign isolation, and DPI
 * certification mode.
 */
const { world } = require('./helpers');
const { IdentityPlane } = require('../src/governance/identity.plane');
const { PolicyKernel, DECISIONS } = require('../src/governance/policy.kernel');
const { Provenance } = require('../src/governance/provenance');

function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

// A crafted assertion for deterministic policy tests.
function assertion(over = {}) {
  return { subject: 'u1', authenticated: true, level: 'L1', roles: [], tenant: 'motse', suspended: false, morafe_refs: [], ...over };
}

describe('Identity Plane — assertions only', () => {
  test('anonymous, unknown and known subjects produce assertions', () => {
    const w = world();
    expect(w.p.identityPlane.assert(null).authenticated).toBe(false);
    expect(w.p.identityPlane.assert('usr_missing')).toMatchObject({ authenticated: false, level: 'L0', subject: 'usr_missing' });
    const a = w.p.identityPlane.assert(w.mma.id);
    expect(a.authenticated).toBe(true);
    expect(a.level).toBe(w.p.identity.get(w.mma.id).level);
    expect(a.morafe_refs).toContain('bakalanga');
  });

  test('static predicates hasRole / atLeast', () => {
    expect(IdentityPlane.hasRole(assertion({ roles: [{ role: 'custodian', scope: 'heritage:1' }] }), 'custodian')).toBe(true);
    expect(IdentityPlane.hasRole(assertion({ roles: [{ role: 'custodian', scope: 'heritage:1' }] }), 'custodian', 'heritage:2')).toBe(false);
    expect(IdentityPlane.atLeast(assertion({ level: 'L2' }), 'L2')).toBe(true);
    expect(IdentityPlane.atLeast(assertion({ level: 'L1' }), 'L2')).toBe(false);
  });
});

describe('Policy Decision Kernel — deterministic, deny-by-default', () => {
  test('requires an action; public reads are allowed; determinism holds', () => {
    const w = world();
    expectErr(() => w.p.policy.decide({ assertion: assertion(), tenant: 'motse' }), 'INVALID_ARGUMENT');
    const d1 = w.p.policy.decide({ assertion: assertion({ authenticated: false, level: 'L0' }), action: 'read', resource: { classification: 'public' } });
    const d2 = w.p.policy.decide({ assertion: assertion({ authenticated: false, level: 'L0' }), action: 'read', resource: { classification: 'public' } });
    expect(d1.decision).toBe(DECISIONS.ALLOW);
    expect(d2.decision).toBe(d1.decision);
    expect(d1.reason).toBe(d2.reason); // deterministic (only the decision id differs)
  });

  test('deny rules: suspended, cross-tenant, unauthenticated mutation', () => {
    const w = world();
    expect(w.p.policy.decide({ assertion: assertion({ suspended: true }), action: 'read', resource: { classification: 'public' } }).reason).toBe('subject_suspended');
    expect(w.p.policy.decide({ assertion: assertion(), tenant: 'motse', action: 'read', resource: { tenant: 'other', classification: 'public' } }).reason).toBe('cross_tenant_resource');
    expect(w.p.policy.decide({ assertion: assertion({ tenant: 'ngo' }), tenant: 'motse', action: 'read', resource: { classification: 'public' } }).reason).toBe('cross_tenant_subject');
    expect(w.p.policy.decide({ assertion: assertion({ authenticated: false, level: 'L0' }), action: 'payments.pay' }).reason).toBe('unauthenticated_mutation');
  });

  test('a platform operator may act cross-tenant', () => {
    const w = world();
    const op = assertion({ tenant: 'ngo', roles: [{ role: 'platform_admin', scope: 'platform' }] });
    expect(w.p.policy.decide({ assertion: op, tenant: 'motse', action: 'read', resource: { classification: 'public' } }).decision).toBe(DECISIONS.ALLOW);
  });

  test('restricted content is fail-closed; L2+ or the right role passes', () => {
    const w = world();
    expect(w.p.policy.decide({ assertion: assertion({ authenticated: false, level: 'L0' }), action: 'read', resource: { classification: 'restricted' } }).reason).toBe('restricted_requires_auth');
    expect(w.p.policy.decide({ assertion: assertion({ level: 'L1' }), action: 'read', resource: { classification: 'restricted' } }).reason).toBe('restricted_not_authorized');
    expect(w.p.policy.decide({ assertion: assertion({ level: 'L2' }), action: 'read', resource: { classification: 'restricted' } }).decision).toBe(DECISIONS.ALLOW);
    // restricted + explicit role requirement.
    const custodian = assertion({ level: 'L1', roles: [{ role: 'custodian', scope: 'heritage:1' }] });
    expect(w.p.policy.decide({ assertion: custodian, action: 'read', resource: { classification: 'restricted', required_role: 'custodian', required_scope: 'heritage:1' } }).decision).toBe(DECISIONS.ALLOW);
  });

  test('explicit resource requirements: role, level, morafe', () => {
    const w = world();
    expect(w.p.policy.decide({ assertion: assertion(), action: 'read', resource: { classification: 'public', required_role: 'treasurer', required_scope: 'trust:1' } }).reason).toBe('missing_required_role');
    expect(w.p.policy.decide({ assertion: assertion({ level: 'L1' }), action: 'read', resource: { classification: 'public', required_level: 'L3' } }).reason).toBe('below_required_level');
    expect(w.p.policy.decide({ assertion: assertion({ morafe_refs: ['bangwato'] }), action: 'read', resource: { classification: 'public', required_morafe: 'bakalanga' } }).reason).toBe('not_a_member');
  });

  test('risk-based step-up; deny overrides a step-up', () => {
    const w = world();
    const stepUp = w.p.policy.decide({ assertion: assertion({ level: 'L2' }), action: 'payments.pay', riskScore: 90 });
    expect(stepUp.decision).toBe(DECISIONS.STEP_UP_AUTH);
    expect(stepUp.obligations).toContain('reauthenticate');
    // Same high-risk sensitive action but cross-tenant → DENY wins over step-up.
    const denied = w.p.policy.decide({ assertion: assertion({ tenant: 'ngo' }), tenant: 'motse', action: 'payments.pay', riskScore: 90 });
    expect(denied.decision).toBe(DECISIONS.DENY);
    expect(PolicyKernel.permits(stepUp)).toBe(false);
  });

  test('custom rules compose deterministically and every decision is recorded', () => {
    const w = world();
    w.p.policy.register('block_fridays', ({ action }) => (action === 'read.fridays' ? { decision: DECISIONS.DENY, reason: 'no_fridays' } : null));
    expect(w.p.policy.decide({ assertion: assertion(), action: 'read.fridays' }).reason).toBe('no_fridays');
    // Decisions are event-sourced.
    expect(w.p.eventStore.read({ type: 'policy.decided' }).length).toBeGreaterThan(0);
  });
});

describe('Cryptographic provenance', () => {
  test('sign → verify; detects output tampering and bad signatures', () => {
    const w = world();
    const env = w.p.provenance.sign({ output: { answer: 42 }, eventRefs: ['e1'], policyDecisionId: 'pdk_1', tenant: 'motse' });
    expect(w.p.provenance.verify(env).valid).toBe(true);
    const tampered = { ...env, output: { answer: 43 } };
    expect(w.p.provenance.verify(tampered)).toMatchObject({ valid: false, reason: 'output_tampered' });
    const forged = { output: env.output, provenance: { ...env.provenance, signature: 'deadbeef' } };
    expect(w.p.provenance.verify(forged).valid).toBe(false);
    expect(w.p.provenance.verify({}).reason).toBe('no_provenance');
    expect(w.p.provenance.verify({ output: {}, provenance: {} }).reason).toBe('no_signature');
  });

  test('signatures are stable across key-equivalent serialization order', () => {
    const clock = world().p.clock;
    const secrets = world().p.secrets;
    const prov = new Provenance({ clock, secrets });
    const a = prov.sign({ output: { b: 1, a: 2 }, tenant: 't' });
    // Re-verify with keys in a different insertion order.
    const reordered = { output: { a: 2, b: 1 }, provenance: a.provenance };
    expect(prov.verify(reordered).valid).toBe(true);
  });
});

describe('Governed AI Retrieval Gateway', () => {
  function seed(w) {
    w.p.aiGateway.addDocument('u:admin', { classification: 'public', content: 'Tsodilo public heritage notes' });
    w.p.aiGateway.addDocument('u:admin', { classification: 'restricted', requiredLevel: 'L2', content: 'restricted sacred content' });
    w.p.aiGateway.addDocument('u:admin', { classification: 'public', tenant: 'museum', content: 'other tenant doc' });
  }

  test('per-document policy filtering; restricted never leaks to the unauthorized', () => {
    const w = world();
    seed(w);
    const anon = w.p.aiGateway.retrieve({ subject: null, query: '' });
    expect(anon.output.permitted).toHaveLength(1); // public motse only
    expect(anon.output.filtered_count).toBe(1); // restricted filtered (museum doc excluded by the corpus tenant scope)
    expect(JSON.stringify(anon.output)).not.toContain('sacred');
    expect(w.p.provenance.verify(anon).valid).toBe(true);
    // A retriever that yields a cross-tenant doc → filtered by the gateway.
    const crossTenant = () => [{ id: 'ct', tenant: 'museum', classification: 'public', content: 'x' }];
    expect(w.p.aiGateway.retrieve({ subject: null, tenant: 'motse', query: 'x' }, crossTenant).output.permitted).toHaveLength(0);
  });

  test('an authorized (L3) subject sees restricted content', () => {
    const w = world();
    seed(w);
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Museum' }, 'system:bootstrap'); // → L3
    const out = w.p.aiGateway.retrieve({ subject: w.kabo.id, query: '' });
    expect(out.output.permitted.length).toBe(2); // public + restricted (same motse tenant)
  });

  test('a suspended subject is denied retrieval at the gate', () => {
    const w = world();
    seed(w);
    w.p.identity.suspendUser(w.kabo.id, 'test', 'system:bootstrap');
    const out = w.p.aiGateway.retrieve({ subject: w.kabo.id, query: '' });
    expect(out.output.denied).toBe(true);
    expect(out.output.decision).toBe('DENY');
  });

  test('addDocument requires content; a custom retriever is honoured', () => {
    const w = world();
    expectErr(() => w.p.aiGateway.addDocument('u', { content: '' }), 'INVALID_ARGUMENT');
    const custom = () => [{ id: 'x', classification: 'public', content: 'injected via retriever' }];
    const out = w.p.aiGateway.retrieve({ subject: null, query: 'anything' }, custom);
    expect(out.output.permitted[0].content).toContain('injected');
  });
});

describe('Data Product Plane', () => {
  test('lists products; authorized read is signed; unauthorized denied; unknown 404', () => {
    const w = world();
    expect(w.p.dataProducts.list().find((p) => p.name === 'qr_activity')).toBeTruthy();
    // qr_activity is 'internal' with no required role → an authenticated user may read.
    const env = w.p.dataProducts.read('qr_activity', { subject: w.kabo.id });
    expect(env.output.state).toBeDefined();
    expect(w.p.provenance.verify(env).valid).toBe(true);
    // payments_summary is 'restricted' + platform_admin → an ordinary user is denied.
    expectErr(() => w.p.dataProducts.read('payments_summary', { subject: w.kabo.id }), 'PERMISSION_DENIED');
    // admin can read it.
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    expect(w.p.dataProducts.read('payments_summary', { subject: w.kabo.id }).output.state).toBeDefined();
    expectErr(() => w.p.dataProducts.read('nope', {}), 'NOT_FOUND');
  });
});

describe('Cross-plane audit graph', () => {
  test('traces a correlated request across planes and rolls up by plane', () => {
    const w = world();
    const corr = 'corr-123';
    w.p.policy.decide({ assertion: assertion(), action: 'read', resource: { classification: 'public' }, context: { correlationId: corr } });
    w.p.aiGateway.retrieve({ subject: null, query: 'x', correlationId: corr });
    const trace = w.p.auditGraph.trace(corr);
    expect(trace.complete).toBe(true);
    expect(trace.planes).toEqual(expect.arrayContaining(['policy', 'ai']));
    expect(trace.edges.some((e) => e.kind === 'sequence')).toBe(true);
    const summary = w.p.auditGraph.summary();
    expect(summary.by_plane.policy).toBeGreaterThan(0);
    expect(summary.policy_decisions.ALLOW).toBeGreaterThanOrEqual(1);
  });

  test('an unknown correlation id yields an empty, incomplete trace', () => {
    const w = world();
    expect(w.p.auditGraph.trace('nope')).toMatchObject({ complete: false, nodes: [] });
  });
});

describe('Cell-based sovereign isolation', () => {
  test('registration, same-cell guard, and policy-approved cross-cell access', () => {
    const w = world();
    w.p.cells.register({ id: 'cell-1', region: 'za-north', residency: 'za' });
    expect(w.p.cells.describe().map((c) => c.id)).toEqual(expect.arrayContaining(['cell-0', 'cell-1']));
    expectErr(() => w.p.cells.register({}), 'INVALID_ARGUMENT');
    expectErr(() => w.p.cells.get('ghost'), 'NOT_FOUND');
    expect(w.p.cells.assertSameCell('cell-0', 'cell-0')).toBe(true);
    expectErr(() => w.p.cells.assertSameCell('cell-0', 'cell-1'), 'PERMISSION_DENIED');

    // Cross-cell without the cell_operator role → denied by policy.
    expectErr(() => w.p.cells.crossCell({ fromCell: 'cell-0', toCell: 'cell-1', action: 'settle', assertion: assertion() }, () => 'work'), 'PERMISSION_DENIED');
    // With the role → allowed, logged, and the work runs.
    const op = assertion({ level: 'L3', roles: [{ role: 'cell_operator', scope: 'platform' }] });
    const out = w.p.cells.crossCell({ fromCell: 'cell-0', toCell: 'cell-1', action: 'settle', assertion: op }, () => 'settled');
    expect(out.result).toBe('settled');
    expect(w.p.eventStore.read({ type: 'cell.cross_access' }).length).toBeGreaterThan(0);
  });

  test('failure-containment contract and state transitions', () => {
    const w = world();
    expect(w.p.cells.contract('cell-0')).toMatchObject({ cell: 'cell-0', recovery_strategy: 'event_replay_reconciliation' });
    expect(w.p.cells.setState('cell-0', 'degraded').state).toBe('degraded');
  });
});

describe('DPI Certification Mode', () => {
  test('produces a signed, passing compliance report', () => {
    const w = world();
    // Drive some governed activity.
    w.p.policy.decide({ assertion: assertion(), action: 'read', resource: { classification: 'public' } });
    w.p.aiGateway.addDocument('u:admin', { classification: 'public', content: 'x' });
    w.p.aiGateway.retrieve({ subject: null, query: 'x' });
    const cert = w.p.certification.run();
    expect(cert.output.passed).toBe(true);
    expect(cert.output.checks).toMatchObject({ event_sequence_intact: true, ledger_balanced: true, ai_retrievals_governed: true });
    expect(cert.output.policy.decisions).toBeGreaterThan(0);
    expect(cert.output.ai.retrievals).toBeGreaterThanOrEqual(1);
    expect(w.p.provenance.verify(cert).valid).toBe(true);
  });
});
