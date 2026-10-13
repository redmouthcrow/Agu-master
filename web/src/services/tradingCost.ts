/**
 * A-share trading cost model (v2.12).
 * Fixed market-common defaults; ETF/LOF (fund_etf) sells are exempt from stamp tax.
 */

const COMMISSION_RATE = 0.00025;   // 万2.5
const COMMISSION_MIN = 5;          // minimum ¥5
const STAMP_TAX_RATE = 0.0005;     // 万5, stocks sell-only
const TRANSFER_FEE_RATE = 0.00001; // 万0.1, both sides

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Total trading fees for one fill.
 * Buy:  commission + transfer fee.
 * Sell (stock): commission + stamp tax + transfer fee.
 * Sell (fund_etf): commission + transfer fee (no stamp tax for on-exchange funds).
 */
export function calcTradeFee(
  side: 'buy' | 'sell',
  amount: number,
  instrumentType: 'stock' | 'fund_etf',
): number {
  const commission = Math.max(amount * COMMISSION_RATE, COMMISSION_MIN);
  const transferFee = amount * TRANSFER_FEE_RATE;
  const stampTax = side === 'sell' && instrumentType === 'stock' ? amount * STAMP_TAX_RATE : 0;
  return round2(commission + stampTax + transferFee);
}
