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

const STATUSES = ['Proposed', 'Accepted', 'Superseded', 'Rejected'];

function adrFiles() {
  if (!fs.existsSync(ADR_DIR)) return [];
  return fs.readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
}

// Parse one ADR into { number, title, status, sections }.
function parse(file) {
  const text = fs.readFileSync(path.join(ADR_DIR, file), 'utf8');
  const number = Number(file.slice(0, 4));
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
function schemaFor(number) { return number >= FULL_SCHEMA_FROM ? [...LEGACY_SCHEMA, ...FULL_SCHEMA] : LEGACY_SCHEMA; }

// Validate one ADR against the schema that applies to it.
function validateAdr(file, { minSectionChars = 40 } = {}) {
  const adr = parse(file);
  const violations = [];
  if (!adr.title) violations.push('no `# ADR-NNNN: title` heading');
  if (!adr.status) violations.push('no **Status:** line');
  else if (!STATUSES.includes(adr.status)) violations.push(`unknown status '${adr.status}'`);
  const schema = schemaFor(adr.number);
  for (const s of schema) {
    const body = adr.sections[s.heading.toLowerCase()];
    if (body === undefined) violations.push(`missing required section '${s.heading}'${s.why ? ` — ${s.why}` : ''}`);
    else if (body.length < minSectionChars) violations.push(`section '${s.heading}' is present but empty (< ${minSectionChars} chars)`);
  }
  return {
    file, number: adr.number, title: adr.title, status: adr.status,
    schema: adr.number >= FULL_SCHEMA_FROM ? 'full' : 'legacy',
    sections: Object.keys(adr.sections),
    valid: violations.length === 0, violations,
  };
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
  return {
    adrs: results, count: results.length,
    fullSchemaFrom: FULL_SCHEMA_FROM,
    valid: violations.length === 0, violations,
    note: 'ADRs from 0004 satisfy the expanded schema; earlier ones predate it and are held to the legacy schema rather than being rewritten.',
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
  ].join('\n');
}

function schema() { return { legacy: LEGACY_SCHEMA.map((s) => ({ ...s })), full: FULL_SCHEMA.map((s) => ({ ...s })), fullSchemaFrom: FULL_SCHEMA_FROM, statuses: [...STATUSES] }; }

module.exports = { ADR_DIR, FULL_SCHEMA, LEGACY_SCHEMA, FULL_SCHEMA_FROM, STATUSES, adrFiles, parse, schemaFor, validateAdr, validateCatalogue, template, schema };
