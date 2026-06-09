import type { QuoteSnapshot, SessionLabel } from '../types';

/** Stable key from quote fields; same inputs => same diagnosis should be reused. */
export function buildSnapshotFingerprint(
  snapshot: QuoteSnapshot,
  session: SessionLabel,
): string {
  return [
    snapshot.code,
    session,
    snapshot.price,
    snapshot.changePct,
    snapshot.high,
    snapshot.low,
    snapshot.volume,
    snapshot.prevClose,
  ]
    .map((v) => (v === null || v === undefined ? 'null' : String(v)))
    .join('|');
}
