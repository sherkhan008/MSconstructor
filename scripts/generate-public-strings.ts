import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT_DIR, readPublicStrings, renderModules } from './public-strings';

/**
 * Regenerates src/lib/i18n/strings/*.ts from docs/localization/public-strings.csv.
 * Usage: `npm run i18n:generate`. See scripts/public-strings.ts.
 */
const files = renderModules(readPublicStrings());

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const name of readdirSync(OUTPUT_DIR)) {
  if (!files.has(name)) rmSync(join(OUTPUT_DIR, name));
}
for (const [name, content] of files) writeFileSync(join(OUTPUT_DIR, name), content, 'utf8');

console.log(`Wrote ${files.size} modules to ${OUTPUT_DIR}`);
