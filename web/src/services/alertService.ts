import type {
  AlertPayload,
  AlertSettings,
  StockCardState,
} from '../types';
import { HIGH_RISK_SIGNALS } from '../types';
import { checkBreakthrough } from '../utils/keyLevelManager';

const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  priceAlert: true,
  signalAlert: true,
  authErrorAlert: true,
  quoteErrorAlert: true,
};

const BREAKTHROUGH_DEBOUNCE_MS = 10_000;

const lastBreakthroughTs = new Map<string, number>();

function alertEnabled(settings: AlertSettings | undefined, key: keyof AlertSettings): boolean {
  const s = settings ?? DEFAULT_ALERT_SETTINGS;
  if (!s.enabled) {
    return false;
  }
  return s[key] === true;
}

export function isSignalHighRisk(signal: string | undefined): boolean {
  if (!signal) {
    return false;
  }
  return HIGH_RISK_SIGNALS.has(signal.trim());
}

export function collectAlertsFromRound(
  cards: StockCardState[],
  settings: AlertSettings | undefined,
  lastPrices: Map<string, number>,
): AlertPayload[] {
  const alerts: AlertPayload[] = [];

  for (const card of cards) {
    const item = card.stock;
    const diagnosis = card.diagnosis;

    if (diagnosis && alertEnabled(settings, 'signalAlert')) {
      if (isSignalHighRisk(diagnosis.signal)) {
        alerts.push({
          type: 'signal',
          code: item.code,
          name: item.name || item.code,
          signal: diagnosis.signal,
        });
      }
    }

    if (item.keyLevels?.length && card.snapshot?.price != null && alertEnabled(settings, 'priceAlert')) {
      const lastPrice = lastPrices.get(item.code) ?? null;
      const breached = checkBreakthrough(lastPrice, card.snapshot.price, item.keyLevels);
      const now = Date.now();
      for (const keyLevel of breached) {
        const debounceKey = `${item.code}:${keyLevel.type}:${keyLevel.price}`;
        const lastTs = lastBreakthroughTs.get(debounceKey) ?? 0;
        if (now - lastTs < BREAKTHROUGH_DEBOUNCE_MS) {
          continue;
        }
        lastBreakthroughTs.set(debounceKey, now);
        alerts.push({
          type: 'price',
          code: item.code,
          name: item.name || item.code,
          keyLevel,
          currentPrice: card.snapshot.price,
        });
      }
    }

    lastPrices.set(item.code, card.snapshot?.price ?? lastPrices.get(item.code) ?? 0);
  }

  const allQuoteFailed = cards.length > 0 && cards.every((c) => c.quoteError);
  if (allQuoteFailed && alertEnabled(settings, 'quoteErrorAlert')) {
    alerts.push({
      type: 'quote',
      code: '',
      name: '',
    });
  }

  return alerts;
}

export function createAuthErrorAlert(): AlertPayload {
  return { type: 'auth', code: '', name: '' };
}
