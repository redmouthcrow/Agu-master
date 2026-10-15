import { loadScript } from './quoteJsonp';
import { formatTimeHms } from '../utils/time';

/**
 * v2.15.0: 盘外参照（外盘风向标）。
 *
 * A 股的日内情绪受隔夜美股、美股对应板块（半导体/存储/新能源/消费电子）、
 * 中概与亚太市场影响；仅看 A 股自身数据容易误判。这里用与自选行情相同的
 * 腾讯 JSONP 链路拉取一组固定风向标（实测同一字段布局：腾讯 [3]现价、
 * [4]昨收、[32]涨跌幅），随每次 LLM 调用注入 User Message（带获取时间）。
 * 拉取失败静默降级——不注入该块，诊断照常进行。
 */

export interface ExternalQuote {
  code: string;
  changePct: number;
}

export interface ExternalContext {
  /** 本地时间 HH:mm:ss（提示 AI 数据新鲜度）。 */
  fetchedAt: string;
  quotes: ExternalQuote[];
}

interface ExternalItem {
  code: string;
  label: string;
}

/** 分组风向标；label 用于 Prompt 展示（比源站全名更紧凑）。 */
export const EXTERNAL_GROUPS: { label: string; items: ExternalItem[] }[] = [
  {
    label: '美股大盘(最近收盘)',
    items: [
      { code: 'usDJI', label: '道琼斯' },
      { code: 'usIXIC', label: '纳斯达克' },
      { code: 'usINX', label: '标普500' },
      { code: 'usHXC', label: '中概金龙指数' },
    ],
  },
  {
    label: '美股板块风向(最近收盘)',
    items: [
      { code: 'usSOXX', label: '费半ETF' },
      { code: 'usNVDA', label: '英伟达' },
      { code: 'usTSM', label: '台积电' },
      { code: 'usMU', label: '美光科技' },
      { code: 'usAAPL', label: '苹果' },
      { code: 'usTSLA', label: '特斯拉' },
    ],
  },
  {
    label: '亚太实时',
    items: [
      { code: 'hkHSI', label: '恒生指数' },
      { code: 'hkHSTECH', label: '恒生科技' },
      { code: 'kr005930', label: '三星电子' },
      { code: 'kr000660', label: 'SK海力士' },
    ],
  },
];

const ALL_CODES = EXTERNAL_GROUPS.flatMap((g) => g.items.map((i) => i.code));

/**
 * 解析腾讯外盘响应行（纯函数，供单测）。
 * 涨跌幅优先取 [32]；缺失时用 [3]/[4] 推算。字段不足或无效返回 null。
 */
export function parseExternalQuote(code: string, raw: string | undefined): ExternalQuote | null {
  if (!raw || raw.includes('pv_none_match')) {
    return null;
  }
  const parts = raw.split('~');
  if (parts.length < 33) {
    return null;
  }
  let changePct = parseFloat(parts[32]);
  if (!Number.isFinite(changePct)) {
    const price = parseFloat(parts[3]);
    const prevClose = parseFloat(parts[4]);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose === 0) {
      return null;
    }
    changePct = ((price - prevClose) / prevClose) * 100;
  }
  return { code, changePct: Math.round(changePct * 100) / 100 };
}

/** 把盘外参照格式化为 Prompt 文本块（纯函数，供单测）；无有效数据返回 null。 */
export function formatExternalContext(ctx: ExternalContext | null | undefined): string | null {
  if (!ctx || ctx.quotes.length === 0) {
    return null;
  }
  const byCode = new Map(ctx.quotes.map((q) => [q.code, q]));
  const lines: string[] = [`盘外参照（获取于 ${ctx.fetchedAt}）:`];
  for (const group of EXTERNAL_GROUPS) {
    const items = group.items
      .map((item) => {
        const q = byCode.get(item.code);
        if (!q) {
          return null;
        }
        const sign = q.changePct >= 0 ? '+' : '';
        return `${item.label} ${sign}${q.changePct.toFixed(2)}%`;
      })
      .filter((s): s is string => s !== null);
    if (items.length > 0) {
      lines.push(`${group.label}: ${items.join(' | ')}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

// --- module-level cache（仅主运行体使用；诊断时同步读取） ---

let cachedContext: ExternalContext | null = null;
let cachedAt = 0;

/** 供 runDiagnosis 同步读取（无数据/拉取失败时返回 null，调用方跳过注入）。 */
export function getExternalContextText(): string | null {
  return formatExternalContext(cachedContext);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('external markets timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 距上次成功拉取不超过 maxAgeMs 时跳过；失败静默（保留旧缓存）。 */
export async function ensureExternalContext(maxAgeMs = 10 * 60 * 1000): Promise<void> {
  if (cachedContext && Date.now() - cachedAt < maxAgeMs) {
    return;
  }
  try {
    await withTimeout(
      loadScript(`https://qt.gtimg.cn/q=${ALL_CODES.join(',')}&_=${Date.now()}`),
      5000,
    );
    const quotes: ExternalQuote[] = [];
    for (const code of ALL_CODES) {
      const raw = (window as unknown as Record<string, string | undefined>)[`v_${code}`];
      const parsed = parseExternalQuote(code, raw);
      if (parsed) {
        quotes.push(parsed);
      }
    }
    if (quotes.length > 0) {
      cachedContext = { fetchedAt: formatTimeHms(), quotes };
      cachedAt = Date.now();
    }
  } catch {
    /* 盘外参照为尽力而为，失败不注入 */
  }
}
