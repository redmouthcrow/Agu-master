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
