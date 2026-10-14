import { describe, expect, it } from 'vitest';
import { normalizeDiagnosisByPosition } from './diagnosisMode';
import type { DiagnosisResult } from '../types';

const base: DiagnosisResult = {
  signal: '持股观望',
  analysis: '缩量回踩测试支撑位',
  risk: '跌破支撑引发踩踏',
  supportLevel: 10.12,
  resistanceLevel: 11.35,
};

const heldDiagnosis: DiagnosisResult = {
  ...base,
  bandAction: '10.12 企稳可加仓2手',
  shortAction: '回踩10.12不破持有500股',
  bandPlan: { side: 'buy', qty: 200, triggerPrice: 10.12, condition: 'lte' },
  shortPlan: null,
};

const emptyDiagnosis: DiagnosisResult = {
  ...base,
  buildPositionAdvice: '10.12 企稳轻仓试多5手',
  buildPlan: { side: 'buy', qty: 500, triggerPrice: 10.12, condition: 'lte' },
};

describe('normalizeDiagnosisByPosition', () => {
  it('withPosition 剥离混入的 buildPositionAdvice / buildPlan', () => {
    const contaminated: DiagnosisResult = {
      ...heldDiagnosis,
      buildPositionAdvice: '可追高建仓3手',
      buildPlan: { side: 'buy', qty: 300, triggerPrice: 11.0, condition: 'lte' },
    };
    const result = normalizeDiagnosisByPosition(contaminated, true);
    expect(result.buildPositionAdvice).toBeUndefined();
    expect(result.buildPlan).toBeUndefined();
    expect(result.bandAction).toBe(heldDiagnosis.bandAction);
    expect(result.shortAction).toBe(heldDiagnosis.shortAction);
    expect(result.bandPlan).toEqual(heldDiagnosis.bandPlan);
  });

  it('withPosition 干净数据原样返回（同一引用）', () => {
    const result = normalizeDiagnosisByPosition(heldDiagnosis, true);
    expect(result).toBe(heldDiagnosis);
  });

  it('withPosition 保留 core 字段', () => {
    const result = normalizeDiagnosisByPosition(
      { ...heldDiagnosis, buildPositionAdvice: 'x' },
      true,
    );
    expect(result.signal).toBe(base.signal);
    expect(result.analysis).toBe(base.analysis);
    expect(result.risk).toBe(base.risk);
    expect(result.supportLevel).toBe(base.supportLevel);
    expect(result.resistanceLevel).toBe(base.resistanceLevel);
  });

  it('空仓模式剥离混入的 bandAction / shortAction / plans', () => {
    const contaminated: DiagnosisResult = {
      ...emptyDiagnosis,
      bandAction: '波段建议混入',
      shortAction: '短期建议混入',
      bandPlan: { side: 'sell', qty: 100, triggerPrice: 11.3, condition: 'gte' },
      shortPlan: { side: 'sell', qty: 100, triggerPrice: 11.3, condition: 'gte' },
    };
    const result = normalizeDiagnosisByPosition(contaminated, false);
    expect(result.bandAction).toBeUndefined();
    expect(result.shortAction).toBeUndefined();
    expect(result.bandPlan).toBeUndefined();
    expect(result.shortPlan).toBeUndefined();
    expect(result.buildPositionAdvice).toBe(emptyDiagnosis.buildPositionAdvice);
    expect(result.buildPlan).toEqual(emptyDiagnosis.buildPlan);
  });

  it('空仓模式干净数据原样返回（同一引用）', () => {
    const result = normalizeDiagnosisByPosition(emptyDiagnosis, false);
    expect(result).toBe(emptyDiagnosis);
  });

  it('剥离不修改原对象', () => {
    const contaminated: DiagnosisResult = {
      ...heldDiagnosis,
      buildPositionAdvice: '混入',
    };
    normalizeDiagnosisByPosition(contaminated, true);
    expect(contaminated.buildPositionAdvice).toBe('混入');
  });

  it('长期档只保留 longAction / longPlan，剥离短期/波段/建仓字段', () => {
    const contaminated: DiagnosisResult = {
      ...base,
      longAction: '中期趋势未破坏，继续持有；跌破10.12减配',
      longPlan: { side: 'sell', qty: 500, triggerPrice: 10.12, condition: 'lte' },
      bandAction: '波段混入',
      shortAction: '短期混入',
      bandPlan: { side: 'buy', qty: 100, triggerPrice: 10.12, condition: 'lte' },
      shortPlan: { side: 'sell', qty: 100, triggerPrice: 11.3, condition: 'gte' },
      buildPositionAdvice: '建仓混入',
      buildPlan: { side: 'buy', qty: 100, triggerPrice: 10.12, condition: 'lte' },
    };
    const result = normalizeDiagnosisByPosition(contaminated, true, 'long');
    expect(result.longAction).toBe(contaminated.longAction);
    expect(result.longPlan).toEqual(contaminated.longPlan);
    expect(result.bandAction).toBeUndefined();
    expect(result.shortAction).toBeUndefined();
    expect(result.bandPlan).toBeUndefined();
    expect(result.shortPlan).toBeUndefined();
    expect(result.buildPositionAdvice).toBeUndefined();
    expect(result.buildPlan).toBeUndefined();
  });

  it('长期档干净数据原样返回（同一引用）', () => {
    const longClean: DiagnosisResult = { ...base, longAction: '继续持有' };
    expect(normalizeDiagnosisByPosition(longClean, true, 'long')).toBe(longClean);
  });

  it('短线/波段档剥离混入的 longAction / longPlan', () => {
    const contaminated: DiagnosisResult = {
      ...heldDiagnosis,
      longAction: '长期混入',
      longPlan: { side: 'sell', qty: 100, triggerPrice: 10.12, condition: 'lte' },
    };
    const result = normalizeDiagnosisByPosition(contaminated, true, 'short');
    expect(result.longAction).toBeUndefined();
    expect(result.longPlan).toBeUndefined();
    expect(result.bandAction).toBe(heldDiagnosis.bandAction);
    const swingResult = normalizeDiagnosisByPosition(contaminated, true, 'swing');
    expect(swingResult.longAction).toBeUndefined();
    expect(swingResult.bandAction).toBe(heldDiagnosis.bandAction);
  });

  it('空仓档剥离混入的 longAction / longPlan', () => {
    const contaminated: DiagnosisResult = {
      ...emptyDiagnosis,
      longAction: '混入',
      longPlan: { side: 'sell', qty: 100, triggerPrice: 11.3, condition: 'gte' },
    };
    const result = normalizeDiagnosisByPosition(contaminated, false);
    expect(result.longAction).toBeUndefined();
    expect(result.longPlan).toBeUndefined();
    expect(result.buildPositionAdvice).toBe(emptyDiagnosis.buildPositionAdvice);
  });
});
