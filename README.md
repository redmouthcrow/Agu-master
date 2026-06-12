# AguMaster — A 股 AI 实时诊断 H5 工具

纯前端 Vue 看板：在交易时段按 **30 分钟网格**（对齐交易所时钟）拉取自选 **A 股与场内 ETF/LOF** 实时行情，并用你自备的大模型 API Key 生成短线技术面诊断。

- **零后端**：配置与诊断缓存保存在本地，无需部署服务器
- **分池自选**：股票最多 5 只 + 场内基金最多 5 只（合计 10 只）
- **多端可用**：手机竖屏 / 桌面浏览器 / **Win11 半透明悬浮窗（Electron）**

详细需求见 [Product-Spec.md](./Product-Spec.md)，UI 规范见 [UI-Spec.md](./UI-Spec.md)。

## 桌面悬浮窗（Win11 / v2.1.2+）

- 钉选 **1–4 只**，展示与完整看板 **相同的标准诊断卡片**；**自动刷新仍针对全池最多 10 只**；卡片 ↻ **仅刷新当前证券**
- 无边框半透明、始终置顶（可调）、系统托盘

```bat
start-desktop.bat
```

首次会安装 `web/` 与 `desktop/` 依赖，后台启动 Vite，再打开 Electron（完整看板 + 悬浮窗）。

在完整看板「展开配置 → 桌面悬浮窗」中勾选钉选证券。

**打包 Windows 安装包**（仅需在**开发机**执行一次，目标电脑**不需要** Node.js）：

```bat
build-installer.bat
```

或手动：

```bat
cd desktop
npm install
npm run pack
```

输出：`desktop/release/staging/AguMaster-{version}-win-x64-setup.exe` — NSIS 安装向导，含 Electron 运行时与前端静态资源。新装机双击安装即可使用；首次使用需自行配置 API Key 与自选（保存在 `%APPDATA%/AguMaster/agu/`，不打进安装包）。

便携版（免安装单文件 exe，可选）：

```bat
cd desktop
npm run pack:portable
```

**桌面版配置存储**（不会打入安装包）：

- 路径：`%APPDATA%/AguMaster/agu/`（Electron `userData/agu/`）
- 文件：`config.json`（API Key 在系统支持时用 OS 密钥链加密）、`diagnosis-cache.json`、`live-sync.json`、`calendars/calendar-{year}.json`
- 首次启动会自动从 Chromium `localStorage` 迁移一次
- 配置面板可「导出用户数据备份」到 `文档/AguMaster-backup/`

## 主要能力

| 能力 | 说明 |
|------|------|
| 实时行情 | 腾讯 JSONP 主源，新浪备源；每批最多 5 只，10 只分 2 批拉取；卡片现价 **3 位小数** |
| AI 诊断 | OpenAI 兼容接口（如 DeepSeek）；休市时快照不变则沿用缓存结论；**解析失败自动重试**直至成功 |
| 交易日历 | 自动同步节假日，非交易日不触发自动刷新 |
| 本地配置 | API Key、自选列表可写入 `web/agu.config.local.json`（不进 Git）；持仓成本 **3 位小数** |

## 环境要求

- **Windows**（推荐用一键脚本 `start.bat`）
- **Node.js 18+** 与 **npm**（脚本可尝试通过 winget 自动安装 Node.js LTS）

## 快速启动（推荐）

在项目根目录双击或执行：

```bat
start.bat
```

脚本会自动：

1. 检查 Node.js / npm（缺失时尝试 winget 安装）
2. 安装 `web/` 依赖（首次或 lockfile 变化时）
3. 若缺少个人配置，从 `agu.config.example.json` 复制生成 `agu.config.local.json`
4. 启动开发服务，默认地址：**http://localhost:5180**

强制重新检查环境：

```bat
start.bat --recheck
```

## 个人配置

编辑 `web/agu.config.local.json`（该文件已加入 `.gitignore`，不会上传 Git）：

```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "sk-your-api-key-here",
  "model": "deepseek-chat",
  "watchlistCodes": ["600519", "510500", "159915"]
}
```

- 也可使用完整 `watchlist` 对象，详见 `web/agu.config.example.json`
- 存在本地配置文件时，**以文件为准**；修改后需**重启开发服务**生效
- 未创建本地文件时，可在页面「展开配置」里填写，数据保存在浏览器 LocalStorage

## 手动启动

```bat
cd web
npm install
npm run dev
```

其他命令：

```bat
npm run build    # 生产构建
npm run preview  # 预览构建结果（需本地配置文件仍放在 web/ 目录）
```

## 项目结构

```
Agu-master/
├── start.bat                 # H5 一键启动
├── start-desktop.bat         # Win11 Electron 桌面版
├── build-installer.bat       # Windows NSIS 安装包构建
├── Product-Spec.md           # 产品需求文档
├── UI-Spec.md                # UI 规范
├── desktop/                  # Electron 壳（Win11）
└── web/                      # Vue 3 + Vite 前端
    ├── agu.config.example.json
    ├── agu.config.local.json # 个人配置（本地，勿提交）
    └── src/
        ├── components/       # 配置面板、证券卡片等
        ├── composables/      # 应用状态与刷新流水线
        └── services/         # 行情、LLM、交易日历、调度
```

## 使用提示

1. 先配置 API Key 与自选代码，再点击「立即刷新」（全池）
2. 交易时段内会自动按所选档位对齐刷新全池；单张卡片 ↻ 仅刷新该证券
3. 未配置 API Key 时仍可看行情与历史诊断，但不会调用 AI
4. 仅供个人学习与研究，**不构成投资建议**

## 技术栈

Vue 3 · TypeScript · Vite · Electron（Win11 桌面）· 纯前端 JSONP 行情 · OpenAI 兼容 LLM API
