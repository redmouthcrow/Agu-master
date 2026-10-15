import { describe, expect, it } from 'vitest';
import { buildSnapshotFingerprint } from './snapshotFingerprint';
import type { QuoteSnapshot } from '../types';

const snap: QuoteSnapshot = {
  code: 'sh510500',
  name: '500ETF',
  instrumentType: 'fund_etf',
  price: 6.5,
  changePct: 1.2,
  high: 6.6,
  low: 6.4,
  open: 6.45,
  volume: 100_000,
  amount: 650_000,
  prevClose: 6.42,
  quoteTime: '2026-10-14 15:00:00',
};

describe('buildSnapshotFingerprint', () => {
  it('相同输入 → 相同指纹', () => {
    const a = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'short', 500);
    const b = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'short', 500);
    expect(a).toBe(b);
  });

  it('投资周期不同 → 指纹不同（v2.14.1：切换周期必须重新诊断）', () => {
    const shortKey = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'short');
    const longKey = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'long');
    const swingKey = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'swing');
    expect(shortKey).not.toBe(longKey);
    expect(shortKey).not.toBe(swingKey);
    expect(longKey).not.toBe(swingKey);
  });

  it('horizon 缺省与 short 等价', () => {
    const withDefault = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0);
    const withShort = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'short');
    expect(withDefault).toBe(withShort);
  });

  it('已实现盈亏不同 → 指纹不同（PnL 目标策略输入）', () => {
    const a = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'short', 500);
    const b = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0, 'short', -300);
    expect(a).not.toBe(b);
  });

  it('无持仓时 qty/cost/actualPnl 不参与指纹', () => {
    const a = buildSnapshotFingerprint(snap, '交易中', undefined, undefined, 'short', 500);
    const b = buildSnapshotFingerprint(snap, '交易中', undefined, undefined, 'short', -300);
    expect(a).toBe(b);
  });

  it('行情变化 → 指纹变化', () => {
    const a = buildSnapshotFingerprint(snap, '交易中', 1000, 6.0);
    const b = buildSnapshotFingerprint({ ...snap, price: 6.55 }, '交易中', 1000, 6.0);
    expect(a).not.toBe(b);
  });
});
