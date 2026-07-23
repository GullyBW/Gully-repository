'use strict';
// SYNTHETIC envelope encryption for the Digital Engineering Twin ONLY.
// -------------------------------------------------------------------
// This demonstrates the *control flow* (content is ciphertext at rest, keys are
// per-zone, keys are not co-located with ciphertext). It is NOT the production
// cryptographic subsystem: real KMS/HSM + threshold key custody are
// 🔒 HUMAN-EXPERT-BUILT and ISRB-signed (blueprint DDR-10, phase6/10, phase7/04).
// Keys here are derived from a fixed synthetic seed and are clearly labelled.
const crypto = require('node:crypto');

const SYNTHETIC_SEED = 'SYNTHETIC-TWIN-KEY-MATERIAL-NOT-REAL';

function zoneKey(zone) {
  // Per-zone key derivation (synthetic). Real zones use independent HSM hierarchies.
  return crypto.createHash('sha256').update(`${SYNTHETIC_SEED}:${zone}`).digest();
}

// Envelope-encrypt plaintext with a per-object data key wrapped by the zone key.
function envelopeEncrypt(zone, plaintext) {
  const dataKey = crypto.randomBytes(32); // per-object data key
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Wrap the data key with the zone key (the "envelope").
  const kek = zoneKey(zone);
  const wivec = crypto.randomBytes(12);
  const wrap = crypto.createCipheriv('aes-256-gcm', kek, wivec);
  const wrapped = Buffer.concat([wrap.update(dataKey), wrap.final()]);
  const wtag = wrap.getAuthTag();
  return {
    zone,
    algorithm: 'aes-256-gcm',
    synthetic: true,
    keyRef: `synthetic-kms://${zone}`, // reference only; key never stored with ciphertext
    cipher: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    wrappedKey: wrapped.toString('base64'),
    wrapIv: wivec.toString('base64'),
    wrapTag: wtag.toString('base64'),
  };
}

function decrypt(blob) {
  const kek = zoneKey(blob.zone);
  const unwrap = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(blob.wrapIv, 'base64'));
  unwrap.setAuthTag(Buffer.from(blob.wrapTag, 'base64'));
  const dataKey = Buffer.concat([
    unwrap.update(Buffer.from(blob.wrappedKey, 'base64')),
    unwrap.final(),
  ]);
  const dec = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(blob.iv, 'base64'));
  dec.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([dec.update(Buffer.from(blob.cipher, 'base64')), dec.final()]).toString('utf8');
}

// A blob "looks like plaintext" only if it is a raw string. Ciphertext blobs are objects
// with .cipher/.synthetic. Used by the encryption fitness function + exfiltration SIM.
function isCiphertext(blob) {
  return !!(blob && typeof blob === 'object' && blob.cipher && blob.algorithm && blob.synthetic);
}

module.exports = { envelopeEncrypt, decrypt, isCiphertext, zoneKey };
