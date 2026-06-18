import type { AppConfig, DiagnosisCacheEntry, LiveSyncPayload } from '../types';
import { isDesktopRuntime } from '../utils/appMode';
import { collectLegacyStorageForMigration, getItem, setItem } from '../utils/storage';

const CONFIG_KEY = 'config';
const DIAG_KEY = 'diagnosis_cache';
const LIVE_SYNC_KEY = 'live_sync';

interface DesktopUserDataSnapshot {
  config: AppConfig | null;
  diagnosisCache: Record<string, DiagnosisCacheEntry> | null;
  liveSync: LiveSyncPayload | null;
  encryptionAvailable: boolean;
  userDataPath: string;
}

export async function loadDesktopUserData(): Promise<DesktopUserDataSnapshot | null> {
  if (!isDesktopRuntime() || !window.aguDesktop?.loadUserData) {
    return null;
  }
  return window.aguDesktop.loadUserData();
}

export async function saveDesktopConfig(config: AppConfig): Promise<boolean> {
  if (!isDesktopRuntime() || !window.aguDesktop?.saveConfig) {
    return false;
  }
  return window.aguDesktop.saveConfig(config);
}

export async function saveDesktopDiagnosisCache(
  cache: Record<string, DiagnosisCacheEntry>,
): Promise<boolean> {
  if (!isDesktopRuntime() || !window.aguDesktop?.saveDiagnosisCache) {
    return false;
  }
  return window.aguDesktop.saveDiagnosisCache(cache);
}

export async function saveDesktopLiveSync(payload: LiveSyncPayload): Promise<boolean> {
  if (!isDesktopRuntime() || !window.aguDesktop?.saveLiveSync) {
    return false;
  }
  return window.aguDesktop.saveLiveSync(payload);
}

export async function loadDesktopLiveSync(): Promise<LiveSyncPayload | null> {
  if (!isDesktopRuntime() || !window.aguDesktop?.loadLiveSync) {
    return null;
  }
  return window.aguDesktop.loadLiveSync();
}

export async function desktopStorageGet<T>(key: string): Promise<T | null> {
  if (!isDesktopRuntime() || !window.aguDesktop?.storageGet) {
    return getItem<T>(key);
  }
  return window.aguDesktop.storageGet<T>(key);
}

export async function desktopStorageSet(key: string, value: unknown): Promise<boolean> {
  if (!isDesktopRuntime() || !window.aguDesktop?.storageSet) {
    return setItem(key, value);
  }
  return window.aguDesktop.storageSet(key, value);
}

export async function desktopCleanupCalendars(keepYears: number[]): Promise<void> {
  if (!isDesktopRuntime() || !window.aguDesktop?.cleanupCalendars) {
    const { cleanupOldCalendars } = await import('../utils/storage');
    cleanupOldCalendars(keepYears);
    return;
  }
  window.aguDesktop.cleanupCalendars(keepYears);
}

/** One-time migrate renderer localStorage → userData files */
export async function migrateBrowserStorageToDesktop(): Promise<void> {
  if (!isDesktopRuntime() || !window.aguDesktop?.importMigration) {
    return;
  }

  const legacy = collectLegacyStorageForMigration();
  const legacyConfig = legacy[CONFIG_KEY] as AppConfig | undefined;
  const legacyDiag = legacy[DIAG_KEY] as Record<string, DiagnosisCacheEntry> | undefined;
  const legacySync = legacy[LIVE_SYNC_KEY] as LiveSyncPayload | undefined;

  await window.aguDesktop.importMigration({
    config: legacyConfig ?? null,
    diagnosisCache: legacyDiag ?? null,
    liveSync: legacySync ?? null,
  });
}

export async function exportDesktopBackup(): Promise<{ ok: boolean; path?: string }> {
  if (!isDesktopRuntime() || !window.aguDesktop?.exportBackup) {
    return { ok: false };
  }
  return window.aguDesktop.exportBackup();
}
