import { describe, expect, it } from 'vitest';
import { calcTradeFee } from './tradingCost';

describe('calcTradeFee', () => {
  it('buy: commission + transfer fee (no stamp tax)', () => {
    // 100000 × 0.00025 = 25; 100000 × 0.00001 = 1
    expect(calcTradeFee('buy', 100000, 'stock')).toBe(26);
  });

  it('stock sell includes stamp tax', () => {
    // 25 + 50 (stamp) + 1 = 76
    expect(calcTradeFee('sell', 100000, 'stock')).toBe(76);
  });

  it('fund_etf sell is exempt from stamp tax', () => {
    // 25 + 0 + 1 = 26
    expect(calcTradeFee('sell', 100000, 'fund_etf')).toBe(26);
  });

  it('enforces the ¥5 commission floor on small orders', () => {
    // 10000 × 0.00025 = 2.5 → floor 5; transfer 0.1 → 5.1
    expect(calcTradeFee('buy', 10000, 'stock')).toBe(5.1);
  });

  it('rounds to 2 decimals', () => {
    const fee = calcTradeFee('sell', 12345.67, 'stock');
    expect(Number.isInteger(fee * 100)).toBe(true);
  });

  it('zero-amount buy still pays the commission floor', () => {
    expect(calcTradeFee('buy', 0, 'stock')).toBe(5);
  });
});
