'use strict';
// Record the infrastructure baseline (security-relevant invariants of the k8s manifests +
// Dockerfile) AFTER human review. INFRA-FIT-DRIFT compares the live signature against this
// baseline and fails the build on any unreviewed change. Re-run this ONLY when a manifest
// change has been reviewed and approved — that is the human gate on infrastructure drift.
const fs = require('node:fs');
const path = require('node:path');
const { infraSignature } = require('../verification/infra-fitness');

const out = path.join(__dirname, '..', 'verification', 'infra-baseline.json');
const sig = infraSignature();
fs.writeFileSync(out, JSON.stringify({ ...sig, recordedAt: new Date().toISOString(), note: 'Human-reviewed infrastructure baseline. Drift from this fails the build until re-baselined.' }, null, 2));
console.log(`Recorded infra baseline (digest ${sig.digest.slice(0, 16)}…) to verification/infra-baseline.json`);
