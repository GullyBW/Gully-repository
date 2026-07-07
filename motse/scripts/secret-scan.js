'use strict';

/**
 * Repository secret scanning (Phase 3, WS8). Greps the Motse tree for
 * committed credential patterns and fails the build on a hit. Runs in CI
 * alongside the dependency scan. Deliberately conservative — sandbox
 * placeholders and test fixtures are allow-listed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'generic bearer secret', re: /(secret|password|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/]{24,}['"]/i },
];
const ALLOW = [
  /sandbox-/, // sandbox provider secrets
  /dev-bootstrap-token/,
  /motse-[a-z-]*secret/, // documented dev defaults
  /example|placeholder|test|spec|\.md$/i,
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'mobile_flutter']);

let findings = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (!/\.(js|ts|json|ya?ml|env|tf)$/.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const text = fs.readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (ALLOW.some((a) => a.test(line))) return;
      for (const pat of PATTERNS) {
        if (pat.re.test(line)) {
          findings += 1;
          // eslint-disable-next-line no-console
          console.error(`${file}:${i + 1}  possible ${pat.name}`);
        }
      }
    });
  }
}

walk(ROOT);
if (findings > 0) {
  // eslint-disable-next-line no-console
  console.error(`FAIL: ${findings} possible secret(s) committed (§13.1).`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log('PASS: no committed secrets detected.');
