# 产品变更记录 (Changelog)

本文档记录产品需求文档的所有变更历史，遵循语义化版本规范（Semantic Versioning）。

---

## 2.8.0 - 2026-07-01

### 变更类型：新增（次版本）

### 新增功能
- **组合汇总与追踪池**：Portfolio / PortfolioAssignment 类型；侧边栏组合列表（新建/重命名/删除/排序）；主面板组合卡片（加权涨跌/TOP3/折叠详情）；组合内添加证券（代码+权重，支持 A 股+港股）；权重行内编辑+保存；每行 × 删除
- **港股代码支持**：Market 新增 `'hk'`，识别 5 位代码（`hk00700` / `00700`）
- **WatchlistItem.trackingOnly**：追踪证券不显示在诊断池/未分组
- **组合/分组排序**：↑↓ 箭头调整顺序
- **关于页面**：侧边栏底部入口，显示版本号+更新日志

### 修改功能
- 组合刷新跟随配置频率自动执行
- 刷新开关关闭时全局刷新跳过该卡片
- 启动时自动全局刷新

---

## 2.7.0 - 2026-07-01

### 变更类型：新增（次版本）

### 新增功能
- **全局投资风格**（AppConfig.investmentStyle）：激进/中立/保守，三档减仓阈值（8%/5%/3%），注入 System Prompt
- **前瞻性分析**：Prompt 新增 Forward-Looking Analysis 段；User Message 注入日内振幅/高低位置/涨跌方向
- **7 日价格走势**：priceHistory.ts 自动记录每日收盘价 → User Message 注入「近7日收盘」→ Prompt 要求 3-5 日波段预判
- **Signal 词库 5 档**：新增「持股观望」，ShortAction Prompt 加盈亏阈值（pnlPct<2% 禁止减仓）

### 修改功能
- 功能 4：Prompt 重构（Investment Style + Forward-Looking + 7 日走势）
- 功能 1：AppConfig 新增 investmentStyle

---

## 2.6.0 - 2026-06-17

### 变更类型：新增/修改（次版本）

### 新增功能
- **建仓建议**（buildPositionAdvice）：推翻 v2.5 无持仓波段逻辑——无持仓=观望状态，输出建仓建议（锚定关键位）；有持仓=短期+波段建议
- **卡片添加持仓入口**：无持仓卡片显示「+ 添加持仓」按钮
- **超频刷新条件收紧**：需同时配置持仓成本+关键位

### 修改功能
- DiagnosisResult：action→shortAction 重命名；bandAction 改为仅持仓时必填；新增 buildPositionAdvice
- 超频刷新：从 Toast 阻断改为跳挡（未配持仓/关键位时模式列表排除 overclock）
- 持仓输入框 placeholder 中文化

---

## 2.5.0 - 2026-06-17

### 变更类型：新增（次版本）

### 新增功能
- **波段建议**（bandAction）：DiagnosisResult 新增 bandAction 字段（≤30 字，数日级别波段建议）
- **ShortAction**：原 action 重命名为 shortAction，结合 pnlPct+signal 给出短期持仓动作

### 修改功能
- 功能 4 输出契约：单 action → shortAction + bandAction（持仓时）/ buildPositionAdvice（无持仓时）

---

## 2.4.0 - 2026-06-16

### 变更类型：新增/重构（次版本）

### 新增功能
- **自定义分组系统**：UserGroup 类型；左侧可折叠侧边栏；新建/重命名/删除分组；分组排序；主页按分组归类
- **三态刷新开关**：off / normal / overclock；超频 30s 高频监控+关键位预警
- **操作建议**：action 字段（≤30 字），有持仓时 LLM 输出可执行持仓建议

---

**文档版本**：2.8.0
**最后更新**：2026-07-01
