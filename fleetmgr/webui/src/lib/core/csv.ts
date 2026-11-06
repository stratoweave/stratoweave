// CSV as RFC 4180 writes it: "" escapes a quote inside a quoted cell, and a
// quoted cell may hold the delimiter and newlines. The delimiter is the one
// the header line uses most: a comma, a semicolon (Excel in some locales) or
// a tab (a range pasted from a spreadsheet). Unquoted cells are trimmed.

const DELIMITERS = [',', ';', '\t'];

function detectDelimiter(text: string): string {
  const end = text.indexOf('\n');
  const header = end < 0 ? text : text.slice(0, end);
  let best = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = header.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** The rows of `text`, blank rows included so row numbers match a
 * spreadsheet's; blank rows at the end are dropped. Throws on a quote that
 * is never closed or is followed by more text. */
export function parseCsv(text: string): string[][] {
  if (text.startsWith('﻿')) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const n = text.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && text[j] === ' ') j++;
    if (text[j] === '"') {
      let value = '';
      j++;
      for (;;) {
        if (j >= n) throw new Error(`row ${rows.length + 1}: a quote is not closed`);
        const close = text.indexOf('"', j);
        if (close < 0) throw new Error(`row ${rows.length + 1}: a quote is not closed`);
        value += text.slice(j, close);
        if (text[close + 1] === '"') {
          value += '"';
          j = close + 2;
        } else {
          j = close + 1;
          break;
        }
      }
      while (j < n && text[j] === ' ') j++;
      if (j < n && text[j] !== delimiter && text[j] !== '\n' && text[j] !== '\r') {
        throw new Error(`row ${rows.length + 1}: text after a closing quote`);
      }
      row.push(value);
    } else {
      j = i;
      while (j < n && text[j] !== delimiter && text[j] !== '\n' && text[j] !== '\r') j++;
      row.push(text.slice(i, j).trim());
    }
    if (j >= n) {
      i = n;
      break;
    }
    if (text[j] === delimiter) {
      i = j + 1;
      // A delimiter at the very end still ends with an empty cell.
      if (i >= n) row.push('');
      continue;
    }
    if (text[j] === '\r' && text[j + 1] === '\n') j++;
    rows.push(row);
    row = [];
    i = j + 1;
  }
  if (row.length > 0) rows.push(row);
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) rows.pop();
  return rows;
}

function quote(cell: string): string {
  const needsQuotes = /[",\r\n]/.test(cell) || cell !== cell.trim();
  return needsQuotes ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** Comma-separated rows, one per line, quoting only where needed. */
export function formatCsv(rows: string[][]): string {
  return rows.map((row) => row.map(quote).join(',')).join('\n') + (rows.length > 0 ? '\n' : '');
}
