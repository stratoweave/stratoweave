// CSV import and export of the fleet's devices: one row per device, one
// column per leaf. A header is the leaf's path inside the device entry, e.g.
// `credentials/username`. Repeated elements, leaf-list values and nested
// list entries, take a 1-based index: `redundancy-group[2]`,
// `address[2]/name`; a plain name means [1]. An empty cell leaves the leaf
// out, so an import merges and never deletes.
//
// Import writes XML, which needs no schema: lists, leaf-lists and
// containers are all nested or repeated elements.

import { formatCsv, parseCsv } from '#lib/core/csv.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { FLEET_ROOT } from '#lib/software/model.ts';

type Fetch = typeof fetch;

const CONTAINER = 'fleet';
const LIST = 'device';
const NAMESPACE = 'urn:fleetmgr:fleetmgr';
const KEY = 'name';

/** What a device that does not exist yet needs, as the Add device form
 * asks for it; the top refuses an entry without them. */
const NEW_DEVICE_NEEDS = ['type', 'credentials/username'];

/** A header line to show in an empty import box. */
export const DEVICES_CSV_EXAMPLE = 'name,type,address/address,credentials/username,credentials/password';

// ── Import ──

interface Segment {
  name: string;
  index: number;
}

// Element name -> index -> leaf text or child elements. Names keep the
// order they first appear in, which is column order.
type Tree = Map<string, Map<number, Tree | string>>;

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_.-]*)(?:\[([1-9][0-9]*)\])?$/;

function parseHeader(header: string): Segment[] | string {
  if (!header) return 'empty header';
  const segments: Segment[] = [];
  for (const part of header.split('/')) {
    if (part.includes(':')) return `"${header}": module prefixes are not supported`;
    const match = SEGMENT.exec(part);
    if (!match) return `"${header}": not a leaf path`;
    segments.push({ name: match[1], index: match[2] ? Number(match[2]) : 1 });
  }
  return segments;
}

function insert(tree: Tree, segments: Segment[], value: Tree | string): void {
  let node = tree;
  for (const [position, { name, index }] of segments.entries()) {
    let byIndex = node.get(name);
    if (!byIndex) {
      byIndex = new Map();
      node.set(name, byIndex);
    }
    if (position === segments.length - 1) {
      byIndex.set(index, value);
      return;
    }
    let child = byIndex.get(index);
    if (child === undefined) {
      child = new Map();
      byIndex.set(index, child);
    }
    node = child as Tree;
  }
}

/** Checks that no two headers name the same leaf and that no header names a
 * leaf where another one needs a container. */
function headerConflicts(paths: Segment[][], headers: string[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const [column, segments] of paths.entries()) {
    const full = segments.map((s) => `${s.name}[${s.index}]`);
    for (let length = 1; length <= full.length; length++) {
      const prefix = full.slice(0, length).join('/');
      const leaf = length === full.length;
      const other = seen.get(prefix);
      if (other !== undefined) {
        const otherLeaf = other >= 0;
        if (leaf || otherLeaf) {
          const otherColumn = otherLeaf ? other : -other - 1;
          errors.push(`"${headers[column]}" clashes with "${headers[otherColumn]}"`);
          break;
        }
      } else {
        // Leaves store their column, containers -(column + 1).
        seen.set(prefix, leaf ? column : -column - 1);
      }
    }
  }
  return errors;
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function writeTree(tree: Tree, depth: number, out: string[], keyFirst?: string): void {
  const indent = '  '.repeat(depth);
  const names = [...tree.keys()];
  if (keyFirst && tree.has(keyFirst)) {
    names.splice(names.indexOf(keyFirst), 1);
    names.unshift(keyFirst);
  }
  for (const name of names) {
    const byIndex = tree.get(name)!;
    for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
      const child = byIndex.get(index)!;
      if (typeof child === 'string') {
        out.push(`${indent}<${name}>${escapeXml(child)}</${name}>`);
      } else {
        out.push(`${indent}<${name}>`);
        writeTree(child, depth + 1, out);
        out.push(`${indent}</${name}>`);
      }
    }
  }
}

export interface CsvImport {
  /** Empty when there are errors. */
  xml: string;
  entries: number;
  errors: string[];
}

/** The XML PATCH of the datastore that merges one device per CSV row. A
 * row for a name not in existing needs NEW_DEVICE_NEEDS. Any error gives no
 * XML. */
export function devicesCsvToXml(text: string, existing: Set<string> = new Set()): CsvImport {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (err) {
    return { xml: '', entries: 0, errors: [err instanceof Error ? err.message : String(err)] };
  }
  if (rows.length === 0) return { xml: '', entries: 0, errors: ['no header row'] };

  const errors: string[] = [];
  const headers = rows[0];
  const paths: Segment[][] = [];
  for (const [column, header] of headers.entries()) {
    const parsed = parseHeader(header);
    if (typeof parsed === 'string') {
      errors.push(`column ${column + 1}: ${parsed}`);
    } else {
      paths.push(parsed);
    }
  }
  if (errors.length > 0) return { xml: '', entries: 0, errors };
  errors.push(...headerConflicts(paths, headers));
  const keyColumn = paths.findIndex(
    (segments) => segments.length === 1 && segments[0].name === KEY && segments[0].index === 1
  );
  if (keyColumn < 0) errors.push(`no "${KEY}" column`);
  if (errors.length > 0) return { xml: '', entries: 0, errors };
  const neededColumns = NEW_DEVICE_NEEDS.map((path) =>
    headers.findIndex((_, column) => paths[column].map((s) => s.name).join('/') === path && paths[column].every((s) => s.index === 1))
  );

  const entries: Tree[] = [];
  const keyRows = new Map<string, number>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowNumber = r + 1;
    if (row.every((cell) => cell === '')) continue;
    if (row.slice(headers.length).some((cell) => cell !== '')) {
      errors.push(`row ${rowNumber}: ${row.length} cells, the header has ${headers.length}`);
      continue;
    }
    const key = row[keyColumn] ?? '';
    if (!key) {
      errors.push(`row ${rowNumber}: no ${KEY}`);
      continue;
    }
    const earlier = keyRows.get(key);
    if (earlier !== undefined) {
      errors.push(`row ${rowNumber}: ${KEY} ${key} is also on row ${earlier}`);
      continue;
    }
    keyRows.set(key, rowNumber);
    if (!existing.has(key)) {
      const missing = NEW_DEVICE_NEEDS.filter((_, i) => neededColumns[i] < 0 || !row[neededColumns[i]]);
      if (missing.length > 0) {
        errors.push(`row ${rowNumber}: new device ${key} needs ${missing.join(' and ')}`);
        continue;
      }
    }
    const entry: Tree = new Map();
    for (const [column, segments] of paths.entries()) {
      const value = row[column] ?? '';
      if (value !== '') insert(entry, segments, value);
    }
    entries.push(entry);
  }
  if (errors.length > 0) return { xml: '', entries: 0, errors };
  if (entries.length === 0) return { xml: '', entries: 0, errors: ['no rows below the header'] };

  // The top answers 204 to a bare top-level node and drops it, so the
  // PATCH needs the <data> root.
  const out = ['<data>', `  <${CONTAINER} xmlns="${NAMESPACE}">`];
  for (const entry of entries) {
    out.push(`    <${LIST}>`);
    writeTree(entry, 3, out, KEY);
    out.push(`    </${LIST}>`);
  }
  out.push(`  </${CONTAINER}>`, '</data>');
  return { xml: out.join('\n') + '\n', entries: entries.length, errors: [] };
}

// ── Export ──

// Element name -> index -> child columns, or null for a leaf. Index 0 is
// a single element, 1.. are array elements.
type ColumnTree = Map<string, Map<number, ColumnTree | null>>;

function flatten(
  value: unknown,
  prefix: Segment[],
  cells: Map<string, string>,
  columns: ColumnTree
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') {
    cells.set(columnKey(prefix), String(value));
    addColumn(columns, prefix);
    return;
  }
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      child.forEach((item, i) => flatten(item, [...prefix, { name, index: i + 1 }], cells, columns));
    } else {
      flatten(child, [...prefix, { name, index: 0 }], cells, columns);
    }
  }
}

function columnKey(segments: Segment[]): string {
  return segments.map((s) => `${s.name}[${s.index}]`).join('/');
}

function addColumn(columns: ColumnTree, segments: Segment[]): void {
  let node = columns;
  for (const [position, { name, index }] of segments.entries()) {
    let byIndex = node.get(name);
    if (!byIndex) {
      byIndex = new Map();
      node.set(name, byIndex);
    }
    if (position === segments.length - 1) {
      if (!byIndex.has(index)) byIndex.set(index, null);
      return;
    }
    let child = byIndex.get(index);
    if (!child) {
      child = new Map();
      byIndex.set(index, child);
    }
    node = child;
  }
}

// Columns in the order their names first appear, the elements of one array
// together. A segment shows its index only where some entry has a second
// element there.
function listColumns(
  columns: ColumnTree,
  keyPrefix: string,
  headerPrefix: string,
  out: { key: string; header: string }[]
): void {
  for (const [name, byIndex] of columns) {
    const indices = [...byIndex.keys()].sort((a, b) => a - b);
    const showIndex = indices.some((index) => index > 1);
    for (const index of indices) {
      const key = `${keyPrefix}${name}[${index}]`;
      const header = `${headerPrefix}${name}${showIndex ? `[${index}]` : ''}`;
      const child = byIndex.get(index);
      if (child) {
        listColumns(child, `${key}/`, `${header}/`, out);
      } else {
        out.push({ key, header });
      }
    }
  }
}

function keyOf(item: unknown, key: string): string {
  const value = item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined;
  return value === undefined || value === null ? '' : String(value);
}

/** The CSV of a RESTCONF JSON read of the fleet,
 * `{"fleetmgr:fleet": {"device": [...]}}`, rows in name order. */
export function devicesToCsv(json: unknown): string {
  let items: unknown[] = [];
  if (json && typeof json === 'object') {
    const container = Object.values(json as Record<string, unknown>)[0];
    const list = container && typeof container === 'object'
      ? (container as Record<string, unknown>)[LIST]
      : undefined;
    if (Array.isArray(list)) items = list;
  }
  items = [...items].sort((a, b) =>
    keyOf(a, KEY).localeCompare(keyOf(b, KEY), undefined, { numeric: true })
  );
  const columns: ColumnTree = new Map();
  // The key column comes first even when the list is empty.
  addColumn(columns, [{ name: KEY, index: 0 }]);
  const rows = items.map((item) => {
    const cells = new Map<string, string>();
    flatten(item, [], cells, columns);
    return cells;
  });
  const list: { key: string; header: string }[] = [];
  listColumns(columns, '', '', list);
  return formatCsv([
    list.map((column) => column.header),
    ...rows.map((cells) => list.map((column) => cells.get(column.key) ?? ''))
  ]);
}

/** The devices as CSV, read with RESTCONF content=config: the config only,
 * not the state the fleet reports. No fleet (404) gives just the header. */
export async function fetchDevicesCsv(fetchFn: Fetch = fetch): Promise<string> {
  const json = await restconfGetOrNull<unknown>(`${FLEET_ROOT}?content=config`, fetchFn);
  return devicesToCsv(json);
}
