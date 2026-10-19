import { describe, expect, it } from 'vitest';
import {
  bareCode,
  buildQuantDirective,
  daysBetween,
  formatQuantSignalBlock,
  isAdviceDirectionConsistent,
  isQuantSignalFresh,
  parseQuantSignalFile,
  quantRequiredDirection,
  resolveQuantAdvice,
  type QuantSignal,
} from './quantSignals';

const signal: QuantSignal = {
  as_of: '2026-10-16',
  close: 1.39,
  target_weight: 0,
  score: -0.9244,
  factors: [
    { name: 'momentum', version: 'v1', value: -0.6749, weight: 0.6, direction: 1, contribution: -0.4049 },
    { name: 'trend', version: 'v1', value: -1.2987, weight: 0.4, direction: 1, contribution: -0.5195 },
  ],
  score_to_weight: [
    [-0.5, 0],
    [0, 0.5],
    [0.5, 0.9],
  ],
  risk_notes: [],
  backtest: { run_id: 'run-1', ann_return: 0.077, sharpe: 0.37, max_dd: -0.33, win_rate: 0.7 },
};

const rawFile = JSON.stringify({
  schema: 'agu-quant-signal/v1',
  source: 'QuantifySTAR50',
  generated_at: '2026-10-19T09:34:16+08:00',
  symbols: { '588080': signal },
});

describe('parseQuantSignalFile', () => {
  it('解析合法契约文件', () => {
    const parsed = parseQuantSignalFile(rawFile);
    expect(parsed).not.toBeNull();
    expect(parsed!.symbols['588080'].target_weight).toBe(0);
  });

  it('非法 JSON / 缺 symbols → null', () => {
    expect(parseQuantSignalFile('not json')).toBeNull();
    expect(parseQuantSignalFile('{"schema":"x"}')).toBeNull();
    expect(parseQuantSignalFile('{"symbols":{}}')).toBeNull();
  });

  it('条目缺 as_of 或 target_weight → 视为无有效数据', () => {
    expect(
      parseQuantSignalFile('{"symbols":{"588080":{"target_weight":0}}}'),
    ).toBeNull();
    expect(
      parseQuantSignalFile('{"symbols":{"588080":{"as_of":"2026-10-16"}}}'),
    ).toBeNull();
    expect(
      parseQuantSignalFile('{"symbols":{"588080":{"as_of":"bad","target_weight":0}}}'),
    ).toBeNull();
  });
});

describe('bareCode', () => {
  it('归一化带交易所前缀的代码', () => {
    expect(bareCode('sh588080')).toBe('588080');
    expect(bareCode('588080')).toBe('588080');
    expect(bareCode('sz159915')).toBe('159915');
  });
});

describe('时效', () => {
  const today = new Date('2026-10-19T10:00:00');

  it('daysBetween 按自然日计算', () => {
    expect(daysBetween('2026-10-16', today)).toBe(3);
    expect(daysBetween('2026-10-19', today)).toBe(0);
  });

  it('7 天内新鲜、超过 7 天过期、未来日期视为过期', () => {
    expect(isQuantSignalFresh('2026-10-16', today)).toBe(true);
    expect(isQuantSignalFresh('2026-10-12', today)).toBe(true);
    expect(isQuantSignalFresh('2026-10-11', today)).toBe(false);
    expect(isQuantSignalFresh('2026-10-20', today)).toBe(false);
  });
});

describe('方向判定', () => {
  it('目标低于当前 → sell；高于 → buy；接近 → hold', () => {
    expect(quantRequiredDirection(0, 0.6)).toBe('sell');
    expect(quantRequiredDirection(0.9, 0.4)).toBe('buy');
    expect(quantRequiredDirection(0.5, 0.51)).toBe('hold');
    expect(quantRequiredDirection(0.5, 0.48)).toBe('hold'); // 边界 -2pp 仍算维持
    expect(quantRequiredDirection(0.5, 0.47)).toBe('buy');
  });

  it('文本动作词一致性', () => {
    expect(isAdviceDirectionConsistent('反弹至1.400附近减仓，跌破1.361清仓', 'sell')).toBe(true);
    expect(isAdviceDirectionConsistent('中期趋势未破坏，继续持有', 'sell')).toBe(false);
    expect(isAdviceDirectionConsistent('回踩支撑加仓至目标', 'buy')).toBe(true);
    expect(isAdviceDirectionConsistent('观望', 'hold')).toBe(true);
  });
});

describe('buildQuantDirective', () => {
  it('目标 0% → 明确清仓离场', () => {
    const text = buildQuantDirective(signal, 0.6, 'sell');
    expect(text).toContain('【量化优先】');
    expect(text).toContain('目标仓位 0%');
    expect(text).toContain('当前约 60%');
    expect(text).toContain('应清仓离场');
    expect(text).toContain('momentum');
    expect(text).toContain('综合评分');
  });

  it('目标 50% 且当前 70% → 减仓至目标', () => {
    const text = buildQuantDirective({ ...signal, target_weight: 0.5 }, 0.7, 'sell');
    expect(text).toContain('应减仓至目标');
  });

  it('买入方向 → 加仓至目标', () => {
    const text = buildQuantDirective({ ...signal, target_weight: 0.9 }, 0.4, 'buy');
    expect(text).toContain('应加仓至目标');
  });
});

describe('resolveQuantAdvice（量化优先硬约束）', () => {
  const basePlan = {
    side: 'sell' as const,
    qty: 14000,
    triggerPrice: 1.4,
    condition: 'gte' as const,
  };

  it('AI 方向与量化一致 → 原样保留', () => {
    const r = resolveQuantAdvice('反弹至1.400附近减仓1/3，跌破1.361清仓', basePlan, signal, 0.6);
    expect(r.overridden).toBe(false);
    expect(r.longAction).toContain('减仓');
    expect(r.longPlan).toEqual(basePlan);
  });

  it('AI 反向建议（继续持有）→ 替换为码生成指令', () => {
    const r = resolveQuantAdvice('中期趋势未破坏，继续持有，跌破1.361再评估', basePlan, signal, 0.6);
    expect(r.overridden).toBe(true);
    expect(r.longAction).toContain('【量化优先】');
    expect(r.longAction).toContain('应清仓离场');
    expect(r.longAction).not.toContain('继续持有');
  });

  it('文本一致但计划方向相反 → 丢弃计划（文本保留）', () => {
    const buyPlan = { side: 'buy' as const, qty: 1000, triggerPrice: 1.36, condition: 'lte' as const };
    const r = resolveQuantAdvice('跌破1.361清仓', buyPlan, signal, 0.6);
    expect(r.overridden).toBe(true);
    expect(r.longPlan).toBeNull();
    expect(r.longAction).toContain('【量化优先】');
  });

  it('维持档（目标≈当前）→ 不做方向约束', () => {
    const holdSignal: QuantSignal = { ...signal, target_weight: 0.6 };
    const r = resolveQuantAdvice('趋势未破坏，继续持有', null, holdSignal, 0.6);
    expect(r.overridden).toBe(false);
    expect(r.longAction).toBe('趋势未破坏，继续持有');
  });
});

describe('formatQuantSignalBlock', () => {
  it('包含因子、评分、目标仓位、当前占比、回测与硬约束', () => {
    const text = formatQuantSignalBlock(signal, 0.6);
    expect(text).toContain('量化信号（QuantifySTAR50，as-of 2026-10-16）');
    expect(text).toContain('momentum -0.67');
    expect(text).toContain('trend -1.30');
    expect(text).toContain('目标仓位 0%');
    expect(text).toContain('当前持仓占比约 60%');
    expect(text).toContain('年化 7.7%');
    expect(text).toContain('硬约束');
  });
});
