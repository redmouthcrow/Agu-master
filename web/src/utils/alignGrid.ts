import type { RefreshFrequency } from '../types';

/** 30-minute grid from 09:30 (minutes from midnight, Beijing). */
export const BASE_ALIGN_MINUTES = [570, 600, 630, 660, 690, 780, 810, 840, 870, 900];

/** 60-minute tier: 09:30, 10:30, 11:30, 13:30, 14:30 */
const ALIGN_MINUTES_60 = [570, 630, 690, 810, 870];

export function normalizeRefreshFrequency(value: unknown): RefreshFrequency {
  return value === 60 ? 60 : 30;
}

export function getAlignMinutesForFrequency(freq: RefreshFrequency): number[] {
  return freq === 60 ? ALIGN_MINUTES_60 : BASE_ALIGN_MINUTES;
}
