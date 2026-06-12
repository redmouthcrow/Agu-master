import type { RefreshFrequency, SessionLabel } from '../types';
import { getAlignMinutesForFrequency, normalizeRefreshFrequency } from './alignGrid';

export interface BeijingTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateStr: string;
  weekday: number;
  totalMinutes: number;
}

const beijingFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hour12: false,
});

export function getBeijingTime(date = new Date()): BeijingTime {
  const parts = beijingFormatter.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const hour = parseInt(pick('hour'), 10);
  const minute = parseInt(pick('minute'), 10);
  const second = parseInt(pick('second'), 10);

  return {
    year: parseInt(pick('year'), 10),
    month: parseInt(pick('month'), 10),
    day: parseInt(pick('day'), 10),
    hour,
    minute,
    second,
    dateStr: `${pick('year')}-${pick('month')}-${pick('day')}`,
    weekday: weekdayMap[pick('weekday')] ?? 0,
    totalMinutes: hour * 60 + minute,
  };
}

export function formatTimeHms(date = new Date()): string {
  const t = getBeijingTime(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

export function getSessionLabel(isTradingDayFlag: boolean, date = new Date()): SessionLabel {
  if (!isTradingDayFlag) {
    return '非交易时段';
  }
  const { totalMinutes } = getBeijingTime(date);
  if (totalMinutes >= 555 && totalMinutes < 570) {
    return '集合竞价';
  }
  if (isInAutoTradingWindow(isTradingDayFlag, date)) {
    return '交易中';
  }
  return '非交易时段';
}

export function isInAutoTradingWindow(isTradingDayFlag: boolean, date = new Date()): boolean {
  if (!isTradingDayFlag) {
    return false;
  }
  const { totalMinutes } = getBeijingTime(date);
  const morning = totalMinutes >= 570 && totalMinutes <= 690;
  const afternoon = totalMinutes >= 780 && totalMinutes <= 900;
  return morning || afternoon;
}

export function getAlignedTimeLabel(
  isTradingDayFlag: boolean,
  date = new Date(),
  refreshFrequency: RefreshFrequency | unknown = 30,
): string {
  const t = getBeijingTime(date);
  if (!isTradingDayFlag) {
    return `${t.dateStr} ${formatMinutesLabel(t.totalMinutes)}`;
  }

  const slots = getAlignMinutesForFrequency(normalizeRefreshFrequency(refreshFrequency));
  let slot = slots[0];
  for (const m of slots) {
    if (t.totalMinutes >= m) {
      slot = m;
    } else {
      break;
    }
  }
  return `${t.dateStr} ${formatMinutesLabel(slot)}`;
}

function formatMinutesLabel(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isJan1ForceSync(date = new Date()): boolean {
  const t = getBeijingTime(date);
  return t.month === 1 && t.day === 1;
}
