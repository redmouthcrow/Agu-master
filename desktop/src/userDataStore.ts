import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const STORE_DIR_NAME = 'agu';
const CONFIG_FILE = 'config.json';
const DIAGNOSIS_FILE = 'diagnosis-cache.json';
const LIVE_SYNC_FILE = 'live-sync.json';
const CALENDAR_DIR = 'calendars';

export interface PersistedAppConfig {
  baseUrl: string;
  model: string;
  refreshFrequency: 30 | 60;
  watchlist: unknown[];
  widgetPinnedCodes?: string[];
  widgetOpacity?: number;
  widgetAlwaysOnTop?: boolean;
}

export interface ConfigFilePayload {
  version: 1;
  apiKeyEnc?: string;
  /** Fallback when OS encryption is unavailable */
  apiKeyPlain?: string;
  encryptionAvailable: boolean;
  config: PersistedAppConfig;
}

export interface UserDataSnapshot {
  config: (PersistedAppConfig & { apiKey: string }) | null;
  diagnosisCache: Record<string, unknown> | null;
  liveSync: unknown | null;
}

function storeRoot(): string {
  return path.join(app.getPath('userData'), STORE_DIR_NAME);
}

function ensureStoreDir(): string {
  const root = storeRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, CALENDAR_DIR), { recursive: true });
  return root;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): boolean {
  try {
    ensureStoreDir();
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[AguMaster] Failed to write user data:', filePath, err);
    return false;
  }
}

function encryptApiKey(apiKey: string): string | undefined {
  if (!apiKey.trim()) {
    return undefined;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  return safeStorage.encryptString(apiKey).toString('base64');
}

function decryptApiKey(apiKeyEnc: string | undefined): string {
  if (!apiKeyEnc || !safeStorage.isEncryptionAvailable()) {
    return '';
  }
  try {
    return safeStorage.decryptString(Buffer.from(apiKeyEnc, 'base64'));
  } catch {
    return '';
  }
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function getUserDataPath(): string {
  return storeRoot();
}

export function loadUserDataSnapshot(): UserDataSnapshot {
  const root = storeRoot();
  const configPayload = readJsonFile<ConfigFilePayload>(path.join(root, CONFIG_FILE));
  let config: (PersistedAppConfig & { apiKey: string }) | null = null;

  if (configPayload?.config) {
    const fromEnc = decryptApiKey(configPayload.apiKeyEnc);
    config = {
      ...configPayload.config,
      apiKey: fromEnc || configPayload.apiKeyPlain || '',
    };
  }

  return {
    config,
    diagnosisCache: readJsonFile<Record<string, unknown>>(path.join(root, DIAGNOSIS_FILE)),
    liveSync: readJsonFile<unknown>(path.join(root, LIVE_SYNC_FILE)),
  };
}

export function saveAppConfig(config: PersistedAppConfig & { apiKey: string }): boolean {
  const { apiKey, ...rest } = config;
  const apiKeyEnc = encryptApiKey(apiKey);
  const payload: ConfigFilePayload = {
    version: 1,
    apiKeyEnc,
    apiKeyPlain: !apiKeyEnc && apiKey.trim() ? apiKey : undefined,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    config: rest,
  };
  return writeJsonFile(path.join(ensureStoreDir(), CONFIG_FILE), payload);
}

function configHasUserData(config: (PersistedAppConfig & { apiKey?: string }) | null): boolean {
  if (!config) {
    return false;
  }
  if (config.apiKey?.trim()) {
    return true;
  }
  return Array.isArray(config.watchlist) && config.watchlist.length > 0;
}

export function saveDiagnosisCache(cache: Record<string, unknown>): boolean {
  return writeJsonFile(path.join(ensureStoreDir(), DIAGNOSIS_FILE), cache);
}

export function saveLiveSync(payload: unknown): boolean {
  return writeJsonFile(path.join(ensureStoreDir(), LIVE_SYNC_FILE), payload);
}

export function loadLiveSync(): unknown | null {
  return readJsonFile<unknown>(path.join(storeRoot(), LIVE_SYNC_FILE));
}

export function storageGet(key: string): unknown | null {
  if (key.startsWith('trading_calendar_')) {
    const year = key.replace('trading_calendar_', '');
    return readJsonFile<unknown>(
      path.join(storeRoot(), CALENDAR_DIR, `calendar-${year}.json`),
    );
  }
  return null;
}

export function storageSet(key: string, value: unknown): boolean {
  if (key.startsWith('trading_calendar_')) {
    const year = key.replace('trading_calendar_', '');
    return writeJsonFile(
      path.join(ensureStoreDir(), CALENDAR_DIR, `calendar-${year}.json`),
      value,
    );
  }
  return false;
}

export function storageRemove(key: string): void {
  if (!key.startsWith('trading_calendar_')) {
    return;
  }
  const year = key.replace('trading_calendar_', '');
  const filePath = path.join(storeRoot(), CALENDAR_DIR, `calendar-${year}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* ignore */
  }
}

export function cleanupOldCalendars(keepYears: number[]): void {
  const dir = path.join(storeRoot(), CALENDAR_DIR);
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const name of fs.readdirSync(dir)) {
    const match = /^calendar-(\d{4})\.json$/.exec(name);
    if (!match) {
      continue;
    }
    const year = parseInt(match[1], 10);
    if (!keepYears.includes(year)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }
}

export function importMigration(payload: {
  config?: (PersistedAppConfig & { apiKey: string }) | null;
  diagnosisCache?: Record<string, unknown> | null;
  liveSync?: unknown | null;
}): boolean {
  ensureStoreDir();
  const existing = loadUserDataSnapshot();
  let ok = true;

  if (!existing.config && configHasUserData(payload.config ?? null)) {
    ok = saveAppConfig(payload.config!) && ok;
  }
  if (!existing.diagnosisCache && payload.diagnosisCache) {
    ok = saveDiagnosisCache(payload.diagnosisCache) && ok;
  }
  if (!existing.liveSync && payload.liveSync) {
    ok = saveLiveSync(payload.liveSync) && ok;
  }

  return ok;
}

export function exportUserDataForBackup(): { ok: boolean; path?: string } {
  const root = storeRoot();
  if (!fs.existsSync(root)) {
    return { ok: false };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(app.getPath('documents'), 'AguMaster-backup');
  const target = path.join(backupDir, `agu-backup-${stamp}`);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.cpSync(root, target, { recursive: true });
    return { ok: true, path: target };
  } catch (err) {
    console.error('[AguMaster] Backup failed:', err);
    return { ok: false };
  }
}
