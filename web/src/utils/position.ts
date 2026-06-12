import type { WatchlistItem } from '../types';
import { t } from '../i18n';

export const COST_PRICE_DECIMALS = 3;
export const COST_PRICE_MIN = 0.001;
export const COST_PRICE_MAX = 999_999.999;

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
    return t('position.pairRequired');
  }
  if (!Number.isInteger(positionQty) || positionQty <= 0 || positionQty > 999_999_999) {
    return t('position.qtyInvalid');
  }
  if (costPrice! < COST_PRICE_MIN || costPrice! > COST_PRICE_MAX) {
    return t('position.costRange', { min: COST_PRICE_MIN, max: COST_PRICE_MAX });
  }
  if (roundCostPrice(costPrice!) !== costPrice!) {
    return t('position.costDecimals');
  }
  return null;
}

function validateCostPriceString(costStr: string): string | null {
  if (!/^\d+(\.\d{1,3})?$/.test(costStr)) {
    return t('position.costFormatInvalid');
  }
  const n = Number(costStr);
  if (!Number.isFinite(n) || n < COST_PRICE_MIN || n > COST_PRICE_MAX) {
    return t('position.costRange', { min: COST_PRICE_MIN, max: COST_PRICE_MAX });
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
    return { error: t('position.pairRequired') };
  }

  const positionQty = parseOptionalNumber(qtyStr);
  if (positionQty === undefined) {
    return { error: t('position.qtyParseInvalid') };
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
