import type { DiagnosisResult, PendingOrder, PlanType } from '../types';

/**
 * v2.13.1: 「已挂单」chip 的归属判定。
 * 挂单记录其来源建议文本（PendingOrder.sourceAdvice）；chip 只在
 * 「挂单来源建议 === 当前正在展示的建议」时显示。建议一旦变化，
 * 旧挂单的 chip 让位给新的采纳/不采纳（再次采纳将替换原挂单）。
 */

/** 对应建议行的文本（与卡片渲染一致）。 */
export function adviceForPlan(
  diagnosis: DiagnosisResult | null | undefined,
  planType: PlanType,
): string {
  if (!diagnosis) {
    return '';
  }
  if (planType === 'band') {
    return diagnosis.bandAction ?? '';
  }
  if (planType === 'short') {
    return diagnosis.shortAction ?? '';
  }
  if (planType === 'long') {
    return diagnosis.longAction ?? '';
  }
  return diagnosis.buildPositionAdvice ?? '';
}

/** 找到"由当前建议挂出、且仍在等待触发"的订单；无匹配返回 undefined。 */
export function findCurrentAdviceOrder(
  orders: PendingOrder[] | undefined,
  code: string,
  planType: PlanType,
  advice: string,
): PendingOrder | undefined {
  if (!orders || !advice) {
    return undefined;
  }
  return orders.find(
    (o) =>
      o.code === code &&
      o.planType === planType &&
      o.status === 'pending' &&
      (o.sourceAdvice ?? '') === advice,
  );
}
