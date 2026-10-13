import type {
  AttributionRow,
  EquitySnapshot,
  PerformanceStats,
  PlanType,
  Trade,
} from '../types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Win rate over ledger sells. Zero-PnL sells stay in the denominator.
 * No sells → null.
 */
export function computeWinRate(trades: Trade[]): number | null {
  const sells = trades.filter((t) => t.side === 'sell' && t.realizedPnl != null);
  if (sells.length === 0) return null;
  const wins = sells.filter((t) => t.realizedPnl! > 0).length;
  return Math.round((wins / sells.length) * 10000) / 100;
}

/**
 * Profit factor over ledger sells: Σwins / |Σlosses|.
 * No losses → null. No wins but losses exist → 0.
 */
export function computeProfitFactor(trades: Trade[]): number | null {
  const sells = trades.filter((t) => t.side === 'sell' && t.realizedPnl != null);
  if (sells.length === 0) return null;
  let wins = 0;
  let losses = 0;
  for (const t of sells) {
    const pnl = t.realizedPnl!;
    if (pnl > 0) wins += pnl;
    else if (pnl < 0) losses += -pnl;
  }
  if (losses === 0) return null;
  if (wins === 0) return 0;
  return Math.round((wins / losses) * 100) / 100;
}

/**
 * Max drawdown over the equity series (peak-to-trough). Negative value;
 * UI shows the absolute. <2 points → null.
 */
export function computeMaxDrawdown(snapshots: EquitySnapshot[]): number | null {
  if (snapshots.length < 2) return null;
  let peak = snapshots[0].totalAssets;
  let maxDd = 0;
  for (const s of snapshots) {
    if (s.totalAssets > peak) peak = s.totalAssets;
    if (peak > 0) {
      const dd = (s.totalAssets - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return Math.round(maxDd * 10000) / 100;
}

/**
 * Composite return over a snapshot window: last/first − 1.
 * Excess return must use the SAME window as the benchmark (Outside Voice #5).
 */
function windowReturn(snapshots: EquitySnapshot[]): number | null {
  if (snapshots.length < 2) return null;
  const first = snapshots[0].totalAssets;
  const last = snapshots[snapshots.length - 1].totalAssets;
  if (first <= 0) return null;
  return Math.round((last / first - 1) * 10000) / 100;
}

/** Snapshots that carry index data, in order. */
function withIndex(snapshots: EquitySnapshot[]): EquitySnapshot[] {
  return snapshots.filter((s) => s.indexClose != null && s.indexClose > 0);
}

/**
 * Benchmark (CSI300) return over the first/last snapshots that carry indexClose.
 * Interior gaps are tolerated.
 */
export function computeBenchmarkReturn(snapshots: EquitySnapshot[]): number | null {
  const idx = withIndex(snapshots);
  if (idx.length < 2) return null;
  const first = idx[0].indexClose!;
  const last = idx[idx.length - 1].indexClose!;
  if (first <= 0) return null;
  return Math.round((last / first - 1) * 10000) / 100;
}

/** Attribution grouped by planType (sells only; missing planType → 'manual'). */
export function computeAttribution(trades: Trade[]): AttributionRow[] {
  const rows = new Map<PlanType | 'manual', AttributionRow>();
  for (const t of trades) {
    if (t.side !== 'sell' || t.realizedPnl == null) continue;
    const key: PlanType | 'manual' = t.planType ?? 'manual';
    const row = rows.get(key) ?? { planType: key, sellCount: 0, winRate: null, totalPnl: 0 };
    row.sellCount += 1;
    row.totalPnl = round2(row.totalPnl + t.realizedPnl);
    rows.set(key, row);
  }
  for (const row of rows.values()) {
    // Recompute win rate per row from the same trades.
    const rowTrades = trades.filter(
      (t) => t.side === 'sell' && t.realizedPnl != null && (t.planType ?? 'manual') === row.planType,
    );
    const wins = rowTrades.filter((t) => t.realizedPnl! > 0).length;
    row.winRate = rowTrades.length > 0 ? Math.round((wins / rowTrades.length) * 10000) / 100 : null;
  }
  return [...rows.values()];
}

/**
 * Full performance computation (v2.12).
 * totalReturn uses the FIRST SNAPSHOT as baseline (D9) — manual position entry
 * near the start is absorbed, so no phantom jump; initialCapital is NOT used here.
 */
export function computePerformance(
  trades: Trade[],
  snapshots: EquitySnapshot[],
  _initialCapital: number | undefined,
): PerformanceStats {
  const realizedPnl = round2(
    trades.filter((t) => t.side === 'sell').reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0),
  );
  const unrealizedPnl = snapshots.length > 0 ? snapshots[snapshots.length - 1].unrealizedPnl : 0;

  const totalReturn = windowReturn(snapshots);
  const benchmarkReturn = computeBenchmarkReturn(snapshots);
  const idx = withIndex(snapshots);
  const sameWindowReturn = idx.length >= 2 ? windowReturn(idx) : null;
  const excessReturn =
    sameWindowReturn != null && benchmarkReturn != null
      ? Math.round((sameWindowReturn - benchmarkReturn) * 100) / 100
      : null;

  return {
    totalReturn,
    realizedPnl,
    unrealizedPnl,
    winRate: computeWinRate(trades),
    maxDrawdown: computeMaxDrawdown(snapshots),
    profitFactor: computeProfitFactor(trades),
    benchmarkReturn,
    excessReturn,
    attribution: computeAttribution(trades),
  };
}
