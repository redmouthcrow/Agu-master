import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'img', 'icon.svg');

if (!fs.existsSync(svgPath)) {
  console.error('[build-icons] Missing', svgPath);
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);

async function writePng(size, filename) {
  const out = path.join(root, 'img', filename);
  await sharp(svg, { density: Math.max(72, size * 2) })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log('[build-icons]', out);
}

await writePng(256, 'icon-256.png');
await writePng(32, 'tray-32.png');
await writePng(16, 'tray-16.png');
