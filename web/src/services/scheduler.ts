import type { RefreshFrequency } from '../types';
import { getAlignMinutesForFrequency, normalizeRefreshFrequency } from '../utils/alignGrid';
import { getBeijingTime, isInAutoTradingWindow } from '../utils/time';
import { isTradingDay } from './tradingCalendar';

export function getDelayUntilNextAlign(
  now = new Date(),
  refreshFrequency: RefreshFrequency | unknown = 30,
): number {
  const freq = normalizeRefreshFrequency(refreshFrequency);
  const alignMinutes = getAlignMinutesForFrequency(freq);
  const trading = isTradingDay(now);
  const t = getBeijingTime(now);

  if (trading) {
    if (t.totalMinutes < alignMinutes[0]) {
      return minutesToMs(alignMinutes[0] - t.totalMinutes, t.second);
    }
    if (t.totalMinutes > 690 && t.totalMinutes < 780) {
      return minutesToMs(780 - t.totalMinutes, t.second);
    }

    if (isInAutoTradingWindow(trading, now)) {
      for (const slot of alignMinutes) {
        if (t.totalMinutes < slot) {
          return minutesToMs(slot - t.totalMinutes, t.second);
        }
      }
    }
  }

  return msUntilNextTradingDayOpen(now, alignMinutes[0]);
}

function minutesToMs(minutes: number, seconds: number): number {
  return Math.max(1000, minutes * 60_000 - seconds * 1000);
}

function msUntilNextTradingDayOpen(from: Date, openMinutes: number): number {
  for (let offset = 0; offset <= 14; offset += 1) {
    const d = new Date(from.getTime() + offset * 86_400_000);
    if (!isTradingDay(d)) {
      continue;
    }
    const t = getBeijingTime(d);
    if (offset === 0 && t.totalMinutes >= 900) {
      continue;
    }
    if (offset === 0 && t.totalMinutes < openMinutes) {
      return minutesToMs(openMinutes - t.totalMinutes, t.second);
    }
    if (offset > 0) {
      const nowT = getBeijingTime(from);
      const dayDiff = offset;
      const minsUntilMidnight = (24 * 60 - nowT.totalMinutes) * 60 - nowT.second;
      const minsFromMidnightToOpen = openMinutes * 60;
      return (minsUntilMidnight + (dayDiff - 1) * 24 * 60 * 60 + minsFromMidnightToOpen) * 1000;
    }
  }
  return 86_400_000;
}

export function createAlignScheduler(
  onTick: () => void,
  refreshFrequency: RefreshFrequency | unknown = 30,
): () => void {
  const freq = normalizeRefreshFrequency(refreshFrequency);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) {
      return;
    }
    const delay = getDelayUntilNextAlign(new Date(), freq);
    timer = setTimeout(() => {
      onTick();
      schedule();
    }, delay);
  };

  schedule();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
