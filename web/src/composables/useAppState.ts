import { ref, computed } from 'vue';
import type {
  AppConfig,
  CalendarSyncStatus,
  DiagnosisCacheEntry,
  DiagnosisResult,
  InstrumentType,
  StockCardState,
  WatchlistItem,
} from '../types';
import { MAX_FUNDS, MAX_STOCKS } from '../types';
import { getItem, isStorageAvailable, setItem } from '../utils/storage';
import { inferInstrumentType, normalizeWatchlistSymbol } from '../utils/stockCode';
import { buildSnapshotFingerprint } from '../utils/snapshotFingerprint';
import {
  formatTimeHms,
  getAlignedTimeLabel,
  getSessionLabel,
  isInAutoTradingWindow,
} from '../utils/time';
import { fetchQuotesWithFallback } from '../services/quoteJsonp';
import { LlmAuthError, runDiagnosis, sleep } from '../services/llmDiagnosis';
import {
  getCalendarFailed,
  isTradingDay,
  syncTradingCalendar,
} from '../services/tradingCalendar';
import { createAlignScheduler } from '../services/scheduler';
import { loadLocalUserConfig } from '../services/userConfig';

const CONFIG_KEY = 'config';
const DIAG_KEY = 'diagnosis_cache';

const defaultConfig: AppConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  watchlist: [],
};

function migrateWatchlist(raw: WatchlistItem[]): WatchlistItem[] {
  const withType = raw.map((item) => ({
    ...item,
    instrumentType:
      item.instrumentType ?? inferInstrumentType(item.code),
  }));

  const stocks = withType.filter((i) => i.instrumentType === 'stock').slice(0, MAX_STOCKS);
  const funds = withType.filter((i) => i.instrumentType === 'fund_etf').slice(0, MAX_FUNDS);
  return [...stocks, ...funds];
}

const config = ref<AppConfig>(loadConfigFromStorage());
const cards = ref<StockCardState[]>(buildCards(config.value.watchlist));
const usingFileConfig = ref(false);
const refreshing = ref(false);
const configOpen = ref(false);
const storageOk = ref(isStorageAvailable());
const calendarStatus = ref<CalendarSyncStatus>({ state: 'idle' });

const toasts = ref<{ id: number; message: string }[]>([]);
let toastId = 0;
let stopScheduler: (() => void) | null = null;
let lastAlignRun = 0;

function loadConfigFromStorage(): AppConfig {
  const saved = getItem<AppConfig>(CONFIG_KEY);
  const merged = { ...defaultConfig, ...saved };
  const watchlist = migrateWatchlist(merged.watchlist ?? []);
  return { ...merged, watchlist };
}

async function applyLocalFileConfig(): Promise<void> {
  const fileConfig = await loadLocalUserConfig();
  if (!fileConfig) {
    return;
  }

  usingFileConfig.value = true;
  const watchlist = fileConfig.watchlist?.length
    ? migrateWatchlist(fileConfig.watchlist)
    : config.value.watchlist;

  config.value = { ...config.value, ...fileConfig, watchlist };
  cards.value = buildCards(watchlist);
}

function loadDiagnosisCache(): Record<string, DiagnosisCacheEntry> {
  const raw =
    getItem<Record<string, DiagnosisCacheEntry | DiagnosisResult>>(DIAG_KEY) ??
    {};
  const out: Record<string, DiagnosisCacheEntry> = {};
  for (const [code, entry] of Object.entries(raw)) {
    if ('fingerprint' in entry && entry.diagnosis) {
      out[code] = entry;
    } else if ('signal' in entry) {
      out[code] = {
        diagnosis: entry as DiagnosisResult,
        fingerprint: '',
        updatedAt: '',
      };
    }
  }
  return out;
}

function buildCards(watchlist: WatchlistItem[]): StockCardState[] {
  const cache = loadDiagnosisCache();
  return watchlist.map((stock) => {
    const cached = cache[stock.code];
    return {
      stock,
      snapshot: null,
      diagnosis: cached?.diagnosis ?? null,
      quoteError: false,
      aiError: null,
      parseError: false,
      rawAiText: null,
      loading: false,
      updatedAt: cached?.updatedAt || null,
      diagnosisReused: false,
    };
  });
}

function countByType(type: InstrumentType): number {
  return config.value.watchlist.filter((i) => i.instrumentType === type).length;
}

function persistConfig() {
  if (usingFileConfig.value) {
    return;
  }
  if (!setItem(CONFIG_KEY, config.value)) {
    showToast('本地存储写入失败');
  }
}

function persistDiagnosisEntry(code: string, entry: DiagnosisCacheEntry) {
  const cache = loadDiagnosisCache();
  cache[code] = entry;
  setItem(DIAG_KEY, cache);
}

function showToast(message: string) {
  const id = ++toastId;
  toasts.value.push({ id, message });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 4000);
}

const hasApiKey = computed(() => config.value.apiKey.trim().length > 0);

const stockCount = computed(() => countByType('stock'));
const fundCount = computed(() => countByType('fund_etf'));

const stockCards = computed(() =>
  cards.value.filter((c) => c.stock.instrumentType === 'stock'),
);

const fundCards = computed(() =>
  cards.value.filter((c) => c.stock.instrumentType === 'fund_etf'),
);

const calendarLabel = computed(() => {
  const year = new Date().getFullYear();
  if (calendarStatus.value.state === 'syncing') {
    return '同步中…';
  }
  if (calendarStatus.value.state === 'ok') {
    return `交易日历 ${calendarStatus.value.year} 已同步`;
  }
  if (getCalendarFailed()) {
    return '同步失败（已降级为周一至周五）';
  }
  return `交易日历 ${year}`;
});

export function useAppState() {
  async function initCalendar(force = false) {
    calendarStatus.value = { state: 'syncing' };
    const result = await syncTradingCalendar(force);
    if (result === 'ok') {
      calendarStatus.value = { state: 'ok', year: new Date().getFullYear() };
    } else {
      calendarStatus.value = { state: 'failed' };
      showToast('交易日历同步失败，已降级为周一至周五规则');
    }
  }

  function saveConfigField(partial: Partial<AppConfig>) {
    config.value = { ...config.value, ...partial };
    persistConfig();
  }

  function addSymbol(input: string) {
    const parsed = normalizeWatchlistSymbol(input);
    if (!parsed) {
      showToast('代码格式无效，请输入 A 股或场内 ETF/LOF 代码');
      return;
    }

    if (config.value.watchlist.some((s) => s.code === parsed.code)) {
      showToast('该证券已在自选池');
      return;
    }

    const limit = parsed.instrumentType === 'stock' ? MAX_STOCKS : MAX_FUNDS;
    const current = countByType(parsed.instrumentType);
    if (current >= limit) {
      showToast(
        parsed.instrumentType === 'stock'
          ? '股票已达上限 5 只'
          : '基金已达上限 5 只',
      );
      return;
    }

    const item: WatchlistItem = {
      code: parsed.code,
      name: parsed.code,
      market: parsed.market,
      instrumentType: parsed.instrumentType,
    };
    config.value.watchlist.push(item);
    cards.value.push({
      stock: item,
      snapshot: null,
      diagnosis: loadDiagnosisCache()[item.code]?.diagnosis ?? null,
      quoteError: false,
      aiError: null,
      parseError: false,
      rawAiText: null,
      loading: false,
      updatedAt: loadDiagnosisCache()[item.code]?.updatedAt || null,
      diagnosisReused: false,
    });
    persistConfig();
  }

  function removeSymbol(code: string) {
    config.value.watchlist = config.value.watchlist.filter((s) => s.code !== code);
    cards.value = cards.value.filter((c) => c.stock.code !== code);
    persistConfig();
  }

  async function runRefresh(manual: boolean) {
    if (refreshing.value) {
      return;
    }
    if (cards.value.length === 0) {
      return;
    }

    refreshing.value = true;
    const trading = isTradingDay();
    const session = getSessionLabel(trading);
    const aligned = getAlignedTimeLabel(trading);

    try {
      const codes = cards.value.map((c) => c.stock.code);
      const quotes = await fetchQuotesWithFallback(codes);

      for (const card of cards.value) {
        card.loading = true;
        card.quoteError = false;
        card.aiError = null;
        card.parseError = false;
        card.rawAiText = null;
        card.diagnosisReused = false;
      }

      let stopAi = false;
      let reusedCount = 0;

      for (const card of cards.value) {
        const snap = quotes.get(card.stock.code);
        if (!snap) {
          card.quoteError = true;
          card.loading = false;
          continue;
        }

        card.snapshot = {
          ...snap,
          instrumentType: card.stock.instrumentType,
        };
        card.stock.name = snap.name;

        if (!hasApiKey.value) {
          card.loading = false;
          continue;
        }

        if (stopAi) {
          card.loading = false;
          continue;
        }

        const fingerprint = buildSnapshotFingerprint(card.snapshot, session);
        const cached = loadDiagnosisCache()[card.stock.code];
        if (
          cached?.fingerprint &&
          cached.fingerprint === fingerprint &&
          cached.diagnosis
        ) {
          card.diagnosis = cached.diagnosis;
          card.updatedAt = cached.updatedAt;
          card.diagnosisReused = true;
          reusedCount += 1;
          card.loading = false;
          continue;
        }

        try {
          const result = await runDiagnosis(
            card.snapshot,
            config.value,
            aligned,
            session,
          );
          if (result.ok) {
            const updatedAt = formatTimeHms();
            card.diagnosis = result.data;
            card.updatedAt = updatedAt;
            persistDiagnosisEntry(card.stock.code, {
              diagnosis: result.data,
              fingerprint,
              updatedAt,
            });
          } else {
            card.parseError = true;
            card.rawAiText = result.raw;
          }
        } catch (e) {
          if (e instanceof LlmAuthError) {
            showToast(e.message);
            stopAi = true;
            card.aiError = '诊断失败';
          } else {
            card.aiError = '诊断失败';
          }
        }

        card.loading = false;
        await sleep(300);
      }

      if (manual && reusedCount > 0 && reusedCount === cards.value.length) {
        showToast('行情未变，已沿用缓存诊断');
      } else if (manual && reusedCount > 0) {
        showToast(`${reusedCount} 只行情未变，已沿用缓存诊断`);
      }
    } finally {
      refreshing.value = false;
      lastAlignRun = Date.now();
      if (manual && stopScheduler) {
        stopScheduler();
        stopScheduler = createAlignScheduler(() => {
          if (isInAutoTradingWindow(isTradingDay())) {
            void runRefresh(false);
          }
        });
      }
    }
  }

  function startScheduler() {
    stopScheduler?.();
    stopScheduler = createAlignScheduler(() => {
      if (isInAutoTradingWindow(isTradingDay())) {
        void runRefresh(false);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const trading = isTradingDay();
        if (isInAutoTradingWindow(trading) && Date.now() - lastAlignRun > 60_000) {
          void runRefresh(false);
        }
      }
    });
  }

  async function bootstrap() {
    await applyLocalFileConfig();
    await initCalendar(false);
    startScheduler();
    if (isInAutoTradingWindow(isTradingDay())) {
      await runRefresh(false);
    }
  }

  return {
    config,
    cards,
    stockCards,
    fundCards,
    stockCount,
    fundCount,
    refreshing,
    configOpen,
    storageOk,
    usingFileConfig,
    calendarStatus,
    calendarLabel,
    toasts,
    hasApiKey,
    showToast,
    saveConfigField,
    addSymbol,
    removeSymbol,
    runRefresh,
    initCalendar,
    bootstrap,
  };
}
