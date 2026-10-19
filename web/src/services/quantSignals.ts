import type { ActionPlan } from '../types';
import { isDesktopRuntime } from '../utils/appMode';

/**
 * v2.16.0: 量化信号桥（QuantifySTAR50 → AguMaster）。
 *
 * 用户自有量化系统以**确定性规则**产出目标仓位（因子加权评分 → 分档）。
 * 本模块读取其导出契约文件（agu-quant-signal/v1），按证券代码匹配，
 * 在长期档注入「量化信号」并把**量化目标仓位作为硬约束**：
 * 量化优先，AI 不得反向建议（AI 输出不合规时由码生成指令替换）。
 *
 * 设计边界：
 * - 时效：as_of 超过 QUANT_STALE_DAYS 个自然日的信号整条跳过（不以过期规则下硬约束）；
 * - 失败开放：文件缺失/解析失败/非桌面环境 → 不注入、不约束；
 * - 指纹：quantSignatureFor 参与快照指纹，量化数据变化会强制重新诊断。
 */

export interface QuantFactor {
  name: string;
  version?: string;
  value: number | null;
  weight?: number;
  direction?: number;
  contribution?: number | null;
}

export interface QuantBacktest {
  run_id?: string;
  ann_return?: number | null;
  sharpe?: number | null;
  max_dd?: number | null;
  win_rate?: number | null;
  avg_holding_days?: number | null;
  n_trades?: number | null;
}

export interface QuantSignal {
  as_of: string;
  close?: number | null;
  target_weight: number;
  score?: number | null;
  factors?: QuantFactor[];
  score_to_weight?: number[][];
  risk_notes?: string[];
  backtest?: QuantBacktest | null;
}

export interface QuantSignalFile {
  schema?: string;
  source?: string;
  generated_at?: string;
  symbols: Record<string, QuantSignal>;
}

export type QuantDirection = 'buy' | 'sell' | 'hold';

/** as_of 超过该自然日数视为过期——整条跳过，不做硬约束。 */
export const QUANT_STALE_DAYS = 7;
/** 目标仓位与当前占比相差在 ±2 个百分点内视为「维持持有」。 */
export const QUANT_HOLD_TOLERANCE = 0.02;
/**
 * v2.16.1: 约束逻辑版本——参与量化签名。逻辑变更（强硬度调整）后，
 * 已缓存的诊断因签名不匹配而强制重新生成（否则行情未变时会沿用旧文本）。
 */
export const QUANT_LOGIC_VERSION = 'v2';

const SELL_WORDS = ['减仓', '清仓', '减持', '卖出', '离场', '止损', '止盈', '减配', '降仓'];
const BUY_WORDS = ['加仓', '补仓', '买入', '增持', '加配', '加至', '建仓'];

/** 解析并校验导出文件（纯函数）；无任何合法标的返回 null。 */
export function parseQuantSignalFile(raw: string): QuantSignalFile | null {
  try {
    const data = JSON.parse(raw) as QuantSignalFile;
    if (!data || typeof data !== 'object' || !data.symbols || typeof data.symbols !== 'object') {
      return null;
    }
    let valid = false;
    for (const sig of Object.values(data.symbols)) {
      if (!sig || typeof sig !== 'object') {
        continue;
      }
      if (typeof sig.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sig.as_of)) {
        continue;
      }
      if (typeof sig.target_weight !== 'number' || !Number.isFinite(sig.target_weight)) {
        continue;
      }
      valid = true;
    }
    return valid ? data : null;
  } catch {
    return null;
  }
}

/** 'sh588080' / '588080' / 'sz159915' → '588080' / '159915'。 */
export function bareCode(code: string): string {
  const m = code.match(/\d{6}/);
  return m ? m[0] : code.trim().toLowerCase();
}

export function daysBetween(asOf: string, today: Date): number {
  const [y, m, d] = asOf.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - t) / 86_400_000);
}

export function isQuantSignalFresh(
  asOf: string,
  today: Date,
  maxDays = QUANT_STALE_DAYS,
): boolean {
  const diff = daysBetween(asOf, today);
  return diff >= 0 && diff <= maxDays;
}

/** 目标仓位 vs 当前占比 → 必需的持仓动作方向。 */
export function quantRequiredDirection(
  targetWeight: number,
  currentWeight: number,
): QuantDirection {
  // 先舍入到 1e-6，避免浮点误差把恰好 ±2pp 的边界判成超限。
  const delta = Math.round((targetWeight - currentWeight) * 1e6) / 1e6;
  if (delta < -QUANT_HOLD_TOLERANCE) {
    return 'sell';
  }
  if (delta > QUANT_HOLD_TOLERANCE) {
    return 'buy';
  }
  return 'hold';
}

/** AI 文本是否包含与目标方向一致的动作词（hold 不做文本约束）。 */
export function isAdviceDirectionConsistent(text: string, dir: QuantDirection): boolean {
  if (dir === 'hold') {
    return true;
  }
  const words = dir === 'sell' ? SELL_WORDS : BUY_WORDS;
  return words.some((w) => text.includes(w));
}

function fmt(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

function describeRule(score: number | null | undefined, bands?: number[][]): string {
  if (score == null || !bands?.length) {
    return '';
  }
  const sorted = [...bands].sort((a, b) => a[0] - b[0]);
  let matchedThreshold: number | null = null;
  let matchedWeight = 0;
  for (const [threshold, weight] of sorted) {
    if (score >= threshold) {
      matchedThreshold = threshold;
      matchedWeight = weight;
    }
  }
  if (matchedThreshold == null) {
    return `评分 ${fmt(score)} 低于最低档 ${sorted[0][0]} → 0%`;
  }
  return `评分 ${fmt(score)} 落入 ≥${matchedThreshold} 档 → ${(matchedWeight * 100).toFixed(0)}%`;
}

/**
 * 码生成硬约束文本（量化优先的行动句）。
 * v2.16.1: 量化目标为实质差异时，longAction 一律采用本指令——AI 的文本
 * 只保留在 analysis/risk 中解释，行动力度必须与量化目标一致。
 */
export function buildQuantDirective(
  sig: QuantSignal,
  currentWeight: number,
  dir: QuantDirection,
  levels?: { support?: number; resistance?: number },
): string {
  const targetPct = Math.round(sig.target_weight * 1000) / 10;
  const currentPct = Math.round(currentWeight * 1000) / 10;
  const action =
    dir === 'sell'
      ? sig.target_weight <= 0.001
        ? '应清仓离场'
        : '应减仓至目标'
      : dir === 'buy'
        ? '应加仓至目标'
        : '应维持现有仓位';
  const factors = (sig.factors ?? [])
    .filter((f) => typeof f.value === 'number')
    .map((f) => `${f.name} ${fmt(f.value as number)}`)
    .join('、');
  const scoreText = sig.score != null ? `综合评分 ${fmt(sig.score)}` : '';
  const evidence = [factors, scoreText].filter(Boolean).join('，');
  const levelBits: string[] = [];
  if (levels?.support != null) {
    levelBits.push(`支撑 ${levels.support.toFixed(3)}`);
  }
  if (levels?.resistance != null) {
    levelBits.push(`压力 ${levels.resistance.toFixed(3)}`);
  }
  const levelText = levelBits.length > 0 ? `参考关键位 ${levelBits.join('/')}` : '';
  const tail = [evidence ? `因子：${evidence}` : '', levelText].filter(Boolean).join('；');
  return `【量化优先】目标仓位 ${targetPct}%（当前约 ${currentPct}%）：${action}${tail ? `；${tail}` : ''}。`;
}

/** 供长期档 Prompt 注入的量化信号块。 */
export function formatQuantSignalBlock(sig: QuantSignal, currentWeight: number): string {
  const lines: string[] = [`量化信号（QuantifySTAR50，as-of ${sig.as_of}）:`];
  const factors = (sig.factors ?? [])
    .filter((f) => typeof f.value === 'number')
    .map((f) => `${f.name} ${fmt(f.value as number)}`);
  if (factors.length > 0) {
    lines.push(`因子(标准化): ${factors.join(' | ')}`);
  }
  const rule = describeRule(sig.score, sig.score_to_weight);
  const scoreText = sig.score != null ? `复合评分 ${fmt(sig.score)}` : '复合评分';
  lines.push(
    `${scoreText} → 目标仓位 ${(sig.target_weight * 100).toFixed(0)}%${rule ? `（${rule}）` : ''}`,
  );
  lines.push(`当前持仓占比约 ${(currentWeight * 100).toFixed(0)}%`);
  const bt = sig.backtest;
  if (bt && typeof bt.ann_return === 'number') {
    const bits = [`年化 ${(bt.ann_return * 100).toFixed(1)}%`];
    if (typeof bt.sharpe === 'number') bits.push(`夏普 ${bt.sharpe.toFixed(2)}`);
    if (typeof bt.max_dd === 'number') bits.push(`最大回撤 ${(bt.max_dd * 100).toFixed(1)}%`);
    if (typeof bt.win_rate === 'number') bits.push(`胜率 ${(bt.win_rate * 100).toFixed(1)}%`);
    lines.push(`策略回测: ${bits.join(' | ')}`);
  }
  lines.push('硬约束：量化目标优先——longAction 必须与目标方向一致，禁止反向建议。');
  return lines.join('\n');
}

export interface ResolvedQuantAdvice {
  longAction: string;
  longPlan: ActionPlan | null | undefined;
  overridden: boolean;
}

/**
 * 强硬执行：量化目标优先（v2.16.1 收紧）。
 * - 目标与当前相差 ±2pp 内（维持档）→ 保留 AI 文本；
 * - 否则（需减仓/加仓）→ **longAction 一律使用码生成量化指令**，
 *   AI 的文本不再进入行动行（只保留 analysis/risk 解释）——避免模型用
 *   「减仓 1/3」这类不足额/条件化叙事弱化量化目标；
 *   方向不符的 longPlan 丢弃（方向一致则保留，供采纳弹窗预填）。
 */
export function resolveQuantAdvice(
  aiText: string,
  plan: ActionPlan | null | undefined,
  sig: QuantSignal,
  currentWeight: number,
  levels?: { support?: number; resistance?: number },
): ResolvedQuantAdvice {
  const dir = quantRequiredDirection(sig.target_weight, currentWeight);
  if (dir === 'hold') {
    return { longAction: aiText, longPlan: plan, overridden: false };
  }
  const requiredSide = dir === 'sell' ? 'sell' : 'buy';
  const planOk = plan == null || plan.side === requiredSide;
  return {
    longAction: buildQuantDirective(sig, currentWeight, dir, levels),
    longPlan: planOk ? plan : null,
    overridden: true,
  };
}

// --- 模块级缓存（主运行体；诊断时同步读取） ---

let cachedFile: QuantSignalFile | null = null;
let cachedPath: string | null = null;
let cachedAt = 0;

/** 每轮刷新前调用：读取/更新量化导出文件（桌面版；失败保留上次好数据）。 */
export async function ensureQuantSignals(
  filePath: string | undefined,
  maxAgeMs = 30 * 60 * 1000,
): Promise<void> {
  if (!filePath) {
    cachedFile = null;
    cachedPath = null;
    return;
  }
  if (!isDesktopRuntime() || !window.aguDesktop?.readTextFile) {
    return;
  }
  if (cachedFile && cachedPath === filePath && Date.now() - cachedAt < maxAgeMs) {
    return;
  }
  try {
    const raw = await window.aguDesktop.readTextFile(filePath);
    if (!raw) {
      return;
    }
    const parsed = parseQuantSignalFile(raw);
    if (parsed) {
      cachedFile = parsed;
      cachedPath = filePath;
      cachedAt = Date.now();
    }
  } catch {
    /* keep last good cache */
  }
}

/** 按证券代码取最新有效量化信号（过期返回 null）。 */
export function getQuantSignalFor(code: string, today = new Date()): QuantSignal | null {
  if (!cachedFile) {
    return null;
  }
  const key = bareCode(code);
  let sig = cachedFile.symbols[key] ?? null;
  if (!sig) {
    for (const [k, v] of Object.entries(cachedFile.symbols)) {
      if (bareCode(k) === key) {
        sig = v;
        break;
      }
    }
  }
  if (!sig) {
    return null;
  }
  return isQuantSignalFresh(sig.as_of, today) ? sig : null;
}

/**
 * 快照指纹用的量化签名——量化数据变化（或约束逻辑升级）时强制重新诊断。
 * v2.16.1: 追加 QUANT_LOGIC_VERSION，升级后旧缓存自动失效、按新强硬规则重生。
 */
export function quantSignatureFor(code: string): string | null {
  const sig = getQuantSignalFor(code);
  if (!sig) {
    return null;
  }
  return `${sig.as_of}|${sig.target_weight}|${sig.score ?? ''}|${QUANT_LOGIC_VERSION}`;
}
