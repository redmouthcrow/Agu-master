import { ref, computed } from 'vue';
import type {
  ActionPlan,
  AlertPayload,
  AlertSettings,
  AppConfig,
  CalendarSyncStatus,
  DiagnosisCacheEntry,
  DiagnosisResult,
  EquitySnapshot,
  InvestmentHorizon,
  LiveSyncPayload,
  PendingOrder,
  PlanType,
  QuoteSnapshot,
  RefreshMode,
  SessionLabel,
  StockCardState,
  Trade,
  WatchlistItem,
} from '../types';
import { MAX_OVERCLOCK, MAX_SECURITIES } from '../types';
import { getItem, isStorageAvailable, setItem, activateDesktopStorageMirror, setDesktopMirrorEntry, registerDesktopFilePersist, registerDesktopCalendarCleanup, collectLegacyStorageForMigration } from '../utils/storage';
import { inferInstrumentType, normalizeWatchlistSymbol } from '../utils/stockCode';
import { buildSnapshotFingerprint } from '../utils/snapshotFingerprint';
import { adviceForPlan } from '../utils/pendingAdvice';
import {
  formatTimeHms,
  getAlignedTimeLabel,
  getSessionLabel,
  isInAutoTradingWindow,
} from '../utils/time';
import { fetchQuotesWithFallback } from '../services/quoteJsonp';
import { fetchSina } from '../services/quoteJsonp';
import { LlmAuthError, runDiagnosis, sleep } from '../services/llmDiagnosis';
import {
  getCalendarFailed,
  isTradingDay,
  syncTradingCalendar,
} from '../services/tradingCalendar';
import { createAlignScheduler } from '../services/scheduler';
import { loadLocalUserConfig } from '../services/userConfig';
import { normalizeRefreshFrequency } from '../utils/alignGrid';
import { hasPosition, validatePositionPair, roundCostPrice } from '../utils/position';
import { recordPrice } from '../utils/priceHistory';
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
  migrateBrowserStorageToDesktop,
  saveDesktopConfig,
  saveDesktopDiagnosisCache,
  saveDesktopLiveSync,
  exportDesktopBackup,
} from '../services/desktopPersistence';
import { t } from '../i18n';
import { collectAlertsFromRound, createAuthErrorAlert } from '../services/alertService';
import { calcTradeFee } from '../services/tradingCost';
import { computePerformance } from '../services/performance';
import { shouldKeepCachedBandAdvice, shouldKeepCachedLongAdvice } from '../utils/bandAdvice';
import {
  applyKeyLevelsFromDiagnosis,
  toggleKeyLevelsLock as toggleKlLock,
  addCustomKeyLevel as addKl,
  removeCustomKeyLevel as removeKl,
} from '../utils/keyLevelManager';

const CONFIG_KEY = 'config';
const DIAG_KEY = 'diagnosis_cache';
const LIVE_SYNC_KEY = 'live_sync';
const PENDING_ORDERS_KEY = 'pending_orders';
const TRADES_KEY = 'trades';
const EQUITY_SNAPSHOTS_KEY = 'equity_snapshots';
const STORAGE_PREFIX = 'agu_';
/** v2.12: max retained equity snapshots (~1.1 calendar years). */
const MAX_EQUITY_SNAPSHOTS = 400;

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

// --- v2.10 simulated account & adopted orders ---
const pendingOrders = ref<PendingOrder[]>([]);
const trades = ref<Trade[]>([]);
// --- v2.12 equity snapshots (performance feedback loop) ---
const equitySnapshots = ref<EquitySnapshot[]>([]);
/** Last observed price per symbol, for order trigger penetration detection. */
const orderLastPrices = new Map<string, number>();

if (!isDesktopRuntime()) {
  loadOrdersAndTradesSync();
}

function loadOrdersAndTradesSync(): void {
  pendingOrders.value = getItem<PendingOrder[]>(PENDING_ORDERS_KEY) ?? [];
  trades.value = getItem<Trade[]>(TRADES_KEY) ?? [];
  equitySnapshots.value = getItem<EquitySnapshot[]>(EQUITY_SNAPSHOTS_KEY) ?? [];
}

function persistOrdersAndTrades(): void {
  if (isDesktopRuntime()) {
    void window.aguDesktop?.storageSet(PENDING_ORDERS_KEY, pendingOrders.value);
    void window.aguDesktop?.storageSet(TRADES_KEY, trades.value);
    void window.aguDesktop?.storageSet(EQUITY_SNAPSHOTS_KEY, equitySnapshots.value);
    return;
  }
  setItem(PENDING_ORDERS_KEY, pendingOrders.value);
  setItem(TRADES_KEY, trades.value);
  setItem(EQUITY_SNAPSHOTS_KEY, equitySnapshots.value);
}

/**
 * Available cash = initial capital + Σ(sell proceeds − fees) − Σ(buy costs + fees).
 * v2.12: fees are part of the ledger math (legacy trades without fee use 0).
 */
const availableCash = computed(() => {
  let cash = config.value.initialCapital ?? 0;
  for (const tr of trades.value) {
    const fee = tr.fee ?? 0;
    if (tr.side === 'sell') {
      cash += tr.amount - fee;
    } else {
      cash -= tr.amount + fee;
    }
  }
  return Math.round(cash * 100) / 100;
});

/** Cumulative realized PnL across auto-filled sell trades. */
const realizedTotalPnl = computed(() => {
  let total = 0;
  for (const tr of trades.value) {
    if (tr.side === 'sell' && tr.realizedPnl != null) {
      total += tr.realizedPnl;
    }
  }
  return Math.round(total * 100) / 100;
});

/** Local calendar date key (YYYY-MM-DD) for same-day order checks. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- v2.12 performance feedback loop: daily equity snapshots ---

/** CSI300 index code for benchmark comparison. */
const INDEX_CODE = 'sh000300';
/** Set when a day's snapshot was skipped due to a missing/stale quote. */
const snapshotSkipped = ref(false);

/**
 * Record today's equity snapshot (primary runner only).
 * - totalAssets = availableCash + Σ(currentPrice × positionQty)
 * - Any position card with a null price OR a quoteTime that is not today
 *   (stale quote from a silent refresh failure) skips the WHOLE day —
 *   no NaN, no stale carry, per D10.
 * - Same-day overwrite, cross-day append, cap at MAX_EQUITY_SNAPSHOTS.
 */
async function snapshotEquity(): Promise<void> {
  if (!isPrimaryRunner) {
    return;
  }
  const watchlist = config.value.watchlist;
  if (watchlist.length === 0) {
    return;
  }
  const today = localDateKey(new Date());
  const cardByCode = new Map(cards.value.map((c) => [c.stock.code, c]));

  let marketValue = 0;
  let unrealized = 0;
  let countedPositions = 0;
  for (const item of watchlist) {
    if (item.positionQty == null) {
      continue;
    }
    const card = cardByCode.get(item.code);
    const price = card?.snapshot?.price;
    const quoteDate = card?.snapshot?.quoteTime?.slice(0, 10);
    // Missing price or a quote not from today → skip the whole day.
    if (price == null || quoteDate !== today) {
      snapshotSkipped.value = true;
      return;
    }
    marketValue += price * item.positionQty;
    if (item.costPrice != null) {
      unrealized += (price - item.costPrice) * item.positionQty;
    }
    countedPositions += 1;
  }
  // No positions to value — a cash-only curve carries no signal; skip.
  if (countedPositions === 0) {
    return;
  }

  // Fetch the index close for benchmark comparison (failure → undefined).
  let indexClose: number | undefined;
  try {
    const idxQuotes = await fetchQuotesWithFallback([INDEX_CODE]);
    const idx = idxQuotes.get(INDEX_CODE);
    if (idx?.price != null) {
      indexClose = idx.price;
    }
  } catch {
    /* benchmark line optional */
  }

  const totalAssets = Math.round((availableCash.value + marketValue) * 100) / 100;
  const snap: EquitySnapshot = {
    date: today,
    totalAssets,
    realizedPnl: realizedTotalPnl.value,
    unrealizedPnl: Math.round(unrealized * 100) / 100,
    cash: availableCash.value,
    indexClose,
  };

  const list = [...equitySnapshots.value];
  const idx = list.findIndex((s) => s.date === today);
  if (idx >= 0) {
    list[idx] = snap; // same-day overwrite (idempotent across dual triggers)
  } else {
    list.push(snap);
  }
  equitySnapshots.value = list.slice(-MAX_EQUITY_SNAPSHOTS);
  persistOrdersAndTrades();
  snapshotSkipped.value = false;
}

/** v2.12: reactive performance stats for the panel. */
const performanceStats = computed(() =>
  computePerformance(trades.value, equitySnapshots.value, config.value.initialCapital),
);

/**
 * v2.10.1: adopted orders live only for the day they were created. Stale
 * orders (created on a previous calendar day) are auto-cancelled so a new
 * session never inherits yesterday's pending orders.
 */
function expireStaleOrders(): number {
  const today = localDateKey(new Date());
  let cancelled = 0;
  for (const order of pendingOrders.value) {
    if (order.status !== 'pending') {
      continue;
    }
    const created = new Date(order.createdAt);
    if (Number.isNaN(created.getTime())) {
      continue;
    }
    if (localDateKey(created) === today) {
      continue;
    }
    order.status = 'cancelled';
    cancelled += 1;
  }
  if (cancelled > 0) {
    persistOrdersAndTrades();
    showToast(t('toast.ordersExpired', { count: cancelled }));
  }
  return cancelled;
}

function planDetailLabel(plan: ActionPlan, instrumentType: string): string {
  const unit = instrumentType === 'fund_etf' ? '份' : '股';
  const side = plan.side === 'sell' ? t('trade.sell') : t('trade.buy');
  return `${side} ${plan.qty}${unit} @ ${plan.triggerPrice.toFixed(3)}`;
}

function notifyTradeAlert(code: string, name: string, message: string): void {
  if (!isDesktopRuntime()) {
    return;
  }
  const settings = config.value.alertSettings;
  if (settings?.enabled === false || settings?.tradeAlert === false) {
    return;
  }
  sendDesktopAlert([{ type: 'trade', code, name, tradeMsg: message }]);
}

/**
 * Execute a pending order's bookkeeping: position, cost, realized PnL and
 * cash are derived from the Trade ledger. Runs in the primary runner only.
 */
function executeFill(order: PendingOrder): void {
  const item = config.value.watchlist.find((w) => w.code === order.code);
  const card = cards.value.find((c) => c.stock.code === order.code);
  if (!item || !card) {
    order.status = 'rejected';
    persistOrdersAndTrades();
    return;
  }
  const plan = order.plan;
  const price = plan.triggerPrice;
  const amount = Math.round(price * plan.qty * 100) / 100;
  const fee = calcTradeFee(plan.side, amount, item.instrumentType);

  if (plan.side === 'sell') {
    if (!hasPosition(item) || item.positionQty! < plan.qty) {
      order.status = 'rejected';
      persistOrdersAndTrades();
      const detail = planDetailLabel(plan, item.instrumentType);
      showToast(t('toast.orderRejected', { detail }));
      notifyTradeAlert(item.code, item.name || item.code, `${t('trade.rejected')} ${detail}`);
      return;
    }
    // v2.12: sell fees are deducted from realized PnL.
    const realized = Math.round(((price - item.costPrice!) * plan.qty - fee) * 100) / 100;
    const remaining = item.positionQty! - plan.qty;
    item.actualPnl = Math.round(((item.actualPnl ?? 0) + realized) * 100) / 100;
    if (remaining <= 0) {
      delete item.positionQty;
      delete item.costPrice;
      delete card.stock.positionQty;
      delete card.stock.costPrice;
    } else {
      item.positionQty = remaining;
      card.stock.positionQty = remaining;
    }
    card.stock.actualPnl = item.actualPnl;
    trades.value.push({
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code: item.code,
      name: item.name || item.code,
      side: 'sell',
      qty: plan.qty,
      price,
      amount,
      realizedPnl: realized,
      source: 'auto',
      planType: order.planType,
      signal: order.signal,
      fee,
      createdAt: new Date().toISOString(),
    });
  } else {
    // v2.12: buy funds check includes the fee.
    if (amount + fee > availableCash.value) {
      order.status = 'rejected';
      persistOrdersAndTrades();
      const detail = planDetailLabel(plan, item.instrumentType);
      showToast(t('toast.insufficientFunds'));
      notifyTradeAlert(item.code, item.name || item.code, `${t('trade.rejected')} ${detail}`);
      return;
    }
    if (hasPosition(item)) {
      // v2.12: buy fee is amortized into cost basis.
      const newQty = item.positionQty! + plan.qty;
      const newCost = roundCostPrice(
        (item.costPrice! * item.positionQty! + amount + fee) / newQty,
      );
      item.positionQty = newQty;
      item.costPrice = newCost;
      card.stock.positionQty = newQty;
      card.stock.costPrice = newCost;
    } else {
      item.positionQty = plan.qty;
      item.costPrice = roundCostPrice((amount + fee) / plan.qty);
      card.stock.positionQty = plan.qty;
      card.stock.costPrice = item.costPrice;
    }
    trades.value.push({
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code: item.code,
      name: item.name || item.code,
      side: 'buy',
      qty: plan.qty,
      price,
      amount,
      source: 'auto',
      planType: order.planType,
      signal: order.signal,
      fee,
      createdAt: new Date().toISOString(),
    });
  }

  order.status = 'filled';
  order.filledAt = new Date().toISOString();

  // Position changed — cached diagnosis and its fingerprint are stale.
  if (card.diagnosis) {
    card.diagnosis = null;
    card.updatedAt = null;
    card.diagnosisReused = false;
    delete getDiagnosisCache()[item.code];
    flushDiagnosisCache();
  }
  cards.value = [...cards.value];
  persistConfig();
  persistOrdersAndTrades();
  broadcastLiveSync();
  const detail = planDetailLabel(plan, item.instrumentType);
  showToast(t('toast.orderFilled', { detail }));
  notifyTradeAlert(item.code, item.name || item.code, `${t('trade.filled')} ${detail}`);
}

/**
 * Check adopted orders for a card after its snapshot updates. Penetration
 * semantics: sell triggers when price crosses the trigger from below, buy
 * from above; the first observation already past the trigger fires too
 * (covers overnight gaps).
 */
function checkPendingOrdersForCard(card: StockCardState): void {
  expireStaleOrders();
  const price = card.snapshot?.price;
  if (price == null) {
    return;
  }
  const orders = pendingOrders.value.filter(
    (o) => o.code === card.stock.code && o.status === 'pending',
  );
  const lastPrice = orderLastPrices.get(card.stock.code);
  for (const order of orders) {
    const tp = order.plan.triggerPrice;
    const triggered =
      order.plan.condition === 'gte'
        ? (lastPrice == null && price >= tp) || (lastPrice != null && lastPrice < tp && price >= tp)
        : (lastPrice == null && price <= tp) || (lastPrice != null && lastPrice > tp && price <= tp);
    if (triggered) {
      executeFill(order);
    }
  }
  orderLastPrices.set(card.stock.code, price);
}

let diagnosisCacheMemory: Record<string, DiagnosisCacheEntry> | null = null;

/**
 * v2.5→v2.6 migration: cache field evolution across two versions.
 *
 * Migration rules:
 *  1. v2.6 entries carrying buildPositionAdvice → valid.
 *  2. v2.5/v2.6 with-position (shortAction + bandAction both present) → valid.
 *  3. v2.5 without-position (bandAction alone) → stale, discard.
 *  4. Anything else is incomplete → discard.
 * Returns the migrated DiagnosisResult, or null if the entry must be discarded.
 */
function migrateDiagnosis(d: DiagnosisResult): DiagnosisResult | null {
  if (d.buildPositionAdvice) {
    return d;
  }
  // v2.14.0: long-horizon entries carry longAction only.
  if (d.longAction) {
    return d;
  }
  // v2.13.0+: swing entries may omit shortAction; bandAction alone is valid.
  if (d.bandAction) {
    return d;
  }
  return null;
}

function readDiagnosisCacheFromObject(
  raw: Record<string, DiagnosisCacheEntry | DiagnosisResult>,
): Record<string, DiagnosisCacheEntry> {
  const out: Record<string, DiagnosisCacheEntry> = {};
  for (const [code, entry] of Object.entries(raw)) {
    // All current caches use the DiagnosisCacheEntry wrapper format.
    if ('fingerprint' in entry && entry.diagnosis) {
      const migrated = migrateDiagnosis(entry.diagnosis);
      if (migrated) {
        out[code] = { ...entry, diagnosis: migrated };
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
  investmentStyle: 'neutral',
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
    tradeAlert: true,
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
    // v2.14.2: 投资周期决定渲染哪族建议行——悬浮窗必须同步，否则长期模式下
    // 诊断只有 longAction，悬浮窗按 short 渲染会一行建议都不显示。
    investmentHorizon: live.investmentHorizon ?? base.investmentHorizon,
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
  const plain = JSON.parse(JSON.stringify(config.value)) as AppConfig;
  await Promise.all([
    saveDesktopConfig(plain),
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
  // Strip Vue reactivity proxies before serialisation.
  const plain = JSON.parse(JSON.stringify(config.value)) as AppConfig;
  if (isDesktopRuntime()) {
    if (!canPersistDesktopConfig()) {
      return;
    }
    void saveDesktopConfig(plain);
    return;
  }
  if (!setItem(CONFIG_KEY, plain)) {
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
  // v2.10: any snapshot update may trigger adopted pending orders.
  checkPendingOrdersForCard(card);
  // Record today's close price for 7-day trend history.
  if (snap.price != null) {
    recordPrice(card.stock.code, snap.price);
  }
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
    config.value.investmentHorizon ?? 'short',
    card.stock.actualPnl,
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
      config.value.initialCapital != null ? availableCash.value : null,
    );
    if (result.ok) {
      const today = localDateKey(new Date());
      const cachedDiag = cached?.diagnosis;
      const horizon: InvestmentHorizon = config.value.investmentHorizon ?? 'short';
      let diagnosis: DiagnosisResult;
      let keepCachedBand = false;
      if (horizon === 'long') {
        // v2.14.0 cross-day long freeze: 长期策略跨日稳定——"看涨就不管今天的
        // 涨跌继续持有"。仅当锚定关键位实质变化、或价格真实穿越锚定区间时更新。
        const keepCachedLong = shouldKeepCachedLongAdvice({
          cachedLong: cachedDiag?.longAction,
          cachedSupport: cachedDiag?.supportLevel,
          cachedResistance: cachedDiag?.resistanceLevel,
          newSupport: result.data.supportLevel,
          newResistance: result.data.resistanceLevel,
          price: card.snapshot?.price,
        });
        diagnosis = keepCachedLong
          ? {
              ...result.data,
              longAction: cachedDiag!.longAction,
              longPlan: cachedDiag!.longPlan ?? null,
            }
          : result.data;
      } else {
        // v2.12.3 intraday band freeze: bandAction is a multi-day recommendation;
        // keep today's first version while its anchored key levels are stable.
        // v2.14.0: the cached bandPlan travels with the frozen text so the
        // adopted order stays consistent with the frozen advice.
        keepCachedBand = shouldKeepCachedBandAdvice({
          cachedBand: cachedDiag?.bandAction,
          cachedBandDate: cached?.bandDate,
          today,
          cachedSupport: cachedDiag?.supportLevel,
          cachedResistance: cachedDiag?.resistanceLevel,
          newSupport: result.data.supportLevel,
          newResistance: result.data.resistanceLevel,
        });
        diagnosis = keepCachedBand
          ? {
              ...result.data,
              bandAction: cachedDiag!.bandAction,
              bandPlan: cachedDiag!.bandPlan ?? null,
            }
          : result.data;
      }
      const updatedAt = formatTimeHms();
      card.diagnosis = diagnosis;
      card.updatedAt = updatedAt;
      persistDiagnosisEntry(card.stock.code, {
        diagnosis,
        fingerprint,
        updatedAt,
        bandDate: diagnosis.bandAction ? (keepCachedBand ? cached?.bandDate : today) : undefined,
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
    .map((code) => {
      const card = cards.value.find((c) => c.stock.code === code);
      if (card) return card;
      // Fallback: create a placeholder card so the widget never loses a pin.
      const watchItem = config.value.watchlist.find((w) => w.code === code);
      if (!watchItem) return null;
      const cache = getDiagnosisCache();
      return {
        stock: watchItem,
        snapshot: null,
        diagnosis: cache[code]?.diagnosis ?? null,
        quoteError: false,
        aiError: null,
        parseError: false,
        rawAiText: null,
        loading: false,
        updatedAt: cache[code]?.updatedAt || null,
        diagnosisReused: false,
      } as StockCardState;
    })
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
      investmentHorizon: config.value.investmentHorizon,
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
      const prev = existing.get(item.code);
      // Preserve local position data if it exists — dashboard broadcasts may
      // arrive out of order during refresh, and local edits should survive.
      const stock = {
        ...item,
        ...synced.stock,
        code: item.code,
        positionQty: prev?.stock.positionQty ?? synced.stock.positionQty ?? item.positionQty,
        costPrice: prev?.stock.costPrice ?? synced.stock.costPrice ?? item.costPrice,
        actualPnl: prev?.stock.actualPnl ?? synced.stock.actualPnl ?? item.actualPnl,
      };
      return {
        ...synced,
        stock,
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
    // v2.10: simulated account state lives in the file-backed KV store.
    // v2.12: equity snapshots hydrate alongside orders/trades.
    const [orders, ledger, snapshots] = await Promise.all([
      desktopStorageGet<PendingOrder[]>(PENDING_ORDERS_KEY),
      desktopStorageGet<Trade[]>(TRADES_KEY),
      desktopStorageGet<EquitySnapshot[]>(EQUITY_SNAPSHOTS_KEY),
    ]);
    if (orders) {
      pendingOrders.value = orders;
    }
    if (ledger) {
      trades.value = ledger;
    }
    if (snapshots) {
      equitySnapshots.value = snapshots;
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
    // Don't load cached sync — it may be stale (widget was closed while dashboard updated).
    // Widget gets fresh data via requestSync() after setupWidgetDesktopIpc is in place.
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
    // v2.14.1: 切换投资周期会改变建议契约——旧周期的缓存诊断必须作废，
    // 否则行情未变/休市时会一直沿用（长期模式将无行可显示）。
    const horizonChanged =
      partial.investmentHorizon != null &&
      partial.investmentHorizon !== config.value.investmentHorizon;
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
    if (horizonChanged) {
      const cache = getDiagnosisCache();
      for (const key of Object.keys(cache)) {
        delete cache[key];
      }
      flushDiagnosisCache();
      for (const card of cards.value) {
        card.diagnosis = null;
        card.updatedAt = null;
        card.diagnosisReused = false;
      }
      cards.value = [...cards.value];
    }
    applyWidgetWindowSettings();
    broadcastLiveSync();
    if (
      partial.refreshFrequency != null &&
      partial.refreshFrequency !== prevFreq
    ) {
      restartScheduler();
    }
    if (horizonChanged) {
      // 立即按新契约重新诊断（行情未变也会重新调用——指纹含周期）。
      void runRefresh(false);
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
    actualPnl?: number,
  ) {
    const item = config.value.watchlist.find((s) => s.code === code);
    const card = cards.value.find((c) => c.stock.code === code);
    if (!item || !card) {
      return;
    }
    if (!applyPositionFields(item, positionQty, costPrice)) {
      return;
    }
    // Mutate card.stock in-place to preserve shared reference with config.watchlist.
    if (item.positionQty != null) {
      card.stock.positionQty = item.positionQty;
    } else {
      delete card.stock.positionQty;
    }
    if (item.costPrice != null) {
      card.stock.costPrice = item.costPrice;
    } else {
      delete card.stock.costPrice;
    }
    // Actual PnL
    if (actualPnl != null) {
      item.actualPnl = actualPnl;
      card.stock.actualPnl = actualPnl;
    } else if (actualPnl === undefined) {
      // keep existing value when not explicitly cleared
    } else {
      delete item.actualPnl;
      delete card.stock.actualPnl;
    }
    // Invalidate cached diagnosis — position changed, old AI advice is stale.
    if (card.diagnosis) {
      card.diagnosis = null;
      card.updatedAt = null;
      card.diagnosisReused = false;
      delete getDiagnosisCache()[code];
      // Also clear the fingerprint so next refresh doesn't hit the "reused" path.
      flushDiagnosisCache();
    }
    cards.value = [...cards.value];
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

  // --- v2.10 adopt / cancel adopted AI orders ---

  function planOf(card: StockCardState, planType: PlanType): ActionPlan | null | undefined {
    const d = card.diagnosis;
    if (!d) {
      return undefined;
    }
    if (planType === 'short') {
      return d.shortPlan;
    }
    if (planType === 'band') {
      return d.bandPlan;
    }
    if (planType === 'long') {
      return d.longPlan;
    }
    return d.buildPlan;
  }

  /** Adopt an AI structured order → pending order. Validates at listing time. */
  function adoptPlan(code: string, planType: PlanType, manualPlan?: ActionPlan): boolean {
    const card = cards.value.find((c) => c.stock.code === code);
    const item = config.value.watchlist.find((w) => w.code === code);
    if (!card || !item) {
      return false;
    }
    // v2.13.0: 弹窗采纳时数量/价位由用户填写（manualPlan），无弹窗时沿用 AI 计划。
    const plan = manualPlan ?? planOf(card, planType);
    if (!plan) {
      return false;
    }
    if (plan.side === 'sell') {
      if (!hasPosition(item) || item.positionQty! < plan.qty) {
        showToast(t('toast.sellQtyExceeds'));
        return false;
      }
    } else {
      if (config.value.initialCapital == null) {
        showToast(t('toast.needInitialCapital'));
        return false;
      }
      // v2.12: the adopt-time check includes the estimated fee.
      const estAmount = Math.round(plan.qty * plan.triggerPrice * 100) / 100;
      const estFee = calcTradeFee('buy', estAmount, item.instrumentType);
      if (estAmount + estFee > availableCash.value) {
        showToast(t('toast.insufficientFunds'));
        return false;
      }
    }
    // v2.13.1: 同一建议行再次采纳 → 替换原挂单（撤旧挂新），不再拒绝。
    const existing = pendingOrders.value.filter(
      (o) => o.code === code && o.planType === planType && o.status === 'pending',
    );
    for (const o of existing) {
      o.status = 'cancelled';
    }
    pendingOrders.value.push({
      id: `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code,
      name: item.name || code,
      plan: { ...plan },
      planType,
      // v2.12: capture the signal at adopt time for attribution.
      signal: card.diagnosis?.signal,
      // v2.13.1: bind the order to the advice it was adopted from (chip gating).
      sourceAdvice: adviceForPlan(card.diagnosis, planType),
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    persistOrdersAndTrades();
    const detail = planDetailLabel(plan, item.instrumentType);
    showToast(
      existing.length > 0
        ? t('toast.orderReplaced', { detail })
        : t('toast.orderAdopted', { detail }),
    );
    return true;
  }

  /** Cancel a pending order (only pending orders can be cancelled). */
  function cancelOrder(orderId: string): void {
    const order = pendingOrders.value.find((o) => o.id === orderId);
    if (!order || order.status !== 'pending') {
      return;
    }
    order.status = 'cancelled';
    persistOrdersAndTrades();
    showToast(t('toast.orderCancelled'));
  }

  /** v2.10.1: cancel the adopted order for a suggestion row (card chip). */
  function cancelOrderForPlan(code: string, planType: PlanType): void {
    const order = pendingOrders.value.find(
      (o) => o.code === code && o.planType === planType && o.status === 'pending',
    );
    if (!order) {
      return;
    }
    order.status = 'cancelled';
    persistOrdersAndTrades();
    showToast(t('toast.orderCancelled'));
  }

  async function runRefreshSingleCard(code: string) {
    if (!isPrimaryRunner) {
      window.aguDesktop?.requestRefreshSymbol(code);
      return;
    }

    const card = cards.value.find((c) => c.stock.code === code);
    if (!card || card.loading) {
      broadcastLiveSync();
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
      const codes = cards.value.filter((c) => !c.stock.trackingOnly).map((c) => c.stock.code);
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
          // Skip cards with refresh mode set to 'off' or tracking-only.
          if (card.stock.refreshMode === 'off' || card.stock.trackingOnly) continue;
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
      void snapshotEquity();
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
        void refreshTrackingQuotes();
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
          checkPendingOrdersForCard(card);
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
      expireStaleOrders();
      await initCalendar(false);
      setupPrimaryDesktopIpc();
      startScheduler();
      // Always do an initial refresh on startup.
      void runRefresh(false);
      void refreshTrackingQuotes();
      if (!isInAutoTradingWindow(isTradingDay())) {
        broadcastLiveSync();
      }
      applyWidgetWindowSettings();
      return;
    }

    setupWidgetDesktopIpc();
    setupWidgetStorageListener();
    // v2.8: don't load cached sync — always request fresh data from dashboard.
    window.aguDesktop?.requestSync();
    applyWidgetWindowSettings();
  }

  function cycleRefreshMode(code: string) {
    const item = config.value.watchlist.find((w) => w.code === code);
    if (!item) {
      return;
    }
    // Overclock is only available when position + key levels are configured.
    const eligible =
      hasPosition(item) && item.keyLevels && item.keyLevels.length > 0;
    const modes: RefreshMode[] = eligible
      ? ['off', 'normal', 'overclock']
      : ['off', 'normal'];
    const current = item.refreshMode || 'normal';
    let nextIdx = modes.indexOf(current) + 1;
    if (nextIdx >= modes.length) {
      nextIdx = 0;
    }
    const next = modes[nextIdx];
    if (next === 'overclock' && getOverclockCount() >= MAX_OVERCLOCK && current !== 'overclock') {
      showToast(t('toast.overclockLimit', { max: MAX_OVERCLOCK }));
      return;
    }
    item.refreshMode = next;
    // Sync card so the UI toggle picks up the change.
    const card = cards.value.find((c) => c.stock.code === code);
    if (card) {
      card.stock.refreshMode = next;
    }
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
    // Sync cards so groupedCards computed picks up the change.
    const card = cards.value.find((c) => c.stock.code === code);
    if (card) {
      card.stock.groupId = groupId;
    }
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

  // --- Portfolio functions (v2.8) ---

  function addPortfolio(name: string, sectorCode?: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 10) return false;
    const portfolios = config.value.portfolios ?? [];
    if (portfolios.some((p) => p.name === trimmed)) return false;
    const maxPfOrder = portfolios.reduce((m, p) => Math.max(m, p.order ?? 0), -1);
    portfolios.push({ id: `pf_${Date.now()}`, name: trimmed, order: maxPfOrder + 1, sectorCode: sectorCode || undefined, createdAt: new Date().toISOString() });
    config.value.portfolios = portfolios;
    persistConfig();
    broadcastLiveSync();
    return true;
  }

  function removePortfolio(id: string): void {
    const portfolios = config.value.portfolios;
    if (!portfolios) return;
    config.value.portfolios = portfolios.filter((p) => p.id !== id);
    config.value.portfolioAssignments = (config.value.portfolioAssignments ?? []).filter(
      (a) => a.portfolioId !== id,
    );
    persistConfig();
    broadcastLiveSync();
  }

  function renamePortfolio(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 10) return false;
    const portfolio = (config.value.portfolios ?? []).find((p) => p.id === id);
    if (!portfolio) return false;
    if ((config.value.portfolios ?? []).some((p) => p.id !== id && p.name === trimmed)) return false;
    portfolio.name = trimmed;
    persistConfig();
    broadcastLiveSync();
    return true;
  }

  function setPortfolioSector(id: string, sectorCode: string): void {
    const p = (config.value.portfolios ?? []).find((x) => x.id === id);
    if (!p) return;
    p.sectorCode = sectorCode || undefined;
    // Force reactivity: replace array reference.
    config.value.portfolios = [...(config.value.portfolios ?? [])];
    persistConfig();
    broadcastLiveSync();
  }

  function upsertAssignment(code: string, portfolioId: string, weight: number): void {
    const assignments = config.value.portfolioAssignments ?? [];
    const idx = assignments.findIndex((a) => a.code === code && a.portfolioId === portfolioId);
    if (idx >= 0) {
      assignments[idx].weight = weight;
    } else {
      assignments.push({ code, portfolioId, weight });
    }
    // Normalize: keep weights within 0-100 range, sum may not equal 100.
    config.value.portfolioAssignments = assignments;
    persistConfig();
    broadcastLiveSync();
  }

  function removeAssignment(code: string, portfolioId: string): void {
    config.value.portfolioAssignments = (config.value.portfolioAssignments ?? []).filter(
      (a) => !(a.code === code && a.portfolioId === portfolioId),
    );
    persistConfig();
    broadcastLiveSync();
  }

  function moveGroupUp(id: string): void {
    const groups = config.value.groups;
    if (!groups || groups.length < 2) return;
    const idx = groups.findIndex((g) => g.id === id);
    if (idx <= 0) return;
    [groups[idx - 1], groups[idx]] = [groups[idx], groups[idx - 1]];
    groups[idx].order = idx;
    groups[idx - 1].order = idx - 1;
    persistConfig();
    broadcastLiveSync();
  }

  function moveGroupDown(id: string): void {
    const groups = config.value.groups;
    if (!groups || groups.length < 2) return;
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0 || idx >= groups.length - 1) return;
    [groups[idx], groups[idx + 1]] = [groups[idx + 1], groups[idx]];
    groups[idx].order = idx;
    groups[idx + 1].order = idx + 1;
    persistConfig();
    broadcastLiveSync();
  }

  function movePortfolioUp(id: string): void {
    const pfs = config.value.portfolios;
    if (!pfs || pfs.length < 2) return;
    const idx = pfs.findIndex((p) => p.id === id);
    if (idx <= 0) return;
    [pfs[idx - 1], pfs[idx]] = [pfs[idx], pfs[idx - 1]];
    pfs[idx].order = idx;
    pfs[idx - 1].order = idx - 1;
    persistConfig();
    broadcastLiveSync();
  }

  function movePortfolioDown(id: string): void {
    const pfs = config.value.portfolios;
    if (!pfs || pfs.length < 2) return;
    const idx = pfs.findIndex((p) => p.id === id);
    if (idx < 0 || idx >= pfs.length - 1) return;
    [pfs[idx], pfs[idx + 1]] = [pfs[idx + 1], pfs[idx]];
    pfs[idx].order = idx;
    pfs[idx + 1].order = idx + 1;
    persistConfig();
    broadcastLiveSync();
  }

  function getTrackingCodes(): string[] {
    const assignments = config.value.portfolioAssignments ?? [];
    return [...new Set(assignments.map((a) => a.code))];
  }

  let refreshingTracking = false;
  const trackingSnapshots = ref<Map<string, { name: string; price: number | null; changePct: number | null }>>(new Map());

	  async function refreshTrackingQuotes(): Promise<void> {
	    if (refreshingTracking) return;
	    const codes = getTrackingCodes();
	    const sectorCodes = (config.value.portfolios ?? []).map((p) => p.sectorCode).filter(Boolean) as string[];
	    const allCodes = [...new Set([...codes, ...sectorCodes])];
	    if (allCodes.length === 0) return;
	    refreshingTracking = true;
	    try {
      const quotes = await fetchQuotesWithFallback(allCodes);
      // Sector ETF codes may not be supported by Tencent — try Sina as fallback.
      const missingSector = sectorCodes.filter((c) => !quotes.get(c));
      if (missingSector.length > 0) {
        try {
          const sina = await fetchSina(missingSector);
          sina.forEach((v, k) => quotes.set(k, v));
        } catch { /* ignore */ }
      }
      const next = new Map(trackingSnapshots.value);
		      for (const card of cards.value) {
		        const snap = quotes.get(card.stock.code);
		        if (snap) {
		          card.snapshot = { ...snap, instrumentType: card.stock.instrumentType };
		          if (card.stock.name !== snap.name) card.stock.name = snap.name;
		          if (snap.price != null) recordPrice(card.stock.code, snap.price);
		          checkPendingOrdersForCard(card);
		        }
		      }
      for (const code of allCodes) {
        const snap = quotes.get(code);
        if (snap) next.set(code, { name: snap.name ?? code, price: snap.price, changePct: snap.changePct });
      }
      trackingSnapshots.value = next;
      cards.value = [...cards.value];
      broadcastLiveSync();
      void snapshotEquity();
    } catch { /* retry next click */ }
    finally { refreshingTracking = false; }
	  }

  /** Compute estimated change% for a portfolio. Uses sector index to compensate unconfigured weight. */
  function computePortfolioChange(portfolioId: string): number | null {
    const assignments = (config.value.portfolioAssignments ?? []).filter(
      (a) => a.portfolioId === portfolioId,
    );
    const portfolio = (config.value.portfolios ?? []).find((p) => p.id === portfolioId);

    let totalWeight = 0;
    let weightedSum = 0;
    for (const a of assignments) {
      const snap = trackingSnapshots.value.get(a.code) ?? cards.value.find((c) => c.stock.code === a.code)?.snapshot;
      if (!snap || snap.changePct == null) continue;
      weightedSum += a.weight * snap.changePct;
      totalWeight += a.weight;
    }

    // No configured securities: return sector change directly if available.
    if (totalWeight === 0) {
      if (portfolio?.sectorCode) {
        const snap = trackingSnapshots.value.get(portfolio.sectorCode);
        console.log('[computeChange] portfolio=%s sector=%s snap=%o result=%s',
          portfolio.name, portfolio.sectorCode, snap,
          snap?.changePct != null ? (snap.changePct).toFixed(2) + '%' : 'null');
        return snap?.changePct != null ? Math.round(snap.changePct * 100) / 100 : null;
      }
      console.log('[computeChange] portfolio=%s no-sector no-assets → null', portfolio?.name);
      return null;
    }

    const direct = Math.round((weightedSum / totalWeight) * 100) / 100;

    // Sector compensation: remaining weight × sector change%.
    if (portfolio?.sectorCode && totalWeight < 100) {
      const sectorSnap = trackingSnapshots.value.get(portfolio.sectorCode);
      if (sectorSnap?.changePct != null) {
        const remainingRatio = (100 - totalWeight) / 100;
        const compensated = direct + sectorSnap.changePct * remainingRatio;
        console.log('[computeChange] portfolio=%s direct=%.2f%% sector=%s(%.2f%%) remain=%.0f%% result=%.2f%%',
          portfolio.name, direct, portfolio.sectorCode, sectorSnap.changePct,
          (100 - totalWeight), compensated);
        return Math.round(compensated * 100) / 100;
      }
    }
    console.log('[computeChange] portfolio=%s direct=%.2f%% (no sector comp)', portfolio?.name, direct);
    return direct;
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
    adoptPlan,
    cancelOrder,
    cancelOrderForPlan,
    pendingOrders,
    trades,
    availableCash,
    realizedTotalPnl,
    // v2.12 performance feedback loop
    equitySnapshots,
    performanceStats,
    snapshotSkipped,
    snapshotEquity,

    runRefreshSymbol: runRefreshSingleCard,
    runRefresh,
    initCalendar,
    bootstrap,
    exportUserBackup,
    updateAlertSettings: (settings: Partial<AlertSettings>) => {
      const current = config.value.alertSettings ?? { enabled: true, priceAlert: true, signalAlert: true, authErrorAlert: true, quoteErrorAlert: true, tradeAlert: true };
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
      // Sync card so StockCard reacts to the lock toggle.
      const card = cards.value.find((c) => c.stock.code === code);
      if (card) {
        card.stock.keyLevelsLocked = item.keyLevelsLocked;
      }
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
        // Sync card so the UI picks up the new key level.
        const card = cards.value.find((c) => c.stock.code === code);
        if (card) {
          card.stock.keyLevels = item.keyLevels;
        }
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
        // Sync card so the UI picks up the removal.
        const card = cards.value.find((c) => c.stock.code === code);
        if (card) {
          card.stock.keyLevels = item.keyLevels;
        }
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
    addPortfolio,
    removePortfolio,
    renamePortfolio,
    setPortfolioSector,
    upsertAssignment,
    removeAssignment,
    getTrackingCodes,
    computePortfolioChange,
    refreshTrackingQuotes,
    trackingSnapshots,
    moveGroupUp,
    moveGroupDown,
    movePortfolioUp,
    movePortfolioDown,
  };
}
