import { ref, computed } from 'vue';
import type {
  AlertPayload,
  AlertSettings,
  AppConfig,
  CalendarSyncStatus,
  DiagnosisCacheEntry,
  DiagnosisResult,
  LiveSyncPayload,
  QuoteSnapshot,
  RefreshMode,
  SessionLabel,
  StockCardState,
  WatchlistItem,
} from '../types';
import { MAX_OVERCLOCK, MAX_SECURITIES } from '../types';
import { getItem, isStorageAvailable, setItem, activateDesktopStorageMirror, setDesktopMirrorEntry, registerDesktopFilePersist, registerDesktopCalendarCleanup, collectLegacyStorageForMigration } from '../utils/storage';
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
import { normalizeRefreshFrequency } from '../utils/alignGrid';
import { validatePositionPair, roundCostPrice } from '../utils/position';
import { getAppMode, isDesktopRuntime } from '../utils/appMode';
import {
  clampWidgetOpacity,
  sanitizeWidgetPinnedCodes,
} from '../utils/widgetPin';
import { cloneLiveSyncPayload, isNewerLiveSync } from '../utils/liveSync';
import {
  desktopStorageGet,
  desktopStorageSet,
  desktopCleanupCalendars,
  loadDesktopUserData,
  loadDesktopLiveSync,
  migrateBrowserStorageToDesktop,
  saveDesktopConfig,
  saveDesktopDiagnosisCache,
  saveDesktopLiveSync,
  exportDesktopBackup,
} from '../services/desktopPersistence';
import { t } from '../i18n';
import { collectAlertsFromRound, createAuthErrorAlert } from '../services/alertService';
import {
  applyKeyLevelsFromDiagnosis,
  toggleKeyLevelsLock as toggleKlLock,
  addCustomKeyLevel as addKl,
  removeCustomKeyLevel as removeKl,
} from '../utils/keyLevelManager';

const CONFIG_KEY = 'config';
const DIAG_KEY = 'diagnosis_cache';
const LIVE_SYNC_KEY = 'live_sync';
const STORAGE_PREFIX = 'agu_';

/** Delay between sequential AI diagnosis calls (avoid hammering the LLM). */
const CARD_REFRESH_GAP_MS = 300;
/** How long a toast stays visible. */
const TOAST_TIMEOUT_MS = 4000;

const appMode = getAppMode();
const isPrimaryRunner = appMode !== 'widget';

let lastPricesForBreakthrough = new Map<string, number>();
let highFreqTimer: ReturnType<typeof setTimeout> | null = null;
const HIGH_FREQ_INTERVAL_MS = 30_000;
let authAlertSentThisRound = false;

let diagnosisCacheMemory: Record<string, DiagnosisCacheEntry> | null = null;

/**
 * v2.5 migration: old cache entries may carry `action` (pre-rename) and lack
 * `bandAction`. Per spec ADR-008 / changelog compatibility note:
 *  - `action` → renamed to `shortAction` (if `shortAction` absent)
 *  - entries missing `bandAction` cannot be synthesized → dropped, forcing a
 *    fresh diagnosis on next refresh (bandAction is required + anchor-checked)
 * Returns the migrated DiagnosisResult, or null if the entry is stale.
 */
function migrateDiagnosis(d: DiagnosisResult): DiagnosisResult | null {
  let next = d;
  // Pre-v2.5 entries: rename action → shortAction.
  if ((next as { action?: string }).action != null && next.shortAction == null) {
    const { action, ...rest } = next as DiagnosisResult & { action?: string };
    next = { ...rest, shortAction: action };
  }
  // bandAction is required (v2.5); stale entries without it must be discarded.
  if (!next.bandAction) {
    return null;
  }
  return next;
}

function readDiagnosisCacheFromObject(
  raw: Record<string, DiagnosisCacheEntry | DiagnosisResult>,
): Record<string, DiagnosisCacheEntry> {
  const out: Record<string, DiagnosisCacheEntry> = {};
  for (const [code, entry] of Object.entries(raw)) {
    if ('fingerprint' in entry && entry.diagnosis) {
      const migrated = migrateDiagnosis(entry.diagnosis);
      if (migrated) {
        out[code] = { ...entry, diagnosis: migrated };
      }
    } else if ('signal' in entry) {
      const migrated = migrateDiagnosis(entry as DiagnosisResult);
      if (migrated) {
        out[code] = {
          diagnosis: migrated,
          fingerprint: '',
          updatedAt: '',
        };
      }
    }
  }
  return out;
}

function readDiagnosisCacheFromStorage(): Record<string, DiagnosisCacheEntry> {
  const raw =
    getItem<Record<string, DiagnosisCacheEntry | DiagnosisResult>>(DIAG_KEY) ??
    {};
  return readDiagnosisCacheFromObject(raw);
}

function getDiagnosisCache(): Record<string, DiagnosisCacheEntry> {
  if (!diagnosisCacheMemory) {
    diagnosisCacheMemory = readDiagnosisCacheFromStorage();
  }
  return diagnosisCacheMemory;
}

function buildCards(watchlist: WatchlistItem[]): StockCardState[] {
  const cache = getDiagnosisCache();
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

const defaultConfig: AppConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  refreshFrequency: 30,
  watchlist: [],
  widgetPinnedCodes: [],
  widgetOpacity: 0.9,
  widgetAlwaysOnTop: true,
  alertSettings: {
    enabled: true,
    priceAlert: true,
    signalAlert: true,
    authErrorAlert: true,
    quoteErrorAlert: true,
  },
};

function migrateWatchlist(raw: WatchlistItem[]): WatchlistItem[] {
  return raw
    .map((item) => ({
      ...item,
      instrumentType:
        item.instrumentType ?? inferInstrumentType(item.code),
    }))
    .slice(0, MAX_SECURITIES);
}

const config = ref<AppConfig>(
  isDesktopRuntime() ? { ...defaultConfig } : loadConfigFromStorage(),
);
const cards = ref<StockCardState[]>(buildCards(config.value.watchlist));
const usingFileConfig = ref(false);
const refreshing = ref(false);
const configOpen = ref(false);
const storageOk = ref(isStorageAvailable());
const calendarStatus = ref<CalendarSyncStatus>({ state: 'idle' });

const toasts = ref<{ id: number; message: string }[]>([]);
let toastId = 0;
let stopScheduler: (() => void) | null = null;
let lastAppliedSyncTs = 0;
let lastWidgetOpacity: number | null = null;
let lastWidgetAlwaysOnTop: boolean | null = null;
let desktopPersistenceReady = false;
let diagnosisSaveTimer: ReturnType<typeof setTimeout> | null = null;

const AI_REFRESH_CONCURRENCY = 2;

function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  const watchlist = migrateWatchlist(raw.watchlist ?? []);
  const widgetPinnedCodes = sanitizeWidgetPinnedCodes(
    raw.widgetPinnedCodes,
    watchlist,
  );
  return {
    ...defaultConfig,
    ...raw,
    refreshFrequency: normalizeRefreshFrequency(raw.refreshFrequency),
    watchlist,
    widgetPinnedCodes,
    widgetOpacity: clampWidgetOpacity(raw.widgetOpacity),
    widgetAlwaysOnTop: raw.widgetAlwaysOnTop ?? true,
  };
}

function loadConfigFromStorage(): AppConfig {
  const saved = getItem<AppConfig>(CONFIG_KEY);
  return normalizeConfig({ ...defaultConfig, ...saved });
}

/**
 * Merge a live-sync config payload onto a base config, falling back to the
 * base value for any field the payload omits. Used by both the desktop
 * hydration path (base = defaults + current) and the live-sync apply path
 * (base = current). watchlist must already be migrated by the caller.
 */
function mergeLiveConfig(
  live: LiveSyncPayload['config'],
  base: AppConfig,
): AppConfig {
  return normalizeConfig({
    ...base,
    baseUrl: live.baseUrl ?? base.baseUrl,
    model: live.model ?? base.model,
    refreshFrequency: live.refreshFrequency ?? base.refreshFrequency,
    watchlist: live.watchlist ?? base.watchlist,
    widgetPinnedCodes: live.widgetPinnedCodes,
    widgetOpacity: live.widgetOpacity,
    widgetAlwaysOnTop: live.widgetAlwaysOnTop,
    alertSettings: live.alertSettings ?? base.alertSettings,
    groups: live.groups ?? base.groups,
    apiKey: live.apiKey ?? base.apiKey,
  });
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

  config.value = normalizeConfig({
    ...config.value,
    ...fileConfig,
    watchlist,
  });
  cards.value = buildCards(config.value.watchlist);
}

const watchlistCount = computed(() => config.value.watchlist.length);

function flushDiagnosisCache() {
  const cache = getDiagnosisCache();
  if (isDesktopRuntime()) {
    void saveDesktopDiagnosisCache(cache);
    return;
  }
  setItem(DIAG_KEY, cache);
}

function canPersistDesktopConfig(): boolean {
  if (!isDesktopRuntime() || !isPrimaryRunner || usingFileConfig.value) {
    return false;
  }
  return desktopPersistenceReady;
}

async function flushDesktopPersistence(): Promise<void> {
  if (!canPersistDesktopConfig()) {
    return;
  }
  if (diagnosisSaveTimer) {
    clearTimeout(diagnosisSaveTimer);
    diagnosisSaveTimer = null;
  }
  const payload = cloneLiveSyncPayload(buildLiveSyncPayload());
  await Promise.all([
    saveDesktopConfig(config.value),
    saveDesktopDiagnosisCache(getDiagnosisCache()),
    saveDesktopLiveSync(payload),
  ]);
}

function applyConfigFromLiveSyncPayload(live: LiveSyncPayload): boolean {
  if (!live.config.watchlist?.length) {
    return false;
  }
  config.value = mergeLiveConfig(live.config, { ...defaultConfig, ...config.value });
  if (live.cards?.length) {
    cards.value = mergeCardsFromWatchlist(config.value.watchlist, live.cards);
  } else {
    cards.value = buildCards(config.value.watchlist);
  }
  return true;
}

function persistConfig() {
  if (usingFileConfig.value) {
    return;
  }
  if (isDesktopRuntime()) {
    if (!canPersistDesktopConfig()) {
      return;
    }
    void saveDesktopConfig(config.value);
    return;
  }
  if (!setItem(CONFIG_KEY, config.value)) {
    showToast(t('toast.storageWriteFailed'));
  }
}

function persistDiagnosisEntry(code: string, entry: DiagnosisCacheEntry) {
  const cache = getDiagnosisCache();
  cache[code] = entry;
  if (isDesktopRuntime()) {
    if (diagnosisSaveTimer) {
      clearTimeout(diagnosisSaveTimer);
    }
    diagnosisSaveTimer = setTimeout(flushDiagnosisCache, 300);
    return;
  }
  setItem(DIAG_KEY, cache);
}

function showToast(message: string) {
  const id = ++toastId;
  toasts.value.push({ id, message });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, TOAST_TIMEOUT_MS);
}

type CardRefreshOutcome =
  | 'ok'
  | 'quote_error'
  | 'reused'
  | 'no_api_key'
  | 'parse_error'
  | 'ai_error'
  | 'auth_stop';

function sendDesktopAlert(alerts: AlertPayload[]) {
  if (alerts.length === 0) {
    return;
  }
  window.aguDesktop?.sendAlert(alerts);
}

async function refreshCardQuoteAndDiagnosis(
  card: StockCardState,
  snap: QuoteSnapshot | undefined,
  session: SessionLabel,
  aligned: string,
  skipAi = false,
): Promise<CardRefreshOutcome> {
  card.quoteError = false;
  card.aiError = null;
  card.parseError = false;
  card.rawAiText = null;
  card.diagnosisReused = false;

  if (!snap) {
    card.quoteError = true;
    return 'quote_error';
  }

  card.snapshot = {
    ...snap,
    instrumentType: card.stock.instrumentType,
  };
  if (card.stock.name !== snap.name) {
    card.stock.name = snap.name;
    persistConfig();
  }

  if (!hasApiKey.value || skipAi) {
    return 'no_api_key';
  }

  const fingerprint = buildSnapshotFingerprint(
    card.snapshot,
    session,
    card.stock.positionQty,
    card.stock.costPrice,
  );
  const cached = getDiagnosisCache()[card.stock.code];
  if (
    cached?.fingerprint &&
    cached.fingerprint === fingerprint &&
    cached.diagnosis
  ) {
    card.diagnosis = cached.diagnosis;
    card.updatedAt = cached.updatedAt;
    card.diagnosisReused = true;
    return 'reused';
  }

  try {
    const result = await runDiagnosis(
      card.snapshot,
      card.stock,
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
      applyKeyLevelsFromDiagnosis(
        card.stock,
        result.data.supportLevel,
        result.data.resistanceLevel,
        updatedAt,
      );
      return 'ok';
    }
    card.parseError = true;
    card.rawAiText = result.raw;
    return 'parse_error';
  } catch (e) {
    if (e instanceof LlmAuthError) {
      showToast(e.message);
      card.aiError = t('card.diagnoseFailed');
      if (!authAlertSentThisRound) {
        authAlertSentThisRound = true;
        if (config.value.alertSettings?.enabled !== false && config.value.alertSettings?.authErrorAlert !== false) {
          sendDesktopAlert([createAuthErrorAlert()]);
        }
      }
      return 'auth_stop';
    }
    card.aiError = t('card.diagnoseFailed');
    return 'ai_error';
  }
}

const PARSE_RETRY_MAX = 30;
const PARSE_RETRY_BASE_MS = 2000;

async function refreshCardWithParseRetry(
  card: StockCardState,
  session: SessionLabel,
  aligned: string,
  skipAi: boolean,
  aiState: { stopAi: boolean },
  initialSnap?: QuoteSnapshot,
): Promise<CardRefreshOutcome> {
  let lastOutcome: CardRefreshOutcome = 'quote_error';
  let snap = initialSnap;

  for (let attempt = 1; attempt <= PARSE_RETRY_MAX; attempt += 1) {
    if (attempt > 1 || snap === undefined) {
      const quotes = await fetchQuotesWithFallback([card.stock.code]);
      snap = quotes.get(card.stock.code) ?? undefined;
    }

    lastOutcome = await refreshCardQuoteAndDiagnosis(
      card,
      snap,
      session,
      aligned,
      skipAi || aiState.stopAi,
    );

    if (lastOutcome === 'auth_stop') {
      aiState.stopAi = true;
    }

    if (lastOutcome !== 'parse_error') {
      return lastOutcome;
    }

    if (attempt < PARSE_RETRY_MAX) {
      await sleep(Math.min(PARSE_RETRY_BASE_MS + attempt * 300, 8000));
    }
  }

  return lastOutcome;
}

const hasApiKey = computed(() => config.value.apiKey.trim().length > 0);

const pinnedCodes = computed(() =>
  sanitizeWidgetPinnedCodes(
    config.value.widgetPinnedCodes,
    config.value.watchlist,
  ),
);

const pinnedCards = computed(() =>
  pinnedCodes.value
    .map((code) => cards.value.find((c) => c.stock.code === code))
    .filter((c): c is StockCardState => c != null),
);

const isDesktop = computed(() => isDesktopRuntime());

function buildLiveSyncPayload(): LiveSyncPayload {
  return {
    ts: Date.now(),
    config: {
      baseUrl: config.value.baseUrl,
      model: config.value.model,
      refreshFrequency: config.value.refreshFrequency,
      widgetPinnedCodes: config.value.widgetPinnedCodes,
      widgetOpacity: config.value.widgetOpacity,
      widgetAlwaysOnTop: config.value.widgetAlwaysOnTop,
      alertSettings: config.value.alertSettings,
      groups: config.value.groups ? [...config.value.groups] : undefined,
      apiKey: config.value.apiKey,
      watchlist: config.value.watchlist.map((w) => ({ ...w })),
    },
    cards: cards.value.map((c) => ({
      ...c,
      stock: { ...c.stock },
      snapshot: c.snapshot ? { ...c.snapshot } : null,
      diagnosis: c.diagnosis ? { ...c.diagnosis } : null,
    })),
  };
}

function mergeCardsFromWatchlist(
  watchlist: WatchlistItem[],
  syncedCards: StockCardState[],
): StockCardState[] {
  const byCode = new Map(syncedCards.map((c) => [c.stock.code, c]));
  const existing = new Map(cards.value.map((c) => [c.stock.code, c]));

  return watchlist.map((item) => {
    const synced = byCode.get(item.code);
    if (synced) {
      return {
        ...synced,
        stock: { ...item, ...synced.stock, code: item.code },
        snapshot: synced.snapshot ? { ...synced.snapshot } : null,
        diagnosis: synced.diagnosis ? { ...synced.diagnosis } : null,
      };
    }
    const prev = existing.get(item.code);
    if (prev) {
      return { ...prev, stock: { ...item } };
    }
    return buildCards([item])[0];
  });
}

function broadcastLiveSync() {
  const payload = cloneLiveSyncPayload(buildLiveSyncPayload());
  if (isDesktopRuntime()) {
    void saveDesktopLiveSync(payload);
  } else {
    setItem(LIVE_SYNC_KEY, payload);
  }
  window.aguDesktop?.broadcastLiveSync(payload);
}

function applyLiveSync(raw: LiveSyncPayload) {
  if (!isNewerLiveSync(raw, lastAppliedSyncTs)) {
    return;
  }
  lastAppliedSyncTs = raw.ts;
  const watchlist = migrateWatchlist(raw.config.watchlist ?? config.value.watchlist);
  config.value = mergeLiveConfig({ ...raw.config, watchlist }, config.value);
  cards.value = mergeCardsFromWatchlist(watchlist, raw.cards);
  applyWidgetWindowSettings();
}

function reloadWidgetStateFromStorage() {
  const savedConfig = getItem<AppConfig>(CONFIG_KEY);
  if (savedConfig) {
    config.value = normalizeConfig({ ...defaultConfig, ...savedConfig });
  }
  const payload = getItem<LiveSyncPayload>(LIVE_SYNC_KEY);
  if (payload) {
    applyLiveSync(payload);
    return;
  }
  cards.value = buildCards(config.value.watchlist);
}

function setupWidgetStorageListener() {
  if (!isDesktopRuntime() || isPrimaryRunner) {
    return;
  }
  // Electron 桌面版走 IPC，避免 storage 与 IPC 重复 apply
  if (window.aguDesktop?.mode === 'widget') {
    return;
  }
  window.addEventListener('storage', (event) => {
    if (event.key === `${STORAGE_PREFIX}${LIVE_SYNC_KEY}` && event.newValue) {
      try {
        applyLiveSync(JSON.parse(event.newValue) as LiveSyncPayload);
      } catch {
        reloadWidgetStateFromStorage();
      }
      return;
    }
    if (event.key === `${STORAGE_PREFIX}${CONFIG_KEY}` && event.newValue) {
      reloadWidgetStateFromStorage();
    }
  });
}

async function preloadDesktopCalendars(): Promise<void> {
  const year = new Date().getFullYear();
  for (const y of [year, year - 1]) {
    const key = `trading_calendar_${y}`;
    const cached = await desktopStorageGet<unknown>(key);
    if (cached) {
      setDesktopMirrorEntry(key, cached);
    }
  }
}

async function hydrateDesktopPersistence(): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }

  const legacyStorage = collectLegacyStorageForMigration();

  if (isPrimaryRunner) {
    let snap = await loadDesktopUserData();
    const hasFileConfig = Boolean(snap?.config);
    const hasFileDiag = Boolean(
      snap?.diagnosisCache && Object.keys(snap.diagnosisCache).length > 0,
    );

    if (!hasFileConfig && !hasFileDiag) {
      await migrateBrowserStorageToDesktop();
      snap = await loadDesktopUserData();
    }

    if (snap?.config) {
      config.value = normalizeConfig({ ...defaultConfig, ...snap.config });
    } else if (snap?.liveSync) {
      applyConfigFromLiveSyncPayload(snap.liveSync as LiveSyncPayload);
    }

    if (snap?.diagnosisCache) {
      diagnosisCacheMemory = readDiagnosisCacheFromObject(snap.diagnosisCache);
    }
    cards.value = buildCards(config.value.watchlist);
    desktopPersistenceReady = true;
  }

  activateDesktopStorageMirror();
  registerDesktopFilePersist((key, value) => {
    void desktopStorageSet(key, value);
  });
  registerDesktopCalendarCleanup((keepYears) => {
    void desktopCleanupCalendars(keepYears);
  });

  for (const [key, value] of Object.entries(legacyStorage)) {
    if (key.startsWith('trading_calendar_')) {
      setDesktopMirrorEntry(key, value);
    }
  }

  await preloadDesktopCalendars();
  storageOk.value = true;
}

async function bootstrapWidgetDesktopState(): Promise<void> {
  activateDesktopStorageMirror();
  await preloadDesktopCalendars();
  const cached = await loadDesktopLiveSync();
  if (cached && isNewerLiveSync(cached, lastAppliedSyncTs)) {
    applyLiveSync(cached);
  }
}

function applyWidgetWindowSettings() {
  if (!isDesktopRuntime()) {
    return;
  }
  const opacity = clampWidgetOpacity(config.value.widgetOpacity);
  const alwaysOnTop = config.value.widgetAlwaysOnTop ?? true;
  if (lastWidgetOpacity !== opacity) {
    lastWidgetOpacity = opacity;
    window.aguDesktop?.setOpacity(opacity);
  }
  if (lastWidgetAlwaysOnTop !== alwaysOnTop) {
    lastWidgetAlwaysOnTop = alwaysOnTop;
    window.aguDesktop?.setAlwaysOnTop(alwaysOnTop);
  }
}

const calendarLabel = computed(() => {
  const year = new Date().getFullYear();
  if (calendarStatus.value.state === 'syncing') {
    return t('calendar.syncing');
  }
  if (calendarStatus.value.state === 'ok') {
    return t('calendar.ok', { year: calendarStatus.value.year });
  }
  if (getCalendarFailed()) {
    return t('calendar.failed');
  }
  return t('calendar.year', { year });
});

export function useAppState() {
  async function initCalendar(force = false) {
    calendarStatus.value = { state: 'syncing' };
    const result = await syncTradingCalendar(force);
    if (result === 'ok') {
      calendarStatus.value = { state: 'ok', year: new Date().getFullYear() };
    } else {
      calendarStatus.value = { state: 'failed' };
      showToast(t('toast.calendarFailed'));
    }
  }

  function saveConfigField(partial: Partial<AppConfig>) {
    const prevFreq = config.value.refreshFrequency;
    if (partial.refreshFrequency != null) {
      partial.refreshFrequency = normalizeRefreshFrequency(partial.refreshFrequency);
    }
    if (partial.widgetPinnedCodes != null) {
      partial.widgetPinnedCodes = sanitizeWidgetPinnedCodes(
        partial.widgetPinnedCodes,
        config.value.watchlist,
      );
    }
    if (partial.widgetOpacity != null) {
      partial.widgetOpacity = clampWidgetOpacity(partial.widgetOpacity);
    }
    config.value = normalizeConfig({ ...config.value, ...partial });
    persistConfig();
    applyWidgetWindowSettings();
    broadcastLiveSync();
    if (
      partial.refreshFrequency != null &&
      partial.refreshFrequency !== prevFreq
    ) {
      restartScheduler();
    }
  }

  function applyPositionFields(
    item: WatchlistItem,
    positionQty?: number,
    costPrice?: number,
  ): boolean {
    const err = validatePositionPair(positionQty, costPrice);
    if (err) {
      showToast(err);
      return false;
    }
    if (positionQty != null && costPrice != null) {
      item.positionQty = positionQty;
      item.costPrice = roundCostPrice(costPrice);
    } else {
      delete item.positionQty;
      delete item.costPrice;
    }
    return true;
  }

  function addSymbol(
    input: string,
    positionQty?: number,
    costPrice?: number,
  ): boolean {
    const trimmed = input.trim();
    if (!trimmed) {
      showToast(t('toast.enterCode'));
      return false;
    }

    const parsed = normalizeWatchlistSymbol(trimmed);
    if (!parsed) {
      showToast(t('toast.invalidCode'));
      return false;
    }

    if (config.value.watchlist.some((s) => s.code === parsed.code)) {
      showToast(t('toast.duplicate'));
      return false;
    }

    if (config.value.watchlist.length >= MAX_SECURITIES) {
      showToast(t('toast.watchlistLimit', { max: MAX_SECURITIES }));
      return false;
    }

    const item: WatchlistItem = {
      code: parsed.code,
      name: '',
      market: parsed.market,
      instrumentType: parsed.instrumentType,
    };
    if (!applyPositionFields(item, positionQty, costPrice)) {
      return false;
    }
    config.value.watchlist.push(item);
    const cache = getDiagnosisCache();
    cards.value.push({
      stock: item,
      snapshot: null,
      diagnosis: cache[item.code]?.diagnosis ?? null,
      quoteError: false,
      aiError: null,
      parseError: false,
      rawAiText: null,
      loading: false,
      updatedAt: cache[item.code]?.updatedAt || null,
      diagnosisReused: false,
    });
    persistConfig();
    broadcastLiveSync();
    return true;
  }

  function updateSymbolPosition(
    code: string,
    positionQty?: number,
    costPrice?: number,
  ) {
    const item = config.value.watchlist.find((s) => s.code === code);
    const card = cards.value.find((c) => c.stock.code === code);
    if (!item || !card) {
      return;
    }
    if (!applyPositionFields(item, positionQty, costPrice)) {
      return;
    }
    card.stock = { ...item };
    persistConfig();
    broadcastLiveSync();
  }

  function removeSymbol(code: string) {
    config.value.watchlist = config.value.watchlist.filter((s) => s.code !== code);
    config.value.widgetPinnedCodes = sanitizeWidgetPinnedCodes(
      config.value.widgetPinnedCodes,
      config.value.watchlist,
    );
    cards.value = cards.value.filter((c) => c.stock.code !== code);
    persistConfig();
    broadcastLiveSync();
  }

  async function runRefreshSingleCard(code: string) {
    if (!isPrimaryRunner) {
      window.aguDesktop?.requestRefreshSymbol(code);
      return;
    }

    const card = cards.value.find((c) => c.stock.code === code);
    if (!card || card.loading) {
      return;
    }

    card.loading = true;
    try {
      const trading = isTradingDay();
      const session = getSessionLabel(trading);
      const aligned = getAlignedTimeLabel(trading, new Date(), config.value.refreshFrequency);
      const aiState = { stopAi: false };
      const quotes = await fetchQuotesWithFallback([code]);
      const outcome = await refreshCardWithParseRetry(
        card,
        session,
        aligned,
        false,
        aiState,
        quotes.get(code) ?? undefined,
      );

      if (outcome !== 'quote_error' && outcome !== 'no_api_key' && outcome !== 'reused' && !aiState.stopAi) {
        await sleep(CARD_REFRESH_GAP_MS);
      }
    } finally {
      card.loading = false;
      broadcastLiveSync();
    }
  }

  async function runRefresh(manual: boolean) {
    if (refreshing.value) {
      return;
    }
    if (cards.value.length === 0) {
      return;
    }

    refreshing.value = true;
    authAlertSentThisRound = false;
    const trading = isTradingDay();
    const session = getSessionLabel(trading);
    const aligned = getAlignedTimeLabel(trading, new Date(), config.value.refreshFrequency);

    try {
      const codes = cards.value.map((c) => c.stock.code);
      const quotes = await fetchQuotesWithFallback(codes);

      const aiState = { stopAi: false };
      let reusedCount = 0;
      let nextIndex = 0;

      async function refreshOne(card: StockCardState): Promise<void> {
        card.loading = true;
        try {
          const snap = quotes.get(card.stock.code) ?? undefined;
          const outcome = await refreshCardWithParseRetry(
            card,
            session,
            aligned,
            aiState.stopAi,
            aiState,
            snap,
          );

          if (outcome === 'reused') {
            reusedCount += 1;
          }

          if (
            outcome !== 'quote_error' &&
            outcome !== 'no_api_key' &&
            outcome !== 'reused' &&
            !aiState.stopAi
          ) {
            await sleep(CARD_REFRESH_GAP_MS);
          }
        } finally {
          card.loading = false;
        }
      }

      async function worker(): Promise<void> {
        while (nextIndex < cards.value.length) {
          const card = cards.value[nextIndex];
          nextIndex += 1;
          await refreshOne(card);
        }
      }

      const workers = Math.min(AI_REFRESH_CONCURRENCY, cards.value.length);
      await Promise.all(Array.from({ length: workers }, () => worker()));

      if (manual && reusedCount > 0 && reusedCount === cards.value.length) {
        showToast(t('toast.reusedAll'));
      } else if (manual && reusedCount > 0) {
        showToast(t('toast.reusedPartial', { count: reusedCount }));
      }
    } finally {
      refreshing.value = false;
      broadcastLiveSync();
      checkAndSendAlerts(cards.value);
      if (manual) {
        restartScheduler();
      }
    }
  }

  function setupPrimaryDesktopIpc() {
    if (!isDesktopRuntime() || !isPrimaryRunner) {
      return;
    }
    window.aguDesktop?.onRunRefresh(() => {
      void runRefresh(true);
    });
    window.aguDesktop?.onRunRefreshSymbol?.((code) => {
      void runRefreshSingleCard(code);
    });
    window.aguDesktop?.onPushSync(() => {
      broadcastLiveSync();
    });
  }

  function setupWidgetDesktopIpc() {
    if (!isDesktopRuntime() || isPrimaryRunner) {
      return;
    }
    window.aguDesktop?.onLiveSync((payload) => {
      applyLiveSync(payload as LiveSyncPayload);
    });
  }

  function restartScheduler() {
    if (!isPrimaryRunner) {
      return;
    }
    stopScheduler?.();
    stopScheduler = createAlignScheduler(() => {
      if (isInAutoTradingWindow(isTradingDay())) {
        void runRefresh(false);
      }
    }, config.value.refreshFrequency);
    manageHighFreqScheduler();
  }

  function checkAndSendAlerts(cards: StockCardState[]) {
    if (!isDesktopRuntime()) {
      return;
    }
    const alerts = collectAlertsFromRound(
      cards,
      config.value.alertSettings,
      lastPricesForBreakthrough,
    );
    sendDesktopAlert(alerts);
  }

  function hasOverclock(): boolean {
    return config.value.watchlist.some((w) => w.refreshMode === 'overclock');
  }

  function getOverclockCount(): number {
    return config.value.watchlist.filter((w) => w.refreshMode === 'overclock').length;
  }

  function shouldRunHighFreq(): boolean {
    if (!hasOverclock()) {
      return false;
    }
    return isInAutoTradingWindow(isTradingDay());
  }

  function stopHighFreqScheduler() {
    if (highFreqTimer) {
      clearTimeout(highFreqTimer);
      highFreqTimer = null;
    }
  }

  async function runHighFreqCheck() {
    stopHighFreqScheduler();
    if (!shouldRunHighFreq()) {
      return;
    }
    try {
      const overclockCodes = config.value.watchlist
        .filter((w) => w.refreshMode === 'overclock')
        .map((w) => w.code);
      if (overclockCodes.length === 0) {
        return;
      }
      const quotes = await fetchQuotesWithFallback(overclockCodes);
      for (const card of cards.value) {
        const snap = quotes.get(card.stock.code);
        if (snap) {
          card.snapshot = { ...snap, instrumentType: card.stock.instrumentType };
          if (card.stock.name !== snap.name) {
            card.stock.name = snap.name;
          }
        }
      }
      const cardsToCheck = cards.value.filter((c) => quotes.has(c.stock.code));
      if (cardsToCheck.length > 0) {
        const alerts = collectAlertsFromRound(
          cardsToCheck,
          config.value.alertSettings,
          lastPricesForBreakthrough,
        );
        sendDesktopAlert(alerts);
      }
      broadcastLiveSync();
    } catch {
      /* high-frequency poll failure is silent */
    } finally {
      if (shouldRunHighFreq()) {
        highFreqTimer = setTimeout(runHighFreqCheck, HIGH_FREQ_INTERVAL_MS);
      }
    }
  }

  function manageHighFreqScheduler() {
    if (!isPrimaryRunner) {
      return;
    }
    if (shouldRunHighFreq()) {
      stopHighFreqScheduler();
      highFreqTimer = setTimeout(runHighFreqCheck, HIGH_FREQ_INTERVAL_MS);
    } else {
      stopHighFreqScheduler();
    }
  }

  function startScheduler() {
    if (!isPrimaryRunner) {
      return;
    }
    restartScheduler();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        restartScheduler();
      }
    });
  }

  async function exportUserBackup() {
    const result = await exportDesktopBackup();
    if (result.ok && result.path) {
      showToast(t('config.exportBackupOk', { path: result.path }));
      return;
    }
    showToast(t('config.exportBackupFailed'));
  }

  async function bootstrap() {
    if (isDesktopRuntime()) {
      if (isPrimaryRunner) {
        await hydrateDesktopPersistence();
        window.__aguFlushPersistence = flushDesktopPersistence;
      } else {
        await bootstrapWidgetDesktopState();
      }
    }

    await applyLocalFileConfig();

    if (isPrimaryRunner) {
      await initCalendar(false);
      setupPrimaryDesktopIpc();
      startScheduler();
      if (isInAutoTradingWindow(isTradingDay())) {
        await runRefresh(false);
      } else {
        broadcastLiveSync();
      }
      applyWidgetWindowSettings();
      return;
    }

    setupWidgetDesktopIpc();
    setupWidgetStorageListener();
    if (!isDesktopRuntime()) {
      const cached = getItem<LiveSyncPayload>(LIVE_SYNC_KEY);
      if (cached && isNewerLiveSync(cached, lastAppliedSyncTs)) {
        applyLiveSync(cached);
      }
    }
    window.aguDesktop?.requestSync();
    applyWidgetWindowSettings();
  }

  function cycleRefreshMode(code: string) {
    const item = config.value.watchlist.find((w) => w.code === code);
    if (!item) {
      return;
    }
    const modes: RefreshMode[] = ['off', 'normal', 'overclock'];
    const current = item.refreshMode || 'normal';
    let nextIdx = modes.indexOf(current) + 1;
    if (nextIdx >= modes.length) {
      nextIdx = 0;
    }
    const next = modes[nextIdx];
    if (next === 'overclock') {
      if (!item.keyLevels || item.keyLevels.length === 0) {
        showToast(t('toast.overclockNeedKeyLevels'));
        return;
      }
      if (getOverclockCount() >= MAX_OVERCLOCK && current !== 'overclock') {
        showToast(t('toast.overclockLimit', { max: MAX_OVERCLOCK }));
        return;
      }
    }
    item.refreshMode = next;
    persistConfig();
    broadcastLiveSync();
    manageHighFreqScheduler();
  }

  function addGroup(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 10) {
      return false;
    }
    const groups = config.value.groups ?? [];
    if (groups.some((g) => g.name === trimmed)) {
      return false;
    }
    const id = `group_${Date.now()}`;
    const maxOrder = groups.reduce((max, g) => Math.max(max, g.order), -1);
    groups.push({ id, name: trimmed, order: maxOrder + 1, collapsed: false });
    config.value.groups = groups;
    persistConfig();
    broadcastLiveSync();
    return true;
  }

  function renameGroup(id: string, name: string): boolean {
    const groups = config.value.groups;
    if (!groups) {
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 10) {
      return false;
    }
    const group = groups.find((g) => g.id === id);
    if (!group) {
      return false;
    }
    if (groups.some((g) => g.id !== id && g.name === trimmed)) {
      return false;
    }
    group.name = trimmed;
    persistConfig();
    broadcastLiveSync();
    return true;
  }

  function removeGroup(id: string) {
    const groups = config.value.groups;
    if (!groups) {
      return;
    }
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0) {
      return;
    }
    groups.splice(idx, 1);
    for (const item of config.value.watchlist) {
      if (item.groupId === id) {
        item.groupId = undefined;
      }
    }
    persistConfig();
    broadcastLiveSync();
  }

  function setSecurityGroup(code: string, groupId: string | undefined) {
    const item = config.value.watchlist.find((w) => w.code === code);
    if (!item) {
      return;
    }
    item.groupId = groupId;
    persistConfig();
    broadcastLiveSync();
  }

  function toggleGroupCollapse(id: string) {
    const groups = config.value.groups;
    if (!groups) {
      return;
    }
    const group = groups.find((g) => g.id === id);
    if (!group) {
      return;
    }
    group.collapsed = !group.collapsed;
    persistConfig();
  }

  return {
    config,
    cards,
    pinnedCards,
    pinnedCodes,
    watchlistCount,
    refreshing,
    configOpen,
    storageOk,
    usingFileConfig,
    calendarStatus,
    calendarLabel,
    toasts,
    hasApiKey,
    isDesktop,
    appMode,
    showToast,
    saveConfigField,
    addSymbol,
    updateSymbolPosition,
    removeSymbol,
    runRefreshSymbol: runRefreshSingleCard,
    runRefresh,
    initCalendar,
    bootstrap,
    exportUserBackup,
    updateAlertSettings: (settings: Partial<AlertSettings>) => {
      const current = config.value.alertSettings ?? { enabled: true, priceAlert: true, signalAlert: true, authErrorAlert: true, quoteErrorAlert: true };
      config.value.alertSettings = { ...current, ...settings };
      persistConfig();
      broadcastLiveSync();
    },
    toggleKeyLevelsLock: (code: string) => {
      const item = config.value.watchlist.find((w) => w.code === code);
      if (!item) {
        return;
      }
      toggleKlLock(item);
      persistConfig();
      broadcastLiveSync();
    },
    addCustomKeyLevel: (code: string, price: number, label: string) => {
      const item = config.value.watchlist.find((w) => w.code === code);
      if (!item) {
        return false;
      }
      const ok = addKl(item, price, label);
      if (ok) {
        persistConfig();
        broadcastLiveSync();
      }
      return ok;
    },
    removeCustomKeyLevel: (code: string, index: number) => {
      const item = config.value.watchlist.find((w) => w.code === code);
      if (!item) {
        return false;
      }
      const ok = removeKl(item, index);
      if (ok) {
        persistConfig();
        broadcastLiveSync();
      }
      return ok;
    },
    cycleRefreshMode,
    addGroup,
    renameGroup,
    removeGroup,
    setSecurityGroup,
    toggleGroupCollapse,
  };
}
