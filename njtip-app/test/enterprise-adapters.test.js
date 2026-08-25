'use strict';
// v1.3 enterprise adapters: cache (TTL/namespacing/session persistence), broker retry +
// dead-letter queue, and object-store versioning + lifecycle — all behind stable ports,
// preserving the PII-free and ciphertext-only invariants.
const { test } = require('node:test');
const assert = require('node:assert');
const { MemoryCache, CacheSessionStore, makeCache } = require('../src/adapters/cache');
const { MessageBroker } = require('../src/adapters/broker');
const { makeKeyManager } = require('../src/adapters/kms');
const { ObjectStore } = require('../src/adapters/object-store');

test('cache: TTL expiry, namespacing isolation, atomic incr', () => {
  let now = 1000;
  const c = new MemoryCache({ clock: () => now });
  c.set('k', { a: 1 }, 100);
  assert.deepStrictEqual(c.get('k'), { a: 1 });
  assert.ok(c.ttl('k') > 0);
  now += 200; // expire
  assert.strictEqual(c.get('k'), null);
  // Namespaces do not collide.
  const a = c.namespace('a'); const b = c.namespace('b');
  a.set('x', 1); b.set('x', 2);
  assert.strictEqual(a.get('x'), 1);
  assert.strictEqual(b.get('x'), 2);
  // incr is atomic and starts from 0.
  assert.strictEqual(c.incr('n'), 1);
  assert.strictEqual(c.incr('n', 4), 5);
  // Non-memory driver fails closed.
  assert.throws(() => makeCache({ cache: 'redis' }), /drop-in/);
});

test('cache session store: distributed revocation is visible across handles', () => {
  const c = new MemoryCache({ clock: () => 1 });
  const s1 = new CacheSessionStore(c);
  const s2 = new CacheSessionStore(c); // another "node" sharing the same cache
  s1.put('jti-1', { role: 'investigator' }, 0);
  assert.strictEqual(s2.active('jti-1'), true);
  s1.revoke('jti-1');
  assert.strictEqual(s2.active('jti-1'), false);
});

test('broker: retry with backoff then dead-letter; replay requeues', () => {
  let now = 0;
  const b = new MessageBroker({ clock: () => now, retry: { maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 100 } });
  let fail = true;
  b.subscribe('t', () => { if (fail) throw new Error('handler down'); });
  b.publish('t', { caseCode: 'NJ-X' });
  // Attempt 1 fails → backoff.
  assert.strictEqual(b.drain(), 0);
  assert.strictEqual(b.pending(), 1);
  now += 10; assert.strictEqual(b.drain(), 0); // attempt 2
  now += 20; assert.strictEqual(b.drain(), 0); // attempt 3 → dead-lettered
  assert.strictEqual(b.pending(), 0);
  assert.strictEqual(b.deadLetters().length, 1);
  assert.strictEqual(b.deadLetters()[0].attempts, 3);
  // Fix the consumer and replay the DLQ → now delivers.
  fail = false;
  assert.strictEqual(b.replayDeadLetters(), 1);
  assert.strictEqual(b.drain(), 1);
  assert.strictEqual(b.deadLetters().length, 0);
});

test('object store: versioning under a logical key + lifecycle expiry (ciphertext-only kept)', () => {
  let now = 0;
  const km = makeKeyManager();
  const os = new ObjectStore(km, { clock: () => now });
  const put = (s) => os.putVersion('executive', 'case-42/evidence', km.encrypt('executive', s));
  put('v1'); now = 10; put('v2'); now = 20; put('v3');
  assert.strictEqual(os.versions('executive', 'case-42/evidence').length, 3);
  // Latest and specific version reads.
  assert.strictEqual(km.decrypt(os.getVersion('executive', 'case-42/evidence')), 'v3');
  assert.strictEqual(km.decrypt(os.getVersion('executive', 'case-42/evidence', 1)), 'v1');
  // keepLatest=2 lifecycle expires the oldest.
  const r = os.applyLifecycle('executive', { keepLatest: 2 });
  assert.strictEqual(r.expired, 1);
  assert.strictEqual(os.getVersion('executive', 'case-42/evidence', 1), null);
  // Legal hold blocks expiry.
  os.setLegalHold('executive', 'case-42/evidence', 2, true);
  now = 10_000;
  const r2 = os.applyLifecycle('executive', { expireAfterMs: 1 });
  assert.strictEqual(km.decrypt(os.getVersion('executive', 'case-42/evidence', 2)), 'v2'); // held
  // Plaintext still refused.
  assert.throws(() => os.putVersion('executive', 'k', 'raw'), /refuses plaintext/);
});
