'use strict';
// Architecture Governance Expansion (Phase 10, Part 11). An ADR is only useful if it records
// what a reviewer actually needs: business justification, risk, performance / security /
// operational / compliance impact, rollback, migration, cost, success metrics, a decision owner
// and an approval history.
//
// This module makes that schema EXECUTABLE — it parses `docs/adr/*.md` and validates each one.
// ADRs numbered 0004 and later must satisfy the full schema; 0001–0003 predate it and are held
// to the legacy schema, recorded as a deliberate cutover rather than rewriting decision history.
const fs = require('node:fs');
const path = require('node:path');

const ADR_DIR = path.join(__dirname, '..', '..', 'docs', 'adr');
// The first ADR required to satisfy the expanded schema.
const FULL_SCHEMA_FROM = 4;

// Required sections, as the headings they must appear under.
const FULL_SCHEMA = [
  { field: 'businessJustification', heading: 'Business justification', why: 'An architecture change without a business reason is a preference.' },
  { field: 'riskAssessment', heading: 'Risk assessment', why: 'Naming the risk is what makes accepting it a decision.' },
  { field: 'performanceImpact', heading: 'Performance impact', why: 'Performance regressions are cheapest to catch at decision time.' },
  { field: 'securityImpact', heading: 'Security impact', why: 'Routes the ADR to the ISRB when it needs to go there.' },
  { field: 'operationalImpact', heading: 'Operational impact', why: 'Someone has to run this afterwards.' },
  { field: 'complianceImpact', heading: 'Compliance impact', why: 'Legal mandates are traced to controls; a change may move one.' },
  { field: 'rollbackStrategy', heading: 'Rollback strategy', why: 'A decision you cannot reverse is a bet, not a decision.' },
  { field: 'migrationStrategy', heading: 'Migration strategy', why: 'How existing state and consumers get from here to there.' },
  { field: 'implementationCost', heading: 'Estimated implementation cost', why: 'Cost is part of the trade-off, so it belongs in the record.' },
  { field: 'successMetrics', heading: 'Success metrics', why: 'How we will know afterwards whether this worked.' },
  { field: 'decisionOwner', heading: 'Decision owner', why: 'A decision without an owner cannot be revisited.' },
  { field: 'approvalHistory', heading: 'Approval history', why: 'Who approved, when, and on what basis.' },
];
// The legacy schema every ADR — including the first three — must satisfy.
const LEGACY_SCHEMA = [
  { field: 'context', heading: 'Context' },
  { field: 'decision', heading: 'Decision' },
  { field: 'consequences', heading: 'Consequences' },
  { field: 'alternatives', heading: 'Alternatives considered' },
];

// --- Extended schema (Phase 11, Part 11) --------------------------------------------------------
//
// Applied from ADR-0006 onward, on the same principle as the 0004 expansion: an ADR records what
// was known and required at the time it was written. Retrofitting a later standard onto an earlier
// decision would destroy exactly the thing the record exists to preserve.
const EXTENDED_SCHEMA_FROM = 6;
const EXTENDED_SCHEMA = [
  { field: 'rejectedAlternatives', heading: 'Rejected alternatives', why: 'What we chose not to do, and why — the part future readers most often need and least often find.' },
  { field: 'architecturalTradeoffs', heading: 'Architectural trade-offs', why: 'Every decision buys something with something. Naming the price is the decision.' },
  { field: 'maintenanceImpact', heading: 'Long-term maintenance impact', why: 'Who maintains this in five years, and what does it cost them.' },
  { field: 'implementationComplexity', heading: 'Implementation complexity', why: 'Complexity is a durable cost paid by everyone who reads the code afterwards.' },
  { field: 'operationalCost', heading: 'Operational cost', why: 'Running cost outlives build cost, and is usually the larger number.' },
  { field: 'lifecycleImplications', heading: 'Lifecycle implications', why: 'When this decision expires, what supersedes it, and what has to be revisited.' },
  { field: 'measurableSuccessCriteria', heading: 'Measurable success criteria', why: 'A criterion with no number in it cannot be checked, so it is an intention rather than a criterion.' },
  { field: 'architecturalDebt', heading: 'Architectural debt assessment', why: 'What this decision knowingly leaves unpaid, and when it comes due.' },
];

// --- Governance schema (Phase 12, Part 11) ------------------------------------------------------
//
// Applied from ADR-0007 onward. The extended schema records what a decision COSTS; the governance
// schema records when it gets LOOKED AT AGAIN. Without those two sections an ADR is written once
// and is thereafter permanent by inertia — nobody decided to keep it, they just never revisited it.
const GOVERNANCE_SCHEMA_FROM = 7;
const GOVERNANCE_SCHEMA = [
  { field: 'reviewSchedule', heading: 'Review schedule', why: 'When this decision is next examined, and by whom. A decision nobody has agreed to re-read is permanent by accident.' },
  { field: 'sunsetCriteria', heading: 'Sunset criteria', why: 'The observable conditions under which this decision stops applying. Without them a decision can only be replaced, never retired.' },
];

// --- Merge schema (Phase 18.1, Part 2) ----------------------------------------------------------
//
// Applied from ADR-0012 onward, and it exists because of a specific thing that happened rather than
// a general principle.
//
// Three specifications — Phase 17 Parts 15 and 17, and Phase 18 Part 7 — each asked for fields on
// the executive decision package. Implementing them as three frameworks would have been the exact
// duplication every phase forbids, so they were merged into one guard. That was the right call and
// it was made in a commit message, which is not architectural governance:
//
//   A MERGE IS AN ARCHITECTURAL DECISION. It resolves several stated requirements into one
//   implementation, which means a future reader looking for "Phase 18 Part 7" will find nothing
//   under that name. Without a record naming the requirements it absorbed, the merge is
//   indistinguishable from a requirement that was silently dropped.
//
// So an ADR that records a merge must name what it merged, and the register in this module refuses
// to hold a merge that cites no ADR.
const MERGE_SCHEMA_FROM = 12;
const MERGE_SCHEMA = [
  { field: 'mergedRequirements', heading: 'Merged requirements', why: 'The specification requirements this implementation absorbed. Without them, a merge is indistinguishable from a requirement that was quietly dropped.' },
  { field: 'mergeRationale', heading: 'Merge rationale', why: 'Why one implementation rather than several. A merge made for convenience and one made to prevent duplication look identical afterwards.' },
  { field: 'compatibilityImpact', heading: 'Compatibility impact', why: 'What existing callers of the merged surfaces have to change, and what they do not.' },
  { field: 'implementationStrategy', heading: 'Implementation strategy', why: 'How the requirements were combined, so a reader can check that each one is still satisfied rather than taking it on trust.' },
];

// Sections whose content must actually be measurable — a threshold, a count, a percentage or a
// date. This is the one place the validator reads content rather than structure, because
// "improve reliability" satisfies a heading check and commits to nothing.
const MEASURABLE_SECTIONS = ['Measurable success criteria', 'Success metrics'];
const MEASURABLE_PATTERN = /\d/;

// A review schedule that says "periodically" is not a schedule. It must name a date or an interval.
const DATED_SECTIONS = ['Review schedule'];
const DATED_PATTERN = /(\d{4}-\d{2}-\d{2}|\b\d+\s*(month|months|year|years|quarter|quarters|week|weeks|day|days)\b|\bannual|\bquarterly|\bmonthly)/i;

const STATUSES = ['Proposed', 'Accepted', 'Superseded', 'Rejected'];

function adrFiles() {
  if (!fs.existsSync(ADR_DIR)) return [];
  return fs.readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
}

// Parse one ADR into { number, title, status, sections }.
function parse(file) { return parseText(fs.readFileSync(path.join(ADR_DIR, file), 'utf8'), { file, number: Number(file.slice(0, 4)) }); }

// Parse ADR text without touching the filesystem. Validation must be exercisable on crafted
// content — writing a probe into the real catalogue to prove the validator works would make the
// validator's own test a source of non-determinism for anything else reading that directory.
function parseText(text, { file = '(in-memory)', number = 0 } = {}) {
  const titleMatch = text.match(/^#\s*ADR-\d{4}:\s*(.+)$/m);
  const statusMatch = text.match(/\*\*Status:\*\*\s*([A-Za-z]+)/);
  const sections = {};
  // Section = a `## Heading` and everything until the next `##`.
  const re = /^##\s+(.+?)\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ heading: m[1].trim(), start: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? text.lastIndexOf('\n##', marks[i + 1].start) : text.length;
    sections[marks[i].heading.toLowerCase()] = text.slice(marks[i].start, end).trim();
  }
  return { file, number, title: titleMatch ? titleMatch[1].trim() : null, status: statusMatch ? statusMatch[1] : null, sections, raw: text };
}

// Which schema applies to an ADR number.
function schemaFor(number) {
  if (number >= MERGE_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA, ...EXTENDED_SCHEMA, ...GOVERNANCE_SCHEMA, ...MERGE_SCHEMA];
  if (number >= GOVERNANCE_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA, ...EXTENDED_SCHEMA, ...GOVERNANCE_SCHEMA];
  if (number >= EXTENDED_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA, ...EXTENDED_SCHEMA];
  if (number >= FULL_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA];
  return LEGACY_SCHEMA;
}
function schemaNameFor(number) {
  if (number >= MERGE_SCHEMA_FROM) return 'merge';
  return number >= GOVERNANCE_SCHEMA_FROM ? 'governance' : number >= EXTENDED_SCHEMA_FROM ? 'extended' : number >= FULL_SCHEMA_FROM ? 'full' : 'legacy';
}

// Validate one ADR against the schema that applies to it.
function validateAdr(file, opts = {}) { return validateParsed(parse(file), opts); }

// Validate an already-parsed ADR — the form the crafted-content checks use.
function validateParsed(adr, { minSectionChars = 40 } = {}) {
  const file = adr.file;
  const violations = [];
  if (!adr.title) violations.push('no `# ADR-NNNN: title` heading');
  if (!adr.status) violations.push('no **Status:** line');
  else if (!STATUSES.includes(adr.status)) violations.push(`unknown status '${adr.status}'`);
  const schema = schemaFor(adr.number);
  for (const s of schema) {
    const body = adr.sections[s.heading.toLowerCase()];
    if (body === undefined) violations.push(`missing required section '${s.heading}'${s.why ? ` — ${s.why}` : ''}`);
    else if (body.length < minSectionChars) violations.push(`section '${s.heading}' is present but empty (< ${minSectionChars} chars)`);
    // Phase 11: a success criterion with no number in it commits to nothing.
    else if (MEASURABLE_SECTIONS.includes(s.heading) && !MEASURABLE_PATTERN.test(body)) {
      violations.push(`section '${s.heading}' contains no measurable value — a criterion with no number cannot be checked`);
    }
    // Phase 12: "review periodically" is not a schedule. A date or an interval, or it is nothing.
    else if (DATED_SECTIONS.includes(s.heading) && !DATED_PATTERN.test(body)) {
      violations.push(`section '${s.heading}' names no date or interval — 'periodically' is not a schedule`);
    }
  }
  return {
    file, number: adr.number, title: adr.title, status: adr.status,
    schema: schemaNameFor(adr.number),
    sections: Object.keys(adr.sections),
    supersededBy: supersessionTarget(adr),
    valid: violations.length === 0, violations,
  };
}

// "Superseded by ADR-0007" — parsed so the chain can be checked rather than trusted.
function supersessionTarget(adr) {
  const m = adr.raw.match(/\*\*Status:\*\*\s*Superseded\s+by\s+ADR-(\d{4})/i);
  return m ? Number(m[1]) : null;
}

// Validate the whole catalogue, and check catalogue-level invariants.
function validateCatalogue(options = {}) {
  const files = adrFiles();
  const results = files.map((f) => validateAdr(f, options));
  const violations = [];
  for (const r of results) for (const vi of r.violations) violations.push(`${r.file}: ${vi}`);
  // Numbering must be unique and contiguous from 0001 — a gap means a decision went missing.
  const numbers = results.map((r) => r.number).sort((a, b) => a - b);
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) { violations.push(`ADR numbering is not contiguous: expected ${i + 1}, found ${numbers[i]}`); break; }
    if (numbers.indexOf(numbers[i]) !== i) violations.push(`duplicate ADR number ${numbers[i]}`);
  }
  // Every ADR must be referenced from the governance process document.
  const governanceDoc = path.join(__dirname, '..', '..', 'docs', 'architecture-governance.md');
  if (fs.existsSync(governanceDoc)) {
    const text = fs.readFileSync(governanceDoc, 'utf8');
    for (const r of results) if (!text.includes(r.file)) violations.push(`${r.file} is not listed in the ADR catalogue in architecture-governance.md`);
  } else violations.push('architecture-governance.md is missing — there is no published governance process');
  // Phase 11: supersession must point somewhere real, and nothing may supersede itself.
  const byNumber = new Map(results.map((r) => [r.number, r]));
  for (const r of results) {
    if (r.supersededBy === null) continue;
    if (!byNumber.has(r.supersededBy)) violations.push(`${r.file}: superseded by ADR-${String(r.supersededBy).padStart(4, '0')}, which does not exist`);
    if (r.supersededBy === r.number) violations.push(`${r.file}: supersedes itself`);
    if (r.status !== 'Superseded') violations.push(`${r.file}: names a superseding ADR but its status is '${r.status}'`);
  }
  return {
    adrs: results, count: results.length,
    fullSchemaFrom: FULL_SCHEMA_FROM, extendedSchemaFrom: EXTENDED_SCHEMA_FROM,
    bySchema: results.reduce((acc, r) => ((acc[r.schema] = (acc[r.schema] || 0) + 1), acc), {}),
    lifecycle: lifecycle(results),
    valid: violations.length === 0, violations,
    note: 'ADRs from 0004 satisfy the expanded schema and from 0006 the extended one; earlier ones predate each expansion and are held to the standard in force when they were written rather than being rewritten.',
  };
}

// Decision lifecycle: which decisions are live, which have been replaced, and by what.
function lifecycle(results = null) {
  const rows = results || adrFiles().map((f) => validateAdr(f));
  const byStatus = rows.reduce((acc, r) => ((acc[r.status || 'unknown'] = (acc[r.status || 'unknown'] || 0) + 1), acc), {});
  return {
    total: rows.length, byStatus,
    active: rows.filter((r) => r.status === 'Accepted').map((r) => r.number),
    superseded: rows.filter((r) => r.status === 'Superseded').map((r) => ({ number: r.number, by: r.supersededBy })),
    chains: rows.filter((r) => r.supersededBy !== null).map((r) => `ADR-${String(r.number).padStart(4, '0')} → ADR-${String(r.supersededBy).padStart(4, '0')}`),
    note: 'A decision is live until something explicitly replaces it. An ADR nobody superseded is still in force, whether or not anyone remembers it.',
  };
}

// --- ADR quality reporting (Phase 12, Part 11) ---------------------------------------------------
//
// A pass/fail verdict tells an author their ADR is incomplete. It does not tell a governance board
// whether the catalogue as a whole is decaying, or which dimension it is decaying in. The quality
// report scores each ADR across the dimensions that make a decision record usable years later.
const QUALITY_DIMENSIONS = [
  { id: 'completeness', description: 'Every section the applicable schema requires is present and non-empty.', headings: null },
  { id: 'specificity', description: 'Sections that must contain a number or a date actually do.', headings: [...MEASURABLE_SECTIONS, ...DATED_SECTIONS] },
  { id: 'alternatives', description: 'What was considered, and what was rejected and why.', headings: ['Alternatives considered', 'Rejected alternatives'] },
  { id: 'accountability', description: 'A named decision owner and a recorded approval history.', headings: ['Decision owner', 'Approval history'] },
  { id: 'reviewability', description: 'When this decision is looked at again, and what would retire it.', headings: ['Review schedule', 'Sunset criteria'] },
  { id: 'reversibility', description: 'How to get back, and how existing state gets forward.', headings: ['Rollback strategy', 'Migration strategy'] },
];

// Score one parsed ADR. A dimension whose sections the ADR's schema does not require scores `null`
// — "not applicable" — rather than 0. Scoring an ADR-0001 badly for lacking a section that did not
// exist when it was written would make the report a measure of age rather than of quality.
function qualityScore(adr, { minSectionChars = 40 } = {}) {
  const required = new Set(schemaFor(adr.number).map((s) => s.heading));
  const has = (heading) => {
    const body = adr.sections[heading.toLowerCase()];
    if (body === undefined || body.length < minSectionChars) return false;
    if (MEASURABLE_SECTIONS.includes(heading) && !MEASURABLE_PATTERN.test(body)) return false;
    if (DATED_SECTIONS.includes(heading) && !DATED_PATTERN.test(body)) return false;
    return true;
  };
  const dimensions = QUALITY_DIMENSIONS.map((d) => {
    const headings = (d.headings || [...required]).filter((h) => required.has(h));
    if (!headings.length) return { dimension: d.id, applicable: false, score: null, missing: [], description: d.description };
    const missing = headings.filter((h) => !has(h));
    return {
      dimension: d.id, applicable: true, description: d.description,
      score: +((headings.length - missing.length) / headings.length).toFixed(3),
      missing,
    };
  });
  const applicable = dimensions.filter((d) => d.applicable);
  // AGGREGATE TO THE WEAKEST LINK. An ADR that is complete, specific and accountable but records
  // no way back is not "83% good" — it is a decision you cannot reverse, and the mean hides that.
  const weakest = applicable.reduce((w, d) => (w === null || d.score < w.score ? d : w), null);
  return {
    file: adr.file, number: adr.number, title: adr.title, status: adr.status, schema: schemaNameFor(adr.number),
    dimensions, weakestDimension: weakest ? weakest.dimension : null,
    score: weakest ? weakest.score : null,
    complete: applicable.every((d) => d.score === 1),
    note: 'Scored against the schema in force when the ADR was written. A dimension that schema did not require is not applicable, not a failure.',
  };
}

// The next review date, read from the Review schedule section. An ADR with a schedule that names no
// date is reported as `unknown` — which is a blocker, not a pass. "No date" must never read as
// "not due".
function nextReview(adr) {
  const body = adr.sections['review schedule'];
  if (body === undefined) return { adr: adr.number, scheduled: false, nextReview: null, reason: 'this ADR predates the review-schedule requirement' };
  const m = body.match(/\d{4}-\d{2}-\d{2}/);
  if (!m) return { adr: adr.number, scheduled: true, nextReview: null, reason: 'the review schedule names an interval but no next date — an interval with no anchor cannot become overdue' };
  return { adr: adr.number, scheduled: true, nextReview: m[0], reason: `next reviewed on or before ${m[0]}` };
}

// Which decisions are due to be looked at again. `now` is injected — a governance report that
// changes with the wall clock is not reproducible evidence.
function dueForReview({ now = null, results = null } = {}) {
  const adrs = (results || adrFiles().map((f) => parse(f)));
  const today = now || null;
  const rows = adrs.map((a) => {
    const r = nextReview(a);
    const overdue = today && r.nextReview ? r.nextReview < today : false;
    return { ...r, title: a.title, status: a.status, overdue, undated: r.scheduled && !r.nextReview };
  });
  return {
    now: today, adrs: rows,
    overdue: rows.filter((r) => r.overdue).map((r) => r.adr),
    undated: rows.filter((r) => r.undated).map((r) => r.adr),
    unscheduled: rows.filter((r) => !r.scheduled).map((r) => r.adr),
    scheduledFrom: GOVERNANCE_SCHEMA_FROM,
    note: 'A decision with no scheduled review is permanent by inertia rather than by choice.',
  };
}

// Automatic rejection (Phase 12, Part 11). An incomplete ADR does not enter the catalogue and is
// not "accepted pending sections" — that state is how an incomplete record becomes a permanent one.
// This is deliberately a pure function over TEXT so a proposal can be checked before it is written
// to disk, and so the check itself never mutates the real catalogue.
function admit(text, { number, minSectionChars = 40 } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { admitted: false, rejected: true, rejections: ['an empty proposal is not an ADR'], failClosed: true };
  }
  const n = Number.isFinite(number) ? number : (text.match(/^#\s*ADR-(\d{4})/m) ? Number(text.match(/^#\s*ADR-(\d{4})/m)[1]) : null);
  if (n === null) return { admitted: false, rejected: true, rejections: ['no `# ADR-NNNN: title` heading, so no schema can be selected'], failClosed: true };
  const parsed = parseText(text, { file: `${String(n).padStart(4, '0')}-proposed.md`, number: n });
  const validation = validateParsed(parsed, { minSectionChars });
  const quality = qualityScore(parsed, { minSectionChars });
  return {
    admitted: validation.valid, rejected: !validation.valid,
    number: n, title: parsed.title, schema: schemaNameFor(n),
    rejections: validation.violations, quality,
    failClosed: true, authorizes: false,
    note: validation.valid
      ? 'The proposal satisfies the schema in force for its number. Admission to the catalogue is a completeness check, not approval — approval remains a recorded decision by the Architecture Review Board.'
      : 'REJECTED. An incomplete ADR is not admitted and is not recorded as accepted-pending-sections; that state is how an incomplete record becomes a permanent one.',
  };
}

// The catalogue-wide quality report a governance board reads.
function qualityReport({ now = null, minSectionChars = 40 } = {}) {
  const adrs = adrFiles().map((f) => parse(f));
  const scores = adrs.map((a) => qualityScore(a, { minSectionChars }));
  const byDimension = QUALITY_DIMENSIONS.map((d) => {
    const rows = scores.map((s) => s.dimensions.find((x) => x.dimension === d.id)).filter((x) => x && x.applicable);
    return {
      dimension: d.id, description: d.description, assessed: rows.length,
      // Weakest link again: one ADR with no rollback strategy is the catalogue's rollback story.
      score: rows.length ? Math.min(...rows.map((r) => r.score)) : null,
      failing: scores.filter((s) => { const r = s.dimensions.find((x) => x.dimension === d.id); return r && r.applicable && r.score < 1; }).map((s) => s.number),
    };
  });
  const incomplete = scores.filter((s) => !s.complete);
  const review = dueForReview({ now, results: adrs });
  return {
    adrs: scores, count: scores.length,
    byDimension, weakestDimension: byDimension.filter((d) => d.score !== null).sort((a, b) => a.score - b.score)[0] || null,
    incomplete: incomplete.map((s) => ({ number: s.number, weakestDimension: s.weakestDimension, missing: s.dimensions.filter((d) => d.applicable && d.missing.length).flatMap((d) => d.missing) })),
    review,
    // The catalogue is sound only if nothing is incomplete AND nothing is silently overdue.
    sound: incomplete.length === 0 && review.overdue.length === 0 && review.undated.length === 0,
    dimensions: QUALITY_DIMENSIONS.map((d) => ({ id: d.id, description: d.description })),
    informationalOnly: true, authorizes: false,
    note: 'Every figure aggregates to the weakest ADR, not to the mean. One decision with no way back is the catalogue\'s rollback story, whatever the other twelve say.',
  };
}

// The architectural debt the catalogue has knowingly taken on, read from the ADRs that record it.
function architecturalDebt() {
  const entries = [];
  for (const file of adrFiles()) {
    const adr = parse(file);
    const body = adr.sections['architectural debt assessment'];
    if (!body) continue;
    entries.push({ adr: adr.number, file, title: adr.title, status: adr.status, assessment: body });
  }
  return {
    entries, count: entries.length,
    recordedFrom: EXTENDED_SCHEMA_FROM,
    unassessed: adrFiles().map((f) => Number(f.slice(0, 4))).filter((n) => n >= EXTENDED_SCHEMA_FROM && !entries.some((e) => e.adr === n)),
    note: 'Debt the architecture has agreed to carry, recorded at the point it was taken on rather than discovered later.',
  };
}

// The template an author should follow, generated from the schema so the two cannot drift.
function template({ number = 'NNNN', title = '<title>' } = {}) {
  const section = (h, hint) => `## ${h}\n<${hint}>\n`;
  return [
    `# ADR-${number}: ${title}`, '',
    '- **Status:** Proposed | Accepted | Superseded by ADR-XXXX | Rejected',
    '- **Date:** YYYY-MM-DD',
    '- **Deciders:** <roles> · **Review required:** ARB (+ OB super-majority if constitutional-invariant)', '',
    ...LEGACY_SCHEMA.map((s) => section(s.heading, `what applies here`)),
    ...FULL_SCHEMA.map((s) => section(s.heading, s.why)),
    ...EXTENDED_SCHEMA.map((s) => section(s.heading, s.why)),
    ...GOVERNANCE_SCHEMA.map((s) => section(s.heading, s.why)),
  ].join('\n');
}

function schema() {
  return {
    legacy: LEGACY_SCHEMA.map((s) => ({ ...s })),
    full: FULL_SCHEMA.map((s) => ({ ...s })),
    extended: EXTENDED_SCHEMA.map((s) => ({ ...s })),
    governance: GOVERNANCE_SCHEMA.map((s) => ({ ...s })),
    fullSchemaFrom: FULL_SCHEMA_FROM, extendedSchemaFrom: EXTENDED_SCHEMA_FROM, governanceSchemaFrom: GOVERNANCE_SCHEMA_FROM,
    measurableSections: [...MEASURABLE_SECTIONS],
    datedSections: [...DATED_SECTIONS],
    qualityDimensions: QUALITY_DIMENSIONS.map((d) => ({ id: d.id, description: d.description })),
    statuses: [...STATUSES],
  };
}

// --- Merge register and verification (Phase 18.1, Parts 2 and 6) -------------------------------------
//
// The record of which implementations absorbed which specification requirements. It exists because
// an ungoverned merge is invisible: from the code alone there is no way to tell a requirement that
// was absorbed into a larger implementation from one that was quietly dropped. Both look like
// absence, and only one of them is fine.
//
// The register is DECLARATIVE and says so. It records what somebody recorded. Nothing here scans the
// codebase for merge-shaped implementations that were never registered — that is named as a debt in
// ADR-0012 rather than pretended away, because inferring intent from a diff would fill the register
// with guesses that read exactly like recorded decisions.
class MergeRegister {
  constructor({ clock = () => 0 } = {}) { this._merges = new Map(); this._clock = clock; }

  // Record a merge. Every field the merge schema requires of the ADR is required of the entry, and
  // an entry that cites no ADR is refused fail-closed — for the same reason the authority register
  // refuses an unattributed declaration.
  record(id, {
    mergedRequirements = [], into, rationale, architecturalJustification,
    affectedContexts = [], rejectedAlternatives = [], compatibilityImpact, implementationStrategy,
    adr, recordedBy, at = null,
  } = {}) {
    const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
    if (!id) fail('a merge record must have an identifier');
    if (!adr) fail('a merge must cite the ADR that governs it — a merge recorded only in a commit message is indistinguishable afterwards from a requirement that was dropped');
    if (!/^ADR-\d{4}$/.test(adr)) fail(`'${adr}' is not an ADR reference of the form ADR-NNNN`);
    // The ADR must EXIST. A citation of something nobody wrote is worse than no citation, because it
    // looks governed.
    const numbers = adrFiles().map((f) => Number(path.basename(f).slice(0, 4)));
    if (!numbers.includes(Number(adr.slice(4)))) fail(`${adr} does not exist in docs/adr/, so this merge cites a decision nobody recorded`);
    if (!Array.isArray(mergedRequirements) || mergedRequirements.length < 2) {
      fail('a merge must name at least two requirements it absorbed — one requirement implemented once is not a merge');
    }
    if (!into) fail('a merge must name the implementation the requirements were merged into');
    if (!rationale) fail('a merge must state why one implementation rather than several — a merge for convenience and one to prevent duplication are indistinguishable afterwards');
    if (!architecturalJustification) fail('a merge must state its architectural justification');
    if (!compatibilityImpact) fail('a merge must state what existing callers have to change, and what they do not');
    if (!implementationStrategy) fail('a merge must state how the requirements were combined, so a reader can check each is still satisfied rather than taking it on trust');
    if (!recordedBy) fail('a merge record must name who recorded it');

    const rec = {
      id, mergedRequirements: [...mergedRequirements], into, rationale, architecturalJustification,
      affectedContexts: [...affectedContexts], rejectedAlternatives: [...rejectedAlternatives],
      compatibilityImpact, implementationStrategy, adr, recordedBy, at: at ?? this._clock(),
    };
    this._merges.set(id, rec);
    return { ...rec };
  }

  merges() { return [...this._merges.values()].map((m) => ({ ...m })).sort((a, b) => a.id.localeCompare(b.id)); }
  merge(id) { const m = this._merges.get(id); return m ? { ...m } : null; }

  // Which requirements are recorded as absorbed, and by what. This is the lookup a reader performs
  // when a specification requirement appears to have no implementation.
  requirementIndex() {
    const index = new Map();
    for (const m of this.merges()) {
      for (const r of m.mergedRequirements) {
        if (!index.has(r)) index.set(r, []);
        index.get(r).push({ merge: m.id, into: m.into, adr: m.adr });
      }
    }
    return index;
  }

  report({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = this.merges();
    const index = this.requirementIndex();
    // A requirement recorded as merged into more than one implementation is a contradiction: it
    // cannot have been absorbed twice, so one of the records is wrong.
    const duplicated = [...index.entries()].filter(([, v]) => v.length > 1).map(([r, v]) => ({ requirement: r, into: v.map((x) => x.into) }));
    return {
      merges: rows, count: rows.length,
      requirementsAbsorbed: index.size,
      requirementIndex: Object.fromEntries([...index.entries()]),
      implementations: [...new Set(rows.map((m) => m.into))].sort(),
      duplicatedRequirements: duplicated,
      everyMergeGoverned: rows.every((m) => !!m.adr),
      measurable: rows.length > 0,
      basis: rows.length
        ? `${rows.length} merge(s) recorded, absorbing ${index.size} specification requirement(s) into ${new Set(rows.map((m) => m.into)).size} implementation(s). ${duplicated.length} requirement(s) are recorded as absorbed more than once.`
        : 'No merge is recorded. That is not the same as no merge having happened — this register is declarative, and an unregistered merge is invisible to it.',
      now: t, declarative: true, informationalOnly: true, authorizes: false,
      note: 'This register records what somebody recorded. Nothing scans the codebase for merge-shaped implementations that were never registered; inferring intent from a diff would populate it with guesses that read exactly like recorded decisions. That gap is named in ADR-0012 rather than closed here.',
    };
  }
}

// The merges this platform has actually performed. Recorded because they happened and there is a
// commit and an ADR for each — not fabricated, and deliberately not inferred.
const PLATFORM_MERGES = [
  {
    id: 'MERGE-0001',
    mergedRequirements: ['Phase 17 Part 15', 'Phase 17 Part 17', 'Phase 18 Part 7'],
    into: 'src/assurance/institutional.js — DECISION_PACKAGE_FIELDS and assertAdvisory',
    rationale: 'All three specifications describe the same artefact — the package a board reads before taking a decision — and each explicitly forbids creating another decision framework. Three schemas over one concept would have let a board act on whichever package it was handed, with no way to tell that another schema required a field this one omitted.',
    architecturalJustification: 'The decision package and its fail-closed guard already existed from Phase 15. Extending one schema preserves the single composition root, the single guard and the existing callers; three parallel schemas would have been a duplicate governance framework, which every phase since 15 forbids.',
    affectedContexts: ['assurance'],
    rejectedAlternatives: [
      'Implement all three separately and reconcile later — reconciling three live schemas over one concept is strictly harder than not creating them.',
      'Create a fourth module to validate the other three — a framework whose purpose is to manage the existence of three others.',
      'Rename existing fields to match each specification\'s vocabulary — breaks every caller in exchange for terminology.',
    ],
    compatibilityImpact: 'Additive for readers: every field present before is present now, unrenamed. Breaking for assemblers: a package satisfying the Phase 15 eight-field schema is refused fail-closed with the missing field named. All in-repository callers were updated in the same change.',
    implementationStrategy: 'The union of the three field lists was taken, each specification\'s terminology mapped onto an existing field name where one covered it, and a new field added only where none did. Two fields were made structural rather than documentary: evidenceStrength is a four-grade enum, and forecastConfidence is required exactly when the grade is projected and refused otherwise.',
    adr: 'ADR-0012',
    recordedBy: 'Architecture Review Board',
    at: 0,
  },
];

function seedPlatformMerges(register, { at = 0 } = {}) {
  for (const m of PLATFORM_MERGES) register.record(m.id, { ...m, at });
  return register;
}

// --- Merge verification (Phase 18.1, Part 6) ---------------------------------------------------------
//
// For every recorded merge, check that the requirements it absorbed are still satisfied — and be
// explicit about what that check can and cannot establish:
//
//   THIS VERIFIES STRUCTURE, NOT MEANING. It confirms that each merged requirement maps to fields
//   that exist and are required by the guard. It cannot confirm that a field means what the
//   specification intended. That judgement is human, and a verification that claimed otherwise
//   would be the most confident wrong answer in the module.
//
// `satisfiedBy` is supplied by the caller: a mapping from requirement to the fields or behaviours
// that satisfy it. Nothing here infers it, for the same reason nothing infers a merge.
function mergeVerification({ register = null, satisfiedBy = {}, requiredFields = [], now = 0 } = {}) {
  const merges = register ? register.merges() : [];
  const present = new Set(requiredFields);

  const rows = merges.map((m) => {
    const requirements = m.mergedRequirements.map((r) => {
      const fields = Array.isArray(satisfiedBy[r]) ? satisfiedBy[r] : null;
      if (!fields) {
        return {
          requirement: r, examined: false, satisfied: false, fields: [], missing: [],
          detail: `nothing was supplied saying what satisfies '${r}', so whether it survived the merge is UNKNOWN — not satisfied, and not lost`,
        };
      }
      const missing = fields.filter((f) => !present.has(f));
      return {
        requirement: r, examined: true, satisfied: missing.length === 0, fields, missing,
        detail: missing.length
          ? `${missing.length} of ${fields.length} field(s) that should satisfy '${r}' are not required by the implementation: ${missing.join(', ')}`
          : `all ${fields.length} field(s) satisfying '${r}' are present and required`,
      };
    });
    const examined = requirements.filter((r) => r.examined);
    const lost = examined.filter((r) => !r.satisfied);
    return {
      merge: m.id, into: m.into, adr: m.adr,
      requirements,
      requirementCount: requirements.length,
      examinedCount: examined.length,
      unexamined: requirements.filter((r) => !r.examined).map((r) => r.requirement),
      functionalityLost: lost.map((r) => ({ requirement: r.requirement, missing: r.missing })),
      // Complete means every requirement was EXAMINED and survived. Unexamined is neither.
      complete: requirements.length > 0 && examined.length === requirements.length && lost.length === 0,
      backwardsCompatible: !!m.compatibilityImpact,
      governed: !!m.adr,
      verifies: 'structure',
      cannotVerify: 'whether each field means what the specification intended — that judgement is human',
    };
  });

  const verified = rows.filter((r) => r.complete);
  return {
    merges: rows, count: rows.length,
    complete: verified.map((r) => r.merge),
    incomplete: rows.filter((r) => !r.complete).map((r) => ({ merge: r.merge, lost: r.functionalityLost, unexamined: r.unexamined })),
    functionalityLost: rows.flatMap((r) => r.functionalityLost),
    everyMergeGoverned: rows.every((r) => r.governed),
    everyMergeVerified: rows.length > 0 && verified.length === rows.length,
    measurable: rows.length > 0,
    basis: rows.length
      ? `${verified.length} of ${rows.length} merge(s) have every absorbed requirement examined and satisfied. ${rows.flatMap((r) => r.unexamined).length} requirement(s) had nothing supplied to check them against and are UNKNOWN rather than lost.`
      : 'No merge is recorded, so there is nothing to verify. That is not evidence that no merge happened.',
    now, informationalOnly: true, authorizes: false,
    note: 'Merge verification is structural: it confirms each absorbed requirement maps to fields that exist and are required. It cannot confirm a field means what the specification intended, and it says so rather than implying a completeness it does not have.',
  };
}

module.exports = {
  ADR_DIR, FULL_SCHEMA, LEGACY_SCHEMA, EXTENDED_SCHEMA, GOVERNANCE_SCHEMA,
  FULL_SCHEMA_FROM, EXTENDED_SCHEMA_FROM, GOVERNANCE_SCHEMA_FROM,
  MEASURABLE_SECTIONS, DATED_SECTIONS, QUALITY_DIMENSIONS, STATUSES,
  adrFiles, parse, parseText, schemaFor, schemaNameFor, validateAdr, validateParsed, validateCatalogue,
  lifecycle, architecturalDebt, template, schema,
  MERGE_SCHEMA, MERGE_SCHEMA_FROM, MergeRegister, PLATFORM_MERGES, seedPlatformMerges, mergeVerification,
  qualityScore, qualityReport, nextReview, dueForReview, admit,
};
