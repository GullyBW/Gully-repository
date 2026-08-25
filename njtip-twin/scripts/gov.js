'use strict';
// Governance Review Portal CLI. Records HUMAN decisions into an append-only,
// hash-chained ledger. It never automates authority — it captures a named human's
// judgment + rationale. Usage:
//   node scripts/gov.js record --reviewer "J. Doe" --role "OB chair" \
//        --type readiness --subject "MVP" --verdict approve --rationale "…"
//   node scripts/gov.js attest --reviewer "…" --level 7 --rationale "…"
//   node scripts/gov.js history
//   node scripts/gov.js verify
const path = require('node:path');
const { GovernanceLedger } = require('../src/governance/portal');

const LEDGER = path.join(__dirname, '..', 'evidence-out', 'governance-ledger.json');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1];
  return a;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const ledger = new GovernanceLedger(LEDGER);

  if (cmd === 'record') {
    const e = ledger.record({ reviewer: args.reviewer, role: args.role, decisionType: args.type, subject: args.subject, verdict: args.verdict, rationale: args.rationale });
    console.log('Recorded human decision:', JSON.stringify(e.record, null, 2));
  } else if (cmd === 'attest') {
    const e = ledger.record({ reviewer: args.reviewer, role: args.role || 'independent validator', decisionType: 'maturity-attestation', subject: args.level, verdict: 'attest', rationale: args.rationale });
    console.log(`Recorded maturity attestation for level ${args.level}:`, e.record.reviewer);
  } else if (cmd === 'history') {
    console.log(JSON.stringify(ledger.history(), null, 2));
  } else if (cmd === 'verify') {
    console.log('Ledger integrity:', JSON.stringify(ledger.verify()));
  } else {
    console.log('Usage: node scripts/gov.js <record|attest|history|verify> [--flags]');
    console.log('This portal RECORDS human decisions. It does not automate governance authority.');
    process.exitCode = 1;
  }
}

if (require.main === module) main();
