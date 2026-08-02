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

// Sections whose content must actually be measurable — a threshold, a count, a percentage or a
// date. This is the one place the validator reads content rather than structure, because
// "improve reliability" satisfies a heading check and commits to nothing.
const MEASURABLE_SECTIONS = ['Measurable success criteria', 'Success metrics'];
const MEASURABLE_PATTERN = /\d/;

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
  if (number >= EXTENDED_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA, ...EXTENDED_SCHEMA];
  if (number >= FULL_SCHEMA_FROM) return [...LEGACY_SCHEMA, ...FULL_SCHEMA];
  return LEGACY_SCHEMA;
}
function schemaNameFor(number) { return number >= EXTENDED_SCHEMA_FROM ? 'extended' : number >= FULL_SCHEMA_FROM ? 'full' : 'legacy'; }

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
  ].join('\n');
}

function schema() {
  return {
    legacy: LEGACY_SCHEMA.map((s) => ({ ...s })),
    full: FULL_SCHEMA.map((s) => ({ ...s })),
    extended: EXTENDED_SCHEMA.map((s) => ({ ...s })),
    fullSchemaFrom: FULL_SCHEMA_FROM, extendedSchemaFrom: EXTENDED_SCHEMA_FROM,
    measurableSections: [...MEASURABLE_SECTIONS],
    statuses: [...STATUSES],
  };
}

module.exports = {
  ADR_DIR, FULL_SCHEMA, LEGACY_SCHEMA, EXTENDED_SCHEMA, FULL_SCHEMA_FROM, EXTENDED_SCHEMA_FROM,
  MEASURABLE_SECTIONS, STATUSES,
  adrFiles, parse, parseText, schemaFor, schemaNameFor, validateAdr, validateParsed, validateCatalogue,
  lifecycle, architecturalDebt, template, schema,
};
