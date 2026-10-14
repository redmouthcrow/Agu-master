/**
 * Intraday freeze for multi-day band advice (v2.12.3).
 *
 * `bandAction` is defined as a 3-5 trading-day swing recommendation, but the
 * LLM regenerates it on every refresh, so in-session it drifted with 30-minute
 * inputs. Policy: keep today's first band advice while its anchored key levels
 * are stable; accept a replacement only when the advice is absent/stale (not
 * from today) or the support/resistance levels materially moved.
 */

/** Relative level drift above which a replacement band advice is accepted. */
export const BAND_LEVEL_DRIFT_THRESHOLD = 0.005;

/** Missing or zero denominators count as changed (fail open to fresh advice). */
export function levelMateriallyChanged(
  oldValue: number | undefined,
  newValue: number | undefined,
): boolean {
  if (oldValue == null || newValue == null || oldValue === 0) {
    return true;
  }
  return Math.abs(newValue - oldValue) / Math.abs(oldValue) > BAND_LEVEL_DRIFT_THRESHOLD;
}

export interface BandFreezeInput {
  cachedBand?: string;
  /** Local date key (YYYY-MM-DD) when the cached band advice was accepted. */
  cachedBandDate?: string;
  /** Local date key (YYYY-MM-DD) of the current refresh. */
  today: string;
  cachedSupport?: number;
  cachedResistance?: number;
  newSupport?: number;
  newResistance?: number;
}

/** True when the cached band advice should replace the freshly generated one. */
export function shouldKeepCachedBandAdvice(input: BandFreezeInput): boolean {
  const { cachedBand, cachedBandDate, today } = input;
  if (!cachedBand || !cachedBandDate) {
    return false;
  }
  if (cachedBandDate !== today) {
    return false;
  }
  if (levelMateriallyChanged(input.cachedSupport, input.newSupport)) {
    return false;
  }
  if (levelMateriallyChanged(input.cachedResistance, input.newResistance)) {
    return false;
  }
  return true;
}

export interface LongFreezeInput {
  cachedLong?: string;
  cachedSupport?: number;
  cachedResistance?: number;
  newSupport?: number;
  newResistance?: number;
  /** Current price — used to detect that an anchored level was crossed. */
  price?: number | null;
}

/**
 * Cross-day freeze for long-horizon advice (v2.14.0).
 *
 * 长期策略的目标是"看涨就不管今天的涨跌继续持有"——建议必须跨日稳定，
 * 否则日内噪声每天都会改口。缓存建议只在两种情况下让位给新建议：
 *  1. 锚定的 support/resistance 发生实质变化（>0.5%，与波段冻结同阈值）；
 *  2. 当前价已真实穿越锚定区间（price < support 或 price > resistance）
 *     ——即建议中的离场/重估条件可能已经触发。
 * 与波段冻结不同，不要求同日（这是跨日稳定特性本身）。
 */
export function shouldKeepCachedLongAdvice(input: LongFreezeInput): boolean {
  if (!input.cachedLong) {
    return false;
  }
  if (levelMateriallyChanged(input.cachedSupport, input.newSupport)) {
    return false;
  }
  if (levelMateriallyChanged(input.cachedResistance, input.newResistance)) {
    return false;
  }
  const price = input.price;
  if (price != null && Number.isFinite(price)) {
    const { cachedSupport: s, cachedResistance: r } = input;
    if (s != null && price < s) {
      return false;
    }
    if (r != null && price > r) {
      return false;
    }
  }
  return true;
}
