import { describe, expect, it } from 'vitest';
import type { EquitySnapshot, Trade } from '../types';
import {
  computeAttribution,
  computeBenchmarkReturn,
  computeMaxDrawdown,
  computePerformance,
  computeProfitFactor,
  computeWinRate,
} from './performance';

function trade(partial: Partial<Trade>): Trade {
  return {
    id: Math.random().toString(36),
    code: 'sh600519',
    name: '测试',
    side: 'sell',
    qty: 100,
    price: 10,
    amount: 1000,
    source: 'auto',
    createdAt: '2026-10-01T10:00:00Z',
    ...partial,
  };
}

function snap(date: string, totalAssets: number, indexClose?: number): EquitySnapshot {
  return { date, totalAssets, realizedPnl: 0, unrealizedPnl: 0, cash: 0, indexClose };
}

describe('computeWinRate', () => {
  it('no sells → null', () => {
    expect(computeWinRate([trade({ side: 'buy', realizedPnl: undefined })])).toBeNull();
  });

  it('mixed wins/losses; zero-PnL stays in the denominator', () => {
    const trades = [
      trade({ realizedPnl: 100 }),
      trade({ realizedPnl: -50 }),
      trade({ realizedPnl: 0 }),
    ];
    // 1 win of 3 sells
    expect(computeWinRate(trades)).toBe(33.33);
  });
});

describe('computeProfitFactor', () => {
  it('no sells → null', () => {
    expect(computeProfitFactor([])).toBeNull();
  });

  it('no losses → null', () => {
    expect(computeProfitFactor([trade({ realizedPnl: 100 })])).toBeNull();
  });

  it('no wins with losses → 0', () => {
    expect(computeProfitFactor([trade({ realizedPnl: -100 })])).toBe(0);
  });

  it('wins / |losses|', () => {
    expect(
      computeProfitFactor([trade({ realizedPnl: 300 }), trade({ realizedPnl: -100 })]),
    ).toBe(3);
  });
});

describe('computeMaxDrawdown', () => {
  it('<2 points → null', () => {
    expect(computeMaxDrawdown([snap('2026-10-01', 100)])).toBeNull();
  });

  it('peak-to-trough as negative percent', () => {
    const s = [snap('2026-10-01', 100), snap('2026-10-02', 120), snap('2026-10-03', 90)];
    // peak 120 → trough 90 = −25%
    expect(computeMaxDrawdown(s)).toBe(-25);
  });
});

describe('computeBenchmarkReturn', () => {
  it('<2 index points → null', () => {
    expect(computeBenchmarkReturn([snap('2026-10-01', 100), snap('2026-10-02', 100)])).toBeNull();
  });

  it('uses first/last snapshots carrying indexClose; interior gaps tolerated', () => {
    const s = [
      snap('2026-10-01', 100, 3800),
      snap('2026-10-02', 100), // gap
      snap('2026-10-03', 100, 4180),
    ];
    // 4180/3800 − 1 = 10%
    expect(computeBenchmarkReturn(s)).toBe(10);
  });
});

describe('computeAttribution', () => {
  it('groups sells by planType; missing planType → manual', () => {
    const trades = [
      trade({ planType: 'short', realizedPnl: 100 }),
      trade({ planType: 'short', realizedPnl: -40 }),
      trade({ realizedPnl: 20 }), // manual
      trade({ planType: 'band', side: 'buy', realizedPnl: undefined }), // buys excluded
    ];
    const rows = computeAttribution(trades);
    const short = rows.find((r) => r.planType === 'short')!;
    const manual = rows.find((r) => r.planType === 'manual')!;
    expect(short.sellCount).toBe(2);
    expect(short.totalPnl).toBe(60);
    expect(short.winRate).toBe(50);
    expect(manual.sellCount).toBe(1);
    expect(rows.find((r) => r.planType === 'band')).toBeUndefined();
  });
});

describe('computePerformance', () => {
  it('totalReturn uses the first snapshot as baseline (D9), not initialCapital', () => {
    const s = [snap('2026-10-01', 100000), snap('2026-10-02', 110000)];
    const perf = computePerformance([], s, 50000);
    expect(perf.totalReturn).toBe(10);
  });

  it('<2 snapshots → totalReturn null', () => {
    expect(computePerformance([], [snap('2026-10-01', 100000)], 100000).totalReturn).toBeNull();
  });

  it('excessReturn uses the same window as the benchmark', () => {
    const s = [
      snap('2026-10-01', 100000),          // no index yet
      snap('2026-10-02', 102000, 3800),
      snap('2026-10-03', 110000, 4180),
    ];
    const perf = computePerformance([], s, undefined);
    // same window: 110000/102000 − 1 = 7.84%; benchmark = 10%
    expect(perf.excessReturn).toBe(-2.16);
  });
});
