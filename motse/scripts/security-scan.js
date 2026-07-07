'use strict';

/**
 * Continuous dependency scanning (Phase 2, WS6). Runs npm audit and
 * fails the build on high/critical advisories; low/moderate are
 * reported for the security review queue. Run in CI on every push.
 */
const { execSync } = require('child_process');

let raw;
try {
  raw = execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  raw = e.stdout; // npm audit exits nonzero when advisories exist
}
const report = JSON.parse(raw);
const counts = (report.metadata && report.metadata.vulnerabilities) || {};
// eslint-disable-next-line no-console
console.log('Dependency scan:', JSON.stringify(counts));

if ((counts.high || 0) + (counts.critical || 0) > 0) {
  // eslint-disable-next-line no-console
  console.error('FAIL: high/critical advisories present — hold the release (§13.1 supply chain).');
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log('PASS: no high/critical advisories.');
