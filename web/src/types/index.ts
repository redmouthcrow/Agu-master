export const MAX_SECURITIES = 20;
export const MAX_KEY_LEVELS = 4;
export const MAX_OVERCLOCK = 5;

export type InstrumentType = 'stock' | 'fund_etf';
export type Market = 'sh' | 'sz' | 'bj' | 'hk';
export type RefreshFrequency = 5 | 15 | 30 | 60;
export type RefreshMode = 'off' | 'normal' | 'overclock';
export type KeyLevelType = 'support' | 'resistance' | 'custom';
export type KeyLevelSource = 'ai' | 'manual';
export type AlertType = 'price' | 'signal' | 'auth' | 'quote' | 'trade';

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
  /** v2.10: adopted pending order filled / rejected */
  tradeAlert: boolean;
}

export interface AlertPayload {
  type: AlertType;
  code: string;
  name: string;
  signal?: string;
  keyLevel?: KeyLevel;
  currentPrice?: number;
  /** v2.10: filled trade description, e.g. "卖出 1000股 @ 6.650" */
  tradeMsg?: string;
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
  order: number;
  createdAt: string;
  /** v2.9: sector ETF code for remainder compensation */
  sectorCode?: string;
}

/** Maps a security to a portfolio with a weight percentage (0-100). */
export interface PortfolioAssignment {
  code: string;
  portfolioId: string;
  weight: number;
}

export const DEFAULT_GROUP_ID = '__default__';

/** v2.10: structured action plan output by the LLM alongside text advice. */
export interface ActionPlan {
  side: 'sell' | 'buy';
  qty: number;
  triggerPrice: number;
  condition: 'gte' | 'lte';
}

export type PlanType = 'short' | 'band' | 'build';

/** v2.10: pending order created when the user adopts an ActionPlan. */
export interface PendingOrder {
  id: string;
  code: string;
  name: string;
  plan: ActionPlan;
  planType: PlanType;
  /** v2.12: signal captured at adopt time, for attribution. */
  signal?: string;
  createdAt: string;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  filledAt?: string;
}

/** v2.10: trade ledger entry — source of truth for available cash. */
export interface Trade {
  id: string;
  code: string;
  name: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  amount: number;
  realizedPnl?: number;
  source: 'auto' | 'manual';
  /** v2.12: advice type this fill came from (absent for pre-v2.12 fills). */
  planType?: PlanType;
  /** v2.12: signal captured when the plan was adopted. */
  signal?: string;
  /** v2.12: total trading fees for this fill (commission + stamp tax + transfer fee). */
  fee?: number;
  createdAt: string;
}

/** v2.12: daily equity snapshot for the performance feedback loop. */
export interface EquitySnapshot {
  date: string;            // YYYY-MM-DD
  totalAssets: number;     // availableCash + Σ(currentPrice × positionQty)
  realizedPnl: number;     // Σ Trade.realizedPnl (ledger scope, fees deducted)
  unrealizedPnl: number;   // Σ(currentPrice − costPrice) × qty
  cash: number;            // availableCash at snapshot time
  indexClose?: number;     // CSI300 close for benchmark comparison
}

/** v2.12: attribution row grouped by advice type. */
export interface AttributionRow {
  planType: PlanType | 'manual';
  sellCount: number;
  winRate: number | null;
  totalPnl: number;
}

/** v2.12: computed performance metrics (see services/performance.ts). */
export interface PerformanceStats {
  /** D9: (last.totalAssets / first.totalAssets − 1); null when <2 snapshots. */
  totalReturn: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  winRate: number | null;
  maxDrawdown: number | null;  // negative; UI shows absolute value
  profitFactor: number | null; // Σwins/|Σlosses|; no losses→null; no wins with losses→0
  benchmarkReturn: number | null;
  excessReturn: number | null; // same-window portfolio return − benchmark return
  attribution: AttributionRow[];
}

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
  /** v2.9: User-reported realized PnL (元), for when actual trades differ from snapshotted cost basis. */
  actualPnl?: number;
  keyLevels?: KeyLevel[];
  keyLevelsLocked?: boolean;
  groupId?: string;
  refreshMode?: RefreshMode;
  /** v2.8: true = only tracked via portfolio, not shown in diagnosis grid */
  trackingOnly?: boolean;
}

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  refreshFrequency: RefreshFrequency;
  /** Global investment style (v2.7): aggressive | neutral | conservative. */
  investmentStyle?: 'aggressive' | 'neutral' | 'conservative';
  /** v2.9: User-specified total portfolio capital (元). If set, overrides computed total for position weighting. */
  totalCapital?: number;
  /** v2.10: Simulated account principal (元). Required before adopting buy plans. */
  initialCapital?: number;
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
  /** v2.10: structured order corresponding to shortAction (with position only). */
  shortPlan?: ActionPlan | null;
  /** v2.10: structured order corresponding to bandAction (with position only). */
  bandPlan?: ActionPlan | null;
  /** v2.10: structured order corresponding to buildPositionAdvice (no position). */
  buildPlan?: ActionPlan | null;
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
