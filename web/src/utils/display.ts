import type { SignalTone } from '../types';

export function getSignalTone(signal: string, fallback = false): SignalTone {
  if (fallback) {
    return 'warning';
  }
  if (/减仓|风险|分歧/.test(signal)) {
    return 'bearish';
  }
  if (/做T|吸纳|加仓/.test(signal)) {
    return 'bullish';
  }
  if (/观望|平稳/.test(signal)) {
    return 'neutral';
  }
  return 'warning';
}

export function maskApiKey(key: string): string {
  if (!key) {
    return '';
  }
  if (key.length <= 4) {
    return '****';
  }
  return `${'*'.repeat(Math.min(key.length - 4, 12))}${key.slice(-4)}`;
}

export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '--';
  }
  return n.toFixed(2);
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '--';
  }
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
