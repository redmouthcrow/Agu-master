import type { RefreshFrequency } from '../types';

export const VALID_REFRESH_FREQUENCIES: readonly RefreshFrequency[] = [5, 15, 30, 60];

/** 30-minute grid from 09:30 (minutes from midnight, Beijing). */
export const BASE_ALIGN_MINUTES = [570, 600, 630, 660, 690, 780, 810, 840, 870, 900];

/** 60-minute tier: 09:30, 10:30, 11:30, 13:30, 14:30 */
const ALIGN_MINUTES_60 = [570, 630, 690, 810, 870];

const MORNING_START = 570;
const MORNING_END = 690;
const AFTERNOON_START = 780;
const AFTERNOON_END = 900;

function generateSessionGrid(stepMinutes: number): number[] {
  const slots: number[] = [];
  for (let m = MORNING_START; m <= MORNING_END; m += stepMinutes) {
    slots.push(m);
  }
  for (let m = AFTERNOON_START; m <= AFTERNOON_END; m += stepMinutes) {
    slots.push(m);
  }
  return slots;
}

export function normalizeRefreshFrequency(value: unknown): RefreshFrequency {
  const n = typeof value === 'number' ? value : Number(value);
  if (VALID_REFRESH_FREQUENCIES.includes(n as RefreshFrequency)) {
    return n as RefreshFrequency;
  }
  return 30;
}

export function getAlignMinutesForFrequency(freq: RefreshFrequency): number[] {
  if (freq === 60) {
    return ALIGN_MINUTES_60;
  }
  if (freq === 30) {
    return BASE_ALIGN_MINUTES;
  }
  return generateSessionGrid(freq);
}
