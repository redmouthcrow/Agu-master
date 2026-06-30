const STORAGE_KEY = 'agu_price_history';
const MAX_DAYS = 7;

export interface PriceEntry {
  date: string; // YYYY-MM-DD
  price: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load(): Record<string, PriceEntry[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PriceEntry[]>) : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, PriceEntry[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full, silent */ }
}

/** Record today's closing price for a security. Dedup same day. Keep last 7 days. */
export function recordPrice(code: string, price: number): void {
  const all = load();
  const list = all[code] ?? [];
  const td = today();

  // Replace today's entry or append.
  const idx = list.findIndex((e) => e.date === td);
  if (idx >= 0) {
    list[idx] = { date: td, price };
  } else {
    list.push({ date: td, price });
  }

  // Keep last MAX_DAYS entries.
  all[code] = list.slice(-MAX_DAYS);
  save(all);
}

/** Return last N price entries for a security. */
export function getHistory(code: string): PriceEntry[] {
  return load()[code] ?? [];
}

/** Format as a compact string for AI prompt injection. */
export function formatHistoryText(code: string): string | null {
  const list = getHistory(code);
  if (list.length < 2) {
    return null;
  }
  return list.map((e) => e.price.toFixed(2)).join(' → ');
}
