'use strict';
// INFRASTRUCTURE & OPERATIONAL fitness functions — the Twin's assurance extended from
// architecture/code to the DEPLOYMENT and OPERATIONS layer (Phase 8). Each converts an
// operational invariant (k8s hardening, network default-deny, deploy-gate, config
// validation, HA/scalability, DR round-trip, drift) into a pass/violations check in the
// SAME shape as the code fitness functions. A failing check == a failing build.
//
// Manifests are validated by asserting invariants on their text (zero-dependency; no YAML
// parser). These are STRUCTURAL guarantees, not a full schema validation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const configMod = require('../src/config');
const { MemorySqlDriver } = require('../src/adapters/drivers/sql-driver');
const { SqlStore } = require('../src/adapters/sql-store');

const K8S = path.join(__dirname, '..', 'deploy', 'k8s');
const read = (f) => { try { return fs.readFileSync(path.join(K8S, f), 'utf8'); } catch (_) { return ''; } };

function fit(id, title, fn) {
  return { id, title, check() { const v = []; try { fn(v); } catch (e) { v.push('check threw: ' + e.message); } return { id, title, pass: v.length === 0, violations: v }; } };
}

// A stable signature of the deployment's security-relevant invariants → drift detection.
function infraSignature() {
  const dep = read('deployment.yaml'); const np = read('networkpolicy.yaml'); const hpa = read('hpa.yaml'); const pdb = read('pdb.yaml');
  const facts = {
    runAsNonRoot: /runAsNonRoot:\s*true/.test(dep),
    readOnlyRootFilesystem: /readOnlyRootFilesystem:\s*true/.test(dep),
    dropAll: /drop:\s*\[["']?ALL/.test(dep),
    hasLiveness: /livenessProbe/.test(dep),
    hasReadiness: /readinessProbe/.test(dep),
    hasLimits: /limits:/.test(dep),
    defaultDeny: /default-deny-all/.test(np),
    hpaMin: (hpa.match(/minReplicas:\s*(\d+)/) || [])[1],
    hpaMax: (hpa.match(/maxReplicas:\s*(\d+)/) || [])[1],
    pdbMin: (pdb.match(/minAvailable:\s*(\d+)/) || [])[1],
  };
  return { facts, digest: crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex') };
}

module.exports = [
  fit('INFRA-FIT-K8S-HARDENING', 'Deployment pod is hardened (non-root, RO rootfs, drop caps, limits, probes)', (v) => {
    const d = read('deployment.yaml');
    if (!d) return v.push('deployment.yaml missing');
    if (!/runAsNonRoot:\s*true/.test(d)) v.push('missing runAsNonRoot: true');
    if (!/readOnlyRootFilesystem:\s*true/.test(d)) v.push('missing readOnlyRootFilesystem: true');
    if (!/allowPrivilegeEscalation:\s*false/.test(d)) v.push('missing allowPrivilegeEscalation: false');
    if (!/drop:\s*\[["']?ALL/.test(d)) v.push('capabilities are not dropped (ALL)');
    if (!/limits:/.test(d)) v.push('missing resource limits');
    if (!/livenessProbe/.test(d) || !/readinessProbe/.test(d)) v.push('missing liveness/readiness probes');
  }),

  fit('INFRA-FIT-NETWORK-DEFAULT-DENY', 'NetworkPolicy is default-deny with only required egress', (v) => {
    const np = read('networkpolicy.yaml');
    if (!np) return v.push('networkpolicy.yaml missing');
    if (!/default-deny-all/.test(np)) v.push('no default-deny NetworkPolicy');
    if (!/policyTypes:\s*\[Ingress,\s*Egress\]/.test(np)) v.push('default-deny does not cover both Ingress and Egress');
    // Namespaces per zone (constitutional isolation).
    if (!/njtip\.zone:\s*independent/.test(read('namespace.yaml'))) v.push('per-zone namespaces missing');
  }),

  fit('INFRA-FIT-DEPLOY-GATE', 'Container runs the assurance gate before serving; has healthcheck', (v) => {
    const df = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8'); } catch (_) { return ''; } })();
    if (!df) return v.push('Dockerfile missing');
    if (!/scripts\/assure\.js\s*&&\s*node\s+src\/server\.js/.test(df)) v.push('container does not run the assurance gate before serving (fail-closed startup)');
    if (!/HEALTHCHECK/.test(df)) v.push('no container HEALTHCHECK');
    if (!/USER\s+njtip/.test(df)) v.push('container does not run as a non-root user');
  }),

  fit('INFRA-FIT-CONFIG-VALIDATION', 'Config fails closed on invalid input and redacts secrets', (v) => {
    for (const bad of [{ NJTIP_PERSISTENCE: 'bogus' }, { NJTIP_KMS: 'bogus' }, { NJTIP_BROKER: 'bogus' }, { NJTIP_CACHE: 'bogus' }, { NJTIP_SECRETS: 'bogus' }]) {
      let threw = false; try { configMod.load(bad); } catch (_) { threw = true; }
      if (!threw) v.push('accepted invalid config: ' + JSON.stringify(bad));
    }
    const red = configMod.redacted(configMod.load({}));
    if (red.SESSION_SECRET !== '***REDACTED***') v.push('SESSION_SECRET not redacted');
  }),

  fit('INFRA-FIT-HA-SCALABILITY', 'HA + horizontal scaling are configured (replicas, HPA, PDB)', (v) => {
    const sig = infraSignature().facts;
    if (!(Number(sig.hpaMin) >= 2)) v.push('HPA minReplicas < 2 (no HA)');
    if (!(Number(sig.hpaMax) > Number(sig.hpaMin))) v.push('HPA maxReplicas not greater than minReplicas');
    if (!(Number(sig.pdbMin) >= 2)) v.push('PodDisruptionBudget minAvailable < 2');
    if (!/replicas:\s*[3-9]/.test(read('deployment.yaml'))) v.push('Deployment replicas < 3');
  }),

  fit('INFRA-FIT-DR-BACKUP-RESTORE', 'Disaster recovery: data + integrity survive a backup/restore round-trip', (v) => {
    // Write into a "primary", back it up (dump), restore into a fresh "replica", compare.
    const d1 = new MemorySqlDriver(); const primary = new SqlStore('independent', 'reports', d1);
    primary.put('NJ-1', { case_code: 'NJ-1', status: 'received' });
    primary.put('NJ-2', { case_code: 'NJ-2', status: 'reviewed' });
    const backup = primary.keys().map((k) => [k, primary.get(k)]);
    const d2 = new MemorySqlDriver(); const restored = new SqlStore('independent', 'reports', d2);
    for (const [k, val] of backup) restored.put(k, val);
    if (restored.size() !== primary.size()) v.push('restore lost records');
    if (JSON.stringify(restored.get('NJ-2')) !== JSON.stringify(primary.get('NJ-2'))) v.push('restore corrupted a record');
  }),

  fit('INFRA-FIT-DEVSECOPS', 'No dangerous code patterns or hardcoded secrets (SAST + secret scan)', (v) => {
    const { sast, secretScan } = require('../scripts/devsecops');
    for (const f of sast().filter((x) => x.severity === 'high')) v.push(`SAST ${f.rule} in ${f.file}`);
    for (const f of secretScan()) v.push(`secret ${f.rule} in ${f.file}`);
  }),

  fit('INFRA-FIT-PLATFORM-LIFECYCLE', 'IaC invariants asserted, no secrets in config, supported platform, zero third-party deps', (v) => {
    const { InfrastructureAssurance } = require('../src/infra/infrastructure-assurance');
    const ia = new InfrastructureAssurance();
    // Every declared Infrastructure-as-Code invariant is present in the manifests.
    const iac = ia.validateIac();
    for (const f of iac.findings) v.push(`IaC ${f.rule} in ${f.file}: ${f.detail}`);
    // Dependency inventory: the supply-chain surface stays built-ins only.
    const deps = ia.dependencyInventory();
    if (deps.thirdPartyCount !== 0) v.push(`third-party dependencies present: ${deps.thirdPartyCount}`);
    if (!deps.engines || !deps.engines.node) v.push('no engine constraint declared for the runtime');
    // Platform lifecycle: nothing in use past its support window (assessed at a fixed epoch
    // so the check is deterministic; the operational view uses real time).
    const unsupported = ia.detectUnsupported({ now: Date.UTC(2026, 7, 1) });
    for (const c of unsupported.unsupported) v.push(`unsupported platform component: ${c.component}`);
    // A restore must reproduce the source — an unverified backup is not a backup.
    if (!ia.verifyBackup().verified) v.push('backup/restore verification failed');
  }),

  fit('INFRA-FIT-DRIFT', 'Infrastructure matches the recorded baseline (no unreviewed drift)', (v) => {
    const baselineFile = path.join(__dirname, 'infra-baseline.json');
    const current = infraSignature();
    let baseline;
    try { baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')); } catch (_) { baseline = null; }
    if (!baseline) { v.push('no infra baseline recorded (run scripts/infra-baseline.js to record after review)'); return; }
    if (baseline.digest !== current.digest) {
      const changed = Object.keys(current.facts).filter((k) => String(current.facts[k]) !== String((baseline.facts || {})[k]));
      v.push(`infrastructure drift detected in: ${changed.join(', ') || 'unknown'} (review, then re-baseline)`);
    }
  }),
];

module.exports.infraSignature = infraSignature;
