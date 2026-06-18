import type { InstrumentType, Market } from '../types';

export interface ParsedSymbol {
  code: string;
  market: Market;
  instrumentType: InstrumentType;
}

function inferMarket(num: string): Market | null {
  if (num.startsWith('6') || num.startsWith('5')) {
    return 'sh';
  }
  if (num.startsWith('0') || num.startsWith('3') || num.startsWith('1')) {
    return 'sz';
  }
  if (num.startsWith('4') || num.startsWith('8')) {
    return 'bj';
  }
  return null;
}

export function inferInstrumentType(code: string): InstrumentType {
  const num = code.replace(/^(sh|sz|bj)/i, '');
  if (/^(51|56|58)\d{4}$/.test(num)) {
    return 'fund_etf';
  }
  if (/^(15|16|18)\d{4}$/.test(num)) {
    return 'fund_etf';
  }
  return 'stock';
}

export function normalizeWatchlistSymbol(input: string): ParsedSymbol | null {
  const raw = input.trim().toLowerCase().replace(/\s/g, '');
  const match = raw.match(/^(?:(sh|sz|bj))?(\d{6})$/);
  if (!match) {
    return null;
  }

  let market = match[1] as Market | undefined;
  const num = match[2];

  if (!market) {
    market = inferMarket(num) ?? undefined;
  }
  if (!market) {
    return null;
  }

  const code = `${market}${num}`;
  const instrumentType = inferInstrumentType(code);

  if (instrumentType === 'stock' && market === 'sh' && num.startsWith('5')) {
    if (!/^(51|56|58)\d{4}$/.test(num)) {
      return null;
    }
  }

  return { code, market, instrumentType };
}
