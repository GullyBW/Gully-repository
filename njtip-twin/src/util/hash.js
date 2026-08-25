'use strict';
// Deterministic hashing helpers (Node built-in crypto only).
const crypto = require('node:crypto');

function sha256(input) {
  const data = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Hash-chain link: bind a record to its predecessor's hash (tamper-evidence).
function chain(prevHash, record) {
  return sha256(`${prevHash || 'GENESIS'}::${JSON.stringify(record)}`);
}

module.exports = { sha256, chain };
