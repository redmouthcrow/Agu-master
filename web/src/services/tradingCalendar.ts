import type { HolidayDay, TradingCalendarCache } from '../types';
import { cleanupOldCalendars, getItem, setItem } from '../utils/storage';
import { getBeijingTime, isJan1ForceSync } from '../utils/time';

const calendarKey = (year: number) => `trading_calendar_${year}`;

let memoryDays: HolidayDay[] | null = null;
let memoryYear: number | null = null;
let memoryDayMap: Map<string, HolidayDay> | null = null;
let calendarLoaded = false;
let calendarFailed = false;

function weekdayFallback(date: Date): boolean {
  const { weekday } = getBeijingTime(date);
  return weekday >= 1 && weekday <= 5;
}

function setMemoryCalendar(days: HolidayDay[], year: number): void {
  memoryDays = days;
  memoryYear = year;
  memoryDayMap = new Map(days.map((d) => [d.date, d]));
}

function dayMapForMemory(): Map<string, HolidayDay> | null {
  if (!memoryDays || memoryDayMap == null) {
    return null;
  }
  return memoryDayMap;
}

export function isTradingDay(date = new Date()): boolean {
  const { dateStr, weekday, year } = getBeijingTime(date);

  if (memoryDays && memoryYear === year) {
    const hit = dayMapForMemory()?.get(dateStr);
    if (hit) {
      return !hit.isOffDay;
    }
    return weekday >= 1 && weekday <= 5;
  }

  if (calendarLoaded && calendarFailed) {
    return weekdayFallback(date);
  }

  const cached = getItem<TradingCalendarCache>(calendarKey(year));
  if (cached?.days?.length) {
    setMemoryCalendar(cached.days, year);
    const hit = memoryDayMap?.get(dateStr);
    if (hit) {
      return !hit.isOffDay;
    }
    return weekday >= 1 && weekday <= 5;
  }

  return weekdayFallback(date);
}

async function fetchHolidayCn(year: number): Promise<HolidayDay[]> {
  const url = `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('holiday-cn failed');
  }
  const data = (await res.json()) as { days: HolidayDay[] };
  return data.days ?? [];
}

async function fetchTimor(year: number): Promise<HolidayDay[]> {
  const url = `https://timor.tech/api/holiday/year/${year}/`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('timor failed');
  }
  const data = (await res.json()) as {
    holiday?: Record<string, { holiday: boolean; name: string; date: string }>;
  };

  const days: HolidayDay[] = [];
  if (data.holiday) {
    Object.values(data.holiday).forEach((item) => {
      days.push({
        date: item.date,
        name: item.name,
        isOffDay: item.holiday,
      });
    });
  }
  return days;
}

function shouldSync(year: number): boolean {
  const cached = getItem<TradingCalendarCache>(calendarKey(year));
  if (!cached) {
    return true;
  }
  if (cached.year !== year) {
    return true;
  }
  if (isJan1ForceSync()) {
    const fetchedYear = new Date(cached.fetchedAt).getFullYear();
    return fetchedYear !== year;
  }
  return false;
}

export async function syncTradingCalendar(force = false): Promise<'ok' | 'failed'> {
  const year = getBeijingTime().year;

  if (!force && !shouldSync(year)) {
    const cached = getItem<TradingCalendarCache>(calendarKey(year));
    if (cached) {
      setMemoryCalendar(cached.days, year);
      calendarLoaded = true;
      calendarFailed = false;
      return 'ok';
    }
  }

  let days: HolidayDay[] = [];
  let source: TradingCalendarCache['source'] = 'holiday-cn';

  try {
    days = await fetchHolidayCn(year);
  } catch {
    try {
      days = await fetchTimor(year);
      source = 'timor';
    } catch {
      calendarLoaded = true;
      calendarFailed = true;
      return 'failed';
    }
  }

  const payload: TradingCalendarCache = {
    year,
    fetchedAt: new Date().toISOString(),
    source,
    days,
  };

  if (!setItem(calendarKey(year), payload)) {
    calendarLoaded = true;
    calendarFailed = true;
    return 'failed';
  }

  cleanupOldCalendars([year, year - 1]);
  setMemoryCalendar(days, year);
  calendarLoaded = true;
  calendarFailed = false;
  return 'ok';
}

export function getCalendarFailed(): boolean {
  return calendarFailed;
}
