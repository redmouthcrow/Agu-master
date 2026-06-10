import type { WatchlistItem } from '../types';

export const COST_PRICE_DECIMALS = 4;
export const COST_PRICE_MIN = 0.0001;
export const COST_PRICE_MAX = 999_999.9999;

export function roundCostPrice(n: number): number {
  const factor = 10 ** COST_PRICE_DECIMALS;
  return Math.round(n * factor) / factor;
}

export function hasPosition(item: WatchlistItem): boolean {
  return item.positionQty != null && item.costPrice != null;
}

export function calcPnlPct(
  price: number | null | undefined,
  costPrice: number,
): number | null {
  if (price === null || price === undefined || costPrice <= 0) {
    return null;
  }
  return Math.round(((price - costPrice) / costPrice) * 10000) / 100;
}

export function validatePositionPair(
  positionQty?: number,
  costPrice?: number,
): string | null {
  const hasQty = positionQty != null && !Number.isNaN(positionQty);
  const hasCost = costPrice != null && !Number.isNaN(costPrice);

  if (!hasQty && !hasCost) {
    return null;
  }
  if (!hasQty || !hasCost) {
    return '请同时填写持仓数量与成本价，或留空';
  }
  if (!Number.isInteger(positionQty) || positionQty <= 0 || positionQty > 999_999_999) {
    return '持仓数量须为正整数';
  }
  if (costPrice! < COST_PRICE_MIN || costPrice! > COST_PRICE_MAX) {
    return `成本价须在 ${COST_PRICE_MIN}–${COST_PRICE_MAX} 之间`;
  }
  if (roundCostPrice(costPrice!) !== costPrice!) {
    return '成本价最多保留4位小数';
  }
  return null;
}

function validateCostPriceString(costStr: string): string | null {
  if (!/^\d+(\.\d{1,4})?$/.test(costStr)) {
    return '成本价格式无效，最多保留4位小数';
  }
  const n = Number(costStr);
  if (!Number.isFinite(n) || n < COST_PRICE_MIN || n > COST_PRICE_MAX) {
    return `成本价须在 ${COST_PRICE_MIN}–${COST_PRICE_MAX} 之间`;
  }
  return null;
}

function inputToString(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : '';
  }
  return String(raw).trim();
}

export function parseOptionalNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  const trimmed = inputToString(raw);
  if (!trimmed) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function parsePositionInputs(
  qtyRaw: unknown,
  costRaw: unknown,
): { positionQty?: number; costPrice?: number; error?: string } {
  const qtyStr = inputToString(qtyRaw);
  const costStr = inputToString(costRaw);

  if (!qtyStr && !costStr) {
    return {};
  }

  if (!qtyStr || !costStr) {
    return { error: '请同时填写持仓数量与成本价，或留空' };
  }

  const positionQty = parseOptionalNumber(qtyStr);
  if (positionQty === undefined) {
    return { error: '持仓数量无效' };
  }

  const costErr = validateCostPriceString(costStr);
  if (costErr) {
    return { error: costErr };
  }
  const costPrice = roundCostPrice(Number(costStr));

  const err = validatePositionPair(positionQty, costPrice);
  if (err) {
    return { error: err };
  }

  return { positionQty, costPrice };
}
