import type { DiagnosisResult, InvestmentHorizon } from '../types';

/**
 * v2.12.4: 每种持仓模式下只有一族建议字段是合法的。
 * 有持仓时 Prompt = 基础段 + 持仓段，基础段的 Output Format 仍要求
 * buildPositionAdvice/buildPlan，模型会把两段格式合并输出，导致
 * StockCard 的显示优先级被建仓建议抢占（波段/短期建议被遮住）。
 * 这里按模式确定性剥离另一族字段，保证缓存与展示的数据一致。
 *
 * v2.14.0: 增加投资周期维度 —— 长期档只保留 longAction/longPlan；
 * 短线/波段档剥离长期字段（并继续剥离建仓字段）。
 */
export function normalizeDiagnosisByPosition(
  data: DiagnosisResult,
  withPosition: boolean,
  horizon: InvestmentHorizon = 'short',
): DiagnosisResult {
  if (withPosition && horizon === 'long') {
    if (
      data.buildPositionAdvice == null &&
      data.buildPlan == null &&
      data.bandAction == null &&
      data.bandPlan == null &&
      data.shortAction == null &&
      data.shortPlan == null
    ) {
      return data;
    }
    const clean = { ...data };
    delete clean.buildPositionAdvice;
    delete clean.buildPlan;
    delete clean.bandAction;
    delete clean.bandPlan;
    delete clean.shortAction;
    delete clean.shortPlan;
    return clean;
  }
  if (withPosition) {
    if (
      data.buildPositionAdvice == null &&
      data.buildPlan == null &&
      data.longAction == null &&
      data.longPlan == null
    ) {
      return data;
    }
    const clean = { ...data };
    delete clean.buildPositionAdvice;
    delete clean.buildPlan;
    delete clean.longAction;
    delete clean.longPlan;
    return clean;
  }
  if (
    data.bandAction == null &&
    data.shortAction == null &&
    data.bandPlan == null &&
    data.shortPlan == null &&
    data.longAction == null &&
    data.longPlan == null
  ) {
    return data;
  }
  const clean = { ...data };
  delete clean.bandAction;
  delete clean.shortAction;
  delete clean.bandPlan;
  delete clean.shortPlan;
  delete clean.longAction;
  delete clean.longPlan;
  return clean;
}
