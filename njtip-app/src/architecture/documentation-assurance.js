'use strict';
// Documentation Assurance Framework (Phase 13, Parts 6 & 7). Extends the architecture bounded
// context, generalising the Phase 12 runbook gate from one document to the whole corpus.
//
// Phase 12 checked that the runbook's API routes existed. That closed the sharpest gap — a route
// renamed in `server.js` leaving the runbook telling an operator to call something that 404s — and
// left everything else: an ADR cross-reference to a decision that was never written, a documented
// npm script that no longer exists, a fitness identifier quoted in a governance document after the
// control was renamed, a link to a document somebody deleted.
//
// The design rule that keeps this from being decorative:
//
//   AN UNPARSEABLE OR UNRESOLVABLE CLAIM IS A FINDING, NOT A SKIP.
//
// The obvious failure mode of a documentation checker is that its extractor quietly stops matching,
// coverage reads 100%, and nothing has been verified for months. So the extractor's own yield is
// checked: a document with no extractable claims is reported, and a corpus below a floor of claims
// fails outright.
//
// What this CANNOT do is execute a shell command, so it does not claim to. A documented command is
// verified to RESOLVE — the npm script exists, the file it runs is present — and the report says
// that is what was checked. Claiming to have run it would be the same lie in the other direction.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');

// What a document can claim, how it is found, and what "resolved" means for it.
const CLAIM_KINDS = {
  'api-route': {
    description: 'An HTTP path a reader is told to call.',
    resolvedMeans: 'A route in src/server.js matches it, by literal or by path pattern.',
    ifWrong: 'An operator calls it under pressure and gets a 404.',
  },
  'npm-command': {
    description: 'An `npm run <script>` a reader is told to run.',
    resolvedMeans: 'The script is defined in package.json.',
    ifWrong: 'The documented procedure cannot be followed at all.',
  },
  'adr-reference': {
    description: 'A citation of ADR-NNNN.',
    resolvedMeans: 'An ADR with that number exists in docs/adr/.',
    ifWrong: 'A decision is cited as authority for something, and the decision does not exist.',
  },
  'doc-link': {
    description: 'A relative markdown link to another file in this repository.',
    resolvedMeans: 'The target file exists on disk.',
    ifWrong: 'The reader is sent to a document that is not there.',
  },
  'fitness-id': {
    description: 'A control identifier quoted as the thing that enforces a claim.',
    resolvedMeans: 'A fitness function of that identifier actually runs.',
    ifWrong: 'A document claims a guarantee is enforced by a control nobody runs.',
  },
  'source-module': {
    description: 'A `src/...` path named as where something lives.',
    resolvedMeans: 'The file exists on disk.',
    ifWrong: 'A reader looking for the implementation cannot find it.',
  },
};

// Documents an operator or a reviewer is actually sent to, and what each is for. A corpus defined by
// a glob would silently start checking scratch files; naming them makes the scope a decision.
//
// `operational-procedure` is the strongest role and is held to PROCEDURE_REQUIREMENTS below.
// `operational-reference` is documentation an operator reads to understand something rather than to
// follow it step by step; holding reference material to a rollback-section requirement would train
// people to add empty sections, which is worse than the gap.
const GOVERNED_DOCUMENTS = {
  'operations/runbook.md': { role: 'operational-procedure', audience: 'operator' },
  'architecture-governance.md': { role: 'governance-documentation', audience: 'reviewer' },
  'context-map.md': { role: 'architecture-documentation', audience: 'reviewer' },
  'governance-ownership.md': { role: 'governance-documentation', audience: 'reviewer' },
  'recovery-framework.md': { role: 'recovery-documentation', audience: 'operator' },
  'multi-region.md': { role: 'operational-reference', audience: 'operator' },
  'zero-trust.md': { role: 'policy-documentation', audience: 'reviewer' },
  'compliance-intelligence.md': { role: 'compliance-reference', audience: 'reviewer' },
  'assumptions.md': { role: 'governance-documentation', audience: 'reviewer' },
  'operations-twin.md': { role: 'operational-reference', audience: 'reviewer' },
  'enterprise-graph.md': { role: 'architecture-documentation', audience: 'reviewer' },
  'evidence-confidence.md': { role: 'governance-documentation', audience: 'reviewer' },
};

// Below this, the extractor has broken rather than the corpus being clean.
const MINIMUM_CLAIMS = 100;

function readIfPresent(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } }

// --- Reality: what actually exists ----------------------------------------------------------------

function serverRoutes() {
  const src = readIfPresent(path.join(ROOT, 'src', 'server.js')) || '';
  const literals = new Set([...src.matchAll(/p === '(\/api\/[^']+)'/g)].map((m) => m[1]));
  const patterns = [...src.matchAll(/p\.match\((\/(?:\\.|\[[^\]]*\]|[^/\\])+\/)\)/g)]
    .map((m) => m[1]).filter((r) => r.includes('api')).map((r) => new RegExp(r.slice(1, -1)));
  return { literals, patterns };
}
function npmScripts() {
  try { return new Set(Object.keys(JSON.parse(readIfPresent(path.join(ROOT, 'package.json'))).scripts || {})); }
  catch (_) { return new Set(); }
}
function adrNumbers() {
  try {
    return new Set(fs.readdirSync(path.join(DOCS, 'adr')).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => Number(f.slice(0, 4))));
  } catch (_) { return new Set(); }
}

// --- Extraction -----------------------------------------------------------------------------------

// Pull every checkable claim out of one document. Each claim carries the raw text it came from, so a
// finding can be traced back to the sentence that made it.
function extractClaims(text, { relativeTo = '' } = {}) {
  const claims = [];
  const add = (kind, value, raw) => claims.push({ kind, value, raw: raw.trim().slice(0, 120) });

  for (const m of text.matchAll(/(\/api\/[A-Za-z0-9/{},:<>_-]*)/g)) {
    const raw = m[1].replace(/[.,)]+$/, '');
    const brace = raw.match(/^(.*)\{([^}]*)\}(.*)$/);
    const variants = brace ? brace[2].split(',').map((o) => `${brace[1]}${o.trim()}${brace[3]}`) : [raw];
    for (const variant of variants) {
      const normalised = variant.replace(/\/$/, '').split('/')
        .map((seg) => (seg.startsWith('<') || seg.startsWith(':') ? 'sample' : seg)).join('/');
      if (normalised.length > 4) add('api-route', normalised, m[0]);
    }
  }
  for (const m of text.matchAll(/npm run ([a-z0-9:-]+)/g)) add('npm-command', m[1], m[0]);
  for (const m of text.matchAll(/ADR-(\d{4})/g)) add('adr-reference', Number(m[1]), m[0]);
  for (const m of text.matchAll(/\]\((\.\.?\/[^)\s#]+)/g)) add('doc-link', path.posix.normalize(path.posix.join(relativeTo, m[1])), m[0]);
  for (const m of text.matchAll(/\b((?:APP-FIT|INFRA-FIT|FIT)-[A-Z0-9-]+)\b/g)) add('fitness-id', m[1], m[0]);
  for (const m of text.matchAll(/`(src\/[A-Za-z0-9/_.-]+\.js)`/g)) add('source-module', m[1], m[0]);
  return claims;
}

// --- Verification ---------------------------------------------------------------------------------

function verifyClaim(claim, { routes, scripts, adrs, controls }) {
  switch (claim.kind) {
    case 'api-route': {
      // A documented placeholder may stand for a word or a number, and a route may constrain which
      // it accepts. Both substitutions are tried — found by this check reporting a documented
      // `as-of/:instant` as unresolvable against a route whose parameter is `(\d+)`.
      const candidates = [claim.value, claim.value.replace(/\/sample\b/g, '/1'), `${claim.value}/sample`, `${claim.value}/1`];
      const ok = candidates.some((c) => routes.literals.has(c) || routes.patterns.some((r) => r.test(c)));
      return { resolved: ok, detail: ok ? 'a route serves this path' : 'no route serves this path' };
    }
    case 'npm-command': {
      const ok = scripts.has(claim.value);
      // Stated precisely: the script is DEFINED. Nothing here executed it.
      return { resolved: ok, detail: ok ? 'defined in package.json (resolved, not executed)' : 'no such npm script is defined' };
    }
    case 'adr-reference':
      return { resolved: adrs.has(claim.value), detail: adrs.has(claim.value) ? 'the ADR exists' : 'no ADR with this number exists' };
    case 'doc-link': {
      const ok = fs.existsSync(path.join(DOCS, claim.value)) || fs.existsSync(path.join(ROOT, claim.value));
      return { resolved: ok, detail: ok ? 'the target file exists' : 'the target file does not exist' };
    }
    case 'fitness-id':
      return { resolved: controls.has(claim.value), detail: controls.has(claim.value) ? 'this control runs' : 'no control of this identifier runs' };
    case 'source-module': {
      const ok = fs.existsSync(path.join(ROOT, claim.value));
      return { resolved: ok, detail: ok ? 'the module exists' : 'no such module' };
    }
    default:
      // An unknown claim kind is a finding, never a pass.
      return { resolved: false, detail: `unknown claim kind '${claim.kind}' — an unrecognised claim is unverified, not verified` };
  }
}

// Verify one document. `missing: true` is itself a finding — a governed document that is not there
// cannot be followed.
function verifyDocument(relative, { controls = [] } = {}) {
  const spec = GOVERNED_DOCUMENTS[relative] || { role: 'unclassified', audience: 'unknown' };
  const file = path.join(DOCS, relative);
  const text = readIfPresent(file);
  if (text === null) {
    return { document: relative, ...spec, missing: true, claims: 0, unresolved: [{ kind: 'document', value: relative, detail: 'the document does not exist' }], sound: false };
  }
  const world = {
    routes: serverRoutes(), scripts: npmScripts(), adrs: adrNumbers(),
    controls: new Set(controls.map((c) => (typeof c === 'string' ? c : c.id))),
  };
  const claims = extractClaims(text, { relativeTo: path.posix.dirname(relative) });
  const results = claims.map((c) => ({ ...c, ...verifyClaim(c, world) }));
  const unresolved = results.filter((r) => !r.resolved);
  const byKind = {};
  for (const r of results) {
    const b = (byKind[r.kind] = byKind[r.kind] || { kind: r.kind, total: 0, resolved: 0 });
    b.total += 1; if (r.resolved) b.resolved += 1;
  }
  return {
    document: relative, ...spec, missing: false,
    claims: claims.length, byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    unresolved: unresolved.map((r) => ({ kind: r.kind, value: r.value, raw: r.raw, detail: r.detail })),
    resolvedCount: results.length - unresolved.length,
    // A governed document from which nothing could be extracted is reported, because that is what a
    // broken extractor looks like from the outside.
    noClaims: claims.length === 0,
    sound: unresolved.length === 0 && claims.length > 0,
  };
}

function documents() { return Object.keys(GOVERNED_DOCUMENTS).sort(); }
function claimKinds() { return Object.entries(CLAIM_KINDS).map(([kind, spec]) => ({ kind, ...spec })); }

// The corpus-wide report.
function verify({ controls = [] } = {}) {
  const rows = documents().map((d) => verifyDocument(d, { controls }));
  const totalClaims = rows.reduce((a, r) => a + r.claims, 0);
  const unresolved = rows.flatMap((r) => r.unresolved.map((u) => ({ document: r.document, ...u })));
  const byKind = {};
  for (const r of rows) for (const b of r.byKind || []) {
    const acc = (byKind[b.kind] = byKind[b.kind] || { kind: b.kind, total: 0, resolved: 0 });
    acc.total += b.total; acc.resolved += b.resolved;
  }
  for (const b of Object.values(byKind)) b.coverage = b.total ? +(b.resolved / b.total).toFixed(4) : null;
  // The extractor guards itself: too few claims means it has stopped matching, and a check that
  // passes because it found nothing to check is worse than no check.
  const extractorSound = totalClaims >= MINIMUM_CLAIMS;
  return {
    documents: rows, documentCount: rows.length,
    claims: totalClaims, minimumClaims: MINIMUM_CLAIMS, extractorSound,
    byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    unresolved, unresolvedCount: unresolved.length,
    missingDocuments: rows.filter((r) => r.missing).map((r) => r.document),
    documentsWithNoClaims: rows.filter((r) => r.noClaims && !r.missing).map((r) => r.document),
    claimKinds: claimKinds(),
    sound: unresolved.length === 0 && extractorSound && rows.every((r) => !r.missing),
    verifiedNotExecuted: 'A documented command is verified to RESOLVE — the script exists — not to succeed. Nothing here runs a shell command, and claiming otherwise would be the same failure in the other direction.',
    failClosed: true, informationalOnly: true, authorizes: false,
  };
}

// --- Part 7: operational procedure verification ---------------------------------------------------
//
// A runbook that resolves every route it names can still be unfollowable: no prerequisites, no
// stated permission, no rollback, nobody to escalate to. These are the sections an operational
// document must carry to be worth opening at 03:00, checked by presence and by content.
const PROCEDURE_REQUIREMENTS = {
  prerequisites: { pattern: /prerequisit|before you (start|begin)|requires?:/i, why: 'An operator must know what has to be true before starting.' },
  permissions: { pattern: /\b(admin|oversight-board|investigator|requireRole|authenticated)\b/i, why: 'A procedure nobody can say who may run is one anybody might.' },
  recoveryTimes: { pattern: /\b(RTO|RPO|\d+\s*(min|minute|hour|h)\b)/i, why: 'An expected duration is what tells an operator whether it is going badly.' },
  dependencies: { pattern: /\b(depends?|dependency|dependencies|requires)\b/i, why: 'What must be available for the procedure to work.' },
  escalation: { pattern: /\b(escalat|Board|ARB|ORB|OB|ISRB)\b/, why: 'Somebody has to be named to escalate to.' },
  rollback: { pattern: /\b(rollback|roll back|revert|restore)\b/i, why: 'A procedure you cannot reverse is a bet.' },
  communication: { pattern: /\b(notify|communicat|inform|report to|announce)\b/i, why: 'Who is told, and when.' },
};

function verifyProcedures({ documentsToCheck = null } = {}) {
  const targets = (documentsToCheck || documents()).filter((d) => (GOVERNED_DOCUMENTS[d] || {}).role === 'operational-procedure');
  const rows = targets.map((relative) => {
    const text = readIfPresent(path.join(DOCS, relative));
    if (text === null) return { document: relative, missing: true, satisfied: [], absent: Object.keys(PROCEDURE_REQUIREMENTS), complete: false };
    const satisfied = [], absent = [];
    for (const [req, spec] of Object.entries(PROCEDURE_REQUIREMENTS)) (spec.pattern.test(text) ? satisfied : absent).push(req);
    return {
      document: relative, missing: false, satisfied, absent,
      complete: absent.length === 0,
      gaps: absent.map((a) => ({ requirement: a, why: PROCEDURE_REQUIREMENTS[a].why })),
    };
  });
  return {
    procedures: rows, count: rows.length,
    requirements: Object.entries(PROCEDURE_REQUIREMENTS).map(([id, s]) => ({ requirement: id, why: s.why })),
    incomplete: rows.filter((r) => !r.complete).map((r) => r.document),
    complete: rows.length > 0 && rows.every((r) => r.complete),
    // Said plainly: presence of a section is not proof the procedure works.
    caveat: 'This checks that an operational document CARRIES each element, not that the procedure succeeds. A rollback section that is wrong passes here and fails in an incident; only a rehearsal catches that.',
    failClosed: true, authorizes: false,
  };
}

function report({ controls = [] } = {}) {
  const verification = verify({ controls });
  const procedures = verifyProcedures({});
  return {
    verification, procedures,
    governedDocuments: Object.entries(GOVERNED_DOCUMENTS).map(([doc, spec]) => ({ document: doc, ...spec })),
    sound: verification.sound && procedures.complete,
    blockers: [
      ...verification.unresolved.map((u) => `${u.document}: ${u.kind} '${u.value}' — ${u.detail}`),
      ...(verification.extractorSound ? [] : [`only ${verification.claims} claims were extracted from ${verification.documentCount} documents — the extractor has stopped working, and a check that finds nothing to check is worse than no check`]),
      ...procedures.incomplete.map((d) => `${d}: incomplete operational procedure`),
    ],
    failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Documentation is verified against the implementation on every build. An unresolvable claim is a finding, never a skip, and the extractor\'s own yield is checked so it cannot pass by matching nothing.',
  };
}

module.exports = {
  CLAIM_KINDS, GOVERNED_DOCUMENTS, PROCEDURE_REQUIREMENTS, MINIMUM_CLAIMS,
  documents, claimKinds, extractClaims, verifyClaim, verifyDocument, verify, verifyProcedures, report,
  serverRoutes, npmScripts, adrNumbers,
};
