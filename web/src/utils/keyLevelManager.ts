import {
  type KeyLevel,
  type WatchlistItem,
  KEY_LEVEL_DEVIATION_THRESHOLD,
  MAX_KEY_LEVELS,
} from '../types';

export interface KeyLevelUpdateResult {
  updated: boolean;
  pending?: { support: { old: number; new: number } | null; resistance: { old: number; new: number } | null };
}

function roundKeyPrice(price: number): number {
  return Math.round(price * 1000) / 1000;
}

function findAiLevel(levels: KeyLevel[], type: 'support' | 'resistance'): KeyLevel | undefined {
  return levels.find((l) => l.type === type && l.source === 'ai');
}

function deviationExceeds(oldVal: number, newVal: number): boolean {
  if (oldVal === 0) {
    return true;
  }
  return Math.abs(newVal - oldVal) / oldVal > KEY_LEVEL_DEVIATION_THRESHOLD;
}

export function applyKeyLevelsFromDiagnosis(
  item: WatchlistItem,
  supportLevel: number | undefined,
  resistanceLevel: number | undefined,
  now: string,
): KeyLevelUpdateResult {
  if (item.keyLevelsLocked) {
    return { updated: false };
  }
  if (supportLevel == null && resistanceLevel == null) {
    return { updated: false };
  }

  const levels = item.keyLevels ? [...item.keyLevels] : [];
  let pendingSupport: { old: number; new: number } | null = null;
  let pendingResistance: { old: number; new: number } | null = null;
  let updated = false;

  if (supportLevel != null) {
    const old = findAiLevel(levels, 'support');
    if (old && deviationExceeds(old.price, supportLevel)) {
      pendingSupport = { old: old.price, new: supportLevel };
    } else {
      const rounded = roundKeyPrice(supportLevel);
      if (old) {
        old.price = rounded;
        old.updatedAt = now;
      } else {
        levels.push({ price: rounded, label: '支撑位', type: 'support', source: 'ai', updatedAt: now });
      }
      updated = true;
    }
  }

  if (resistanceLevel != null) {
    const old = findAiLevel(levels, 'resistance');
    if (old && deviationExceeds(old.price, resistanceLevel)) {
      pendingResistance = { old: old.price, new: resistanceLevel };
    } else {
      const rounded = roundKeyPrice(resistanceLevel);
      if (old) {
        old.price = rounded;
        old.updatedAt = now;
      } else {
        levels.push({ price: rounded, label: '压力位', type: 'resistance', source: 'ai', updatedAt: now });
      }
      updated = true;
    }
  }

  if (updated) {
    item.keyLevels = levels;
  }

  if (pendingSupport || pendingResistance) {
    return { updated, pending: { support: pendingSupport, resistance: pendingResistance } };
  }

  return { updated };
}

export function acceptPendingKeyLevels(
  item: WatchlistItem,
  supportLevel: number,
  resistanceLevel: number,
  now: string,
): void {
  const levels = item.keyLevels ? [...item.keyLevels] : [];
  const roundedSupport = roundKeyPrice(supportLevel);
  const roundedResistance = roundKeyPrice(resistanceLevel);

  const supIdx = levels.findIndex((l) => l.type === 'support' && l.source === 'ai');
  if (supIdx >= 0) {
    levels[supIdx] = { ...levels[supIdx], price: roundedSupport, updatedAt: now };
  } else {
    levels.push({ price: roundedSupport, label: '支撑位', type: 'support', source: 'ai', updatedAt: now });
  }

  const resIdx = levels.findIndex((l) => l.type === 'resistance' && l.source === 'ai');
  if (resIdx >= 0) {
    levels[resIdx] = { ...levels[resIdx], price: roundedResistance, updatedAt: now };
  } else {
    levels.push({ price: roundedResistance, label: '压力位', type: 'resistance', source: 'ai', updatedAt: now });
  }

  item.keyLevels = levels;
}

export function toggleKeyLevelsLock(item: WatchlistItem): boolean {
  item.keyLevelsLocked = !item.keyLevelsLocked;
  return item.keyLevelsLocked;
}

export function addCustomKeyLevel(
  item: WatchlistItem,
  price: number,
  label: string,
): boolean {
  const levels = item.keyLevels ?? [];
  if (levels.length >= MAX_KEY_LEVELS) {
    return false;
  }
  const customCount = levels.filter((l) => l.source === 'manual').length;
  if (customCount >= 2) {
    return false;
  }
  if (!label.trim()) {
    return false;
  }
  levels.push({
    price: roundKeyPrice(price),
    label: label.trim(),
    type: 'custom',
    source: 'manual',
  });
  item.keyLevels = levels;
  return true;
}

export function removeCustomKeyLevel(item: WatchlistItem, index: number): boolean {
  const levels = item.keyLevels;
  if (!levels || index < 0 || index >= levels.length) {
    return false;
  }
  if (levels[index].source !== 'manual') {
    return false;
  }
  levels.splice(index, 1);
  item.keyLevels = levels.length > 0 ? levels : undefined;
  return true;
}

export function checkBreakthrough(
  lastPrice: number | null,
  currentPrice: number,
  levels: KeyLevel[],
): KeyLevel[] {
  if (lastPrice == null || levels.length === 0) {
    return [];
  }
  const breached: KeyLevel[] = [];
  for (const level of levels) {
    const crossedBelow = lastPrice > level.price && currentPrice <= level.price;
    const crossedAbove = lastPrice < level.price && currentPrice >= level.price;
    if (crossedBelow || crossedAbove) {
      breached.push(level);
    }
  }
  return breached;
}
