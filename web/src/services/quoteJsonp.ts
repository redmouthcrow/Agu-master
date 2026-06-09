import type { QuoteSnapshot } from '../types';
import { inferInstrumentType } from '../utils/stockCode';
import { formatTimeHms, getBeijingTime } from '../utils/time';

export interface QuoteProvider {
  fetchQuotes(codes: string[]): Promise<Map<string, QuoteSnapshot>>;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.charset = 'gbk';
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTencent(code: string): QuoteSnapshot | null {
  const key = `v_${code}`;
  const raw = (window as unknown as Record<string, string | undefined>)[key];
  if (!raw) {
    return null;
  }

  const parts = raw.split('~');
  if (parts.length < 35) {
    return null;
  }

  const price = num(parts[3]);
  const prevClose = num(parts[4]);
  const high = num(parts[33]);
  const low = num(parts[34]);
  const volume = num(parts[6]);
  const amount = num(parts[37]);
  const changePct =
    price !== null && prevClose !== null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

  return {
    code,
    name: parts[1] || code,
    instrumentType: inferInstrumentType(code),
    price,
    changePct,
    high,
    low,
    volume,
    amount,
    prevClose,
    quoteTime: `${getBeijingTime().dateStr} ${formatTimeHms()}`,
  };
}

function parseSina(code: string): QuoteSnapshot | null {
  const key = `hq_str_${code.toLowerCase()}`;
  const raw = (window as unknown as Record<string, string | undefined>)[key];
  if (!raw || raw.includes('FAILED')) {
    return null;
  }

  const parts = raw.split(',');
  if (parts.length < 10) {
    return null;
  }

  const price = num(parts[3]);
  const prevClose = num(parts[2]);
  const changePct =
    price !== null && prevClose !== null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

  return {
    code,
    name: parts[0] || code,
    instrumentType: inferInstrumentType(code),
    price,
    changePct,
    high: num(parts[4]),
    low: num(parts[5]),
    volume: num(parts[8]),
    amount: num(parts[9]),
    prevClose,
    quoteTime: `${getBeijingTime().dateStr} ${formatTimeHms()}`,
  };
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === '' || v === '--') {
    return null;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchTencent(codes: string[]): Promise<Map<string, QuoteSnapshot>> {
  const result = new Map<string, QuoteSnapshot>();
  if (codes.length === 0) {
    return result;
  }

  const q = codes.join(',');
  await loadScript(`https://qt.gtimg.cn/q=${q}&_=${Date.now()}`);

  for (const code of codes) {
    const snap = parseTencent(code);
    if (snap) {
      result.set(code, snap);
    }
  }
  return result;
}

async function fetchSina(codes: string[]): Promise<Map<string, QuoteSnapshot>> {
  const result = new Map<string, QuoteSnapshot>();
  if (codes.length === 0) {
    return result;
  }

  const list = codes.join(',');
  await loadScript(`https://hq.sinajs.cn/list=${list}&_=${Date.now()}`);

  for (const code of codes) {
    const snap = parseSina(code);
    if (snap) {
      result.set(code, snap);
    }
  }
  return result;
}

export async function fetchQuotesWithFallback(
  codes: string[],
): Promise<Map<string, QuoteSnapshot | null>> {
  const output = new Map<string, QuoteSnapshot | null>();
  codes.forEach((c) => output.set(c, null));

  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += 5) {
    batches.push(codes.slice(i, i + 5));
  }

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];

    try {
      const tencent = await fetchTencent(batch);
      tencent.forEach((v, k) => output.set(k, v));
    } catch {
      /* try sina */
    }

    const missing = batch.filter((c) => !output.get(c));
    if (missing.length > 0) {
      await sleep(500);
      try {
        const sina = await fetchSina(missing);
        sina.forEach((v, k) => output.set(k, v));
      } catch {
        /* keep nulls */
      }
    }

    if (i < batches.length - 1) {
      await sleep(300);
    }
  }

  return output;
}

export function formatVolumeForPrompt(
  volume: number | null,
  session: string,
): string {
  if (session === '集合竞价') {
    return '集合竞价阶段';
  }
  if (volume === null) {
    return '停牌/无成交';
  }
  return String(volume);
}
