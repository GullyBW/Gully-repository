'use strict';

const { world, adminUser, liveCampaign } = require('./helpers');
const { AiRegistry } = require('../src/ai/registry');
const { AiEvaluator } = require('../src/ai/evaluation/evaluator');
const { SecurityScorecard } = require('../src/security/scorecard');
const { PluginManager } = require('../src/plugins/plugin.manager');
const { Store } = require('../src/kernel/store');
const { Clock } = require('../src/kernel/clock');
const { AuditLog } = require('../src/platform/governance/auditLog');

describe('AI evaluator — skipped-capability paths', () => {
  test('a registry with no providers reports every metric as skipped (score 1, n 0)', () => {
    const w = world();
    const bareAi = new AiRegistry({ media: w.p.media, heritage: w.p.heritage, audit: w.p.audit, clock: w.p.clock });
    const evaluator = new AiEvaluator({ ai: bareAi, clock: w.p.clock, audit: w.p.audit });
    const report = evaluator.evaluate('test');
    for (const metric of ['translation', 'search', 'recommendation', 'summarization', 'tagging']) {
      expect(report.metrics[metric].n).toBe(0);
      expect(report.metrics[metric].detail).toContain('skipped');
    }
    expect(report.passed).toBe(true); // nothing configured → nothing failing
  });

  test('evaluator runs without an audit sink', () => {
    const w = world();
    const evaluator = new AiEvaluator({ ai: w.p.ai, clock: w.p.clock, audit: null });
    expect(() => evaluator.evaluate()).not.toThrow();
  });

  test('empty injected datasets score 0 for every metric (denominator guard)', () => {
    const w = world();
    const empty = { TRANSLATION: [], SEARCH: [], RECOMMENDATION: [], SUMMARIZATION: [], TAGGING: [] };
    const evaluator = new AiEvaluator({ ai: w.p.ai, clock: w.p.clock, audit: w.p.audit, datasets: empty });
    const report = evaluator.evaluate('test');
    for (const metric of ['translation', 'search', 'recommendation', 'summarization', 'tagging']) {
      expect(report.metrics[metric].score).toBe(0); // total===0 → the :0 branch
      expect(report.metrics[metric].n).toBe(0);
    }
  });

  test('providers returning empty results score zero (denominator guards)', () => {
    const w = world();
    const { AiProvider } = require('../src/ai/registry');
    const mk = (name, capability, fn) => {
      const p = new AiProvider(name, capability);
      p.run = fn;
      return p;
    };
    // Register providers that return nothing useful → the evaluator's
    // empty-result branches are exercised and the metrics score low.
    w.p.ai.register(mk('empty-search', 'knowledge_search', () => ({ results: [] })));
    w.p.ai.register(mk('empty-rec', 'recommendation', () => ({ recommendations: [] })));
    // A summary that leaks a forbidden term (weather) → violated branch = 0.
    w.p.ai.register(mk('bad-sum', 'summarization', () => ({ summary: 'the weather was mild that day' })));
    w.p.ai.register(mk('bad-tag', 'tagging', () => ({ tags: [], entities: [] })));
    const report = w.p.aiEvaluator.evaluate('test');
    expect(report.metrics.search.score).toBe(0);
    expect(report.metrics.recommendation.score).toBe(0);
    expect(report.metrics.tagging.score).toBe(0);
    expect(report.passed).toBe(false);
  });
});

describe('Security scorecard — grade bands', () => {
  test('grade() maps score bands', () => {
    const { grade } = require('../src/security/scorecard');
    expect(grade(96)).toBe('A');
    expect(grade(88)).toBe('B');
    expect(grade(72)).toBe('C');
    expect(grade(55)).toBe('D');
    expect(grade(10)).toBe('F');
  });

  test('a degraded platform can drop to a low grade with multiple failing controls', () => {
    const w = world();
    const admin = adminUser(w.p);
    // Break several controls at once.
    w.p.clock.advance(91 * 24 * 3600 * 1000);
    w.p.ops.openIncident({ severity: 'sev1', title: 'x', source: 's:1' }, admin.id);
    w.p.assurance.raise('impossible_travel', 'high', { subjectRef: w.mma.id });
    w.p.payments.retryQueue.deadLetters.push({ label: 'stuck' });
    w.p.fraud.reviews.insert({ id: 'frw_x', check: 'x', state: 'open', ts: w.p.clock.nowIso() });
    const card = w.p.securityScorecard.generate();
    expect(card.failing.length).toBeGreaterThanOrEqual(4);
    expect(['C', 'D', 'F']).toContain(card.grade);
  });
});

describe('Plugin manager — router, host guard, exact semver', () => {
  function bareManager() {
    const store = new Store();
    const clock = new Clock();
    const audit = new AuditLog(store, clock);
    const platform = { store, clock, ledger: { balance: () => 0, accountsFor: () => [] }, bus: { subscribe() {} } };
    return new PluginManager({ store, clock, audit, platform, signingSecret: 's' });
  }

  test('install rejects a manifest missing name or version', () => {
    const w = world();
    const admin = adminUser(w.p);
    const register = () => ({});
    const bad = { manifest: { version: '1.0.0' }, register }; // no name
    bad.codeHash = require('../src/kernel/ids').sha256(String(register));
    bad.signature = w.p.plugins.sign(bad.manifest, bad.codeHash);
    expect(() => w.p.plugins.install(bad, admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  test('a workflow action handler that throws fails the instance', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.workflows.registerHandler('boom', () => { throw new Error('handler exploded'); });
    w.p.workflows.defineWorkflow(
      { key: 'explode', steps: [{ id: 'boom', type: 'action', action: 'boom' }] },
      admin.id
    );
    const inst = w.p.workflows.start('explode', { actor: admin.id });
    const done = w.p.workflows.get(inst.id);
    expect(done.state).toBe('failed');
    expect(done.step_states[0].state).toBe('failed');
  });

  test('host.require throws for an ungranted permission; exact-version dependency', () => {
    const mgr = bareManager();
    let host;
    const register = (h) => { host = h; return {}; };
    const manifest = { name: 'guarded', version: '1.0.0', api_version: '1.0.0', permissions: ['ledger:read'] };
    const codeHash = require('../src/kernel/ids').sha256(String(register));
    mgr.install({ manifest, register, codeHash, signature: mgr.sign(manifest, codeHash) }, 'admin');
    expect(() => host.require('events:publish')).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
    // Exact-version dependency match.
    const depManifest = { name: 'exactdep', version: '1.0.0', api_version: '1.0.0', dependencies: { guarded: '1.0.0' }, permissions: [] };
    const dr = () => ({});
    const dh = require('../src/kernel/ids').sha256(String(dr) + 'exactdep');
    expect(() => mgr.install({ manifest: depManifest, register: dr, codeHash: dh, signature: mgr.sign(depManifest, dh) }, 'admin')).not.toThrow();
  });

  test('every permission facet is granted and usable when declared', () => {
    const w = world();
    const admin = adminUser(w.p);
    let host;
    const manifest = {
      name: 'omni', version: '1.0.0', api_version: '1.0.0',
      permissions: [
        'identity:read', 'ledger:read', 'ledger:write', 'search:read', 'search:index',
        'events:subscribe', 'events:publish', 'notifications:send', 'audit:append', 'store:namespaced',
      ],
    };
    const register = (h) => { host = h; return {}; };
    const codeHash = require('../src/kernel/ids').sha256(String(register) + 'omni');
    w.p.plugins.install({ manifest, register, codeHash, signature: w.p.plugins.sign(manifest, codeHash) }, admin.id);

    // Exercise each granted capability facet.
    expect(host.getUser(w.mma.id).id).toBe(w.mma.id); // identity:read
    expect(host.attestMembership(w.mma.id, 'bakalanga')).toBe(true);
    const acc = host.openAccount('plugin-owner', 'user_wallet'); // ledger:write
    const acc2 = host.openAccount('plugin-owner2', 'provider_clearing');
    host.transfer({ // ledger:write transfer facet
      source: acc2.id, dest: acc.id, amountMinor: 10, purpose: 'plugin', ref: 'p:1', idempotencyKey: 'pl-tx',
    });
    expect(host.balance(acc.id)).toBe(10); // ledger:read
    expect(host.accountsFor('plugin-owner').length).toBe(1);
    expect(host.search('nothing here', {})).toHaveProperty('results'); // search:read
    expect(host.reindex()).toHaveProperty('documents'); // search:index
    host.register('ext.omni.thing', 1, ['x']); // events:publish
    let seen = 0;
    host.subscribe('ext.omni.thing', () => { seen += 1; }); // events:subscribe
    host.publish('ext.omni.thing', { x: 1 });
    expect(seen).toBe(1);
    host.notify(w.mma.id, { category: 'general', title: 'Plugin says hi', body: null }); // notifications:send
    expect(w.p.notifications.inboxFor(w.mma.id).some((n) => n.title === 'Plugin says hi')).toBe(true);
    host.append(w.mma.id, 'did_thing', 'omni:1', null, { ok: true }); // audit:append
    expect(w.p.audit.events.find((e) => e.action === 'plugin:omni:did_thing').length).toBe(1);
    const col = host.collection('widgets'); // store:namespaced
    col.insert({ id: 'wgt_1', name: 'x' });
    expect(w.p.store.collections.has('plugin_omni_widgets')).toBe(true);
    expect(host.permissions).toHaveLength(10);
  });

  test('an action step with no handler is skipped rather than failing the flow', () => {
    const w = world();
    const admin = adminUser(w.p);
    // Define a workflow whose action handler is optional and unregistered.
    w.p.workflows.defineWorkflow(
      { key: 'opt', steps: [{ id: 'noop', type: 'action', action: 'ghost.handler', optional_handler: true }] },
      admin.id
    );
    const inst = w.p.workflows.start('opt', { actor: admin.id });
    expect(w.p.workflows.get(inst.id).state).toBe('completed'); // skipped, not failed
    expect(w.p.workflows.get(inst.id).step_states[0].state).toBe('skipped');
  });
});

describe('Precise branch coverage', () => {
  test('all workflow condition operators route correctly', () => {
    const w = world();
    const admin = adminUser(w.p);
    const wf = w.p.workflows;
    const cases = [
      { op: 'eq', value: 5, ctx: 5, skip: false }, { op: 'eq', value: 5, ctx: 6, skip: true },
      { op: 'ne', value: 5, ctx: 6, skip: false }, { op: 'ne', value: 5, ctx: 5, skip: true },
      { op: 'gt', value: 5, ctx: 6, skip: false }, { op: 'gt', value: 5, ctx: 5, skip: true },
      { op: 'lt', value: 5, ctx: 4, skip: false }, { op: 'lt', value: 5, ctx: 5, skip: true },
      { op: 'lte', value: 5, ctx: 5, skip: false }, { op: 'lte', value: 5, ctx: 6, skip: true },
      { op: 'in', value: [1, 2, 3], ctx: 2, skip: false }, { op: 'in', value: [1, 2], ctx: 9, skip: true },
    ];
    cases.forEach((c, i) => {
      const key = `cond_${i}`;
      wf.defineWorkflow(
        { key, steps: [{ id: 's', type: 'approval', roles: [], condition: { field: 'v', op: c.op, value: c.value } }] },
        admin.id
      );
      const inst = wf.start(key, { context: { v: c.ctx }, actor: admin.id });
      const state = wf.get(inst.id).step_states[0].state;
      // skipped condition → step 'skipped' and workflow completes; else it waits 'active'.
      expect(state).toBe(c.skip ? 'skipped' : 'active');
    });
  });

  test('i18n leaves an unprovided interpolation placeholder intact', () => {
    const { I18n } = require('../src/i18n/i18n');
    const i18n = new I18n();
    i18n.addPack('en', { 'x.y': 'Hello {name} from {place}' });
    // Only one param provided → the other placeholder is preserved.
    expect(i18n.t('x.y', { locale: 'en', params: { name: 'Kabo' } })).toBe('Hello Kabo from {place}');
    // t() with no options object at all.
    expect(i18n.t('x.y')).toContain('{name}');
  });

  test('paypal parseWebhook tolerates a resource without an amount', () => {
    const w = world();
    const paypal = w.p.payments.provider('paypal');
    const parsed = paypal.parseWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: 'x' } });
    expect(parsed.amount_minor).toBeUndefined();
    const noResource = paypal.parseWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED' });
    expect(noResource.provider_ref).toBeUndefined();
  });

  test('developer: default transport delivers; a revoked app is skipped in fanout', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dd');
    w.p.identity.grantInstitutional(user.id, { institution: 'U' }, 'system:bootstrap');
    const dev = w.p.developer;
    // No transport set → default sandbox marks deliveries delivered.
    const { app } = dev.createApp(user.id, { name: 'default-tx', scopes: ['events:subscribe'] });
    dev.subscribe(app.id, { eventTypes: ['kgetsi.contribution.received'], url: 'u' });
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 1, contributorRef: w.kabo.id, idempotencyKey: 'dd-1',
    });
    expect(dev.deliveries.find((d) => d.app_id === app.id && d.state === 'delivered').length).toBe(1);

    // Revoke the app → its subscription is skipped on the next event.
    dev.revokeApp(app.id, user.id);
    const before = dev.deliveries.count();
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 1, contributorRef: w.kabo.id, idempotencyKey: 'dd-2',
    });
    expect(dev.deliveries.count()).toBe(before); // no new delivery for the revoked app
  });

  test('defineWorkflow rejects an unknown step type', () => {
    const w = world();
    const admin = adminUser(w.p);
    expect(() =>
      w.p.workflows.defineWorkflow({ key: 'badtype', steps: [{ id: 's', type: 'teleport' }] }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    // A step missing id/type is also rejected.
    expect(() =>
      w.p.workflows.defineWorkflow({ key: 'noid', steps: [{ type: 'approval' }] }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  test('escalation with notifications bound but a step lacking escalate_to is a no-op', () => {
    const w = world();
    const admin = adminUser(w.p);
    const wf = w.p.workflows;
    // notifications ARE bound (default), but this step has no escalate_to.
    wf.defineWorkflow(
      { key: 'noescalate', steps: [{ id: 's', type: 'approval', roles: [], timeout_ms: 100, on_timeout: 'escalate' }] },
      admin.id
    );
    const inst = wf.start('noescalate', { actor: admin.id });
    w.p.clock.advance(200);
    expect(() => wf.tick()).not.toThrow();
    expect(wf.get(inst.id).state).toBe('running'); // escalated (deadline widened), still open
  });

  test('paypal default currency and intent are applied', () => {
    const w = world();
    const paypal = w.p.payments.provider('paypal');
    const order = paypal.createOrder({ amountMinor: 100, ref: 'r' }); // currency+intent default
    expect(paypal._order(order.provider_ref).currency).toBe('USD');
    expect(paypal._order(order.provider_ref).intent).toBe('CAPTURE');
    const viaCollect = paypal.initiateCollection({ amountMinor: 100, ref: 'r2' }); // default currency
    expect(paypal._order(viaCollect.provider_ref).currency).toBe('USD');
  });

  test('developer authenticate with no required scope, and t() with no options', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dns');
    w.p.identity.grantInstitutional(user.id, { institution: 'U' }, 'system:bootstrap');
    const { api_key, app } = w.p.developer.createApp(user.id, { name: 'noscope', scopes: ['public:read'] });
    // authenticate without a required scope → the requiredScope falsy branch.
    const authed = w.p.developer.authenticate(api_key);
    expect(authed.id).toBe(app.id);
    // i18n.t called with no options at all (defaults applied).
    const { I18n } = require('../src/i18n/i18n');
    expect(new I18n().t('greeting.hello')).toBe('Dumela');
  });

  test('plugin install derives a code hash when the package omits one', () => {
    const w = world();
    const admin = adminUser(w.p);
    const register = () => ({});
    const manifest = { name: 'nohash', version: '1.0.0', api_version: '1.0.0', permissions: [] };
    // No codeHash field → the manager derives it from the register source.
    const { sha256 } = require('../src/kernel/ids');
    const signature = w.p.plugins.sign(manifest, sha256(String(register)));
    expect(() => w.p.plugins.install({ manifest, register, signature }, admin.id)).not.toThrow();
  });

  test('developer delivery transport that throws is caught and marked failed', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dt');
    w.p.identity.grantInstitutional(user.id, { institution: 'U' }, 'system:bootstrap');
    const { app } = w.p.developer.createApp(user.id, { name: 'thrower', scopes: ['events:subscribe'] });
    w.p.developer.setTransport({ post: () => { throw new Error('network down'); } });
    w.p.developer.subscribe(app.id, { eventTypes: ['loeto.booking.settled'], url: 'u' });
    // Emit a settle event → delivery attempted, transport throws, caught.
    const experience = w.p.loeto.createExperience(w.mma.id, {
      title: 'x', priceMinor: 1000,
      splitTemplate: { name: 't', version: 1, shares: [{ account_id: w.mmaWallet.id, pct: 100 }] },
    });
    const booking = w.p.loeto.book(experience.id, w.kabo.id, { sourceAccountId: w.kaboWallet.id, idempotencyKey: 'dt-b' });
    w.p.loeto.settle(booking.id, w.mma.id, { idempotencyKey: 'dt-s' });
    expect(w.p.developer.deliveries.find((d) => d.state === 'failed').length).toBe(1);
  });
});

describe('Workflow — notification-less and delegate-audit branches', () => {
  test('a workflow service with no notifications bound still runs approvals', () => {
    const w = world();
    const admin = adminUser(w.p);
    const { WorkflowService } = require('../src/workflow/workflow.service');
    const wf = new WorkflowService({
      store: w.p.store, clock: w.p.clock, identity: w.p.identity,
      audit: w.p.audit, bus: w.p.bus, notifications: null, // no notifications
    });
    wf.registerHandler('noop', () => ({}));
    wf.defineWorkflow(
      { key: 'quiet', steps: [
        { id: 'a', type: 'approval', roles: [{ role: 'platform_admin', scope: 'platform' }], timeout_ms: 100, on_timeout: 'escalate', escalate_to: { role: 'platform_admin', scope: 'platform' } },
      ] },
      admin.id
    );
    const inst = wf.start('quiet', { actor: admin.id });
    // Timeout escalation with no notifications must not throw.
    w.p.clock.advance(200);
    expect(() => wf.tick()).not.toThrow();
    wf.decide(inst.id, 'a', admin.id, { decision: 'approve' });
    expect(wf.get(inst.id).state).toBe('completed');
  });
});
