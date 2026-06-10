import type {
  AppConfig,
  DiagnosisResult,
  QuoteSnapshot,
  SessionLabel,
  WatchlistItem,
} from '../types';
import { calcPnlPct, hasPosition, roundCostPrice } from '../utils/position';
import { formatVolumeForPrompt } from './quoteJsonp';

const SYSTEM_PROMPT_BASE = `你是一个专业的 A 股短线量化交易助手。请根据我提供的实时行情快照进行客观的技术面诊断。
注意：输入为某一时刻的实时快照，而非完整 K 线序列；资产类型可能是 A 股股票或场内 ETF/LOF，请结合类型标签调整表述（基金关注跟踪误差、溢价折价、量价配合）。

1. 语言必须精炼、专业，直接使用标准技术分析术语（如：放量突破、缩量盘整、均线压制、多头排列、底背离等）。
2. 操作提示必须给出明确的倾向性参考（如：持股观望/逢高减仓/逢低做T/多头轻仓），signal 字段固定 4 字。
3. 风险预测指出当前周期内最核心的技术面风险。
4. 严格按照以下 JSON 格式输出，不要包含任何 markdown 标记或多余解释：
{
  "signal": "4字操盘提示",
  "analysis": "形态诊断（不超过50字）",
  "risk": "风险预测（不超过50字）"
}`;

const SYSTEM_PROMPT_WITH_POSITION = `${SYSTEM_PROMPT_BASE}

当 User Message 包含持仓信息时，必须额外输出 action 字段（不超过30字），结合浮动盈亏率与 signal 给出可执行持仓建议（如持有、减仓、止损、观望不加仓），禁止空泛表述。JSON 格式：
{
  "signal": "4字操盘提示",
  "analysis": "形态诊断（不超过50字）",
  "risk": "风险预测（不超过50字）",
  "action": "可执行持仓建议（不超过30字）"
}`;

function typeLabel(type: QuoteSnapshot['instrumentType']): string {
  return type === 'fund_etf' ? '场内基金' : 'A股';
}

function buildUserMessage(
  snapshot: QuoteSnapshot,
  watchlistItem: WatchlistItem,
  alignedTime: string,
  session: SessionLabel,
): string {
  const volume = formatVolumeForPrompt(snapshot.volume, session);
  const change =
    snapshot.changePct === null ? 'null' : `${snapshot.changePct.toFixed(2)}`;

  let msg = `【${snapshot.name} ${snapshot.code} | ${typeLabel(snapshot.instrumentType)}】对齐时刻 ${alignedTime} | ${session}
快照: price=${snapshot.price}, changePct=${change}%, high=${snapshot.high}, low=${snapshot.low}, volume=${volume}, prevClose=${snapshot.prevClose}`;

  if (hasPosition(watchlistItem)) {
    const pnl = calcPnlPct(snapshot.price, watchlistItem.costPrice!);
    const pnlStr = pnl === null ? 'null' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`;
    const unit = watchlistItem.instrumentType === 'fund_etf' ? '份' : '股';
    msg += `\n持仓: qty=${watchlistItem.positionQty}${unit}, cost=${roundCostPrice(watchlistItem.costPrice!)}, pnlPct=${pnlStr}%`;
  }

  return msg;
}

export class LlmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmAuthError';
  }
}

export async function runDiagnosis(
  snapshot: QuoteSnapshot,
  watchlistItem: WatchlistItem,
  config: AppConfig,
  alignedTime: string,
  session: SessionLabel,
): Promise<{ ok: true; data: DiagnosisResult } | { ok: false; raw: string }> {
  const withPosition = hasPosition(watchlistItem);
  const base = config.baseUrl.replace(/\/$/, '');
  const body = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: withPosition ? SYSTEM_PROMPT_WITH_POSITION : SYSTEM_PROMPT_BASE,
      },
      {
        role: 'user',
        content: buildUserMessage(snapshot, watchlistItem, alignedTime, session),
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 429) {
    throw new LlmAuthError('API Key 校验失败或额度不足，请检查配置');
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, raw: text || `HTTP ${res.status}` };
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? '';

  try {
    const parsed = JSON.parse(raw) as DiagnosisResult;
    if (!parsed.signal || !parsed.analysis || !parsed.risk) {
      return { ok: false, raw };
    }
    if (withPosition && (!parsed.action || parsed.action.length > 30)) {
      return { ok: false, raw };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, raw };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
