import type { ActionPlan, PlanType } from '../types';

/**
 * v2.13.0: 半自动采纳 — AI 只给价位与方向，数量由用户在采纳弹窗中填写。
 * 本模块从建议文本中解析/推断弹窗的预填值，并提供手动计划校验。
 * 纯函数、无 i18n 依赖（错误以代码返回，由弹窗映射文案），便于单测。
 */

export type AdviceSide = 'buy' | 'sell';
export type AdviceCondition = 'gte' | 'lte';

const BUY_WORDS = ['加仓', '补仓', '买入', '建仓', '试多', '低吸', '分批买'];
const SELL_WORDS = ['减仓', '止盈', '止损', '清仓', '卖出', '减持', '锁盈', '锁亏', '离场'];
const BREAK_WORDS = ['跌破', '破位', '失守', '下破', '跌穿'];

/** 提取文本中的候选价位：优先带小数的数字（避开「7日」「500股」），无小数时回退全部正整数。 */
export function parseAdvicePrices(text?: string | null): number[] {
  if (!text) {
    return [];
  }
  const matches = text.match(/\d+(?:\.\d{1,3})?/g) ?? [];
  const nums = matches
    .map((m) => Number(m))
    .filter((n) => Number.isFinite(n) && n > 0);
  const withDecimals = nums.filter((n) => String(n).includes('.'));
  const pool = withDecimals.length > 0 ? withDecimals : nums;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of pool) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** 预填触发价时对操作位的取向偏好：向上触发取现价上方，向下触发取下方。 */
export type PricePreference = 'above' | 'below';

/**
 * 预填触发价：取候选价位中距现价最近者；超出 [0.5x, 2x] 合理区间的候选被剔除
 * （防止把「7日」「500股」这类数字当成价位）。prefer 指定时优先取现价对应侧的候选
 * （卖出向上触发→上方，买入向下触发→下方），同侧无候选再退回全体最近者。
 * 无现价参考时取首个候选。
 */
export function pickTriggerPrice(
  text: string | null | undefined,
  refPrice?: number | null,
  prefer?: PricePreference,
): number | null {
  const prices = parseAdvicePrices(text);
  if (prices.length === 0) {
    return null;
  }
  if (refPrice == null || !Number.isFinite(refPrice) || refPrice <= 0) {
    return prices[0];
  }
  const inBand = prices.filter((p) => p >= refPrice * 0.5 && p <= refPrice * 2);
  if (inBand.length === 0) {
    return null;
  }
  let candidates = inBand;
  if (prefer === 'above') {
    const above = inBand.filter((p) => p >= refPrice);
    if (above.length > 0) {
      candidates = above;
    }
  } else if (prefer === 'below') {
    const below = inBand.filter((p) => p <= refPrice);
    if (below.length > 0) {
      candidates = below;
    }
  }
  let best = candidates[0];
  let bestDist = Math.abs(best - refPrice);
  for (const p of candidates.slice(1)) {
    const d = Math.abs(p - refPrice);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** 方向推断：买卖关键词计数择多；平票时按建议类型默认（建仓→买入，其余→卖出）。 */
export function inferAdviceSide(planType: PlanType, text?: string | null): AdviceSide {
  const s = text ?? '';
  let buy = 0;
  let sell = 0;
  for (const w of BUY_WORDS) {
    if (s.includes(w)) {
      buy++;
    }
  }
  for (const w of SELL_WORDS) {
    if (s.includes(w)) {
      sell++;
    }
  }
  if (buy > sell) {
    return 'buy';
  }
  if (sell > buy) {
    return 'sell';
  }
  return planType === 'build' ? 'buy' : 'sell';
}

/** 触发方式推断：含跌破类关键词→向下触及（lte）；否则按方向默认配对（卖→gte，买→lte）。 */
export function inferAdviceCondition(
  text: string | null | undefined,
  side: AdviceSide,
): AdviceCondition {
  const s = text ?? '';
  for (const w of BREAK_WORDS) {
    if (s.includes(w)) {
      return 'lte';
    }
  }
  return side === 'sell' ? 'gte' : 'lte';
}

export type ManualPlanInput = {
  side: AdviceSide;
  condition: AdviceCondition;
  triggerPrice?: number;
  qty?: number;
};

export type ManualPlanResult =
  | { plan: ActionPlan }
  | { error: 'price_invalid' | 'qty_invalid' };

/** 校验并构造手动计划；触发价保留 3 位小数（与 A 股/ETF 报价一致）。 */
export function buildManualPlan(input: ManualPlanInput): ManualPlanResult {
  const { triggerPrice, qty } = input;
  if (triggerPrice == null || !Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    return { error: 'price_invalid' };
  }
  if (qty == null || !Number.isInteger(qty) || qty <= 0 || qty > 999_999_999) {
    return { error: 'qty_invalid' };
  }
  return {
    plan: {
      side: input.side,
      qty,
      triggerPrice: Math.round(triggerPrice * 1000) / 1000,
      condition: input.condition,
    },
  };
}
