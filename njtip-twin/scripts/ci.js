'use strict';
// Continuous Verification pipeline (v0.2). On every change it runs the full assurance
// suite, generates signed + archived evidence, a dashboard, and multi-audience
// reports, and BLOCKS (exit 1) on any critical failure, unresisted attack, failed
// chaos/formal check, architecture drift, or incomplete traceability coverage.
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../src/platform/orchestrator');
const fitness = require('../verification/fitness');
const adversarial = require('../adversarial');
const formal = require('../formal');
const chaos = require('../chaos/chaos');
const { buildMatrix } = require('../src/traceability/engine');
const { mapCompliance } = require('../src/compliance/engine');
const { detect } = require('../src/drift/detector');
const maturityModel = require('../src/maturity/model');
const { buildBundle, renderMarkdown, writeJSON } = require('../src/evidence/evidence');
const { sign, publicKeyPem } = require('../src/evidence/signing');
const { EvidenceArchive } = require('../src/evidence/archive');
const { GovernanceLedger } = require('../src/governance/portal');
const { renderDashboard } = require('../src/dashboard/render');
const reports = require('../src/reports/multi-audience');
const version = require('../src/version');

const OUT = path.join(__dirname, '..', 'evidence-out');

function runAssurance() {
  const twin = build();
  const verification = fitness.map((f) => f.check(twin));
  const adversarialResults = adversarial.runAll((o) => build(o));
  const formalResults = formal.runAll();
  const chaosResults = chaos.runAll((o) => build(o));

  const traceability = buildMatrix({ fitness: verification, sims: adversarialResults, formal: formalResults });
  const compliance = mapCompliance(verification);
  const drift = detect(twin);

  const fitnessPass = verification.every((v) => v.pass);
  const adversarialPass = adversarialResults.every((s) => s.pass);
  const formalPass = formalResults.every((f) => f.pass);
  const chaosPass = chaosResults.every((c) => c.pass);
  const ciPassed = fitnessPass && adversarialPass && formalPass && chaosPass && !drift.drift && traceability.coverage.percentCovered === 100;

  // Human maturity attestations come ONLY from the governance ledger (human-entered).
  let humanAttestations = {};
  try { humanAttestations = new GovernanceLedger(path.join(OUT, 'governance-ledger.json')).maturityAttestations(); } catch (_) {}
  const maturity = maturityModel.assess({ referenceImplementation: true, fitnessPass, adversarialPass, evidenceGenerated: true, ciPassed, humanAttestations });

  const bundle = buildBundle({
    verification, adversarial: adversarialResults, formal: formalResults, chaos: chaosResults,
    traceability, compliance, drift, maturity, version: version.VERSION,
  });
  return { twin, bundle, verification, adversarialResults, formalResults, chaosResults, traceability, compliance, drift, maturity };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const r = runAssurance();
  const digest = r.bundle.meta.contentDigest;

  // Sign + archive (immutable, hash-chained, independently verifiable).
  const signature = sign(digest);
  const archive = new EvidenceArchive(path.join(OUT, 'archive.json'));
  const entry = archive.append(digest, { version: version.VERSION });
  const archiveOk = archive.verify().ok;

  // Assemble the flattened view for dashboard + reports.
  const A = {
    version: version.VERSION, digest, generatedAt: r.bundle.meta.generatedAt, summary: r.bundle.summary,
    verification: r.verification, adversarial: r.adversarialResults, formal: r.formalResults, chaos: r.chaosResults,
    traceability: r.traceability, compliance: r.compliance, drift: r.drift, maturity: r.maturity,
    signature, archiveOk, timestampSeq: entry.timestamp.seq,
  };

  // History (for dashboard trend). Gitignored; rebuilt over runs.
  const histFile = path.join(OUT, 'history.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch (_) {}
  history.push({ at: A.generatedAt, digest, percentEnforced: r.traceability.coverage.percentEnforced, fitnessPassed: r.bundle.summary.fitnessPassed, fitnessTotal: r.bundle.summary.fitnessTotal });
  history = history.slice(-50);
  writeJSON(histFile, history);

  // Write all artifacts.
  writeJSON(path.join(OUT, 'evidence.json'), { ...r.bundle, signature, publicKey: publicKeyPem(), archiveEntry: entry });
  fs.writeFileSync(path.join(OUT, 'REVIEW-REPORT.md'), renderMarkdown(r.bundle));
  fs.writeFileSync(path.join(OUT, 'dashboard.html'), renderDashboard(A, history));
  const rep = reports.generateAll(A);
  const repDir = path.join(OUT, 'reports');
  fs.mkdirSync(repDir, { recursive: true });
  for (const [name, md] of Object.entries(rep)) fs.writeFileSync(path.join(repDir, `${name}.md`), md);

  // Report + gate.
  const s = r.bundle.summary;
  console.log('\n=== NJTIP Twin — Continuous Assurance Gate (v' + version.VERSION + ') ===');
  console.log(`Fitness:        ${s.fitnessPassed}/${s.fitnessTotal} (critical fails ${s.criticalFailures})`);
  console.log(`Adversarial:    ${s.adversarialResisted}/${s.adversarialTotal}`);
  console.log(`Formal proofs:  ${s.formalPassed}/${s.formalTotal}`);
  console.log(`Chaos:          ${s.chaosPassed}/${s.chaosTotal}`);
  console.log(`Traceability:   ${r.traceability.coverage.percentCovered}% covered, ${r.traceability.coverage.percentEnforced}% enforced`);
  console.log(`Drift:          ${r.drift.drift ? 'DETECTED' : 'none'}`);
  console.log(`Maturity:       Level ${r.maturity.achievedLevel}/10 (automated cap ${r.maturity.automatedCap}; 7–10 need human attestation)`);
  console.log(`Digest:         ${digest}`);
  console.log(`Signature:      ${signature.slice(0, 24)}… (Ed25519 synthetic) · archive ${archiveOk ? 'VERIFIED' : 'FAILED'}`);
  console.log(`Artifacts:      evidence.json, REVIEW-REPORT.md, dashboard.html, reports/*.md`);

  if (r.bundle.verdict.blocked) {
    console.error('\n❌ ASSURANCE GATE FAILED — deployment blocked.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ Assurance gate passed — signed evidence generated for human review.');
    console.log('   Evidence ≠ authorization. Production go-live remains a human Oversight Board decision.');
  }
}

if (require.main === module) main();
module.exports = { runAssurance, main };
