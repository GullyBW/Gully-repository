'use strict';
// Phase 9 — Independent Assurance Evidence Package (deterministic + signed).
// Assembles a reproducible package an INDEPENDENT assessor can verify offline: the
// architecture-invariant results (Twin + app fitness), the port/adapter inventory, and the
// domain lifecycle + authorization definitions. The hashed "core" contains NO timestamps,
// absolute paths, or randomness, so the same codebase always yields the same digest and
// Ed25519 signature. Metadata (generatedAt, public key) sits OUTSIDE the hashed core.
//
// Usage:
//   node scripts/evidence-package.js            # print package JSON to stdout
//   node scripts/evidence-package.js --out F     # also write to file F
//   node scripts/evidence-package.js --verify F  # recompute + verify a package file
//
// This is EVIDENCE, not authorization. It supports an independent human assessment; it
// never authorizes production deployment.
const fs = require('node:fs');
const { signing, hash } = require('../src/twin');
const { runTwin, runApp } = require('../src/twin-validate');
const authz = require('../src/authz');
const caseLc = require('../src/domain/case-lifecycle');
const evLc = require('../src/domain/evidence-lifecycle');
const configMod = require('../src/config');

// Deterministic inventory of ports and their reference/production drivers.
const ADAPTER_INVENTORY = [
  { port: 'persistence', interface: 'get/put/values/keys/size/delete', reference: 'MemoryStore|FileStore|SqlStore(MemorySqlDriver)', production: 'PostgreSQL' },
  { port: 'encryption-at-rest', interface: 'encrypt/decrypt/isCiphertext/rewrap', reference: 'SyntheticKeyManager', production: '🔒 KMS/HSM (human-built, ISRB-signed)' },
  { port: 'object-store', interface: 'put/get/has/delete/keys', reference: 'ObjectStore(memory)', production: 'S3|MinIO|GCS' },
  { port: 'broker', interface: 'publish/subscribe/drain', reference: 'MessageBroker(memory outbox)', production: 'Kafka|RabbitMQ|NATS' },
  { port: 'sessions', interface: 'issue/verify/revoke', reference: 'SessionManager(HMAC)', production: 'secrets-manager key' },
  { port: 'federated-auth', interface: 'verify(token)->{principal,role}', reference: 'OidcVerifier(HS256)', production: 'OIDC/OAuth2 IdP (JWKS, FIDO2)' },
  { port: 'staff-notifications', interface: 'send({toPrincipal,role,reason,data})', reference: 'CaptureProvider', production: 'SES|Twilio|FCM' },
];

function buildCore() {
  const twin = runTwin().map((r) => ({ id: r.id, pass: r.pass })).sort((a, b) => a.id.localeCompare(b.id));
  const app = runApp().map((r) => ({ id: r.id, pass: r.pass })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    platform: 'NJTIP',
    version: configMod.load({ NJTIP_PERSISTENCE: 'memory' }).version,
    fitness: { twin, app, twinPassed: twin.filter((r) => r.pass).length, appPassed: app.filter((r) => r.pass).length, allHold: [...twin, ...app].every((r) => r.pass) },
    adapters: ADAPTER_INVENTORY,
    authorization: { rbac: authz.RBAC, mfaRequired: [...authz.MFA_REQUIRED].sort() },
    lifecycles: {
      case: { states: caseLc.STATES, transitions: serializeTransitions(caseLc.TRANSITIONS) },
      evidence: { states: evLc.STATES, transitions: serializeTransitions(evLc.TRANSITIONS) },
    },
    invariants: [
      'zone isolation (no shared DB across constitutional zones)',
      'identity minimization (no reporter identity is ever stored)',
      'ciphertext-only evidence at rest (plaintext refused)',
      'PII-free cross-zone events (identity/content refused)',
      'default-deny authorization with MFA step-up',
      'guarded case/evidence lifecycles (illegal transitions refused)',
      'anonymity boundary (no push to anonymous reporters)',
      'human-accountable governance (decisions recorded, never automated)',
    ],
  };
}

function serializeTransitions(t) { const o = {}; for (const [k, v] of Object.entries(t)) o[k] = [...v].sort(); return o; }

function makePackage() {
  const core = buildCore();
  const digest = hash.sha256(core);
  return {
    core,
    digest,
    signature: signing.sign(digest),
    algorithm: 'ed25519',
    publicKey: signing.publicKeyPem(),
    synthetic: true,
    generatedAt: new Date().toISOString(), // metadata only — NOT part of the hashed core
    note: 'Deterministic assurance evidence for INDEPENDENT review. Reproducible: the same codebase yields the same digest/signature. Evidence ≠ authorization; production go-live is a human decision.',
  };
}

function verifyPackage(pkg) {
  const problems = [];
  const recomputed = hash.sha256(pkg.core);
  if (recomputed !== pkg.digest) problems.push(`digest mismatch: recomputed ${recomputed} ≠ stored ${pkg.digest}`);
  if (!signing.verify(pkg.digest, pkg.signature)) problems.push('signature does not verify against the stored digest');
  if (!pkg.core.fitness.allHold) problems.push('package records failing architecture invariants');
  return { ok: problems.length === 0, problems, digest: recomputed };
}

function main() {
  const argv = process.argv.slice(2);
  const vi = argv.indexOf('--verify');
  if (vi !== -1) {
    const pkg = JSON.parse(fs.readFileSync(argv[vi + 1], 'utf8'));
    const res = verifyPackage(pkg);
    console.log(res.ok ? `✅ Evidence package verified (digest ${res.digest.slice(0, 16)}…).` : '❌ Evidence package INVALID:');
    for (const p of res.problems) console.log('  - ' + p);
    process.exitCode = res.ok ? 0 : 1;
    return;
  }
  const pkg = makePackage();
  const oi = argv.indexOf('--out');
  if (oi !== -1) { fs.writeFileSync(argv[oi + 1], JSON.stringify(pkg, null, 2)); console.error(`Wrote evidence package to ${argv[oi + 1]}`); }
  else console.log(JSON.stringify(pkg, null, 2));
}
if (require.main === module) main();

module.exports = { buildCore, makePackage, verifyPackage, ADAPTER_INVENTORY };
