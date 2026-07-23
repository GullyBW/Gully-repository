'use strict';
// Deterministic evidence signing (Ed25519, Node built-in crypto).
// The key is derived from a fixed SYNTHETIC seed -> the same content always yields
// the same signature (Ed25519 is deterministic), so signed evidence is reproducible
// and independently verifiable. This is a SYNTHETIC signing identity for the twin,
// NOT a production/governance signing key (those are 🔒 human-managed in HSMs).
const crypto = require('node:crypto');

const SEED = crypto.createHash('sha256').update('NJTIP-TWIN-SYNTHETIC-ED25519-SEED').digest(); // 32 bytes

function privateKey() {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

const _priv = privateKey();
const _pub = crypto.createPublicKey(_priv);

function sign(message) {
  return crypto.sign(null, Buffer.from(String(message)), _priv).toString('base64');
}

function verify(message, signatureB64) {
  try {
    return crypto.verify(null, Buffer.from(String(message)), _pub, Buffer.from(signatureB64, 'base64'));
  } catch (_) {
    return false;
  }
}

function publicKeyPem() {
  return _pub.export({ type: 'spki', format: 'pem' });
}

module.exports = { sign, verify, publicKeyPem, synthetic: true };
