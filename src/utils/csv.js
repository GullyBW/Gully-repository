'use strict';

/**
 * Minimal, dependency-free CSV serialiser. Quotes fields containing commas,
 * quotes or newlines and escapes embedded quotes per RFC 4180.
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @param {Array<object>} rows
 * @param {string[]} [columns] explicit column order; defaults to keys of row 0
 */
function toCSV(rows, columns) {
  if (!rows || rows.length === 0) return '';
  const cols = columns || Object.keys(rows[0]);
  const header = cols.map(escapeField).join(',');
  const body = rows.map((row) => cols.map((c) => escapeField(row[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

module.exports = { toCSV };
