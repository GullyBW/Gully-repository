import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { downloadText } from './download.util';

type Row = Record<string, unknown>;

/**
 * Client-side report exporting. Turns a flat array of objects into CSV, PDF
 * (jsPDF + autotable) or Excel (SheetJS). Pages pass the rows they already
 * render, so exports stay consistent with what the user sees.
 */
@Injectable({ providedIn: 'root' })
export class ReportExportService {
  private columns(rows: Row[]): string[] {
    return rows.length ? Object.keys(rows[0]) : [];
  }

  csv(filename: string, rows: Row[]): void {
    const cols = this.columns(rows);
    const header = cols.join(',');
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
    downloadText(`${filename}.csv`, `${header}\n${body}`);
  }

  excel(filename: string, rows: Row[]): void {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  pdf(filename: string, rows: Row[], title?: string): void {
    const doc = new jsPDF();
    const cols = this.columns(rows);
    if (title) doc.text(title, 14, 16);
    autoTable(doc, {
      startY: title ? 22 : 14,
      head: [cols],
      body: rows.map((r) => cols.map((c) => String(r[c] ?? ''))),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [31, 122, 140] },
    });
    doc.save(`${filename}.pdf`);
  }
}
