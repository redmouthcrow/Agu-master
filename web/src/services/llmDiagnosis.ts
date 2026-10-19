import { STANDARD_SIGNALS } from '../constants/signals';
import type {
  ActionPlan,
  AppConfig,
  DiagnosisResult,
  InvestmentHorizon,
  QuoteSnapshot,
  SessionLabel,
  WatchlistItem,
} from '../types';
import { calcPnlPct, hasPosition, roundCostPrice } from '../utils/position';
import { normalizeDiagnosisByPosition } from '../utils/diagnosisMode';
import { formatVolumeForPrompt } from './quoteJsonp';
import { getExternalContextText } from './externalMarkets';
import {
  formatQuantSignalBlock,
  getQuantSignalFor,
  quantRequiredDirection,
  resolveQuantAdvice,
} from './quantSignals';
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
5. 建仓建议 (buildPositionAdvice)：限 40 字以内。必须锚定上述 supportLevel / resistanceLevel 与当前价 price 的相对位置，给出建仓方向、建议价位与**具体建议仓位数量**（如：可等支撑位企稳后轻仓试多5手 / 接近阻力位暂不建议追高建仓 / 可半仓试探6手止损设于支撑下方）。严禁脱离关键位凭空给出买卖建议。
6. 结构化操作指令 (buildPlan)：仅当 buildPositionAdvice 明确包含**具体数量与触发价位**时输出 buildPlan 对象（side 固定 "buy"，condition 固定 "lte"，triggerPrice 为建议买入触发价，保留 3 位小数，qty 为正整数，单位股/份）；若建议中无明确数量或价位，输出 null。**严禁编造数量或价位**。

# Investment Style (投资风格)
当前用户投资风格：{styleLabel}。你必须根据此风格调整风险偏好与建议措辞：
- 激进（aggressive）：偏好积极操作，减仓阈值为 pnlPct > 8%。优先提示加仓/做T机会，波段建议可给出更乐观的目标位。
- 中立（neutral）：平衡风险收益，减仓阈值为 pnlPct > 5%。波段建议锚定关键位，不激进不保守。
- 保守（conservative）：以保本和风控为最高优先级，减仓阈值为 pnlPct > 3%。即使技术面偏多，也应以防御性建议为主。

# PnL Targeting (盈亏目标策略)
当 User Message 包含「已实现盈亏」时，你的 all-analysis 与操作建议必须以该盈亏为战略目标：
- **已实现亏损（actualPnl < 0）**：核心目标是**回本/减小亏损**。优先评估：当前是否处于可加仓摊薄成本的位置（价格接近支撑位且有企稳信号）；若技术面不支持反弹，果断建议**止损离场保住剩余本金**，禁止给"再看看""持有不动"这类拖延型建议。shortAction/bandAction 必须明确说出目标方向（如"若不破支撑可小仓补回成本，破位则立即止损"）。
- **已实现盈利（actualPnl > 0）**：核心目标是**扩大盈利**。优先评估：趋势是否支持继续持有或加仓扩大浮盈；若出现放量滞涨/顶背离等衰竭信号，建议分批止盈锁定利润。shortAction/bandAction 应给出扩张或锁盈的具体动作。
- **无已实现盈亏数据**：按常规持仓逻辑给出建议。
- 上述目标与投资风格叠加：激进风格允许更大的回本博弈（如补仓摊薄）；保守风格亏损时更早止损、盈利时更早锁盈。

# Forward-Looking Analysis (前瞻分析)
你必须基于日内数据与近7日走势做出前瞻性判断：
- 根据日内振幅（high-low）、当前价在日内区间的位置（positionInRange）、较昨收涨跌方向、量能水平，推断当日最可能的走势方向（偏多上行 / 偏空下行 / 窄幅震荡）
- 结合 User Message 中的近段收盘价走势（短线/波段为近7日，长期为近20日），判断趋势方向（上行/下行/横盘），并在 analysis 中体现
- bandAction / buildPositionAdvice 中给出基于关键位与近期趋势的未来 3-5 个交易日波段预判
- risk 中指出判断错误的关键破位条件

# External Reference (盘外参照)
当 User Message 包含「盘外参照」时，必须结合其判断情绪联动，并纳入 analysis / risk / 建议方向：
- 隔夜美股大盘（道琼斯/纳斯达克/标普500）与中概金龙指数 → 当日 A 股整体风险偏好与外盘情绪；
- 美股板块风向（费半ETF/英伟达/台积电/美光 → 半导体·存储·算力链；苹果 → 消费电子链；特斯拉 → 新能源车链）→ 对应 A 股板块的开盘情绪与联动方向；
- 亚太实时（恒生指数/恒生科技 → 港股情绪对 A 股的风险偏好传导；三星电子/SK海力士 → 存储与半导体链的实时印证）。
规则：
1. 盘外因素作为**辅助权重**——仅当盘外信号与个股自身量价结构一致时提升判断置信度；两者明显背离时（如美股半导体大跌而个股缩量抗跌）必须在 analysis 或 risk 中明确指出该背离。
2. 最终建议（bandAction / shortAction / longAction）**必须锚定该证券自身的 supportLevel / resistanceLevel**，不得因盘外因素脱离关键位给出价位。
3. 指数类数据（美股大盘/金龙指数）主要影响情绪描述与风险提示，不直接派生个股价位建议；个股对照（英伟达/台积电/三星等）与对应 A 股板块的联动可直接用于倾向判断。

# Output Format
必须严格按照以下 JSON 格式响应，不要包含任何 markdown 标记（如 \`\`\`json）或多余的解释文字：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "buildPositionAdvice": "锚定关键位的建仓建议(含仓位数量,不超过40字)",
  "buildPlan": {"side":"buy","qty":1000,"triggerPrice":6.15,"condition":"lte"},
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
}`;

const SYSTEM_PROMPT_WITH_POSITION = `${SYSTEM_PROMPT_BASE}

# Position Context (持仓上下文)
**字段互斥（最高优先级，覆盖上方 Output Format）**：已持仓时禁止输出 buildPositionAdvice 和 buildPlan 字段——它们是空仓用户专用的建仓建议，已持仓时输出属于错误。只按本节下方的 JSON 格式输出。
当 User Message 包含持仓信息（qty、cost、pnlPct）时，必须额外输出 shortAction 字段（不超过40字），结合浮动盈亏率 pnlPct 与 signal 给出可执行短期持仓建议，**必须包含具体数量**（如：减半仓卖出500股 / 加仓2手 / 全部止盈清仓 / 持有不动）。严禁对微小浮动盈亏（pnlPct 绝对值 < 2%）给出减仓建议——微盈时信号应为多头持股或持股观望，shortAction 建议持有或关注关键位得失。

结构化操作指令（v2.10）：
- shortPlan：仅当 shortAction 明确包含**具体数量与触发价位**时输出。减仓/清仓 side="sell"、condition="gte"（价格≥触发价成交）；加仓 side="buy"、condition="lte"（价格≤触发价成交）。qty 为正整数；**卖出 qty 不得超过持仓数量**；买入金额不得超过可用资金。无明确数量或价位时输出 null。严禁编造。
- bandPlan：仅当 bandAction 明确包含**具体数量与触发价位**时输出，规则同 shortPlan。无明确数量或价位时输出 null。严禁编造。

JSON 格式：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "bandAction": "锚定关键位的波段建议(含仓位指引,不超过40字)",
  "bandPlan": {"side":"buy","qty":1000,"triggerPrice":6.15,"condition":"lte"},
  "shortAction": "可执行短期持仓建议(含具体数量,不超过40字)",
  "shortPlan": {"side":"sell","qty":500,"triggerPrice":6.65,"condition":"gte"},
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
}`;

const SYSTEM_PROMPT_SWING_POSITION = `${SYSTEM_PROMPT_BASE}

# Position Context (持仓上下文)
**字段互斥（最高优先级，覆盖上方 Output Format）**：已持仓时禁止输出 buildPositionAdvice 和 buildPlan 字段（那是空仓用户专用的建仓建议）。只按本节下方的 JSON 格式输出。
用户投资周期为**波段**：以数日到两周的波段操作为核心，短线操作仅作辅助。
- bandAction（必填，≤40字）：波段建议，必须锚定 supportLevel / resistanceLevel 与当前价的位置关系，给出加/减仓方向与条件。
- shortAction（**可选**，≤40字）：仅当存在明确、值得当天执行的短线机会时输出，且必须包含具体数量；若无明显机会或建议继续持有时输出 null——不要为了填字段而制造操作。严禁对微小浮动盈亏（pnlPct 绝对值 < 2%）给出减仓建议。
- 结构化指令：bandPlan / shortPlan —— 仅当对应建议明确含**具体数量与触发价位**时输出（减仓/清仓 side="sell"、condition="gte"；加仓 side="buy"、condition="lte"）。无明确数量或价位时输出 null，严禁编造。卖出 qty 不得超过持仓数量；买入金额不得超过可用资金。

JSON 格式：
{
  "signal": "4字标准标签",
  "analysis": "高密度量价技术面诊断（不超过50字）",
  "risk": "明确的破位或衰竭风险预测（不超过50字）",
  "bandAction": "锚定关键位的波段建议(含仓位指引,不超过40字)",
  "bandPlan": {"side":"buy","qty":1000,"triggerPrice":6.15,"condition":"lte"},
  "shortAction": "短线操作(含具体数量)或 null",
  "shortPlan": {"side":"sell","qty":500,"triggerPrice":6.65,"condition":"gte"},
  "supportLevel": 6.12,
  "resistanceLevel": 6.85
}`;

const SYSTEM_PROMPT_LONG_POSITION = `${SYSTEM_PROMPT_BASE}

# Position Context (长期持仓策略)
**字段互斥（最高优先级，覆盖上方 Output Format）**：用户投资周期为**长期**（数周到数月），已持仓时**只输出 longAction / longPlan**——禁止输出 shortAction、bandAction、buildPositionAdvice 及其对应 plan 字段。只按本节下方的 JSON 格式输出。
- longAction（必填，≤60字）：一句话给出「中期趋势判断 + 持有或减仓动作 + 离场/重估条件」，必须锚定 supportLevel / resistanceLevel。范例：
  - 「中期趋势未破坏，继续持有，忽略日内波动；仅当跌破 6.12 时减配」
  - 「中期结构转弱，建议反弹至 6.85 减仓三分之一；若直接跌破 6.12 则清仓离场」
- **判断必须基于中期结构（趋势方向、关键位得失、量价配合）而非当日涨跌；当日波动本身不构成改变建议的理由。** 中期趋势向上时明确给出「继续持有、无需操作」的结论。
- longPlan（可选）：仅当 longAction 明确包含**具体数量与触发价位**时输出（减仓/清仓 side="sell"；跌破卖出 condition="lte"、反弹卖出 condition="gte"；加仓 side="buy"、condition="lte"）。无明确数量或价位时输出 null，严禁编造。卖出 qty 不得超过持仓数量；买入金额不得超过可用资金。
- signal 仍取五个标准标签；长期视角下通常为「多头持股」或「持股观望」，仅在趋势破坏时给出「逢高减仓」。

# 量化信号优先（硬约束）
当 User Message 包含「量化信号」时（来自用户自有量化系统的确定性规则，优先级高于你的技术判断）：
- 量化目标仓位是**最高优先级硬约束**：longAction 必须与目标方向一致，**严禁输出反向建议**（目标需减仓/清仓时不得建议持有或加仓；目标需加仓时不得建议减仓）。
- 目标仓位为 0%：必须明确建议**清仓/离场**（可给出执行价位与节奏），禁止「继续持有为主」或不足额减仓。
- 目标低于当前占比：建议**减仓至目标附近**；目标高于当前占比：建议**加仓至目标附近**；相差在 ±2 个百分点内：建议**维持持有**。
- longAction 以「量化目标 xx%」开头并给出对应动作（清仓/减至目标/加至目标/维持），随后给出执行价位（锚定 supportLevel/resistanceLevel）与离场条件。
- 可在 analysis/risk 中解释因子依据与背离风险，但**不得用技术观点推翻量化方向**。

JSON 格式：
{
  "signal": "4字标准标签",
  "analysis": "中期结构诊断（不超过50字）",
  "risk": "明确的趋势破坏风险预测（不超过50字）",
  "longAction": "中期趋势判断+持有/减仓动作+离场条件（不超过60字）",
  "longPlan": {"side":"sell","qty":1000,"triggerPrice":6.12,"condition":"lte"},
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
  totalPortfolioValue: number,
  availableCash: number | null,
  horizon: InvestmentHorizon,
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

  const open = snapshot.open;
  let msg = `${snapshot.name} ${snapshot.code} | ${typeLabel(snapshot.instrumentType)} | 对齐 ${alignedTime} | ${session}
快照: price=${snapshot.price}, changePct=${change}%, open=${open ?? 'null'}, high=${high}, low=${low}, volume=${volume}, prevClose=${prevClose}
日内: 振幅=${amplitude}, 位置=${positionInRange}%(0=最低,100=最高), 方向=${direction}
风格: ${STYLE_LABELS[investmentStyle] ?? '中立'}`;

  // v2.7.1: price history for trend analysis. v2.14.0: depth follows the
  // horizon — intraday tiers keep 7 days, long-term uses up to 20.
  const histDays = horizon === 'long' ? 20 : 7;
  const histText = formatHistoryText(snapshot.code, histDays);
  if (histText) {
    msg += `\n近${histDays}日收盘: ${histText}`;
  }

  // v2.15.0: 盘外参照（隔夜美股/美股板块风向/亚太实时）——仅当拉取到数据时注入。
  const externalText = getExternalContextText();
  if (externalText) {
    msg += `\n${externalText}`;
  }

  if (hasPosition(watchlistItem)) {
    const pnl = calcPnlPct(snapshot.price, watchlistItem.costPrice!);
    const pnlStr = pnl === null ? 'null' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`;
    const unit = watchlistItem.instrumentType === 'fund_etf' ? '份' : '股';
    // Absolute PnL and position weight.
    const absPnl = snapshot.price != null ? Math.round((snapshot.price - watchlistItem.costPrice!) * watchlistItem.positionQty!) : null;
    const positionValue = watchlistItem.positionQty! * watchlistItem.costPrice!;
    const weightPct = totalPortfolioValue > 0 ? Math.round((positionValue / totalPortfolioValue) * 100) : null;
    msg += `\n持仓: qty=${watchlistItem.positionQty}${unit}, cost=${roundCostPrice(watchlistItem.costPrice!)}, pnlPct=${pnlStr}%`;
    if (absPnl != null) msg += `, 浮动盈亏=${absPnl}元`;
    if (weightPct != null) msg += `, 占总仓位约${weightPct}%`;
    if (watchlistItem.actualPnl != null) msg += `, 已实现盈亏=${watchlistItem.actualPnl}元`;
    // v2.10: available cash bounds buy-side structured orders.
    if (availableCash != null) msg += `, 可用资金=${availableCash}元`;

    // v2.16.0: 长期档注入量化信号（QuantifySTAR50，硬约束锚点）。
    if (horizon === 'long') {
      const quant = getQuantSignalFor(snapshot.code);
      if (quant) {
        const weightFrac = totalPortfolioValue > 0 ? positionValue / totalPortfolioValue : 0;
        msg += `\n${formatQuantSignalBlock(quant, weightFrac)}`;
      }
    }
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

/**
 * Validate an LLM-emitted structured order. Invalid plans are dropped (return
 * null) WITHOUT failing the whole diagnosis — the text advice stays usable.
 */
function sanitizeActionPlan(
  raw: unknown,
  maxSellQty?: number,
): ActionPlan | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }
  const p = raw as Partial<ActionPlan>;
  const { side } = p;
  if (side !== 'sell' && side !== 'buy') {
    return null;
  }
  if (typeof p.qty !== 'number' || !Number.isInteger(p.qty) || p.qty <= 0) {
    return null;
  }
  if (
    typeof p.triggerPrice !== 'number' ||
    !Number.isFinite(p.triggerPrice) ||
    p.triggerPrice <= 0
  ) {
    return null;
  }
  const { condition } = p;
  const expected = side === 'sell' ? 'gte' : 'lte';
  if (condition !== expected) {
    return null;
  }
  if (side === 'sell' && maxSellQty != null && p.qty > maxSellQty) {
    return null;
  }
  return {
    side,
    qty: p.qty,
    triggerPrice: Math.round(p.triggerPrice * 1000) / 1000,
    condition,
  };
}

export async function runDiagnosis(
  snapshot: QuoteSnapshot,
  watchlistItem: WatchlistItem,
  config: AppConfig,
  alignedTime: string,
  session: SessionLabel,
  availableCash?: number | null,
): Promise<{ ok: true; data: DiagnosisResult } | { ok: false; raw: string }> {
  const withPosition = hasPosition(watchlistItem);
  const base = config.baseUrl.replace(/\/$/, '');
  const style = config.investmentStyle ?? 'neutral';
  const styleLabel = STYLE_LABELS[style] ?? '中立';
  // v2.14.0: investment horizon drives the with-position advice contract.
  const horizon: InvestmentHorizon = config.investmentHorizon ?? 'short';

  // Total portfolio: user-specified overrides computed.
  const totalPortfolioValue = config.totalCapital ?? config.watchlist.reduce((sum, w) => {
    if (hasPosition(w)) return sum + w.positionQty! * w.costPrice!;
    return sum;
  }, 0);

  // Inject style label into the system prompt template. With a position the
  // horizon picks the contract: short (both actions) / swing (band required,
  // short optional) / long (longAction only).
  const withPositionPrompt =
    horizon === 'long'
      ? SYSTEM_PROMPT_LONG_POSITION
      : horizon === 'swing'
        ? SYSTEM_PROMPT_SWING_POSITION
        : SYSTEM_PROMPT_WITH_POSITION;
  const systemContent = (withPosition ? withPositionPrompt : SYSTEM_PROMPT_BASE).replace(
    '{styleLabel}',
    styleLabel,
  );

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: buildUserMessage(snapshot, watchlistItem, alignedTime, session, style, totalPortfolioValue, availableCash ?? null, horizon),
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
    // v2.16.1: 量化目标优先——预先判定是否绑定（目标与当前仓位存在实质差异）。
    const quantSignal =
      withPosition && horizon === 'long' ? getQuantSignalFor(snapshot.code) : null;
    const quantPositionValue = hasPosition(watchlistItem)
      ? watchlistItem.positionQty! * watchlistItem.costPrice!
      : 0;
    const quantWeight =
      totalPortfolioValue > 0 ? quantPositionValue / totalPortfolioValue : 0;
    const quantDir = quantSignal
      ? quantRequiredDirection(quantSignal.target_weight, quantWeight)
      : 'hold';
    const quantBinding = quantSignal != null && quantDir !== 'hold';
    if (withPosition) {
      if (horizon === 'long') {
        if (quantBinding) {
          // 绑定量化时行动句由码生成替换，AI 文本只需存在（供 analysis/risk 解释）。
          if (!parsed.longAction) {
            return { ok: false, raw };
          }
        } else if (
          !parsed.longAction ||
          parsed.longAction.length > 60 ||
          !anchorsToKeyLevel(parsed.longAction, parsed.supportLevel, parsed.resistanceLevel)
        ) {
          return { ok: false, raw };
        }
      } else {
        if (horizon === 'short') {
          if (!parsed.shortAction || parsed.shortAction.length > 40) {
            return { ok: false, raw };
          }
        } else if (
          parsed.shortAction != null &&
          parsed.shortAction !== '' &&
          parsed.shortAction.length > 40
        ) {
          return { ok: false, raw };
        }
        if (
          !parsed.bandAction ||
          parsed.bandAction.length > 40 ||
          !anchorsToKeyLevel(parsed.bandAction, parsed.supportLevel, parsed.resistanceLevel)
        ) {
          return { ok: false, raw };
        }
      }
    } else {
      if (
        !parsed.buildPositionAdvice ||
        parsed.buildPositionAdvice.length > 40 ||
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
    // v2.10: sanitize structured orders. Invalid plans are silently dropped —
    // they never fail the diagnosis, the text advice remains.
    if (withPosition) {
      if (horizon === 'long') {
        parsed.longPlan = sanitizeActionPlan(parsed.longPlan, watchlistItem.positionQty);
      } else {
        parsed.shortPlan = sanitizeActionPlan(parsed.shortPlan, watchlistItem.positionQty);
        parsed.bandPlan = sanitizeActionPlan(parsed.bandPlan, watchlistItem.positionQty);
      }
    } else {
      parsed.buildPlan = sanitizeActionPlan(parsed.buildPlan);
    }
    // v2.16.1: 量化目标优先（强硬版）——目标与当前存在实质差异时，行动句
    // 一律由码生成（AI 的不足额/条件化叙事不再进入行动行，只保留 analysis/risk
    // 解释），方向不符的 longPlan 丢弃。
    if (quantSignal && quantBinding) {
      const resolved = resolveQuantAdvice(
        parsed.longAction!,
        parsed.longPlan ?? null,
        quantSignal,
        quantWeight,
        { support: parsed.supportLevel, resistance: parsed.resistanceLevel },
      );
      parsed.longAction = resolved.longAction;
      parsed.longPlan = resolved.longPlan;
    }
    // v2.12.4: 剥离另一持仓模式混入的建议字段，保证展示/缓存数据确定性。
    return { ok: true, data: normalizeDiagnosisByPosition(parsed, withPosition, horizon) };
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
