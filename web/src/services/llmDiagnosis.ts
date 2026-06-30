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
import { formatHistoryText } from '../utils/priceHistory';

const SYSTEM_PROMPT_BASE = `# Role
你是一个在顶级量化私募机构深耕多年的资深 A 股日内短线（15m/30m级别）策略专家兼技术面投研助理。你的任务是根据传入的实时及历史 K 线截面数据，进行高密度的量价行为（VSA）诊断，并输出明确的操盘动作倾向与核心风险预警。

# Style & Tone
- 冷静、客观、纯粹基于数据，严禁带有任何情绪化色彩。
- 必须使用标准的 A 股业内行话与技术分析术语（如：缩量回踩测试、高位放量滞涨、筹码密集峰压制、多头排列、动能背离等）。
- 拒绝任何宽泛的套话，每句话必须直指盘面具体异动。

# Analysis Framework (量价分析核心框架)
在评估数据时，你必须严格遵循以下量化技术逻辑：
1. 量价配合：对比当前 30 分钟成交量与日内平均量能，判断是真实突破、诱多/诱空放量还是流动性枯竭导致的无量滑头。
2. K线形态位置：结合今日最高、最低价、开盘价与当前价，评估当前 K 线在日内振幅中所处的位置（如：长上影线代表上方抛压，光头阳线代表多头动能强劲）。
3. 趋势与位置：识别当前价格相对于关键支撑/阻力位（由今日高低点或成交密集区衍生）的相对空间。

# Execution Rules (约束条件)
1. 操作提示 (signal)：必须从以下五个标准标签中根据量价诊断结果精确选择一个，严禁自行创造：多头持股、持股观望、逢高减仓、逢低做T、空仓观望。选择依据：有浮盈且日内动能强劲→多头持股；有浮盈但动能衰减、盈亏幅度微小（pnlPct绝对值 < 2%）→优先持股观望而非逢高减仓；浮盈较大（pnlPct > 5%）且出现放量滞涨/长上影→逢高减仓；盘中急跌至支撑位附近→逢低做T。
2. 形态诊断 (analysis)：限 50 字以内。必须包含一个显性量价特征（如：30m放量滞涨）+ 一个短期趋势推导（如：向日内低点回踩测试支撑）。
3. 风险预测 (risk)：限 50 字以内。必须指出明确的右侧破位条件或动能衰竭信号（如：一旦跌破今日低点XX元将引发多头踩踏，或：MACD 30m级别顶背离隐患）。
4. 关键位 (supportLevel / resistanceLevel)：根据当前快照的 price、high、low、prevClose 及量价特征，推算最贴近当前价格的近端技术支撑位和近端技术压力位。单位为元，保留 3 位小数。支撑位应低于当前价，压力位应高于当前价。
5. 建仓建议 (buildPositionAdvice)：限 30 字以内。必须锚定上述 supportLevel / resistanceLevel 与当前价 price 的相对位置，给出建仓方向与建议价位（如：可等待放量企稳支撑位后轻仓试多 / 接近阻力位暂不建议追高建仓）。严禁脱离关键位凭空给出买卖建议。

# Investment Style (投资风格)
当前用户投资风格：{styleLabel}。你必须根据此风格调整风险偏好与建议措辞：
- 激进（aggressive）：偏好积极操作，减仓阈值为 pnlPct > 8%。优先提示加仓/做T机会，波段建议可给出更乐观的目标位。
- 中立（neutral）：平衡风险收益，减仓阈值为 pnlPct > 5%。波段建议锚定关键位，不激进不保守。
- 保守（conservative）：以保本和风控为最高优先级，减仓阈值为 pnlPct > 3%。即使技术面偏多，也应以防御性建议为主。

# Forward-Looking Analysis (前瞻分析)
你必须基于日内数据与近7日走势做出前瞻性判断：
- 根据日内振幅（high-low）、当前价在日内区间的位置（positionInRange）、较昨收涨跌方向、量能水平，推断当日最可能的走势方向（偏多上行 / 偏空下行 / 窄幅震荡）
- 结合近7日收盘价走势（见 User Message），判断短期趋势（上行/下行/横盘），并在 analysis 中体现
- bandAction / buildPositionAdvice 中给出基于关键位与近期趋势的未来 3-5 个交易日波段预判
- risk 中指出判断错误的关键破位条件

# Output Format
必须严格按照以下 JSON 格式响应，不要包含任何 markdown 标记（如 \`\`\`json）或多余的解释文字：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "buildPositionAdvice": "锚定关键位的建仓建议（不超过30字）",
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
}`;

const SYSTEM_PROMPT_WITH_POSITION = `${SYSTEM_PROMPT_BASE}

# Position Context (持仓上下文)
当 User Message 包含持仓信息（qty、cost、pnlPct）时，必须额外输出 shortAction 字段（不超过30字），结合浮动盈亏率 pnlPct 与 signal 给出可执行短期持仓建议。严禁对微小浮动盈亏（pnlPct 绝对值 < 2%）给出减仓建议——微盈时信号应为多头持股或持股观望，shortAction 建议持有或关注关键位得失。JSON 格式：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "bandAction": "锚定关键位的波段建议（不超过30字）",
  "shortAction": "可执行短期持仓建议（不超过30字）",
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
}`;

const STYLE_LABELS: Record<string, string> = {
  aggressive: '激进',
  neutral: '中立',
  conservative: '保守',
};

function typeLabel(type: QuoteSnapshot['instrumentType']): string {
  return type === 'fund_etf' ? '场内基金' : 'A股';
}

function buildUserMessage(
  snapshot: QuoteSnapshot,
  watchlistItem: WatchlistItem,
  alignedTime: string,
  session: SessionLabel,
  investmentStyle: string,
): string {
  const volume = formatVolumeForPrompt(snapshot.volume, session);
  const change =
    snapshot.changePct === null ? 'null' : `${snapshot.changePct.toFixed(2)}`;

  // v2.7: intraday context for forward-looking analysis.
  const high = snapshot.high;
  const low = snapshot.low;
  const prevClose = snapshot.prevClose;
  let amplitude = 'null';
  let positionInRange = 'null';
  let direction = 'null';
  if (high != null && low != null && prevClose != null) {
    amplitude = (high - low).toFixed(2);
    positionInRange =
      snapshot.price != null
        ? ((snapshot.price - low) / (high - low) * 100).toFixed(1)
        : 'null';
    direction =
      snapshot.price != null
        ? snapshot.price > prevClose
          ? '高开上行'
          : snapshot.price < prevClose
          ? '低开下行'
          : '平开'
        : 'null';
  }

  let msg = `${snapshot.name} ${snapshot.code} | ${typeLabel(snapshot.instrumentType)} | 对齐 ${alignedTime} | ${session}
快照: price=${snapshot.price}, changePct=${change}%, high=${high}, low=${low}, volume=${volume}, prevClose=${prevClose}
日内: 振幅=${amplitude}, 位置=${positionInRange}%(0=最低,100=最高), 方向=${direction}
风格: ${STYLE_LABELS[investmentStyle] ?? '中立'}`;

  // v2.7.1: 7-day price history for trend analysis.
  const histText = formatHistoryText(snapshot.code);
  if (histText) {
    msg += `\n近7日收盘: ${histText}`;
  }

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
  const style = config.investmentStyle ?? 'neutral';
  const styleLabel = STYLE_LABELS[style] ?? '中立';

  // Inject style label into the system prompt template.
  const systemContent = (
    withPosition ? SYSTEM_PROMPT_WITH_POSITION : SYSTEM_PROMPT_BASE
  ).replace('{styleLabel}', styleLabel);

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: buildUserMessage(snapshot, watchlistItem, alignedTime, session, style),
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
    if (withPosition) {
      if (!parsed.shortAction || parsed.shortAction.length > 30) {
        return { ok: false, raw };
      }
      if (
        !parsed.bandAction ||
        parsed.bandAction.length > 30 ||
        !anchorsToKeyLevel(parsed.bandAction, parsed.supportLevel, parsed.resistanceLevel)
      ) {
        return { ok: false, raw };
      }
    } else {
      if (
        !parsed.buildPositionAdvice ||
        parsed.buildPositionAdvice.length > 30 ||
        !anchorsToKeyLevel(parsed.buildPositionAdvice, parsed.supportLevel, parsed.resistanceLevel)
      ) {
        return { ok: false, raw };
      }
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

function anchorsToKeyLevel(
  advice: string,
  support?: number,
  resistance?: number,
): boolean {
  const candidates: string[] = [];
  for (const v of [support, resistance]) {
    if (v == null || Number.isNaN(v)) continue;
    candidates.push(v.toFixed(2), v.toFixed(1), String(v));
  }
  return candidates.some((c) => advice.includes(c));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
