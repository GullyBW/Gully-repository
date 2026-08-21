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
  { field: 'verificationStrategy', heading: 'Verification strategy', why: 'How anybody confirms the merged implementation still satisfies each absorbed requirement. Without it, the merge is verified by whoever performed it.' },
  { field: 'unresolvedSemanticQuestions', heading: 'Unresolved semantic questions', why: 'What the merge could not settle. Structural verification proves a requirement maps to a field; it cannot prove the field means what the specification intended, and the questions that remain open belong in the record rather than in somebody\'s head.' },
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
  // Phase 18.1, Part 2. A merge is a KIND of decision, not a date. An ADR is held to the merge
  // schema when it declares that it records one — not merely because it was written after 0012.
  // The first version of this tier applied by number and immediately demanded four merge sections
  // of ADR-0013, which records no merge; the platform's own control caught it.
  const mergeMatch = text.match(/\*\*Records a merge:\*\*\s*(\S+)/);
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
  const recordsMerge = mergeMatch ? mergeMatch[1].trim() : null;
  return {
    file, number, title: titleMatch ? titleMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1] : null,
    recordsMerge: recordsMerge && recordsMerge.toLowerCase() !== 'no' ? recordsMerge : null,
    sections, raw: text,
  };
}

// Which schema applies to an ADR number.
function schemaFor(number, { recordsMerge = false } = {}) {
  // The merge tier is CONDITIONAL, unlike the four tiers before it. Those apply from a number
  // onward because they raised the standard for every decision. A merge schema demands four
  // sections that are meaningless in an ADR recording no merge, so it applies to the decisions that
  // record one — whenever they were written, and only those.
  const base = number >= GOVERNANCE_SCHEMA_FROM ? [...LEGACY_SCHEMA, ...FULL_SCHEMA, ...EXTENDED_SCHEMA, ...GOVERNANCE_SCHEMA] : null;
  if (base && recordsMerge && number >= MERGE_SCHEMA_FROM) return [...base, ...MERGE_SCHEMA];
  if (base) return base;
  if (number >= EXTENDED_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA, ...EXTENDED_SCHEMA];
  if (number >= FULL_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA];
  return LEGACY_SCHEMA;
}
function schemaNameFor(number, { recordsMerge = false } = {}) {
  if (recordsMerge && number >= MERGE_SCHEMA_FROM) return 'merge';
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
  const schema = schemaFor(adr.number, { recordsMerge: !!adr.recordsMerge });
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
    schema: schemaNameFor(adr.number, { recordsMerge: !!adr.recordsMerge }),
    sections: Object.keys(adr.sections),
    supersededBy: supersessionTarget(adr),
    recordsMerge: adr.recordsMerge || null,
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
  const required = new Set(schemaFor(adr.number, { recordsMerge: !!adr.recordsMerge }).map((s) => s.heading));
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
    file: adr.file, number: adr.number, title: adr.title, status: adr.status, schema: schemaNameFor(adr.number, { recordsMerge: !!adr.recordsMerge }), recordsMerge: adr.recordsMerge || null,
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
    number: n, title: parsed.title, schema: schemaNameFor(n, { recordsMerge: !!parsed.recordsMerge }),
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
    // Phase 18.1, Part 2. Seven fields the first version did not carry.
    specificationReferences = [], mergedCapability = null, affectedModules = [],
    callerImpact = null, requirementFieldMapping = null, verificationStrategy = null,
    unresolvedSemanticQuestions = [], approvedBy = null, approvedAt = null,
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
    // --- Phase 18.1, Part 2 ------------------------------------------------------------------
    if (!mergedCapability) fail('a merge must name the enduring capability it produced — a merge into "some module" cannot be planned against or retired');
    if (!Array.isArray(affectedModules) || !affectedModules.length) {
      fail('a merge must name every module it touched. `into` names where the requirements landed; a merge that changed three files and records one is a merge nobody can review.');
    }
    if (!callerImpact) {
      fail('a merge must state its CALLER impact separately from its compatibility impact — "additive for readers, breaking for assemblers" is two facts, and collapsing them is how one of them gets missed');
    }
    if (!requirementFieldMapping || typeof requirementFieldMapping !== 'object') {
      fail('a merge must map each absorbed requirement to what now satisfies it — without it, "the requirements were merged" is a claim nobody can check');
    }
    for (const r of mergedRequirements) {
      if (!Array.isArray(requirementFieldMapping[r]) || !requirementFieldMapping[r].length) {
        fail(`'${r}' is recorded as absorbed and the mapping says nothing satisfies it — a requirement that maps to nothing was dropped, not merged`);
      }
    }
    if (!verificationStrategy) fail('a merge must state how anybody confirms it still satisfies each absorbed requirement, or the merge is verified by whoever performed it');
    // Approval is a HUMAN act and is recorded separately from the engineering record. A merge
    // recorded by an engineer and approved by nobody is a merge that happened, not one that was
    // agreed — and the register keeps those apart rather than letting `recordedBy` imply both.
    if (!approvedBy) fail('a merge must name the human authority that approved it — recording a merge and approving one are different acts, and this platform performs only the first');
    if (approvedBy === recordedBy) {
      fail(`'${approvedBy}' both recorded and approved this merge — that is a self-approval, and no subsystem may approve itself`);
    }

    const rec = {
      id, mergedRequirements: [...mergedRequirements], into, rationale, architecturalJustification,
      affectedContexts: [...affectedContexts], rejectedAlternatives: [...rejectedAlternatives],
      compatibilityImpact, implementationStrategy, adr, recordedBy, at: at ?? this._clock(),
      specificationReferences: [...specificationReferences], mergedCapability,
      affectedModules: [...affectedModules], callerImpact,
      requirementFieldMapping: JSON.parse(JSON.stringify(requirementFieldMapping)),
      verificationStrategy, unresolvedSemanticQuestions: [...unresolvedSemanticQuestions],
      approvedBy, approvedAt, selfApproved: approvedBy === recordedBy,
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
    // --- Phase 18.1, Part 2 -----------------------------------------------------------------
    specificationReferences: ['Phase 17 §Part 15', 'Phase 17 §Part 17', 'Phase 18 §Part 7'],
    mergedCapability: 'Decision Intelligence',
    affectedModules: [
      'src/assurance/institutional.js',
      'verification/app-fitness.js',
      'test/phase15-government-sustainability-decisions.test.js',
    ],
    callerImpact: 'Breaking for assemblers, additive for readers — two different facts about two different audiences. Every in-repository caller of decisionPackage was updated in the same change; an external caller passing the Phase 15 eight-field shape is refused fail-closed with the missing field named, which is an actionable error rather than a silently thinner package.',
    requirementFieldMapping: {
      'Phase 17 Part 15': ['supportingEvidence', 'assumptions', 'confidence', 'alternativesConsidered', 'legalDependencies', 'historicalOutcomes', 'forecastConfidence', 'validationHistory'],
      'Phase 17 Part 17': ['confidence', 'supportingEvidence', 'assumptions', 'risks', 'uncertainties', 'historicalOutcomes', 'governanceOwner'],
      'Phase 18 Part 7': ['supportingEvidence', 'assumptions', 'confidence', 'historicalOutcomes', 'legalDependencies', 'governanceOwner', 'risks', 'institutionalImpacts', 'alternativesConsidered', 'predictedConsequences', 'validationHistory', 'constitutionalImplications'],
    },
    verificationStrategy: 'Structural, by mergeVerification(): each absorbed requirement is mapped to fields, and every field is checked against the guard\'s required set. APP-FIT-MERGE-GOVERNANCE fails if any mapped field stops being required. This proves the fields exist and are enforced; it does not prove they mean what the specifications intended, which is recorded below as unresolved.',
    unresolvedSemanticQuestions: [
      'Whether `institutionalImpacts` satisfies what Phase 18 Part 7 meant by "organizational impacts", or whether the specification intended impacts on people rather than on institutions. Mapped on the reading that they are the same; a reader who disagrees should say so.',
      'Whether `risks` satisfies Phase 18 Part 7\'s "implementation risks" specifically, or whether implementation risk is narrower than the risk field currently collects.',
      'Whether Phase 17 Part 15\'s "evidence chain" is satisfied by `supportingEvidence` alone, or requires the nine-hop explanation chain to be attached to each package. Phase 18.1 Part 8 revisits this.',
    ],
    approvedBy: 'Oversight Board',
    approvedAt: 0,
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

// --- Requirements traceability (Phase 18.1, Parts 1 and 3) -------------------------------------------
//
// Nothing in this repository represented a specification requirement before this. Eighteen phases of
// specifications arrived as prose, were implemented, and left no artefact saying which requirement
// authorised which module. The gap was found the hard way: a merge of three requirements went in
// with no ADR, and nothing in a 204-invariant assurance suite noticed, because nothing knew the
// three requirements existed.
//
// Two rules shape everything below, and both are refusals.
//
//   THE REGISTER IS DECLARED, NEVER INFERRED. A requirement's owner, context and ADR are recorded by
//   somebody. Deriving them from a diff would populate the matrix with guesses that read exactly
//   like declarations — and the one thing worse than an untraceable requirement is a traceable-
//   looking one that traces to a guess.
//
//   A MISSING VERIFICATION ELEMENT IS BLOCKED, NOT PARTIAL. "Seven of nine present" invites somebody
//   to read 78% and move on. A requirement missing its tests is not 78% verified; it is unverified,
//   and the state says so.
const REQUIREMENT_STATES = {
  UNKNOWN: {
    rank: 0, verified: false, blocking: false,
    means: 'Declared and nothing has been checked about it. Not a failure — nobody has looked.',
  },
  DECLARED: {
    rank: 1, verified: false, blocking: false,
    means: 'The requirement is recorded with an owner and a context. Nothing yet says it was built.',
  },
  PARTIAL: {
    rank: 2, verified: false, blocking: false,
    means: 'An implementation is mapped and at least one non-required verification element is absent.',
  },
  VERIFIED: {
    rank: 3, verified: true, blocking: false,
    means: 'Every element this requirement\'s artefact type demands is present and resolves.',
  },
  BLOCKED: {
    rank: 4, verified: false, blocking: true,
    means: 'A REQUIRED verification element is missing. Not a percentage: the requirement is unverified and says so.',
  },
  REJECTED: {
    rank: 5, verified: false, blocking: false,
    means: 'Recorded, considered, and deliberately not implemented — with a rationale. Distinct from an orphan in every way that matters.',
  },
};

// Artefact types, and this is the distinction the Phase 18.1 invariant turns on. Requiring mutation
// testing of a governance decision would be a category error: you cannot mutate a board's approval
// to see whether a control notices.
const ARTEFACT_TYPES = {
  executable: {
    requires: ['implementation', 'context', 'owner', 'tests', 'fitness'],
    optional: ['adr', 'endpoint', 'documentation', 'runbook', 'mutation'],
    means: 'Code. Verified by deterministic tests, executable fitness functions and mutation testing.',
  },
  governance: {
    requires: ['owner', 'context', 'documentation'],
    optional: ['adr', 'implementation', 'tests', 'fitness', 'endpoint', 'runbook', 'mutation'],
    means: 'A decision, an approval, an ownership record. Verified by authorization, evidence and reviewability — never by mutation, which would be a category error.',
  },
  architectural: {
    requires: ['adr', 'owner', 'context', 'implementation'],
    optional: ['tests', 'fitness', 'endpoint', 'documentation', 'runbook', 'mutation'],
    means: 'A structural change. Verified by a recorded decision, impact analysis and compatibility analysis.',
  },
  documentation: {
    requires: ['documentation', 'owner'],
    optional: ['adr', 'context', 'implementation', 'tests', 'fitness', 'endpoint', 'runbook', 'mutation'],
    means: 'A governed document. Verified by existing, resolving against the implementation, and having somebody accountable for it.',
  },
};

// Every traceability element a requirement can carry, and what its absence costs.
const TRACE_ELEMENTS = {
  implementation: { asks: 'Which module implements this?', ifAbsent: 'The requirement is an orphan: stated, never built, and nothing says so.' },
  context: { asks: 'Which bounded context owns it?', ifAbsent: 'The requirement belongs to nobody structurally, so it drifts between contexts.' },
  owner: { asks: 'Which institution is accountable?', ifAbsent: 'There is nobody to ask when it is questioned.' },
  capability: { asks: 'Which enduring capability does it serve?', ifAbsent: 'It can only be planned against a phase, which ends.' },
  adr: { asks: 'Which recorded decision authorises it?', ifAbsent: 'It is being enforced and nobody can say who decided it.' },
  tests: { asks: 'Which deterministic tests cover it?', ifAbsent: 'A change can remove it and every test still passes.' },
  fitness: { asks: 'Which executable control enforces it?', ifAbsent: 'It is a statement rather than a check — nothing would fail if it stopped being true.' },
  mutation: { asks: 'Has the control been shown to detect its own defect?', ifAbsent: 'A control nothing can fail is decoration, and nothing here would reveal that.' },
  endpoint: { asks: 'Which HTTP surface exposes it?', ifAbsent: 'Nothing outside the process can observe it.' },
  documentation: { asks: 'Which governed document describes it?', ifAbsent: 'An operator has nothing to read.' },
  runbook: { asks: 'Which runbook operates it?', ifAbsent: 'Nobody knows what to do with it at three in the morning.' },
  commits: { asks: 'Which commits delivered it?', ifAbsent: 'The change cannot be reviewed against the requirement that asked for it.' },
};

// --- Part 7: specification compliance vocabulary ---------------------------------------------------
//
// Five outcomes, and the two that are most often merged are the two that must not be. "Not compliant"
// and "not established" are different institutional facts leading to different actions: one is fixed,
// the other is investigated. A dashboard that shows them in the same colour has thrown away the
// distinction its readers most need.
//
// Each maps onto the platform's three epistemic states so a compliance figure can be rolled into any
// other assurance chain without a translation layer inventing a fourth meaning on the way.
const COMPLIANCE_STATES = {
  COMPLIANT: {
    epistemic: 'RESOLVED', compliant: true, blocking: false, humanJudgementNeeded: false,
    means: 'Every element this requirement\'s artefact type demands is present and resolves, or it was deliberately rejected with a recorded rationale.',
  },
  NON_COMPLIANT: {
    epistemic: 'BROKEN', compliant: false, blocking: true, humanJudgementNeeded: false,
    means: 'A required element is absent. Checked, and the specification is not met — this is the actionable state.',
  },
  EVIDENCE_UNRESOLVED: {
    epistemic: 'BROKEN', compliant: false, blocking: true, humanJudgementNeeded: false,
    means: 'A declaration points at a file, control, owner or ADR that does not exist. Worse than an absent declaration, because it reads as covered.',
  },
  UNKNOWN: {
    epistemic: 'UNKNOWN', compliant: false, blocking: false, humanJudgementNeeded: true,
    means: 'Nothing has been checked, or nothing was ever declared. Not a failure and emphatically not a pass — nobody has looked.',
  },
  HUMAN_REVIEW_REQUIRED: {
    epistemic: 'UNKNOWN', compliant: false, blocking: false, humanJudgementNeeded: true,
    means: 'Structurally complete, with an outstanding question no test can settle. A machine has done what it can and says so.',
  },
};

// Rolling a set of requirements up collapses to three epistemic states; this maps back to the
// compliance vocabulary so the specification-level answer stays as specific as the evidence allows.
const COMPLIANCE_FROM_EPISTEMIC = { RESOLVED: 'COMPLIANT', BROKEN: 'NON_COMPLIANT', UNKNOWN: 'UNKNOWN' };

class RequirementRegister {
  constructor({ clock = () => 0 } = {}) { this._requirements = new Map(); this._clock = clock; }

  // Declare a requirement. Identity, statement, artefact type and owner are mandatory because a
  // requirement missing any of them cannot be traced in either direction — and an untraceable entry
  // in a traceability matrix is worse than no entry, because it inflates the denominator.
  declare(id, {
    specification, section, statement, artefactType,
    implementation = null, context = null, owner = null, capability = null, adr = null,
    tests = [], fitness = [], mutation = [], endpoint = null, documentation = null, runbook = null,
    commits = [], rejected = false, rejectionRationale = null, declaredBy, at = null,
  } = {}) {
    const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
    if (!id) fail('a requirement must have an identifier');
    if (!specification) fail(`'${id}' must name the specification it came from — a requirement with no source cannot be traced back to anything`);
    if (!section) fail(`'${id}' must name the section of that specification`);
    if (!statement) fail(`'${id}' must carry the requirement statement itself, or the register records an identifier and not a requirement`);
    if (!ARTEFACT_TYPES[artefactType]) fail(`'${id}' must declare an artefact type — one of ${Object.keys(ARTEFACT_TYPES).join(', ')} — because what counts as verified differs between them`);
    if (!declaredBy) fail(`'${id}' must name who declared it`);
    if (rejected && !rejectionRationale) fail(`'${id}' is recorded as rejected and states no rationale — a rejection with no reason is indistinguishable from an oversight`);

    const rec = {
      id, specification, section, statement, artefactType,
      implementation, context, owner, capability, adr,
      tests: [...tests], fitness: [...fitness], mutation: [...mutation],
      endpoint, documentation, runbook, commits: [...commits],
      rejected, rejectionRationale, declaredBy, at: at ?? this._clock(),
    };
    this._requirements.set(id, rec);
    return { ...rec };
  }

  requirements() { return [...this._requirements.values()].map((r) => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id)); }
  requirement(id) { const r = this._requirements.get(id); return r ? { ...r } : null; }

  // --- Part 3: executable coverage verification -------------------------------------------------
  //
  // Each element is checked against the thing it claims, not against its own presence. A requirement
  // naming a fitness function that does not exist is worse than one naming none, because it reads as
  // covered.
  // `controls` defaults to null rather than [] on purpose. Not supplying a control list is a
  // different fact from supplying one that lacks the declared control: the first means nobody
  // checked, the second means the check was run and the control was not there. Defaulting to []
  // collapsed them, and a requirement nobody had verified reported BLOCKED — absence of input
  // rendered as evidence of failure, which is the same error in the same family as the precedent
  // hop that read a stated absence as a presence.
  verify(id, { controls = null, testFiles = null, now = null } = {}) {
    const t = now ?? this._clock();
    const r = this._requirements.get(id);
    if (!r) throw new Error('unknown requirement: ' + id);
    const spec = ARTEFACT_TYPES[r.artefactType];
    const contextMap = require('./context-map');
    const ownershipModule = require('../governance/ownership');

    const controlsSupplied = Array.isArray(controls);
    const controlIds = new Set((controls || []).map((c) => (typeof c === 'string' ? c : c.id)));
    const testFileList = testFiles || [];
    const adrNumbers = adrFiles().map((f) => Number(path.basename(f).slice(0, 4)));
    const contexts = new Set(contextMap.ids());
    const owners = new Set(ownershipModule.subsystems().flatMap((s) => {
      const o = ownershipModule.describe(s);
      return [o.operationalOwner, o.approvingAuthority, o.responsibleAuthority, o.dataSteward, o.board && o.board.name].filter(Boolean);
    }));

    // present: declared AND resolves. A declaration that does not resolve is a broken mapping, which
    // is a third thing — worse than absent, because it looks satisfied.
    const check = (element) => {
      switch (element) {
        case 'implementation': {
          if (!r.implementation) return { present: false, resolves: null, detail: 'no implementation declared' };
          const exists = fs.existsSync(path.join(__dirname, '..', '..', r.implementation));
          return { present: true, resolves: exists, detail: exists ? `${r.implementation} exists on disk` : `${r.implementation} is declared and does not exist` };
        }
        case 'context': {
          if (!r.context) return { present: false, resolves: null, detail: 'no bounded context declared' };
          const ok = contexts.has(r.context);
          return { present: true, resolves: ok, detail: ok ? `'${r.context}' is a declared bounded context` : `'${r.context}' is not one of the ${contexts.size} bounded contexts` };
        }
        case 'owner': {
          if (!r.owner) return { present: false, resolves: null, detail: 'no owner declared' };
          const ok = owners.has(r.owner);
          return { present: true, resolves: ok, detail: ok ? `'${r.owner}' holds a role in the accountability record` : `'${r.owner}' holds nothing in the accountability record` };
        }
        case 'adr': {
          if (!r.adr) return { present: false, resolves: null, detail: 'no ADR declared' };
          const ok = /^ADR-\d{4}$/.test(r.adr) && adrNumbers.includes(Number(r.adr.slice(4)));
          return { present: true, resolves: ok, detail: ok ? `${r.adr} exists in docs/adr/` : `${r.adr} does not exist` };
        }
        case 'tests': {
          if (!r.tests.length) return { present: false, resolves: null, detail: 'no deterministic test declared' };
          const missing = r.tests.filter((f) => !testFileList.includes(f) && !fs.existsSync(path.join(__dirname, '..', '..', 'test', f)));
          return { present: true, resolves: missing.length === 0, detail: missing.length ? `${missing.length} declared test file(s) do not exist: ${missing.join(', ')}` : `${r.tests.length} test file(s) exist` };
        }
        case 'fitness': {
          if (!r.fitness.length) return { present: false, resolves: null, detail: 'no fitness function declared' };
          // A declared control can only be checked against a supplied list of what ran. With no
          // list, this is unknown — not failing. The distinction is the whole point.
          if (!controlsSupplied) return { present: true, resolves: null, unknown: true, detail: `${r.fitness.length} control(s) declared and nothing was supplied to check them against — unknown, not failing` };
          const missing = r.fitness.filter((f) => !controlIds.has(f));
          return { present: true, resolves: missing.length === 0, detail: missing.length ? `${missing.length} declared control(s) did not run: ${missing.join(', ')}` : `${r.fitness.length} control(s) ran on this build` };
        }
        case 'mutation': {
          // Mutation evidence is a claim about a process, not an artefact on disk. It is recorded
          // where it was performed and is UNKNOWN where nothing recorded it — never back-filled.
          if (!r.mutation.length) return { present: false, resolves: null, detail: 'no mutation evidence recorded — unknown, and deliberately not inferred from the fitness function existing' };
          return { present: true, resolves: true, detail: `${r.mutation.length} mutation(s) recorded as caught` };
        }
        case 'endpoint':
          return r.endpoint ? { present: true, resolves: true, detail: r.endpoint } : { present: false, resolves: null, detail: 'no HTTP endpoint declared' };
        case 'documentation': {
          if (!r.documentation) return { present: false, resolves: null, detail: 'no governed document declared' };
          const exists = fs.existsSync(path.join(__dirname, '..', '..', r.documentation));
          return { present: true, resolves: exists, detail: exists ? `${r.documentation} exists` : `${r.documentation} is declared and does not exist` };
        }
        case 'runbook': {
          if (!r.runbook) return { present: false, resolves: null, detail: 'no runbook declared' };
          const exists = fs.existsSync(path.join(__dirname, '..', '..', r.runbook));
          return { present: true, resolves: exists, detail: exists ? `${r.runbook} exists` : `${r.runbook} is declared and does not exist` };
        }
        case 'capability':
          return r.capability ? { present: true, resolves: true, detail: r.capability } : { present: false, resolves: null, detail: 'no enduring capability declared' };
        case 'commits':
          return r.commits.length ? { present: true, resolves: true, detail: `${r.commits.length} commit(s)` } : { present: false, resolves: null, detail: 'no delivering commit recorded' };
        default:
          return { present: false, resolves: null, detail: 'unknown element' };
      }
    };

    const elements = Object.keys(TRACE_ELEMENTS).map((element) => ({
      element, ...TRACE_ELEMENTS[element],
      required: spec.requires.includes(element),
      ...check(element),
    }));

    const missingRequired = elements.filter((e) => e.required && !e.present);
    const brokenMappings = elements.filter((e) => e.present && e.resolves === false);
    const missingOptional = elements.filter((e) => !e.required && !e.present);
    // Declared, and could not be checked because nothing was supplied to check it against.
    const unknownRequired = elements.filter((e) => e.required && e.present && e.unknown === true);

    // THE STATE RULE. A missing REQUIRED element or a broken mapping is BLOCKED — never a fraction.
    // A required element that could not be checked is UNKNOWN, which is neither. The ordering is the
    // weakest-link rule from src/assurance/epistemic.js: BROKEN dominates UNKNOWN dominates RESOLVED,
    // so a requirement that is both unverifiable and demonstrably wrong reports the wrongness.
    //
    // Until this was written, UNKNOWN was a state nothing could reach — defined in REQUIREMENT_STATES,
    // documented as "nobody has looked", and produced by no code path. A state nothing can reach is
    // not a state, and this register had one for three batches.
    const state = r.rejected ? 'REJECTED'
      : missingRequired.length || brokenMappings.length ? 'BLOCKED'
        : unknownRequired.length ? 'UNKNOWN'
          : missingOptional.length ? 'PARTIAL'
            : 'VERIFIED';

    return {
      requirement: id, specification: r.specification, section: r.section, statement: r.statement,
      artefactType: r.artefactType, artefactMeans: spec.means,
      state, ...REQUIREMENT_STATES[state],
      elements,
      missingRequired: missingRequired.map((e) => e.element),
      brokenMappings: brokenMappings.map((e) => ({ element: e.element, detail: e.detail })),
      missingOptional: missingOptional.map((e) => e.element),
      unknownRequired: unknownRequired.map((e) => e.element),
      verificationInputSupplied: { controls: controlsSupplied, testFiles: Array.isArray(testFiles) },
      reason: r.rejected ? `recorded as rejected: ${r.rejectionRationale}`
        : brokenMappings.length ? `${brokenMappings.length} declared mapping(s) do not resolve — a declaration that points at nothing reads as covered and is not`
          : missingRequired.length ? `${missingRequired.length} REQUIRED element(s) absent for a '${r.artefactType}' requirement: ${missingRequired.map((e) => e.element).join(', ')}. This is BLOCKED, not partially verified.`
            : unknownRequired.length ? `${unknownRequired.length} REQUIRED element(s) could not be checked because nothing was supplied to check them against: ${unknownRequired.map((e) => e.element).join(', ')}. Nobody has looked, which is not the same as a failure and is emphatically not a pass.`
              : missingOptional.length ? `every required element is present; ${missingOptional.length} optional element(s) absent`
                : 'every element this artefact type requires is present and resolves',
      now: t,
    };
  }

  // --- Part 7: specification compliance dashboard ----------------------------------------------
  //
  // Not a new framework, and the platform's own duplication analysis is why. Asked to compare a
  // proposed compliance dashboard against what already exists, it returned GOVERNANCE_REVIEW_REQUIRED
  // against this very register on five dimensions — responsibility, registry, validation logic,
  // decision framework and bounded context. A second module would have been the CONFIRMED_DUPLICATION
  // that Part 6 blocks. So this is a view over the requirements already declared here.
  //
  // What it adds is the axis `matrix()` does not have: the SPECIFICATION. `matrix()` answers "is this
  // requirement verified"; a board asks "is Phase 18.1 implemented". Those differ in one way that
  // matters enormously — a specification with no declared requirements has a perfectly clean matrix,
  // because a register you never wrote to contains no failures.
  //
  //     absence of evidence is not evidence of compliance
  //
  // So the dashboard is told which specifications are expected to exist, and reports UNKNOWN for any
  // it holds nothing about. A dashboard that rendered "no requirements declared" as green would be
  // worse than no dashboard, because it would be believed.
  specificationCompliance({
    // Defaults are null, not [], for the same reason verify()'s are: an empty control list is a
    // claim that nothing ran, and no control list is a statement that nobody checked. The dashboard
    // must carry that distinction through or the UNKNOWN state it reports can never be reached.
    controls = null, testFiles = null, modules = [], specifications = [], reviews = [], now = null,
  } = {}) {
    const t = now ?? this._clock();
    const { EPISTEMIC_STATES, weakest, machineBoundary } = require('../assurance/epistemic');
    const rows = this.requirements().map((r) => this.verify(r.id, { controls, testFiles, now: t }));

    // A review is a recorded human finding. Declared, never inferred, and refused if it does not say
    // who looked and what they concluded — an unsigned review is an assertion that somebody agreed.
    const reviewed = new Map();
    const rejectedReviews = [];
    for (const rv of reviews) {
      if (!rv || !rv.requirement || !rv.reviewedBy || !rv.finding) {
        rejectedReviews.push({ review: rv || null, reason: 'a review must name the requirement, who reviewed it and what they found' });
        continue;
      }
      reviewed.set(rv.requirement, { reviewedBy: rv.reviewedBy, finding: rv.finding, at: rv.at ?? t });
    }

    // Per requirement: what the machine observed, and whether anything is left that it cannot settle.
    const assessed = rows.map((row) => {
      const req = this._requirements.get(row.requirement);
      const spec = ARTEFACT_TYPES[req.artefactType];
      const review = reviewed.get(row.requirement) || null;

      // Substantive adequacy is a human matter for every artefact type whose verification is a
      // judgement rather than an execution. A governance decision that names an owner, a context and
      // a document is structurally complete and may still be inadequate, and no test can tell.
      const adequacyIsHuman = !spec.requires.includes('fitness');
      const outstanding = adequacyIsHuman && !review;

      const state = row.state === 'REJECTED' ? 'COMPLIANT'
        : row.brokenMappings.length ? 'EVIDENCE_UNRESOLVED'
          : row.state === 'BLOCKED' ? 'NON_COMPLIANT'
            : row.state === 'UNKNOWN' ? 'UNKNOWN'
              : outstanding ? 'HUMAN_REVIEW_REQUIRED'
                : 'COMPLIANT';

      return {
        requirement: row.requirement, specification: req.specification, section: req.section,
        artefactType: req.artefactType, requirementState: row.state,
        state, ...COMPLIANCE_STATES[state],
        missingRequired: row.missingRequired, brokenMappings: row.brokenMappings,
        missingOptional: row.missingOptional,
        humanReview: review,
        adequacyIsHuman,
        detail: state === 'EVIDENCE_UNRESOLVED'
          ? `${row.brokenMappings.length} declared mapping(s) point at something that does not exist: ${row.brokenMappings.map((b) => b.element).join(', ')}`
          : state === 'NON_COMPLIANT' ? row.reason
            : state === 'HUMAN_REVIEW_REQUIRED'
              ? `structurally complete, and whether a '${req.artefactType}' requirement is substantively adequate is not a thing a test establishes`
              : state === 'UNKNOWN' ? 'declared and nothing has been checked about it'
                : review ? `reviewed by ${review.reviewedBy}: ${review.finding}`
                  : row.reason,
      };
    });

    // --- The specification axis, which is the point of Part 7 ------------------------------------
    const declaredSpecs = [...new Set(assessed.map((a) => a.specification))];
    const expected = [...new Set([...specifications, ...declaredSpecs])].sort();

    const bySpecification = expected.map((name) => {
      const mine = assessed.filter((a) => a.specification === name);
      // THE RULE THIS PART EXISTS FOR. No requirements declared means nobody wrote down what the
      // specification demanded — which is an absence of evidence, and never a clean bill.
      if (!mine.length) {
        return {
          specification: name, requirements: [], count: 0,
          state: 'UNKNOWN', ...COMPLIANCE_STATES.UNKNOWN,
          reason: 'no requirement is declared against this specification, so nothing is known about whether it was implemented. An empty register is not a clean one.',
          counts: Object.fromEntries(Object.keys(COMPLIANCE_STATES).map((c) => [c, 0])),
          measurable: false,
        };
      }
      // Weakest link, never the mean. One unresolved requirement is an unresolved specification.
      const state = COMPLIANCE_FROM_EPISTEMIC[weakest(mine.map((a) => COMPLIANCE_STATES[a.state].epistemic))] || 'UNKNOWN';
      // weakest() collapses to three; recover the specific compliance state so a reader is told
      // WHICH kind of not-compliant this is.
      const worst = mine.find((a) => a.state === 'EVIDENCE_UNRESOLVED') || mine.find((a) => a.state === 'NON_COMPLIANT')
        || mine.find((a) => a.state === 'UNKNOWN') || mine.find((a) => a.state === 'HUMAN_REVIEW_REQUIRED') || null;
      const resolved = worst ? worst.state : state;
      const counts = Object.fromEntries(Object.keys(COMPLIANCE_STATES).map((c) => [c, mine.filter((a) => a.state === c).length]));
      return {
        specification: name, requirements: mine.map((a) => a.requirement), count: mine.length,
        state: resolved, ...COMPLIANCE_STATES[resolved],
        counts, measurable: true,
        weakestRequirement: worst ? worst.requirement : null,
        reason: worst
          ? `${worst.requirement} is ${resolved}: ${worst.detail}`
          : `all ${mine.length} declared requirement(s) are compliant on the evidence recorded`,
      };
    });

    const of = (state) => bySpecification.filter((s2) => s2.state === state).map((s2) => s2.specification);

    // The top line keeps the specificity the rows have. Collapsing through the three epistemic states
    // and back would report UNKNOWN — "nobody looked" — for an estate where the machine looked, every
    // structural check passed, and a human review is outstanding. Those are different institutional
    // facts and the reader acts differently on each, so the roll-up names the weakest SPECIFIC state
    // rather than the weakest epistemic one.
    const severity = ['EVIDENCE_UNRESOLVED', 'NON_COMPLIANT', 'UNKNOWN', 'HUMAN_REVIEW_REQUIRED', 'COMPLIANT'];
    const overall = bySpecification.length
      ? severity.find((state) => bySpecification.some((s2) => s2.state === state)) || 'UNKNOWN'
      : 'UNKNOWN';

    return {
      requirements: assessed, bySpecification,
      specificationsExpected: expected, specificationsWithNoRequirements: of('UNKNOWN').filter((n) => !declaredSpecs.includes(n)),
      states: Object.entries(COMPLIANCE_STATES).map(([state, c]) => ({ state, ...c })),
      epistemicStates: Object.entries(EPISTEMIC_STATES).map(([state, e]) => ({ state, ...e })),

      // Five outcomes, reported apart. Collapsing any pair loses the thing a reader needs.
      //
      // Named `specifications*` rather than `compliant`/`unknown` because the state spread below
      // carries a BOOLEAN `compliant`, and the short names let it silently overwrite these lists —
      // `compliant` came back as `true` instead of the specifications that were. A field whose type
      // changes depending on spread order is a bug waiting for a reader to trust it.
      specificationsCompliant: of('COMPLIANT'),
      specificationsNonCompliant: of('NON_COMPLIANT'),
      specificationsEvidenceUnresolved: of('EVIDENCE_UNRESOLVED'),
      specificationsUnknown: of('UNKNOWN'),
      specificationsHumanReviewRequired: of('HUMAN_REVIEW_REQUIRED'),

      requirementsNeedingHumanReview: assessed.filter((a) => a.state === 'HUMAN_REVIEW_REQUIRED').map((a) => ({ requirement: a.requirement, why: a.detail })),
      unresolvedEvidence: assessed.filter((a) => a.state === 'EVIDENCE_UNRESOLVED').flatMap((a) => a.brokenMappings.map((b) => ({ requirement: a.requirement, ...b }))),
      rejectedReviews,

      // Counts per state. Deliberately not a compliance percentage: "80% compliant" cannot tell a
      // reader whether the missing fifth is a runbook or the implementation, and one that sees 80
      // stops asking.
      counts: Object.fromEntries(Object.keys(COMPLIANCE_STATES).map((c) => [c, of(c).length])),
      overall, ...COMPLIANCE_STATES[overall],

      ...machineBoundary({
        observed: [
          'a declared requirement missing an element its artefact type requires',
          'a declaration pointing at a file, control, context, owner or ADR that does not exist',
          'a specification with no declared requirements at all',
          'a requirement nothing has yet been checked about',
        ],
        judged: [
          'whether a structurally complete governance or architectural requirement is substantively adequate',
          'whether a rejection rationale is acceptable',
          'whether the specification was correctly understood in the first place',
        ],
      }),

      measurable: bySpecification.some((s2) => s2.measurable),
      basis: bySpecification.length
        ? `${of('COMPLIANT').length} compliant, ${of('NON_COMPLIANT').length} non-compliant, ${of('EVIDENCE_UNRESOLVED').length} with unresolved evidence, ${of('HUMAN_REVIEW_REQUIRED').length} awaiting human review, ${of('UNKNOWN').length} unknown, of ${bySpecification.length} specification(s).`
        : 'No specification is declared and none was supplied as expected. The dashboard reports nothing rather than reporting that nothing is wrong.',
      now: t, informationalOnly: true, authorizes: false,
      note: 'A specification with no declared requirements is UNKNOWN, never compliant: an empty register is not a clean one. Specification state is the weakest of its requirements rather than their average, because one unverified requirement is an unverified specification no matter how many others hold.',
    };
  }

  // Bidirectional traceability plus the whole-register report.
  matrix({ controls = [], testFiles = [], modules = [], now = null } = {}) {
    const t = now ?? this._clock();
    const rows = this.requirements().map((r) => this.verify(r.id, { controls, testFiles, now: t }));
    const all = this.requirements();

    // Requirement → implementation, and back. The reverse direction is the one nothing asked before,
    // and it is what finds a module no requirement authorised.
    const byImplementation = new Map();
    for (const r of all) {
      if (!r.implementation) continue;
      if (!byImplementation.has(r.implementation)) byImplementation.set(r.implementation, []);
      byImplementation.get(r.implementation).push(r.id);
    }
    const orphanImplementations = modules.filter((m) => !byImplementation.has(m));
    // One module implementing several requirements is normal. The same requirement mapped to two
    // implementations is not: it cannot have one implementation responsibility.
    const duplicateMappings = all.filter((r) => Array.isArray(r.implementation));
    const ambiguousOwnership = rows.filter((row) => {
      const r = this._requirements.get(row.requirement);
      return r.implementation && (byImplementation.get(r.implementation) || []).length > 1;
    }).map((row) => ({ requirement: row.requirement, sharedWith: byImplementation.get(this._requirements.get(row.requirement).implementation).filter((x) => x !== row.requirement) }));

    const counted = (state) => rows.filter((x) => x.state === state);
    return {
      requirements: rows, count: rows.length,
      states: Object.entries(REQUIREMENT_STATES).map(([state, s]) => ({ state, ...s })),
      artefactTypes: Object.entries(ARTEFACT_TYPES).map(([type, s]) => ({ type, ...s })),
      elements: Object.entries(TRACE_ELEMENTS).map(([element, e]) => ({ element, ...e })),
      byState: Object.fromEntries(Object.keys(REQUIREMENT_STATES).map((s) => [s, counted(s).map((x) => x.requirement)])),
      verified: counted('VERIFIED').map((x) => x.requirement),
      blocked: counted('BLOCKED').map((x) => ({ requirement: x.requirement, missing: x.missingRequired, broken: x.brokenMappings })),
      partial: counted('PARTIAL').map((x) => x.requirement),
      unknown: counted('UNKNOWN').map((x) => x.requirement),
      rejected: counted('REJECTED').map((x) => x.requirement),
      // Requirement → implementation
      orphanRequirements: all.filter((r) => !r.implementation && !r.rejected).map((r) => r.id),
      // Implementation → requirement. Only meaningful over modules the caller supplied.
      orphanImplementations,
      implementationsExamined: modules.length,
      duplicateMappings: duplicateMappings.map((r) => r.id),
      ambiguousOwnership,
      brokenMappings: rows.flatMap((x) => x.brokenMappings.map((b) => ({ requirement: x.requirement, ...b }))),
      missingOwnership: all.filter((r) => !r.owner).map((r) => r.id),
      missingAdrs: all.filter((r) => ARTEFACT_TYPES[r.artefactType].requires.includes('adr') && !r.adr).map((r) => r.id),
      // Deliberately NOT a single percentage. Counts, per state, so a high verified count cannot
      // conceal a blocked requirement.
      counts: Object.fromEntries(Object.keys(REQUIREMENT_STATES).map((s) => [s, counted(s).length])),
      everyRequirementVerified: rows.length > 0 && counted('VERIFIED').length + counted('REJECTED').length === rows.length,
      anyBlocked: counted('BLOCKED').length > 0,
      measurable: rows.length > 0,
      basis: rows.length
        ? `${counted('VERIFIED').length} verified, ${counted('BLOCKED').length} blocked, ${counted('PARTIAL').length} partial, ${counted('REJECTED').length} rejected, of ${rows.length} declared requirement(s). ${orphanImplementations.length} of ${modules.length} examined module(s) map to no requirement.`
        : 'No requirement is declared. The register is empty, which is not the same as a platform with no requirements — it is a platform that has not written them down.',
      now: t, declarative: true, informationalOnly: true, authorizes: false,
      note: 'Declared, never inferred. A requirement\'s owner, context and ADR are recorded by somebody; deriving them from a diff would fill the matrix with guesses that read exactly like declarations. A missing REQUIRED element produces BLOCKED rather than a percentage, because "seven of nine" invites a reader to see 78% and move on when the requirement is simply unverified.',
    };
  }
}

// --- Phase 18.1 close-out: a synthetic requirement corpus -----------------------------------------
//
// SYNTHETIC ONLY. Every entry below is invented for deterministic verification and describes nothing
// the Republic of Botswana has ever required, decided or recorded. No entry here is a production
// requirement, and nothing derived from this corpus authorises anything.
//
// It exists because of a limit the Batch 7 close-out audit recorded honestly: the requirement
// register ships empty, so `specificationCompliance()` had been verified against fixtures and an
// empty register and had never been run over a populated one. A dashboard exercised only on the
// empty case is a dashboard whose interesting behaviour is unverified.
//
// The identifiers are prefixed SYN- and the specification is named 'SYNTHETIC-CORPUS' so that no
// reader, and no future aggregation, can mistake a corpus entry for a governed requirement. A
// control asserts the separation in both directions.
const SYNTHETIC_SPECIFICATION = 'SYNTHETIC-CORPUS';
const SYNTHETIC_REQUIREMENTS = [
  // 1. Compliant, and with complete authoritative evidence (covers corpus shapes 1 and 8): every
  //    element the executable artefact type requires is present, resolves, and names a real thing.
  {
    id: 'SYN-COMPLIANT', section: 'shape 1 + 8 — compliant with complete authoritative evidence',
    statement: 'A requirement whose every required element is present, resolves, and is owned.',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
    implementation: 'src/assurance/epistemic.js', context: 'assurance',
    owner: 'Office of the Chief Architect', capability: 'epistemic-integrity',
    adr: 'ADR-0014', tests: ['phase18-1-specification-compliance.test.js'],
    fitness: ['APP-FIT-EPISTEMIC-INTEGRITY'], mutation: ['unknown-to-pass', 'depth-as-tally'],
    endpoint: '/api/architecture/specification-compliance',
    documentation: 'docs/architecture-governance.md', runbook: 'docs/operations/runbook.md',
    commits: ['synthetic'],
  },
  // 2. Non-compliant: declared and never built. The required elements are simply absent.
  {
    id: 'SYN-NONCOMPLIANT', section: 'shape 2 — observed non-compliance',
    statement: 'A requirement that was declared and never implemented.',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
    context: 'assurance', owner: 'Office of the Chief Architect',
  },
  // 3. Human review required: structurally complete governance artefact whose substantive adequacy
  //    is not a thing any test establishes.
  {
    id: 'SYN-HUMAN-REVIEW', section: 'shape 3 — substantive adequacy is a human matter',
    statement: 'A governance decision that is structurally complete and substantively unexamined.',
    artefactType: 'governance', declaredBy: 'Architecture Review Board',
    context: 'assurance', owner: 'Office of the Chief Architect',
    documentation: 'docs/architecture-governance.md',
  },
  // 4. Unknown: an executable requirement declaring a control, evaluated with no control list. Until
  //    the close-out this shape was unreachable — REQUIREMENT_STATES.UNKNOWN existed and no code path
  //    produced it. The corpus carries it so the state stays reachable.
  {
    id: 'SYN-UNKNOWN', section: 'shape 4 — declared, and nothing was supplied to check it against',
    statement: 'A requirement whose verification depends on evidence the caller did not supply.',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
    implementation: 'src/assurance/epistemic.js', context: 'assurance',
    owner: 'Office of the Chief Architect',
    tests: ['phase18-1-specification-compliance.test.js'],
    fitness: ['APP-FIT-EPISTEMIC-INTEGRITY'],
  },
  // 5. Missing evidence: an architectural change with no ADR behind it. The ADR is REQUIRED for this
  //    artefact type, so its absence is a missing required element rather than an optional gap.
  {
    id: 'SYN-MISSING-EVIDENCE', section: 'shape 5 — a required evidence artefact is absent',
    statement: 'A structural change with no recorded architectural decision.',
    artefactType: 'architectural', declaredBy: 'Architecture Review Board',
    implementation: 'src/assurance/epistemic.js', context: 'assurance',
    owner: 'Office of the Chief Architect',
  },
  // 6. Invalid/stale evidence: every declaration is present and points at things that no longer
  //    exist. Worse than absent, because the row reads as covered.
  {
    id: 'SYN-STALE-EVIDENCE', section: 'shape 6 — declarations that point at nothing',
    statement: 'A requirement whose implementation, tests and control were renamed or removed.',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
    implementation: 'src/assurance/renamed-away.js', context: 'assurance',
    owner: 'Office of the Chief Architect',
    tests: ['deleted-in-a-refactor.test.js'], fitness: ['APP-FIT-NO-LONGER-EXISTS'],
  },
  // 8. The succession capability, traced through the register the platform already has rather than
  //    through a separate traceability system. Synthetic like every other entry here: it records
  //    that the CAPABILITY is traceable, not that any institution has exercised it.
  {
    id: 'SYN-SUCCESSION-CAPABILITY', section: 'succession assurance — traceability',
    statement: 'Institutional succession is modelled as an explicit state machine with evidence at every transition and human verification before VERIFIED.',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
    implementation: 'src/governance/ownership.js', context: 'governance-oversight',
    owner: 'Oversight Board', capability: 'governance-decision-recording',
    tests: ['phase19-succession-state-machine.test.js'],
    fitness: ['APP-FIT-SUCCESSION-STATE-MACHINE', 'APP-FIT-GOVERNANCE-SUCCESSION'],
    mutation: ['skipped-state', 'bypassed-transition', 'automatic-verification', 'unauthorized-restoration', 'incorrect-ttar', 'ignored-exercise-failure'],
    documentation: 'docs/architecture-governance.md', runbook: 'docs/operations/runbook.md',
    commits: ['synthetic'],
  },
  // 7. Conflicting evidence: the declarations disagree with one another. The module and the control
  //    both exist, and the context named is not the context that owns either of them — so the row is
  //    internally inconsistent rather than merely incomplete.
  {
    id: 'SYN-CONFLICTING-EVIDENCE', section: 'shape 7 — declarations that contradict each other',
    statement: 'A requirement whose declared bounded context does not exist and whose owner holds nothing.',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
    implementation: 'src/assurance/epistemic.js', context: 'not-a-bounded-context',
    owner: 'Committee That Was Never Constituted',
    tests: ['phase18-1-specification-compliance.test.js'],
    fitness: ['APP-FIT-EPISTEMIC-INTEGRITY'],
  },
];

// Seeds a register with the synthetic corpus. Takes the register rather than creating one, so the
// caller owns the clock and nothing here holds state between runs.
function seedSyntheticRequirements(register, { at = 0 } = {}) {
  for (const r of SYNTHETIC_REQUIREMENTS) {
    register.declare(r.id, { ...r, specification: SYNTHETIC_SPECIFICATION, at });
  }
  return register;
}

module.exports = {
  SYNTHETIC_SPECIFICATION, SYNTHETIC_REQUIREMENTS, seedSyntheticRequirements,
  REQUIREMENT_STATES, ARTEFACT_TYPES, TRACE_ELEMENTS, RequirementRegister,
  COMPLIANCE_STATES, COMPLIANCE_FROM_EPISTEMIC,
  ADR_DIR, FULL_SCHEMA, LEGACY_SCHEMA, EXTENDED_SCHEMA, GOVERNANCE_SCHEMA,
  FULL_SCHEMA_FROM, EXTENDED_SCHEMA_FROM, GOVERNANCE_SCHEMA_FROM,
  MEASURABLE_SECTIONS, DATED_SECTIONS, QUALITY_DIMENSIONS, STATUSES,
  adrFiles, parse, parseText, schemaFor, schemaNameFor, validateAdr, validateParsed, validateCatalogue,
  lifecycle, architecturalDebt, template, schema,
  MERGE_SCHEMA, MERGE_SCHEMA_FROM, MergeRegister, PLATFORM_MERGES, seedPlatformMerges, mergeVerification,
  qualityScore, qualityReport, nextReview, dueForReview, admit,
};
