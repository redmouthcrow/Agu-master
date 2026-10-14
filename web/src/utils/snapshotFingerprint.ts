import type { InvestmentHorizon, QuoteSnapshot, SessionLabel } from '../types';

/**
 * Stable key from quote fields; same inputs => same diagnosis should be reused.
 * v2.14.1: the key covers EVERY prompt input that can change the diagnosis —
 * investment horizon (advice contract + history depth) and actualPnl
 * (PnL-targeting). Omitting them meant switching horizon reused the old-mode
 * cached diagnosis while quotes were unchanged (long mode showed no advice).
 */
export function buildSnapshotFingerprint(
  snapshot: QuoteSnapshot,
  session: SessionLabel,
  positionQty?: number,
  costPrice?: number,
  horizon?: InvestmentHorizon,
  actualPnl?: number,
): string {
  const parts: (string | number | null | undefined)[] = [
    snapshot.code,
    session,
    snapshot.price,
    snapshot.changePct,
    snapshot.high,
    snapshot.low,
    snapshot.volume,
    snapshot.prevClose,
    `h:${horizon ?? 'short'}`,
  ];
  if (positionQty != null && costPrice != null) {
    parts.push(positionQty, costPrice, `p:${actualPnl ?? 'null'}`);
  }
  return parts
    .map((v) => (v === null || v === undefined ? 'null' : String(v)))
    .join('|');
}
