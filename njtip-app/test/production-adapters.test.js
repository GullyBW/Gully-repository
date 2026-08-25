'use strict';
// Tests for the v1.2 production adapters (behind stable ports): KMS/encryption-at-rest,
// evidence object store (ciphertext-only), message broker (PII-free outbox), OIDC token
// verification, and staff notification providers (anonymity boundary). All exercise the
// PORT contract that production drivers must satisfy.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeKeyManager, SyntheticKeyManager } = require('../src/adapters/kms');
const { ObjectStore, makeObjectStore } = require('../src/adapters/object-store');
const { MessageBroker } = require('../src/adapters/broker');
const { OidcVerifier } = require('../src/adapters/oidc');
const { CaptureProvider, NotificationDispatcher, makeNotificationProviders } = require('../src/adapters/notify-providers');

test('KMS: envelope round-trip; keys not co-located with ciphertext', () => {
  const km = makeKeyManager();
  assert.ok(km instanceof SyntheticKeyManager);
  const blob = km.encrypt('executive', 'synthetic evidence body');
  assert.ok(km.isCiphertext(blob));
  assert.notStrictEqual(JSON.stringify(blob), 'synthetic evidence body');
  assert.strictEqual(km.decrypt(blob), 'synthetic evidence body');
  // rewrap preserves plaintext but produces a different envelope.
  const rw = km.rewrap('executive', blob);
  assert.strictEqual(km.decrypt(rw), 'synthetic evidence body');
  // Production KMS is human-built and intentionally absent.
  assert.throws(() => makeKeyManager({ kms: 'kms' }), /human-built/);
});

test('ObjectStore: stores ciphertext, REFUSES plaintext, zone-isolated refs', () => {
  const km = makeKeyManager();
  const os = makeObjectStore(km);
  assert.ok(os instanceof ObjectStore);
  const blob = km.encrypt('executive', 'evidence-A');
  const { ref, zone } = os.put('executive', blob);
  assert.strictEqual(zone, 'executive');
  assert.deepStrictEqual(os.get('executive', ref), blob);
  // Plaintext is refused (fail-closed).
  assert.throws(() => os.put('executive', 'raw plaintext'), /refuses plaintext/);
  // A ref in one zone is not visible in another (structural isolation).
  assert.strictEqual(os.get('judiciary', ref), null);
  assert.deepStrictEqual(os.buckets(), ['executive']);
});

test('MessageBroker: outbox drains at-least-once; REFUSES PII/content cross-zone', () => {
  const seen = [];
  const b = new MessageBroker({ clock: () => 1 });
  b.subscribe('case.routed', (p) => seen.push(p));
  b.publish('case.routed', { caseCode: 'NJ-XYZ', recipient: 'dcec', coi: 'clear' });
  assert.strictEqual(b.pending(), 1);
  assert.strictEqual(b.drain(), 1);
  assert.strictEqual(b.pending(), 0);
  assert.deepStrictEqual(seen[0].recipient, 'dcec');
  // Draining again delivers nothing (idempotent per-event).
  assert.strictEqual(b.drain(), 0);
  // PII/content is refused before it can be queued.
  assert.throws(() => b.publish('case.routed', { email: 'a@b.c' }), /refuses PII/);
  assert.throws(() => b.publish('case.routed', { meta: { content: 'secret' } }), /refuses PII/);
});

test('OIDC: verifies signed JWT, maps claims → role; rejects tamper/expiry/bad-issuer', () => {
  let now = 10_000_000;
  const v = new OidcVerifier({ secret: 'idp-secret', clock: () => now });
  const tok = v.issue({ sub: 'inv-042', role: 'investigator', ttlMs: 1000 });
  const claims = v.verify(tok);
  assert.strictEqual(claims.principal, 'inv-042');
  assert.strictEqual(claims.role, 'investigator');
  assert.strictEqual(claims.kind, 'oidc');
  // Tamper → null.
  assert.strictEqual(v.verify(tok.slice(0, -2) + 'xx'), null);
  // Wrong trust anchor → null.
  const other = new OidcVerifier({ secret: 'idp-secret', issuer: 'evil', clock: () => now });
  assert.strictEqual(v.verify(other.issue({ sub: 'x', role: 'admin' })), null);
  // Disallowed role → null (no implicit privilege).
  const badRole = v.issue({ sub: 'x', role: 'superuser' });
  assert.strictEqual(v.verify(badRole), null);
  // Expiry.
  now += 2000; assert.strictEqual(v.verify(tok), null);
});

test('Notify providers: staff-only, no anonymous push, no case content', () => {
  const email = new CaptureProvider('email', { clock: () => 1 });
  email.send({ toPrincipal: 'inv-001', role: 'investigator', reason: 'case-assigned', data: { queueSize: 3 } });
  assert.strictEqual(email.sent()[0].reason, 'case-assigned');
  // No principal (anonymous) → refused.
  assert.throws(() => email.send({ reason: 'x' }), /no anonymous push/);
  // Non-staff role → refused.
  assert.throws(() => email.send({ toPrincipal: 'r', role: 'citizen', reason: 'x' }), /only staff/);
  // Case content → refused.
  assert.throws(() => email.send({ toPrincipal: 'inv-001', role: 'investigator', reason: 'x', data: { content: 'leak' } }), /content must not leave/);
  // Dispatcher fans out to configured channels.
  const d = makeNotificationProviders({ clock: () => 1 });
  assert.ok(d instanceof NotificationDispatcher);
  const res = d.dispatch(['email', 'push'], { toPrincipal: 'adm-001', role: 'admin', reason: 'report-generated', data: {} });
  assert.strictEqual(res.length, 2);
});
