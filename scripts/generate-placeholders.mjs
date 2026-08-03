import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates clearly-labelled placeholder SVG "photographs" for every image
 * path referenced by src/lib/data/seed-data.ts, so the storefront never 404s
 * on a product image before real photography is uploaded.
 *
 * To replace a placeholder with a real photo later: drop a file at the same
 * public/ path (or update the path in seed-data.ts / the admin panel) — the
 * rest of the app already reads image paths as plain strings.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');

const seedSource = readFileSync(join(root, 'src/lib/data/seed-data.ts'), 'utf8');
const matches = seedSource.match(/\/images\/[a-zA-Z0-9/_-]+\.svg/g) ?? [];
const paths = [...new Set(matches)];

function labelFromPath(path) {
  const file = path.split('/').pop() ?? path;
  const name = file.replace(/\.svg$/, '');
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function categoryFromPath(path) {
  if (path.includes('/models/')) return 'MODEL';
  if (path.includes('/accessories/')) return 'ACCESSORY';
  if (path.includes('/gallery/')) return 'GALLERY';
  return 'PLACEHOLDER';
}

function buildSvg(path) {
  const category = categoryFromPath(path);
  const label = labelFromPath(path);
  const isIcon = category === 'ACCESSORY';
  const width = isIcon ? 400 : 800;
  const height = isIcon ? 300 : 600;
  const gridStep = 20;

  let grid = '';
  for (let x = gridStep; x < width; x += gridStep) {
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#2F5D8A" stroke-opacity="0.08" stroke-width="1"/>`;
  }
  for (let y = gridStep; y < height; y += gridStep) {
    grid += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#2F5D8A" stroke-opacity="0.08" stroke-width="1"/>`;
  }

  const cross = (cx, cy) =>
    `<line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="#5B6470" stroke-width="1.5"/>` +
    `<line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="#5B6470" stroke-width="1.5"/>`;

  const shelfLines = isIcon
    ? ''
    : Array.from({ length: 4 }, (_, i) => {
        const y = 160 + i * 90;
        return `<line x1="140" y1="${y}" x2="${width - 140}" y2="${y}" stroke="#8B939D" stroke-width="4"/>`;
      }).join('');
  const uprights = isIcon
    ? ''
    : `<line x1="140" y1="120" x2="140" y2="${height - 80}" stroke="#5B6470" stroke-width="6"/>` +
      `<line x1="${width - 140}" y1="120" x2="${width - 140}" y2="${height - 80}" stroke="#5B6470" stroke-width="6"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#F6F7F5"/>
  ${grid}
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="#D8DCE0" stroke-width="2" stroke-dasharray="6 6"/>
  ${cross(30, 30)}${cross(width - 30, 30)}${cross(30, height - 30)}${cross(width - 30, height - 30)}
  ${uprights}
  ${shelfLines}
  <rect x="${width / 2 - 150}" y="${height / 2 - 26}" width="300" height="52" fill="#1C2024" fill-opacity="0.85"/>
  <text x="${width / 2}" y="${height / 2 - 4}" font-family="IBM Plex Mono, monospace" font-size="13" fill="#F6F7F5" text-anchor="middle" letter-spacing="1">${category} — SAMPLE IMAGE</text>
  <text x="${width / 2}" y="${height / 2 + 16}" font-family="IBM Plex Mono, monospace" font-size="12" fill="#F0A202" text-anchor="middle">${label}</text>
</svg>`;
}

let created = 0;
for (const path of paths) {
  const outPath = join(publicDir, path);
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(outPath)) {
    writeFileSync(outPath, buildSvg(path), 'utf8');
    created += 1;
  }
}

console.info(`Placeholder images: ${created} created, ${paths.length - created} already present (of ${paths.length} referenced).`);
