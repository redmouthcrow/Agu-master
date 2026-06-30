export const MAX_SECURITIES = 20;
export const MAX_KEY_LEVELS = 4;
export const MAX_OVERCLOCK = 5;

export type InstrumentType = 'stock' | 'fund_etf';
export type Market = 'sh' | 'sz' | 'bj';
export type RefreshFrequency = 5 | 15 | 30 | 60;
export type RefreshMode = 'off' | 'normal' | 'overclock';
export type KeyLevelType = 'support' | 'resistance' | 'custom';
export type KeyLevelSource = 'ai' | 'manual';
export type AlertType = 'price' | 'signal' | 'auth' | 'quote';

export interface KeyLevel {
  price: number;
  label: string;
  type: KeyLevelType;
  source: KeyLevelSource;
  updatedAt?: string;
}

export interface AlertSettings {
  enabled: boolean;
  priceAlert: boolean;
  signalAlert: boolean;
  authErrorAlert: boolean;
  quoteErrorAlert: boolean;
}

export interface AlertPayload {
  type: AlertType;
  code: string;
  name: string;
  signal?: string;
  keyLevel?: KeyLevel;
  currentPrice?: number;
}

export const HIGH_RISK_SIGNALS: ReadonlySet<string> = new Set([
  '止损',
  '逢高减仓',
  '减仓',
  '清仓',
]);

export const KEY_LEVEL_DEVIATION_THRESHOLD = 0.03;

export interface UserGroup {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
}

export interface Portfolio {
  id: string;
  name: string;
  createdAt: string;
}

/** Maps a security to a portfolio with a weight percentage (0-100). */
export interface PortfolioAssignment {
  code: string;
  portfolioId: string;
  weight: number;
}

export const DEFAULT_GROUP_ID = '__default__';

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
  keyLevels?: KeyLevel[];
  keyLevelsLocked?: boolean;
  groupId?: string;
  refreshMode?: RefreshMode;
}

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  refreshFrequency: RefreshFrequency;
  /** Global investment style (v2.7): aggressive | neutral | conservative. */
  investmentStyle?: 'aggressive' | 'neutral' | 'conservative';
  watchlist: WatchlistItem[];
  groups?: UserGroup[];
  /** v2.8 portfolio tracking */
  portfolios?: Portfolio[];
  portfolioAssignments?: PortfolioAssignment[];
  /** Desktop widget: 1–5 codes from watchlist */
  widgetPinnedCodes?: string[];
  /** Desktop widget window opacity 0.70–1.00 */
  widgetOpacity?: number;
  /** Desktop widget always on top */
  widgetAlwaysOnTop?: boolean;
  /** Desktop alert notification settings */
  alertSettings?: AlertSettings;
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
  /** 波段操作建议（v2.5 新增，v2.6 改为仅持仓时必填；须锚定 supportLevel/resistanceLevel）。 */
  bandAction?: string;
  /** 短期持仓操作建议（v2.5，原 action；仅当配置持仓时由 LLM 输出）。 */
  shortAction?: string;
  /** 建仓建议（v2.6 新增；仅当未配置持仓时由 LLM 输出，须锚定 supportLevel/resistanceLevel）。 */
  buildPositionAdvice?: string;
  supportLevel?: number;
  resistanceLevel?: number;
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
    | 'refreshFrequency'
    | 'widgetPinnedCodes'
    | 'widgetOpacity'
    | 'widgetAlwaysOnTop'
    | 'alertSettings'
    | 'groups'
    | 'apiKey'
    | 'watchlist'
  >;
  cards: StockCardState[];
}
