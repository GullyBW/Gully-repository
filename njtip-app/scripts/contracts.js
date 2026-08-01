'use strict';
// Generate the integration-contract artifacts (Stabilization Part 3): the contract
// catalogue, an OpenAPI fragment for the registered API contracts, broker-neutral event
// definitions, and the canonical error model.
//
// Deterministic: no timestamps, no wall-clock, stable ordering — so the output can be diffed
// in review and committed as a contract snapshot.
//
// Usage: node scripts/contracts.js            # print the artifacts; exit non-zero if invalid
//        node scripts/contracts.js --openapi  # print only the OpenAPI fragment
const { ContractRegistry } = require('../src/contracts/integration-contracts');
const { hash, signing } = require('../src/twin');

function generate() {
  const registry = new ContractRegistry();
  const catalogue = registry.catalogue();
  const artifacts = {
    contracts: catalogue.contracts,
    openapi: registry.toOpenApi(),
    events: registry.eventDefinitions(),
    errorModel: catalogue.errorModel,
    versioningPolicy: catalogue.versioningPolicy,
    coverage: catalogue.coverage,
    validation: catalogue.validation,
  };
  const digest = hash.sha256(artifacts);
  return { platform: 'NJTIP', kind: 'integration-contracts', artifacts, digest, signature: signing.sign(digest), note: 'Deterministic contract snapshot. Synthetic signature. Evidence ≠ authorization.' };
}

function main() {
  const out = generate();
  if (process.argv.includes('--openapi')) { console.log(JSON.stringify(out.artifacts.openapi, null, 2)); return; }
  console.log(JSON.stringify(out, null, 2));
  const v = out.artifacts.validation;
  console.log(v.valid
    ? `\n✅ Integration contracts: ${v.contracts} contracts valid; every boundary crossing is covered.`
    : `\n❌ Integration contracts: ${v.violations.length} violation(s).`);
  process.exitCode = v.valid ? 0 : 1;
}

module.exports = { generate };
if (require.main === module) main();
