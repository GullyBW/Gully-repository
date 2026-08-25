'use strict';
// v1.3 enterprise identity + secrets/cert lifecycle: OIDC token revocation + key rotation,
// SAML assertion verification, secrets leasing/rotation, and certificate lifecycle.
const { test } = require('node:test');
const assert = require('node:assert');
const { OidcVerifier, SamlVerifier } = require('../src/adapters/oidc');
const { SecretsManager } = require('../src/adapters/secrets');
const { CertificateManager } = require('../src/adapters/certificates');

test('OIDC: token revocation invalidates a live token', () => {
  const v = new OidcVerifier({ secret: 's', clock: () => 1000 });
  const tok = v.issue({ sub: 'inv-1', role: 'investigator' });
  const ok = v.verify(tok);
  assert.strictEqual(ok.role, 'investigator');
  v.revoke(ok.jti);
  assert.strictEqual(v.verify(tok), null); // revoked
});

test('OIDC: key rotation keeps old tokens valid during the overlap', () => {
  const v = new OidcVerifier({ secret: 'k1-secret', clock: () => 1000 });
  const oldTok = v.issue({ sub: 'a', role: 'admin' }); // signed with k1
  const kid = v.rotateKey('k2-secret');
  assert.strictEqual(kid, 'k2');
  const newTok = v.issue({ sub: 'b', role: 'admin' }); // signed with k2
  // Both verify (JWKS overlap): the verifier picks the key by kid.
  assert.ok(v.verify(oldTok));
  assert.ok(v.verify(newTok));
  assert.ok(v.jwks().some((k) => k.kid === 'k2' && k.active));
});

test('SAML: signed assertion verifies and maps to a role; tamper/expiry rejected', () => {
  let now = 1000;
  const s = new SamlVerifier({ secret: 'saml', clock: () => now });
  const a = s.issue({ sub: 'gov-1', role: 'oversight-board', ttlMs: 500 });
  assert.deepStrictEqual(s.verify(a), { principal: 'gov-1', role: 'oversight-board', kind: 'saml' });
  assert.strictEqual(s.verify(a.slice(0, -2) + 'xx'), null); // tamper
  now += 600; assert.strictEqual(s.verify(a), null);         // expiry
});

test('Secrets: lease on read, versioned rotation, metadata never leaks the value', () => {
  let now = 0;
  const sm = new SecretsManager({ clock: () => now, leaseMs: 100, source: { DB_PASSWORD: 'p1' } });
  const r = sm.get('DB_PASSWORD');
  assert.strictEqual(r.value, 'p1');
  assert.strictEqual(r.lease.ttlMs, 100);
  sm.rotate('DB_PASSWORD', 'p2');
  assert.strictEqual(sm.get('DB_PASSWORD').value, 'p2');
  assert.strictEqual(sm.get('DB_PASSWORD').version, 2);
  // status()/list() expose metadata only — never the secret value.
  const st = sm.status('DB_PASSWORD');
  assert.strictEqual(st.currentVersion, 2);
  assert.ok(!('value' in st));
  assert.ok(JSON.stringify(sm.list()).indexOf('p2') === -1);
});

test('Certificates: lifecycle states, rotation-due detection, and revocation list', () => {
  let now = 0;
  const cm = new CertificateManager({ clock: () => now, renewBeforeMs: 10 });
  const c = cm.issue({ subject: 'njtip-app.gov.bw', validForMs: 100 });
  assert.strictEqual(cm.status(c.serial).state, 'active');
  now = 95; // within renewBefore window
  assert.strictEqual(cm.status(c.serial).state, 'renew-due');
  assert.deepStrictEqual(cm.dueForRotation(), [c.serial]);
  const next = cm.rotate(c.serial);
  assert.strictEqual(cm.status(next.serial).supersedes, c.serial);
  now = 200; // original expired
  assert.strictEqual(cm.status(c.serial).state, 'expired');
  // Revocation.
  cm.revoke(next.serial, 'key-compromise');
  assert.strictEqual(cm.status(next.serial).state, 'revoked');
  assert.ok(cm.isRevoked(next.serial));
});
