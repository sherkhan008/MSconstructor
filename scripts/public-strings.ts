import { readFileSync } from 'node:fs';

/**
 * docs/localization/public-strings.csv → typed runtime dictionaries.
 *
 * The CSV is the owner-reviewed source of truth for public copy. It is never
 * parsed at request time: `npm run i18n:generate` turns it into one module
 * per id prefix under src/lib/i18n/strings/, with `ru_text` and `kk_proposed`
 * copied byte for byte (placeholders included — they are resolved at render
 * time by src/lib/i18n/format.ts). The output is a pure function of the CSV
 * bytes, and tests/integration/public-strings-dictionary.test.ts fails when
 * the committed modules differ from a fresh generation.
 */

export const CSV_PATH = 'docs/localization/public-strings.csv';
export const OUTPUT_DIR = 'src/lib/i18n/strings';
export const COLUMNS = ['id', 'section', 'route', 'source_file', 'context', 'ru_text', 'kk_proposed', 'review_status', 'notes'] as const;

export type PublicStringRow = Record<(typeof COLUMNS)[number], string>;

/** RFC 4180: quoted fields, "" escapes, CRLF records (same rules as the inventory test). */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
    } else field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function readPublicStrings(path = CSV_PATH): PublicStringRow[] {
  const bytes = readFileSync(path);
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
  const [header, ...records] = parseCsv(text);
  if (JSON.stringify(header) !== JSON.stringify(COLUMNS)) throw new Error(`Unexpected CSV header: ${header.join(',')}`);
  return records.map((r) => {
    if (r.length !== COLUMNS.length) throw new Error(`Row ${r[0]} has ${r.length} columns`);
    return Object.fromEntries(COLUMNS.map((c, i) => [c, r[i]])) as PublicStringRow;
  });
}

/** 'HM-006' → 'HM'. */
export function idPrefix(id: string): string {
  const match = /^([A-Z]{1,2})-\d{3}$/.exec(id);
  if (!match) throw new Error(`Malformed id ${id}`);
  return match[1];
}

/** Single-line comment text: the CSV context, collapsed. */
function comment(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim();
}

/** Every generated module, keyed by file name. Deterministic: CSV order, fixed formatting. */
export function renderModules(rows: PublicStringRow[]): Map<string, string> {
  const byPrefix = new Map<string, PublicStringRow[]>();
  for (const row of rows) {
    const prefix = idPrefix(row.id);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(row);
  }

  const header = [
    '// GENERATED FILE — do not edit by hand.',
    '// Source: docs/localization/public-strings.csv (owner-reviewed). Regenerate: npm run i18n:generate',
    '',
  ].join('\n');

  const files = new Map<string, string>();
  const prefixes = [...byPrefix.keys()].sort();
  for (const prefix of prefixes) {
    const lines = [header, `export const ${prefix} = {`];
    for (const row of byPrefix.get(prefix)!) {
      lines.push(`  /** ${comment(row.context)} */`);
      lines.push(`  ${JSON.stringify(row.id)}: {`);
      lines.push(`    ru: ${JSON.stringify(row.ru_text)},`);
      lines.push(`    kk: ${JSON.stringify(row.kk_proposed)},`);
      lines.push('  },');
    }
    lines.push('} as const;', '');
    files.set(`${prefix}.ts`, lines.join('\n'));
  }

  const index = [header];
  for (const prefix of prefixes) index.push(`export { ${prefix} } from './${prefix}';`);
  index.push('');
  files.set('index.ts', index.join('\n'));
  return files;
}
