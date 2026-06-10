import type { AppConfig, RefreshFrequency, WatchlistItem } from '../types';
import { normalizeWatchlistSymbol } from '../utils/stockCode';
import { normalizeRefreshFrequency } from '../utils/alignGrid';

export interface LocalUserConfigFile {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  refreshFrequency?: RefreshFrequency;
  watchlist?: WatchlistItem[];
  /** Shorthand: e.g. ["600519", "510500"] — merged with watchlist if both set */
  watchlistCodes?: string[];
}

const CONFIG_ENDPOINT = '/__agu_local_config__';

function codesToWatchlist(codes: string[]): WatchlistItem[] {
  const items: WatchlistItem[] = [];
  for (const raw of codes) {
    const parsed = normalizeWatchlistSymbol(raw);
    if (!parsed) {
      continue;
    }
    items.push({
      code: parsed.code,
      name: parsed.code,
      market: parsed.market,
      instrumentType: parsed.instrumentType,
    });
  }
  return items;
}

function parseWatchlist(raw: LocalUserConfigFile): WatchlistItem[] | undefined {
  const fromCodes = raw.watchlistCodes?.length
    ? codesToWatchlist(raw.watchlistCodes)
    : [];
  const fromList = raw.watchlist ?? [];

  const merged = [...fromList, ...fromCodes];
  if (merged.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  return merged.filter((item) => {
    if (seen.has(item.code)) {
      return false;
    }
    seen.add(item.code);
    return true;
  });
}

function toAppConfig(raw: LocalUserConfigFile): Partial<AppConfig> | null {
  const watchlist = parseWatchlist(raw);
  const out: Partial<AppConfig> = {};

  if (raw.baseUrl?.trim()) {
    out.baseUrl = raw.baseUrl.trim();
  }
  if (raw.apiKey?.trim()) {
    out.apiKey = raw.apiKey.trim();
  }
  if (raw.model?.trim()) {
    out.model = raw.model.trim();
  }
  if (raw.refreshFrequency != null) {
    out.refreshFrequency = normalizeRefreshFrequency(raw.refreshFrequency);
  }
  if (watchlist?.length) {
    out.watchlist = watchlist;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export async function loadLocalUserConfig(): Promise<Partial<AppConfig> | null> {
  try {
    const res = await fetch(CONFIG_ENDPOINT);
    if (!res.ok) {
      return null;
    }
    const raw = (await res.json()) as LocalUserConfigFile;
    return toAppConfig(raw);
  } catch {
    return null;
  }
}
