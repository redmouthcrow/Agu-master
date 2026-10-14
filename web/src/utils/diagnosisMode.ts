import type { DiagnosisResult } from '../types';

/**
 * v2.12.4: 每种持仓模式下只有一族建议字段是合法的。
 * 有持仓时 Prompt = 基础段 + 持仓段，基础段的 Output Format 仍要求
 * buildPositionAdvice/buildPlan，模型会把两段格式合并输出，导致
 * StockCard 的显示优先级被建仓建议抢占（波段/短期建议被遮住）。
 * 这里按模式确定性剥离另一族字段，保证缓存与展示的数据一致。
 */
export function normalizeDiagnosisByPosition(
  data: DiagnosisResult,
  withPosition: boolean,
): DiagnosisResult {
  if (withPosition) {
    if (data.buildPositionAdvice == null && data.buildPlan == null) {
      return data;
    }
    const clean = { ...data };
    delete clean.buildPositionAdvice;
    delete clean.buildPlan;
    return clean;
  }
  if (
    data.bandAction == null &&
    data.shortAction == null &&
    data.bandPlan == null &&
    data.shortPlan == null
  ) {
    return data;
  }
  const clean = { ...data };
  delete clean.bandAction;
  delete clean.shortAction;
  delete clean.bandPlan;
  delete clean.shortPlan;
  return clean;
}
