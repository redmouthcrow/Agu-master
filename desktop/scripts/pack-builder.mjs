import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activeOutputFile = path.join(desktopRoot, 'release', '.active-output');

function readOutputDir() {
  if (fs.existsSync(activeOutputFile)) {
    const rel = fs.readFileSync(activeOutputFile, 'utf8').trim();
    if (rel) {
      return rel.replace(/\\/g, '/');
    }
  }
  return 'release/staging';
}

const outputDir = readOutputDir();
const builderArgs = [
  '--no-install',
  'electron-builder',
  ...process.argv.slice(2),
  `--config.directories.output=${outputDir}`,
];

console.log(`[pack] electron-builder output: ${outputDir}`);

const result = spawnSync('npx', builderArgs, {
  cwd: desktopRoot,
  stdio: 'inherit',
  shell: true,
  windowsHide: true,
});

process.exit(result.status ?? 1);
