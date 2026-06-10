import type { QuoteSnapshot, SessionLabel } from '../types';

/** Stable key from quote fields; same inputs => same diagnosis should be reused. */
export function buildSnapshotFingerprint(
  snapshot: QuoteSnapshot,
  session: SessionLabel,
  positionQty?: number,
  costPrice?: number,
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
  ];
  if (positionQty != null && costPrice != null) {
    parts.push(positionQty, costPrice);
  }
  return parts
    .map((v) => (v === null || v === undefined ? 'null' : String(v)))
    .join('|');
}
