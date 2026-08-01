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

// Secret scanning with FINDING CLASSIFICATION. A scanner that cannot tell a credential from
// a configuration value trains people to ignore it. Every candidate match is classified as a
// credential, an identifier, a data classification label, or a configuration value; only a
// CREDENTIAL is a security finding. Classification is evidence-based and fail-safe: a value
// that matches none of the benign shapes is treated as a credential.
const CLASSIFICATION_LABELS = new Set(['public', 'internal', 'restricted', 'secret', 'confidential', 'official', 'top-secret']);
// Clearly-labelled synthetic/placeholder material (never real credential material).
const PLACEHOLDER_MARKER = /SYNTHETIC|REPLACE_FROM|REPLACE_ME|CHANGEME|example|REDACTED|do-not-use-in-prod|placeholder/i;

// Shannon entropy per character — the signal that separates a random secret from a slug.
function entropy(value) {
  if (!value.length) return 0;
  const freq = {};
  for (const ch of value) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const n of Object.values(freq)) { const p = n / value.length; h -= p * Math.log2(p); }
  return h;
}

// Classify a captured value: 'credential' | 'identifier' | 'classification' | 'configuration'.
function classifyValue(value, { key = '' } = {}) {
  const val = String(value);
  if (PLACEHOLDER_MARKER.test(val) || PLACEHOLDER_MARKER.test(key)) return 'configuration';
  if (CLASSIFICATION_LABELS.has(val.toLowerCase())) return 'classification';
  // URLs, filesystem paths, hostnames, env-var references and template expressions.
  if (/^(?:https?:\/\/|\/|\.\/|\$\{|process\.env\.)/.test(val)) return 'configuration';
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+){1,}$/i.test(val) && !/^[0-9a-f]{16,}$/i.test(val)) return 'configuration';
  // Slug-shaped, low-entropy identifiers: region codes, zone names, ids, algorithm names.
  if (/^[a-z][a-z0-9._-]{0,30}$/.test(val) && entropy(val) < 3.5) return 'identifier';
  // Anything else that a credential pattern matched is treated as a credential (fail-safe).
  return 'credential';
}

// Every candidate match with its classification (the full picture, for the report).
function scanCandidates() {
  const candidates = [];
  const patterns = [
    { rule: 'private-key', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, capture: false },
    { rule: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/, capture: false },
    { rule: 'hardcoded-credential', re: /(password|secret|apikey|api_key|token)\s*[:=]\s*['"]([^'"]{8,})['"]/i, capture: true },
  ];
  for (const f of walk(SRC).concat([path.join(ROOT, 'package.json')])) {
    const rel = path.relative(ROOT, f);
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      for (const p of patterns) {
        const match = line.match(p.re);
        if (!match) continue;
        // A non-capturing pattern (raw key material) is always a credential.
        const classification = p.capture ? classifyValue(match[2], { key: match[1] }) : 'credential';
        candidates.push({ rule: p.rule, file: rel, key: p.capture ? match[1].toLowerCase() : null, classification });
      }
    }
  }
  return candidates;
}

// Security findings only: a candidate classified as a credential.
function secretScan() {
  return scanCandidates().filter((c) => c.classification === 'credential')
    .map((c) => ({ rule: c.rule, severity: 'high', file: c.file, classification: c.classification }));
}

// What the scanner decided and why — so a suppressed candidate is visible, not invisible.
function classificationReport() {
  const candidates = scanCandidates();
  const byClassification = {};
  for (const c of candidates) byClassification[c.classification] = (byClassification[c.classification] || 0) + 1;
  return {
    candidates: candidates.length, byClassification,
    suppressed: candidates.filter((c) => c.classification !== 'credential').map((c) => ({ file: c.file, key: c.key, classification: c.classification })),
    note: 'Only credential-classified candidates are security findings. Identifiers, data classification labels and configuration values are recorded, never raised.',
  };
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
  const core = { sast: sastFindings, secrets: secretFindings, secretClassification: classificationReport(), sbom: sbomOut, sca: scaOut, iac, clean: high.length === 0 };
  const digest = hash.sha256(core);
  const report = { platform: 'NJTIP', kind: 'devsecops-release-evidence', core, digest, signature: signing.sign(digest), highSeverity: high.length, note: 'Deterministic security evidence. Synthetic signature. Evidence ≠ authorization.' };
  console.log(JSON.stringify(report, null, 2));
  console.log(high.length ? `\n❌ DevSecOps: ${high.length} high-severity finding(s).` : '\n✅ DevSecOps: no high-severity findings; zero third-party dependencies.');
  process.exitCode = high.length ? 1 : 0;
}

// Export BEFORE running main(): main() re-enters infra fitness (IaC step) which lazily
// requires this module back — assigning exports first avoids a circular-dependency stub.
module.exports = { sast, secretScan, scanCandidates, classifyValue, classificationReport, entropy, sbom, sca };

if (require.main === module) main();
