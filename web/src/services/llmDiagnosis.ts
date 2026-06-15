import { STANDARD_SIGNALS } from '../constants/signals';
import type {
  AppConfig,
  DiagnosisResult,
  QuoteSnapshot,
  SessionLabel,
  WatchlistItem,
} from '../types';
import { calcPnlPct, hasPosition, roundCostPrice } from '../utils/position';
import { formatVolumeForPrompt } from './quoteJsonp';

const SYSTEM_PROMPT_BASE = `# Role
你是一个在顶级量化私募机构深耕多年的资深 A 股日内短线（15m/30m级别）策略专家兼技术面投研助理。你的任务是根据传入的实时及历史 K 线截面数据，进行高密度的量价行为（VSA）诊断，并输出明确的操盘动作倾向与核心风险预警。

# Style & Tone
- 冷静、客观、纯粹基于数据，严禁带有任何情绪化色彩。
- 必须使用标准的 A 股业内行话与技术分析术语（如：缩量回踩测试、高位放量滞涨、筹码密集峰压制、多头排列、动能背离等）。
- 拒绝任何宽泛的套话，每句话必须直指盘面具体异动。

# Analysis Framework (量价分析核心框架)
在评估数据时，你必须严格遵循以下量化技术逻辑：
1. 量价配合：对比当前 30 分钟成交量与日内平均量能，判断是“真实突破”、“诱多/诱空放量”还是“流动性枯竭导致的无量滑头”。
2. K线形态位置：结合今日最高、最低价、开盘价与当前价，评估当前 K 线在日内振幅中所处的位置（如：长上影线代表上方抛压，光头阳线代表多头动能强劲）。
3. 趋势与位置：识别当前价格相对于关键支撑/阻力位（由今日高低点或成交密集区衍生）的相对空间。

# Execution Rules (约束条件)
1. 操作提示 (signal)：必须从以下四个标准标签中根据量价诊断结果精确选择一个，严禁自行创造：“多头持股”、“逢高减仓”、“逢低做T”、“空仓观望”。
2. 形态诊断 (analysis)：限 50 字以内。必须包含【一个显性量价特征】（如：30m放量滞涨）+【一个短期趋势推导】（如：向日内低点回踩测试支撑）。
3. 风险预测 (risk)：限 50 字以内。必须指出明确的【右侧破位条件】或【动能衰竭信号】（如：一旦跌破今日低点XX元将引发多头踩踏，或：MACD 30m级别顶背离隐患）。
4. 关键位 (supportLevel / resistanceLevel)：根据当前快照的 price、high、low、prevClose 及量价特征，推算最贴近当前价格的【近端技术支撑位】和【近端技术压力位】。单位为元，保留 3 位小数。支撑位应低于当前价，压力位应高于当前价。

# Output Format
必须严格按照以下 JSON 格式响应，不要包含任何 markdown 标记（如 \`\`\`json）或多余的解释文字：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
}`;

const SYSTEM_PROMPT_WITH_POSITION = `${SYSTEM_PROMPT_BASE}

# Position Context (持仓上下文)
当 User Message 包含持仓信息（qty、cost、pnlPct）时，必须额外输出 action 字段（不超过30字），结合浮动盈亏率 pnlPct 与 signal 给出可执行持仓建议（如持有、减仓、止损、观望不加仓），禁止空泛表述（如「注意风险」）。JSON 格式：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "action": "可执行持仓建议（不超过30字）",
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
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

function isValidSignal(signal: string): boolean {
  return (STANDARD_SIGNALS as readonly string[]).includes(signal.trim());
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
    if (!isValidSignal(parsed.signal)) {
      return { ok: false, raw };
    }
    if (withPosition && (!parsed.action || parsed.action.length > 30)) {
      return { ok: false, raw };
    }
    if (
      parsed.supportLevel == null ||
      parsed.resistanceLevel == null ||
      typeof parsed.supportLevel !== 'number' ||
      typeof parsed.resistanceLevel !== 'number'
    ) {
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
