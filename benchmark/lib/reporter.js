'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Collects benchmark results and emits both a machine-readable JSON document
 * and a human-readable Markdown summary (Phase 1 requirement).
 */
class Report {
  constructor(meta) {
    this.doc = {
      generatedAt: new Date().toISOString(),
      meta,
      sections: [],
    };
  }

  /** Add a section: { title, description?, tables?: [{ title, columns, rows }], notes?: [] } */
  section(section) {
    this.doc.sections.push(section);
    return this;
  }

  write(dir, baseName) {
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, `${baseName}.json`);
    const mdPath = path.join(dir, `${baseName}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(this.doc, null, 2));
    fs.writeFileSync(mdPath, this.toMarkdown());
    return { jsonPath, mdPath };
  }

  toMarkdown() {
    const { meta } = this.doc;
    const lines = [];
    lines.push(`# Tirelo Services — PostgreSQL Benchmark Report`);
    lines.push('');
    lines.push(`_Generated: ${this.doc.generatedAt}_`);
    lines.push('');
    lines.push('## Environment');
    lines.push('');
    lines.push(...mdTable(
      ['Property', 'Value'],
      Object.entries(meta).map(([k, v]) => [k, String(v)])
    ));
    lines.push('');

    for (const s of this.doc.sections) {
      lines.push(`## ${s.title}`);
      lines.push('');
      if (s.description) {
        lines.push(s.description, '');
      }
      for (const table of s.tables || []) {
        if (table.title) lines.push(`### ${table.title}`, '');
        lines.push(...mdTable(table.columns, table.rows));
        lines.push('');
      }
      for (const note of s.notes || []) {
        lines.push(`- ${note}`);
      }
      if ((s.notes || []).length) lines.push('');
    }
    return lines.join('\n');
  }
}

function mdTable(columns, rows) {
  const header = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map((c) => (c === undefined || c === null ? '' : String(c))).join(' | ')} |`);
  return [header, sep, ...body];
}

module.exports = { Report, mdTable };
