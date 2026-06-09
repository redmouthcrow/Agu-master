const PREFIX = 'agu_';

export function isStorageAvailable(): boolean {
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
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

export function cleanupOldCalendars(keepYears: number[]): void {
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
