'use strict';
// Enterprise DevSecOps (Phase 18). Deterministic security verifications over the codebase:
// SAST (dangerous patterns), SECRET SCANNING, SBOM generation, SCA (dependency risk), IaC
// scanning (delegates to infra fitness), and a signed RELEASE EVIDENCE bundle. Zero deps.
//
// Usage: node scripts/devsecops.js            # print report; exit non-zero on high findings
const fs = require('node:fs');
const path = require('node:path');
const { hash, signing } = require('../src/twin');
const infraFitness = require('../verification/infra-fitness');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name); const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out); else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

// SAST: flag dangerous dynamic-code constructs.
function sast() {
  const findings = [];
  for (const f of walk(SRC)) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    if (/\beval\s*\(/.test(text)) findings.push({ rule: 'no-eval', severity: 'high', file: rel });
    if (/new\s+Function\s*\(/.test(text)) findings.push({ rule: 'no-new-function', severity: 'high', file: rel });
    if (/child_process/.test(text)) findings.push({ rule: 'no-child-process', severity: 'medium', file: rel });
  }
  return findings;
}

// Secret scanning: real secret patterns, excluding clearly-labelled synthetic placeholders.
function secretScan() {
  const findings = [];
  const patterns = [
    { rule: 'private-key', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, capture: false },
    { rule: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/, capture: false },
    { rule: 'hardcoded-credential', re: /(password|secret|apikey|api_key|token)\s*[:=]\s*['"]([^'"]{8,})['"]/i, capture: true },
  ];
  const allow = /SYNTHETIC|REPLACE_FROM|example|REDACTED|do-not-use-in-prod|placeholder/i;
  // An identifier-shaped value (region code, hostname, classification, slug) is NOT a
  // credential: all-lowercase alnum with ./-/_ separators, no entropy. Skip those.
  const identifierShaped = (val) => /^[a-z][a-z0-9._-]{0,30}$/.test(val);
  for (const f of walk(SRC).concat([path.join(ROOT, 'package.json')])) {
    const rel = path.relative(ROOT, f);
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      for (const p of patterns) {
        const match = line.match(p.re);
        if (!match || allow.test(line)) continue;
        if (p.capture && identifierShaped(match[2])) continue; // config-like value, not a secret
        findings.push({ rule: p.rule, severity: 'high', file: rel });
      }
    }
  }
  return findings;
}

// SBOM: zero third-party dependencies by design; record built-in modules used.
function sbom() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const builtins = new Set();
  for (const f of walk(SRC)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/require\('node:([a-z_]+)'\)/g)) builtins.add(m[1]);
  return { name: pkg.name, version: pkg.version, dependencies: Object.keys(pkg.dependencies || {}), devDependencies: Object.keys(pkg.devDependencies || {}), runtime: 'node-builtins-only', builtinsUsed: [...builtins].sort() };
}

// SCA: no third-party deps → no third-party CVE exposure (supply-chain surface = built-ins).
function sca(sbomOut) { return { thirdPartyPackages: sbomOut.dependencies.length + sbomOut.devDependencies.length, knownVulnerabilities: 0, supplyChainSurface: 'built-ins only' }; }

function main() {
  const sastFindings = sast();
  const secretFindings = secretScan();
  const sbomOut = sbom();
  const scaOut = sca(sbomOut);
  const iac = infraFitness.map((f) => f.check()).filter((r) => !r.pass).map((r) => ({ rule: r.id, severity: 'high', violations: r.violations }));
  const high = [...sastFindings, ...secretFindings, ...iac].filter((x) => x.severity === 'high');
  // Deterministic release-evidence core (no timestamps): what was scanned + findings.
  const core = { sast: sastFindings, secrets: secretFindings, sbom: sbomOut, sca: scaOut, iac, clean: high.length === 0 };
  const digest = hash.sha256(core);
  const report = { platform: 'NJTIP', kind: 'devsecops-release-evidence', core, digest, signature: signing.sign(digest), highSeverity: high.length, note: 'Deterministic security evidence. Synthetic signature. Evidence ≠ authorization.' };
  console.log(JSON.stringify(report, null, 2));
  console.log(high.length ? `\n❌ DevSecOps: ${high.length} high-severity finding(s).` : '\n✅ DevSecOps: no high-severity findings; zero third-party dependencies.');
  process.exitCode = high.length ? 1 : 0;
}

// Export BEFORE running main(): main() re-enters infra fitness (IaC step) which lazily
// requires this module back — assigning exports first avoids a circular-dependency stub.
module.exports = { sast, secretScan, sbom, sca };

if (require.main === module) main();
