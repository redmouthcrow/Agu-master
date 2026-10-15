import { describe, expect, it } from 'vitest';
import { formatExternalContext, parseExternalQuote, type ExternalContext } from './externalMarkets';

/** 构造 40 字段的腾讯响应行。 */
function raw(fields: Partial<Record<number, string>>): string {
  const arr = new Array(40).fill('0');
  Object.entries(fields).forEach(([i, v]) => {
    arr[Number(i)] = v as string;
  });
  return arr.join('~');
}

describe('parseExternalQuote', () => {
  it('优先取 [32] 涨跌幅', () => {
    const q = parseExternalQuote('usDJI', raw({ 1: '道琼斯', 3: '51621.48', 4: '51670.10', 32: '-0.09' }));
    expect(q).toEqual({ code: 'usDJI', changePct: -0.09 });
  });

  it('[32] 缺失时用现价/昨收推算', () => {
    const q = parseExternalQuote('usIXIC', raw({ 3: '26692.87', 4: '27204.38', 32: '' }));
    expect(q).not.toBeNull();
    expect(q!.changePct).toBeCloseTo(-1.88, 1);
  });

  it('韩股/港股布局同样可用', () => {
    const kr = parseExternalQuote('kr005930', raw({ 1: 'Samsung', 3: '213000', 4: '232000', 32: '-8.18966' }));
    expect(kr).toEqual({ code: 'kr005930', changePct: -8.19 });
  });

  it('无匹配（pv_none_match）/字段不足/价格无效 → null', () => {
    expect(parseExternalQuote('krKOSPI', 'v_pv_none_match="1";')).toBeNull();
    expect(parseExternalQuote('usDJI', 'short~row')).toBeNull();
    expect(parseExternalQuote('usDJI', raw({ 3: '0', 4: '0', 32: '' }))).toBeNull();
    expect(parseExternalQuote('usDJI', undefined)).toBeNull();
  });
});

describe('formatExternalContext', () => {
  const ctx: ExternalContext = {
    fetchedAt: '10:32:00',
    quotes: [
      { code: 'usDJI', changePct: -0.09 },
      { code: 'usIXIC', changePct: -1.88 },
      { code: 'usINX', changePct: -1.11 },
      { code: 'usHXC', changePct: -1.39 },
      { code: 'usSOXX', changePct: -4.5 },
      { code: 'usNVDA', changePct: -3.16 },
      { code: 'hkHSI', changePct: -1.12 },
      { code: 'kr005930', changePct: -8.19 },
    ],
  };

  it('按分组输出、带正负号与获取时间；缺项自动跳过', () => {
    const text = formatExternalContext(ctx);
    expect(text).not.toBeNull();
    expect(text).toContain('盘外参照（获取于 10:32:00）:');
    expect(text).toContain('美股大盘(最近收盘): 道琼斯 -0.09% | 纳斯达克 -1.88% | 标普500 -1.11% | 中概金龙指数 -1.39%');
    expect(text).toContain('费半ETF -4.50%');
    expect(text).toContain('亚太实时: 恒生指数 -1.12%');
    // 三星在列、SK海力士缺项被跳过
    expect(text).toContain('三星电子 -8.19%');
    expect(text).not.toContain('SK海力士');
    // 台积电/美光/苹果/特斯拉 缺项 → 不出现
    expect(text).not.toContain('台积电');
  });

  it('正向涨跌带 + 号', () => {
    const text = formatExternalContext({
      fetchedAt: '10:00:00',
      quotes: [{ code: 'usAAPL', changePct: 0.5 }],
    });
    expect(text).toContain('苹果 +0.50%');
  });

  it('空数据 / 全缺项 → null', () => {
    expect(formatExternalContext(null)).toBeNull();
    expect(formatExternalContext(undefined)).toBeNull();
    expect(formatExternalContext({ fetchedAt: '10:00:00', quotes: [] })).toBeNull();
    expect(
      formatExternalContext({ fetchedAt: '10:00:00', quotes: [{ code: 'zzz', changePct: 1 }] }),
    ).toBeNull();
  });
});
