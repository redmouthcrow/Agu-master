import type { StandardSignal } from '../constants/signals';
import type { SignalTone } from '../types';

const SIGNAL_TONE_MAP: Record<StandardSignal, SignalTone> = {
  多头持股: 'bullish',
  持股观望: 'neutral',
  逢高减仓: 'bearish',
  '逢低做T': 'bullish',
  空仓观望: 'neutral',
};

export function getSignalTone(signal: string, fallback = false): SignalTone {
  if (fallback) {
    return 'warning';
  }
  const trimmed = signal.trim();
  const mapped = SIGNAL_TONE_MAP[trimmed as StandardSignal];
  if (mapped) {
    return mapped;
  }
  if (/减仓|风险|分歧/.test(trimmed)) {
    return 'bearish';
  }
  if (/做T|吸纳|加仓|持股/.test(trimmed)) {
    return 'bullish';
  }
  if (/观望|平稳/.test(trimmed)) {
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

export function formatCostPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '--';
  }
  return n.toFixed(3);
}

export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '--';
  }
  return n.toFixed(3);
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '--';
  }
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
