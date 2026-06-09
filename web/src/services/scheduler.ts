import { getBeijingTime, isInAutoTradingWindow } from '../utils/time';
import { isTradingDay } from './tradingCalendar';

const ALIGN_MINUTES = [570, 600, 630, 660, 690, 780, 810, 840, 870, 900];

export function getDelayUntilNextAlign(now = new Date()): number {
  const trading = isTradingDay(now);
  const t = getBeijingTime(now);

  if (trading) {
    if (t.totalMinutes < 570) {
      return minutesToMs(570 - t.totalMinutes, t.second);
    }
    if (t.totalMinutes > 690 && t.totalMinutes < 780) {
      return minutesToMs(780 - t.totalMinutes, t.second);
    }

    if (isInAutoTradingWindow(trading, now)) {
      for (const slot of ALIGN_MINUTES) {
        if (t.totalMinutes < slot) {
          return minutesToMs(slot - t.totalMinutes, t.second);
        }
      }
    }
  }

  return msUntilNextTradingDayOpen(now);
}

function minutesToMs(minutes: number, seconds: number): number {
  return Math.max(1000, minutes * 60_000 - seconds * 1000);
}

function msUntilNextTradingDayOpen(from: Date): number {
  for (let offset = 0; offset <= 14; offset += 1) {
    const d = new Date(from.getTime() + offset * 86_400_000);
    if (!isTradingDay(d)) {
      continue;
    }
    const t = getBeijingTime(d);
    const openMinutes = 570;
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

export function createAlignScheduler(onTick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) {
      return;
    }
    const delay = getDelayUntilNextAlign();
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
