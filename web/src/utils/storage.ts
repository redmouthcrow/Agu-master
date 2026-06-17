const PREFIX = 'agu_';

/** Desktop: in-memory mirror synced to userData files via IPC */
const desktopMirror = new Map<string, unknown>();
let desktopMirrorActive = false;

export function activateDesktopStorageMirror(): void {
  desktopMirrorActive = true;
}

export function setDesktopMirrorEntry(key: string, value: unknown): void {
  desktopMirror.set(key, value);
}

type DesktopFilePersistFn = (key: string, value: unknown) => void;
type DesktopCalendarCleanupFn = (keepYears: number[]) => void;

let desktopFilePersist: DesktopFilePersistFn | null = null;
let desktopCalendarCleanup: DesktopCalendarCleanupFn | null = null;

export function registerDesktopFilePersist(fn: DesktopFilePersistFn): void {
  desktopFilePersist = fn;
}

export function registerDesktopCalendarCleanup(fn: DesktopCalendarCleanupFn): void {
  desktopCalendarCleanup = fn;
}

export function isStorageAvailable(): boolean {
  if (desktopMirrorActive) {
    return true;
  }
  try {
    const key = `${PREFIX}test`;
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function getItem<T>(key: string): T | null {
  if (desktopMirrorActive) {
    const hit = desktopMirror.get(key);
    return hit === undefined ? null : (hit as T);
  }
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setItem(key: string, value: unknown): boolean {
  if (desktopMirrorActive) {
    desktopMirror.set(key, value);
    if (key.startsWith('trading_calendar_')) {
      desktopFilePersist?.(key, value);
    }
    return true;
  }
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): void {
  if (desktopMirrorActive) {
    desktopMirror.delete(key);
    return;
  }
  localStorage.removeItem(PREFIX + key);
}

export function cleanupOldCalendars(keepYears: number[]): void {
  if (desktopMirrorActive) {
    for (const key of [...desktopMirror.keys()]) {
      if (!key.startsWith('trading_calendar_')) {
        continue;
      }
      const year = parseInt(key.replace('trading_calendar_', ''), 10);
      if (!keepYears.includes(year)) {
        desktopMirror.delete(key);
      }
    }
    desktopCalendarCleanup?.(keepYears);
    return;
  }
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const k = localStorage.key(i);
    if (!k?.startsWith(`${PREFIX}trading_calendar_`)) {
      continue;
    }
    const year = parseInt(k.replace(`${PREFIX}trading_calendar_`, ''), 10);
    if (!keepYears.includes(year)) {
      localStorage.removeItem(k);
    }
  }
}

export function collectLegacyStorageForMigration(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k?.startsWith(PREFIX)) {
      continue;
    }
    const key = k.slice(PREFIX.length);
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        out[key] = JSON.parse(raw);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}
