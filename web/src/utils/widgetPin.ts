import type { WatchlistItem } from '../types';

export const MIN_WIDGET_PINNED = 1;
export const MAX_WIDGET_PINNED = 4;
export const DEFAULT_WIDGET_OPACITY = 0.9;
export const MIN_WIDGET_OPACITY = 0.7;
export const MAX_WIDGET_OPACITY = 1;

export function sanitizeWidgetPinnedCodes(
  codes: string[] | undefined,
  watchlist: WatchlistItem[],
): string[] {
  const valid = new Set(watchlist.map((w) => w.code));
  return (codes ?? []).filter((c) => valid.has(c)).slice(0, MAX_WIDGET_PINNED);
}

export function canShowWidget(pinned: string[]): boolean {
  return pinned.length >= MIN_WIDGET_PINNED;
}

export function clampWidgetOpacity(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_WIDGET_OPACITY;
  }
  return Math.min(MAX_WIDGET_OPACITY, Math.max(MIN_WIDGET_OPACITY, value));
}
