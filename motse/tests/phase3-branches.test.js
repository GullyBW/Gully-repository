'use strict';

const { world, adminUser, liveCampaign, publishedItem } = require('./helpers');
const { PayPalProvider } = require('../src/payments/paypal.provider');
const { WorkflowService } = require('../src/workflow/workflow.service');
const { DeveloperService } = require('../src/developer/developer.service');
const marketplace = require('../src/plugins/examples/marketplace.plugin');

describe('PayPal provider — edge branches', () => {
  test('parseWebhook covers denied, refunded and dispute event types', () => {
    const w = world();
    const paypal = w.p.payments.provider('paypal');
    const denied = paypal.parseWebhook({
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: { custom_id: 'x', amount: { value: '1.00', currency_code: 'USD' } },
    });
    expect(denied.outcome).toBe('failure');
    const refunded = paypal.parseWebhook({
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { custom_id: 'x', id: 'r1', amount: { value: '1.00', currency_code: 'USD' } },
    });
    expect(refunded.event).toBe('refund');
    const disputed = paypal.parseWebhook({
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: { custom_id: 'x', reason: 'ITEM_NOT_RECEIVED' },
    });
    expect(disputed.outcome).toBe('chargeback');
    const unknown = paypal.parseWebhook({ event_type: 'SOMETHING.ELSE', resource: {} });
    expect(unknown.outcome).toBe('unknown');
  });

  test('order guards: unknown order, bad currency, non-positive amount, wrong-state capture', () => {
    const clock = w2clock();
    const paypal = new PayPalProvider({ clock, secrets: fakeSecrets(clock) });
    expect(() => paypal._order('missing')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => paypal.createOrder({ amountMinor: 100, currency: 'JPY', ref: 'r' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => paypal.createOrder({ amountMinor: 0, currency: 'USD', ref: 'r' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    const order = paypal.createOrder({ amountMinor: 100, currency: 'USD', ref: 'r' });
    paypal.captureOrder(order.provider_ref);
    expect(() => paypal.captureOrder(order.provider_ref)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    expect(() => paypal.authorizeOrder(order.provider_ref)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
  });

  test('fxToBwpMinor rejects an unknown currency', () => {
    const w = world();
    expect(() => w.p.payments.provider('paypal').fxToBwpMinor(100, 'JPY')).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });
});

describe('AI evaluator token-F1 — edge branches', () => {
  const { tokenF1 } = require('../src/ai/evaluation/evaluator');
  test('empty inputs and no-overlap', () => {
    expect(tokenF1('', '')).toBe(1); // both empty → identical
    expect(tokenF1('', 'x')).toBe(0);
    expect(tokenF1('x', '')).toBe(0);
    expect(tokenF1('a b', 'c d')).toBe(0); // no overlap
    expect(tokenF1('a a b', 'a b')).toBeGreaterThan(0); // repeated tokens
  });
});

describe('Workflow engine — edge branches', () => {
  test('condition ops, parallel groups and timer reject/auto-approve', () => {
    const w = world();
    const admin = adminUser(w.p);
    const wf = w.p.workflows;
    // A workflow exercising conditional routing, parallel approvals and a rejecting timer.
    wf.defineWorkflow(
      {
        key: 'branchy',
        steps: [
          { id: 'gate', type: 'approval', roles: [{ role: 'platform_admin', scope: 'platform' }],
            condition: { field: 'amount', op: 'gte', value: 100 } },
          { id: 'p1', type: 'approval', parallel_group: 'g', roles: [{ role: 'platform_admin', scope: 'platform' }] },
          { id: 'p2', type: 'approval', parallel_group: 'g', roles: [{ role: 'platform_admin', scope: 'platform' }] },
          { id: 'done', type: 'timer', timeout_ms: 1000 },
        ],
      },
      admin.id
    );
    // amount < 100 → the gate condition is false and the step is skipped.
    const inst = wf.start('branchy', { context: { amount: 50 }, actor: admin.id });
    expect(inst.step_states.find((s) => s.step_id === 'gate').state).toBe('skipped');
    // Parallel group: both p1 and p2 must complete before advancing.
    wf.decide(inst.id, 'p1', admin.id, {});
    expect(wf.get(inst.id).step_states.find((s) => s.step_id === 'p2').state).toBe('active');
    wf.decide(inst.id, 'p2', admin.id, {});
    // Now parked on the timer.
    expect(wf.get(inst.id).state).toBe('running');
    w.p.clock.advance(2000);
    wf.tick();
    expect(wf.get(inst.id).state).toBe('completed');
  });

  test('timer on_timeout reject and auto_approve variants', () => {
    const w = world();
    const admin = adminUser(w.p);
    const wf = w.p.workflows;
    wf.defineWorkflow(
      { key: 'reject_on_timeout', steps: [{ id: 's', type: 'approval', timeout_ms: 100, on_timeout: 'reject', roles: [] }] },
      admin.id
    );
    const r = wf.start('reject_on_timeout', { actor: admin.id });
    w.p.clock.advance(200);
    wf.tick();
    expect(wf.get(r.id).outcome).toBe('rejected');

    wf.defineWorkflow(
      { key: 'auto_on_timeout', steps: [{ id: 's', type: 'approval', timeout_ms: 100, on_timeout: 'auto_approve', roles: [] }] },
      admin.id
    );
    const a = wf.start('auto_on_timeout', { actor: admin.id });
    w.p.clock.advance(200);
    wf.tick();
    expect(wf.get(a.id).state).toBe('completed');
  });

  test('guards: decide on non-existent/closed, unknown condition op, delegate inactive step', () => {
    const w = world();
    const admin = adminUser(w.p);
    const wf = w.p.workflows;
    expect(() => wf.get('wfi_missing')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    const inst = wf.start('custodian_appointment', {
      context: { council_id: w.p.governance.createCouncil('x', admin.id).id, kind: 'association', holder_ref: w.mma.id, actor_ref: admin.id },
      actor: admin.id,
    });
    expect(() => wf.decide(inst.id, 'nonexistent', admin.id, {})).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => wf.delegate(inst.id, 'nonexistent', admin.id, w.kabo.id, admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    // Unknown condition op throws when evaluated.
    wf.defineWorkflow(
      { key: 'badcond', steps: [{ id: 's', type: 'approval', roles: [], condition: { field: 'x', op: 'nope', value: 1 } }] },
      admin.id
    );
    expect(() => wf.start('badcond', { context: { x: 1 }, actor: admin.id })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  test('escalation notifies the escalation role on timeout', () => {
    const w = world();
    const admin = adminUser(w.p);
    const wf = w.p.workflows;
    const inst = wf.start('identity_verification', {
      context: { user_ref: w.kabo.id, ward_ref: w.ward.id, endorser_ref: w.headman.id },
      actor: w.headman.id,
    });
    w.p.clock.advance(15 * 24 * 3600 * 1000); // past the 14-day SLA
    wf.tick();
    // The escalation target is platform_admin(platform) — admin got notified.
    expect(
      w.p.notifications.inboxFor(admin.id).some((n) => n.title.includes('ESCALATED'))
    ).toBe(true);
    // The step deadline was widened (escalated), not failed.
    expect(wf.get(inst.id).state).toBe('running');
  });
});

describe('Plugin manager — edge branches', () => {
  test('disable when not enabled, enable idempotent, get/unknown, semver ~', () => {
    const w = world();
    const admin = adminUser(w.p);
    const pkg = signed(w, marketplace);
    w.p.plugins.install(pkg, admin.id);
    // Disable before enable is a no-op.
    expect(w.p.plugins.disable('community-marketplace', admin.id).enabled).toBe(false);
    w.p.plugins.enable('community-marketplace', admin.id);
    expect(w.p.plugins.enable('community-marketplace', admin.id).enabled).toBe(true); // idempotent
    expect(w.p.plugins.get('community-marketplace').enabled).toBe(true);
    expect(w.p.plugins.get('nope')).toBeNull();
    expect(() => w.p.plugins.enable('nope', admin.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
    // Tilde semver dependency range.
    const base = pluginPkg(w, { name: 'tildebase', version: '2.3.1' });
    w.p.plugins.install(base, admin.id);
    const dep = pluginPkg(w, { name: 'tildedep', version: '1.0.0', dependencies: { tildebase: '~2.3.0' } });
    expect(() => w.p.plugins.install(dep, admin.id)).not.toThrow();
    const badDep = pluginPkg(w, { name: 'tildebad', version: '1.0.0', dependencies: { tildebase: '~2.4.0' } });
    expect(() => w.p.plugins.install(badDep, admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });
});

describe('Developer service — edge branches', () => {
  test('revoke, unsubscribe, unknown scope, unknown event type, unknown app', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dv');
    w.p.identity.grantInstitutional(user.id, { institution: 'U' }, 'system:bootstrap');
    const dev = w.p.developer;
    expect(() => dev.createApp(user.id, { name: 'x', scopes: ['bogus'] })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    const { app } = dev.createApp(user.id, { name: 'ok', scopes: ['events:subscribe'] });
    expect(() => dev.subscribe(app.id, { eventTypes: [] })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => dev.subscribe(app.id, { eventTypes: ['no.such.event'], url: 'u' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    const sub = dev.subscribe(app.id, { eventTypes: ['loeto.booking.settled'], url: 'u' });
    expect(dev.unsubscribe(sub.id, user.id).cancelled).toBe(true);
    expect(() => dev.unsubscribe('sub_missing', user.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
    expect(() => dev.revokeApp('app_missing', user.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
    // Revoke then authenticate fails.
    const { api_key } = dev.createApp(user.id, { name: 'rev', scopes: ['public:read'] });
    const revApp = dev.listApps(user.id).find((a) => a.name === 'rev');
    dev.revokeApp(revApp.id, user.id);
    expect(() => dev.authenticate(api_key, 'public:read')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    );
    expect(() => dev.authenticate(null)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  test('retryFailedDeliveries flips a delivery to delivered when transport recovers', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dv2');
    w.p.identity.grantInstitutional(user.id, { institution: 'U' }, 'system:bootstrap');
    const dev = w.p.developer;
    const { app } = dev.createApp(user.id, { name: 'flappy', scopes: ['events:subscribe'] });
    let up = false;
    dev.setTransport({ post: () => ({ ok: up }) });
    dev.subscribe(app.id, { eventTypes: ['kgetsi.contribution.received'], url: 'u' });
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 1, contributorRef: w.kabo.id, idempotencyKey: 'rd-1',
    });
    expect(dev.deliveries.find((d) => d.state === 'failed').length).toBe(1);
    up = true; // transport recovers
    const { retried } = dev.retryFailedDeliveries();
    expect(retried).toBe(1);
  });
});

// ── helpers ──────────────────────────────────────────────────────────
function w2clock() {
  const { Clock } = require('../src/kernel/clock');
  return new Clock();
}
function fakeSecrets(clock) {
  const { SecretManager } = require('../src/security/secrets');
  return new SecretManager(clock);
}
function signed(w, mod) {
  const codeHash = require('../src/kernel/ids').sha256(String(mod.register));
  return { manifest: mod.manifest, register: mod.register, codeHash, signature: w.p.plugins.sign(mod.manifest, codeHash) };
}
function pluginPkg(w, { name, version, dependencies = {} }) {
  const manifest = { name, version, api_version: '1.0.0', permissions: [], dependencies };
  const register = () => ({});
  const codeHash = require('../src/kernel/ids').sha256(String(register) + name);
  return { manifest, register, codeHash, signature: w.p.plugins.sign(manifest, codeHash) };
}
