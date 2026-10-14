import { describe, expect, it } from 'vitest';
import {
  buildManualPlan,
  computeSellRatioQty,
  inferAdviceCondition,
  inferAdviceSide,
  parseAdvicePrices,
  pickTriggerPrice,
} from './adviceText';

describe('parseAdvicePrices', () => {
  it('提取带小数位的候选价位', () => {
    expect(parseAdvicePrices('反弹1.461减仓锁亏，站稳1.441前不宜重仓抄底')).toEqual([
      1.461, 1.441,
    ]);
  });

  it('存在小数价位时忽略纯整数（7日/500股）', () => {
    expect(parseAdvicePrices('7日破位下行，反弹1.461减仓500股')).toEqual([1.461]);
  });

  it('仅有整数时回退为全部数字', () => {
    expect(parseAdvicePrices('回踩12建仓')).toEqual([12]);
  });

  it('空文本返回空数组', () => {
    expect(parseAdvicePrices('')).toEqual([]);
    expect(parseAdvicePrices(null)).toEqual([]);
    expect(parseAdvicePrices(undefined)).toEqual([]);
  });

  it('重复价位去重', () => {
    expect(parseAdvicePrices('1.44 支撑，跌破1.44止损')).toEqual([1.44]);
  });
});

describe('pickTriggerPrice', () => {
  it('选择最接近现价的候选', () => {
    expect(pickTriggerPrice('反弹1.461减仓，站稳1.441前不宜抄底', 1.45)).toBe(1.441);
  });

  it('剔除超出 [0.5x, 2x] 合理区间的候选', () => {
    expect(pickTriggerPrice('7日破位下行', 1.45)).toBeNull();
  });

  it('无现价参考时取首个候选', () => {
    expect(pickTriggerPrice('反弹1.461减仓锁亏', null)).toBe(1.461);
  });

  it('无候选时返回 null', () => {
    expect(pickTriggerPrice('不宜重仓抄底', 1.45)).toBeNull();
  });

  it('prefer=above：卖出向上触发优先取现价上方价位', () => {
    expect(
      pickTriggerPrice('反弹1.461减仓锁亏，站稳1.441前不宜重仓抄底', 1.45, 'above'),
    ).toBe(1.461);
  });

  it('prefer=below：买入向下触发优先取现价下方价位', () => {
    expect(
      pickTriggerPrice('反弹1.461减仓锁亏，站稳1.441前不宜重仓抄底', 1.45, 'below'),
    ).toBe(1.441);
  });

  it('同侧无候选时退回全体最近者', () => {
    expect(pickTriggerPrice('反弹1.461减仓', 1.3, 'below')).toBe(1.461);
  });
});

describe('inferAdviceSide', () => {
  it('减仓类关键词 → sell', () => {
    expect(inferAdviceSide('band', '反弹1.461减仓锁亏')).toBe('sell');
  });

  it('加仓类关键词 → buy', () => {
    expect(inferAdviceSide('band', '回踩支撑加仓2手')).toBe('buy');
  });

  it('关键词计数择多', () => {
    expect(inferAdviceSide('band', '减仓止盈，不宜加仓')).toBe('sell');
  });

  it('无关键词时按类型默认：build → buy', () => {
    expect(inferAdviceSide('build', '站稳1.44前不宜重仓')).toBe('buy');
  });

  it('无关键词时按类型默认：short/band → sell', () => {
    expect(inferAdviceSide('short', '关注关键位得失')).toBe('sell');
    expect(inferAdviceSide('band', '关注关键位得失')).toBe('sell');
  });
});

describe('inferAdviceCondition', () => {
  it('跌破类关键词 → lte（即使方向为卖出）', () => {
    expect(inferAdviceCondition('跌破1.44止损', 'sell')).toBe('lte');
  });

  it('默认配对：sell → gte', () => {
    expect(inferAdviceCondition('反弹1.461减仓', 'sell')).toBe('gte');
  });

  it('默认配对：buy → lte', () => {
    expect(inferAdviceCondition('回踩1.44建仓', 'buy')).toBe('lte');
  });
});

describe('buildManualPlan', () => {
  it('构造合法计划并保留 3 位小数', () => {
    const r = buildManualPlan({
      side: 'sell',
      condition: 'gte',
      triggerPrice: 1.46051,
      qty: 800,
    });
    expect(r).toEqual({
      plan: { side: 'sell', qty: 800, triggerPrice: 1.461, condition: 'gte' },
    });
  });

  it('触发价无效（0/NaN/缺失）→ price_invalid', () => {
    expect(buildManualPlan({ side: 'sell', condition: 'gte', triggerPrice: 0, qty: 100 })).toEqual(
      { error: 'price_invalid' },
    );
    expect(
      buildManualPlan({ side: 'sell', condition: 'gte', triggerPrice: NaN, qty: 100 }),
    ).toEqual({ error: 'price_invalid' });
    expect(buildManualPlan({ side: 'sell', condition: 'gte', qty: 100 })).toEqual({
      error: 'price_invalid',
    });
  });

  it('数量非正整数 → qty_invalid', () => {
    expect(
      buildManualPlan({ side: 'buy', condition: 'lte', triggerPrice: 1.44, qty: 0 }),
    ).toEqual({ error: 'qty_invalid' });
    expect(
      buildManualPlan({ side: 'buy', condition: 'lte', triggerPrice: 1.44, qty: 1.5 }),
    ).toEqual({ error: 'qty_invalid' });
    expect(buildManualPlan({ side: 'buy', condition: 'lte', triggerPrice: 1.44 })).toEqual({
      error: 'qty_invalid',
    });
  });

  it('支持买入方向 + 向下触及组合（破位买入场景）', () => {
    const r = buildManualPlan({ side: 'buy', condition: 'lte', triggerPrice: 1.44, qty: 500 });
    expect(r).toEqual({
      plan: { side: 'buy', qty: 500, triggerPrice: 1.44, condition: 'lte' },
    });
  });
});

describe('computeSellRatioQty', () => {
  it('1/3 向下取整到 100 的整数倍', () => {
    expect(computeSellRatioQty(3000, 1 / 3)).toBe(1000);
    expect(computeSellRatioQty(3100, 1 / 3)).toBe(1000);
  });

  it('1/2 向下取整到 100 的整数倍', () => {
    expect(computeSellRatioQty(2500, 1 / 2)).toBe(1200);
    expect(computeSellRatioQty(2800, 1 / 2)).toBe(1400);
  });

  it('比例结果不足 100 时给足 100', () => {
    expect(computeSellRatioQty(250, 1 / 3)).toBe(100);
    expect(computeSellRatioQty(250, 1 / 2)).toBe(100);
  });

  it('持仓不足 100 时按全部持仓', () => {
    expect(computeSellRatioQty(60, 1 / 2)).toBe(60);
  });

  it('ratio ≥ 1（全部）返回完整持仓（允许零股清仓）', () => {
    expect(computeSellRatioQty(2350, 1)).toBe(2350);
    expect(computeSellRatioQty(150, 1)).toBe(150);
  });

  it('持仓无效返回 0', () => {
    expect(computeSellRatioQty(0, 1 / 2)).toBe(0);
    expect(computeSellRatioQty(NaN, 1 / 2)).toBe(0);
    expect(computeSellRatioQty(-100, 1 / 2)).toBe(0);
  });
});
