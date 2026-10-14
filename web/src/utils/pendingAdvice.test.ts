import { describe, expect, it } from 'vitest';
import { adviceForPlan, findCurrentAdviceOrder } from './pendingAdvice';
import type { DiagnosisResult, PendingOrder } from '../types';

const diagnosis: DiagnosisResult = {
  signal: '逢高减仓',
  analysis: '缩量回踩测试支撑位',
  risk: '跌破支撑引发踩踏',
  bandAction: '反弹1.461减仓锁亏',
  shortAction: '减半仓卖出400股',
  supportLevel: 1.441,
  resistanceLevel: 1.461,
};

function order(overrides: Partial<PendingOrder>): PendingOrder {
  return {
    id: 'po_1',
    code: 'sh510500',
    name: '500ETF',
    plan: { side: 'sell', qty: 800, triggerPrice: 1.461, condition: 'gte' },
    planType: 'band',
    createdAt: '2026-10-14T02:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

describe('adviceForPlan', () => {
  it('按建议类型返回对应文本', () => {
    expect(adviceForPlan(diagnosis, 'band')).toBe('反弹1.461减仓锁亏');
    expect(adviceForPlan(diagnosis, 'short')).toBe('减半仓卖出400股');
  });

  it('build 类型返回建仓建议', () => {
    const d: DiagnosisResult = { ...diagnosis, buildPositionAdvice: '轻仓试多5手' };
    expect(adviceForPlan(d, 'build')).toBe('轻仓试多5手');
  });

  it('long 类型返回长期策略（v2.14.0）', () => {
    const d: DiagnosisResult = { ...diagnosis, longAction: '中期趋势未破坏，继续持有' };
    expect(adviceForPlan(d, 'long')).toBe('中期趋势未破坏，继续持有');
  });

  it('诊断为空或字段缺失返回空串', () => {
    expect(adviceForPlan(null, 'band')).toBe('');
    expect(adviceForPlan({ signal: 'x', analysis: 'y', risk: 'z' }, 'band')).toBe('');
  });
});

describe('findCurrentAdviceOrder', () => {
  it('匹配 code + planType + pending + 来源建议一致', () => {
    const o = order({ sourceAdvice: '反弹1.461减仓锁亏' });
    const found = findCurrentAdviceOrder([o], 'sh510500', 'band', '反弹1.461减仓锁亏');
    expect(found).toBe(o);
  });

  it('建议变化后不再匹配（让位给新的采纳入口）', () => {
    const o = order({ sourceAdvice: '反弹1.461减仓锁亏' });
    expect(
      findCurrentAdviceOrder([o], 'sh510500', 'band', '反弹1.44减仓锁亏'),
    ).toBeUndefined();
  });

  it('已成交/已撤销的订单不匹配', () => {
    const filled = order({ sourceAdvice: '反弹1.461减仓锁亏', status: 'filled' });
    const cancelled = order({ sourceAdvice: '反弹1.461减仓锁亏', status: 'cancelled' });
    expect(
      findCurrentAdviceOrder([filled, cancelled], 'sh510500', 'band', '反弹1.461减仓锁亏'),
    ).toBeUndefined();
  });

  it('无来源建议的旧订单（v2.13.0 之前）不匹配，会重新给出采纳入口', () => {
    const legacy = order({});
    expect(
      findCurrentAdviceOrder([legacy], 'sh510500', 'band', '反弹1.461减仓锁亏'),
    ).toBeUndefined();
  });

  it('planType / code 不匹配时忽略', () => {
    const o = order({ sourceAdvice: '反弹1.461减仓锁亏' });
    expect(
      findCurrentAdviceOrder([o], 'sh510500', 'short', '反弹1.461减仓锁亏'),
    ).toBeUndefined();
    expect(
      findCurrentAdviceOrder([o], 'sz159915', 'band', '反弹1.461减仓锁亏'),
    ).toBeUndefined();
  });

  it('空订单列表或空建议文本返回 undefined', () => {
    expect(findCurrentAdviceOrder([], 'sh510500', 'band', 'x')).toBeUndefined();
    expect(findCurrentAdviceOrder(undefined, 'sh510500', 'band', 'x')).toBeUndefined();
    expect(findCurrentAdviceOrder([order({})], 'sh510500', 'band', '')).toBeUndefined();
  });
});
