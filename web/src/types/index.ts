export const MAX_STOCKS = 5;
export const MAX_FUNDS = 5;

export type InstrumentType = 'stock' | 'fund_etf';
export type Market = 'sh' | 'sz' | 'bj';
export type RefreshFrequency = 5 | 15 | 30 | 60;

export interface WidgetWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatchlistItem {
  code: string;
  name: string;
  market: Market;
  instrumentType: InstrumentType;
  positionQty?: number;
  costPrice?: number;
}

/** @deprecated use WatchlistItem */
export type StockItem = WatchlistItem;

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  refreshFrequency: RefreshFrequency;
  watchlist: WatchlistItem[];
  /** Desktop widget: 1–4 codes from watchlist */
  widgetPinnedCodes?: string[];
  /** Desktop widget window opacity 0.70–1.00 */
  widgetOpacity?: number;
  /** Desktop widget always on top */
  widgetAlwaysOnTop?: boolean;
}

export interface QuoteSnapshot {
  code: string;
  name: string;
  instrumentType: InstrumentType;
  price: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  prevClose: number | null;
  quoteTime: string;
}

export interface DiagnosisResult {
  signal: string;
  analysis: string;
  risk: string;
  action?: string;
}

export interface DiagnosisCacheEntry {
  diagnosis: DiagnosisResult;
  fingerprint: string;
  updatedAt: string;
}

export type SessionLabel = '交易中' | '集合竞价' | '非交易时段';

export type SignalTone = 'bearish' | 'bullish' | 'neutral' | 'warning';

export interface StockCardState {
  stock: WatchlistItem;
  snapshot: QuoteSnapshot | null;
  diagnosis: DiagnosisResult | null;
  quoteError: boolean;
  aiError: string | null;
  parseError: boolean;
  rawAiText: string | null;
  loading: boolean;
  updatedAt: string | null;
  /** true when AI skipped because snapshot fingerprint unchanged */
  diagnosisReused: boolean;
}

export interface HolidayDay {
  date: string;
  name: string;
  isOffDay: boolean;
}

export interface TradingCalendarCache {
  year: number;
  fetchedAt: string;
  source: 'holiday-cn' | 'timor';
  days: HolidayDay[];
}

export type CalendarSyncStatus =
  | { state: 'idle' }
  | { state: 'syncing' }
  | { state: 'ok'; year: number }
  | { state: 'failed' };

/** Cross-window sync payload (dashboard → widget) */
export interface LiveSyncPayload {
  ts: number;
  config: Pick<
    AppConfig,
    | 'baseUrl'
    | 'model'
    | 'widgetPinnedCodes'
    | 'widgetOpacity'
    | 'widgetAlwaysOnTop'
    | 'apiKey'
    | 'watchlist'
  >;
  cards: StockCardState[];
}
