import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(desktopRoot, 'release');
const stagingDir = path.join(releaseDir, 'staging');
const legacyWinUnpacked = path.join(releaseDir, 'win-unpacked');
const activeOutputFile = path.join(releaseDir, '.active-output');
const killScript = path.join(desktopRoot, 'scripts', 'prepack-kill.ps1');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg) {
  console.log(`[prepack] ${msg}`);
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'ignore', windowsHide: true, ...opts });
}

function killWindowsProcess(name) {
  try {
    run(`taskkill /F /IM ${name} /T`);
    log(`stopped ${name}`);
  } catch {
    /* not running */
  }
}

function killProcessesLockingRelease() {
  if (process.platform !== 'win32') {
    return;
  }

  killWindowsProcess('AguMaster.exe');

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      killScript,
      desktopRoot,
    ],
    { stdio: 'inherit', windowsHide: true },
  );

  if (result.status !== 0) {
    log('process scan finished with warnings (continuing)');
  }
}

function clearReadOnlyAttributes(target) {
  if (process.platform !== 'win32' || !fs.existsSync(target)) {
    return;
  }
  try {
    run(`attrib -R "${target}" /S /D`);
  } catch {
    /* best effort */
  }
}

function removeDirCmd(target) {
  clearReadOnlyAttributes(target);
  run(`cmd /c rmdir /s /q "${target}"`);
}

function removeDirRobocopy(target) {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agu-prepack-empty-'));
  try {
    clearReadOnlyAttributes(target);
    const result = spawnSync(
      'robocopy',
      [emptyDir, target, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'],
      { windowsHide: true },
    );
    if (result.status !== null && result.status > 7) {
      throw new Error(`robocopy exit ${result.status}`);
    }
    removeDirCmd(target);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
}

function removePath(target) {
  if (!fs.existsSync(target)) {
    return;
  }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    removeDirCmd(target);
    if (fs.existsSync(target)) {
      removeDirRobocopy(target);
    }
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    }
    return;
  }

  clearReadOnlyAttributes(target);
  fs.unlinkSync(target);
}

async function removeWithRetry(target, attempts = 5) {
  if (!fs.existsSync(target)) {
    return true;
  }

  const label = path.relative(desktopRoot, target);

  for (let i = 1; i <= attempts; i += 1) {
    try {
      if (process.platform === 'win32') {
        removePath(target);
      } else {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
      }

      if (fs.existsSync(target)) {
        throw new Error('still exists');
      }

      log(`removed ${label}`);
      return true;
    } catch (err) {
      if (i === attempts) {
        return false;
      }
      log(`retry ${i}/${attempts - 1} for ${label}: ${err.code || err.message}`);
      killProcessesLockingRelease();
      await sleep(1200);
    }
  }

  return false;
}

async function removeOrQuarantine(target, label) {
  const removed = await removeWithRetry(target, 4);
  if (removed) {
    return;
  }

  const quarantine = `${target}.locked.${Date.now()}`;
  try {
    fs.renameSync(target, quarantine);
    log(`${label} quarantined to ${path.basename(quarantine)}`);
    await removeWithRetry(quarantine, 2);
  } catch (renameErr) {
    log(`warning: ${label} still locked (${renameErr.message})`);
  }
}

async function ensureStagingOutput() {
  killProcessesLockingRelease();
  await sleep(1000);
  killProcessesLockingRelease();
  await sleep(500);

  log('cleaning release/staging...');
  const stagingRemoved = await removeWithRetry(stagingDir, 4);

  let outputDir = stagingDir;
  if (!stagingRemoved && fs.existsSync(stagingDir)) {
    const quarantine = `${stagingDir}.locked.${Date.now()}`;
    try {
      fs.renameSync(stagingDir, quarantine);
      log(`staging quarantined to ${path.basename(quarantine)}`);
      outputDir = stagingDir;
    } catch {
      outputDir = path.join(releaseDir, `staging-${Date.now()}`);
      log(`staging locked; using alternate output: ${path.relative(desktopRoot, outputDir)}`);
      log('tip: close apps scanning desktop\\release (Explorer, antivirus, IDE) and delete old staging manually');
    }
  }

  if (fs.existsSync(legacyWinUnpacked)) {
    log('cleaning legacy release/win-unpacked...');
    await removeOrQuarantine(legacyWinUnpacked, 'legacy win-unpacked');
  }

  if (fs.existsSync(releaseDir)) {
    for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      if (/\.(exe|7z|blockmap)$/i.test(entry.name)) {
        await removeWithRetry(path.join(releaseDir, entry.name));
      }
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const relOutput = path.relative(desktopRoot, outputDir).replace(/\\/g, '/');
  fs.writeFileSync(activeOutputFile, `${relOutput}\n`, 'utf8');
  log(`release folder ready (${relOutput})`);
}

async function main() {
  log('stopping AguMaster / Electron / Explorer windows on release...');
  await ensureStagingOutput();
}

main().catch((err) => {
  console.error('[prepack] failed:', err.message);
  console.error('[prepack] if still locked: reboot or close apps using desktop\\release, then retry.');
  process.exit(1);
});
