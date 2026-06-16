# AguMaster — A 股 AI 实时诊断工具（H5 + 桌面）

纯前端 Vue 看板：在交易时段按用户所选 **对齐刷新档位**（5 / 15 / 30 / 60 分钟）拉取自选 **A 股与场内 ETF/LOF** 实时行情，调用自备大模型 API Key 生成短线技术面诊断与支撑/压力位。

- **零后端**：配置与诊断缓存保存在本地，无需部署服务器
- **统一自选**：最多 20 只（股票 + 场内 ETF/LOF 混排）
- **多端可用**：手机竖屏 / 桌面浏览器 / **Win11 Electron 桌面版（完整看板 + 悬浮窗）**
- **分组侧边栏**：可创建/重命名/删除自定义分组，主页按分组归类展示，点击标题折叠
- **三态刷新**：每只证券独立的 ◌ 关闭 / ⚡ 正常 / ⚡⚡ 超频 30s 开关

详细需求见 [Product-Spec.md](./Product-Spec.md)，UI 规范见 [UI-Spec.md](./UI-Spec.md)。

## 主要能力

| 能力 | 说明 |
|------|------|
| 实时行情 | 腾讯 JSONP 主源，新浪备源；每批最多 5 只，20 只分 4 批串行；卡片现价 **3 位小数** |
| AI 诊断 | OpenAI 兼容接口（如 DeepSeek）；休市时快照不变则沿用缓存；解析失败自动重试直至成功；**AI 自动输出支撑/压力位** |
| 自定义分组 | 左侧可折叠侧边栏，新建/重命名/删除分组，主页按分组归类，拖拽卡片入组 |
| 刷新控制 | 三态开关：◌ 关闭 / ⚡ 正常（参与主调度）/ ⚡⚡ 超频（主调度 + 30s 高频价格监控，上限 5 只） |
| 桌面通知预警 | **仅 Electron**：价格突破关键位弹窗、高风险 signal 弹窗、API/行情异常通知 |
| 交易日历 | 自动同步法定节假日与调休，非交易日不触发自动刷新 |
| 本地配置 | API Key、自选列表、分组可写入 `web/agu.config.local.json`（不进 Git）；持仓成本 **3 位小数** |
| 国际化 | 界面文案跟随系统语言（`zh*` → 简体中文，否则 English） |

## 桌面悬浮窗（Win11 / v2.4.0+）

- 钉选 **1–5 只**，展示与完整看板相同的标准诊断卡片；自动刷新仍针对全池最多 20 只
- 无边框半透明、始终置顶（可调）、系统托盘、窗口透明度可调
- AI 自动关键位（支撑/压力位）+ 价格突破弹窗 + 高风险 signal 预警

```bat
start-desktop.bat
```

首次会安装 `web/` 与 `desktop/` 依赖，后台启动 Vite，再打开 Electron（完整看板 + 悬浮窗）。

在完整看板「展开配置 → 桌面悬浮窗」中勾选钉选证券。

**打包 Windows 安装包**（仅需在开发机执行，目标电脑不需要 Node.js）：

```bat
build-installer.bat
```

输出：`desktop/release/staging/AguMaster-{version}-win-x64-setup.exe` — NSIS 安装向导，含 Electron 运行时与前端静态资源。

便携版（免安装单文件 exe）：

```bat
cd desktop
npm run pack:portable
```

**桌面版配置存储**（不打入安装包）：

- 路径：`%APPDATA%/AguMaster/agu/`（Electron `userData/agu/`）
- 文件：`config.json`（API Key 在系统支持时用 OS 密钥链加密）、`diagnosis-cache.json`、`live-sync.json`、`calendars/calendar-{year}.json`
- 配置面板可「导出用户数据备份」到 `文档/AguMaster-backup/`

## 环境要求

- **Windows 11**（桌面版推荐）/ 任意现代浏览器（H5 版）
- **Node.js 18+** 与 **npm**（一键脚本可尝试通过 winget 自动安装）

## 快速启动

### H5 版

在项目根目录双击或执行：

```bat
start.bat
```

脚本自动检查环境、安装依赖、启动开发服务，默认地址：**http://localhost:5180**

### 桌面版

```bat
start-desktop.bat
```

## 个人配置

编辑 `web/agu.config.local.json`（已加入 `.gitignore`）：

```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "sk-your-api-key-here",
  "model": "deepseek-chat",
  "watchlist": [
    { "code": "sh600519", "name": "贵州茅台", "market": "sh", "instrumentType": "stock" },
    { "code": "sh510500", "name": "中证500ETF", "market": "sh", "instrumentType": "fund_etf" }
  ],
  "groups": [
    { "id": "group_1", "name": "短线", "order": 0, "collapsed": false }
  ]
}
```

- 也可使用 `watchlistCodes` 简化格式（仅代码数组），详见 `web/agu.config.example.json`
- 存在本地配置文件时以文件为准；修改后需重启开发服务生效
- 未创建本地文件时可在页面「展开配置」里填写配置

## 手动启动

```bat
cd web
npm install
npm run dev
```

其他命令：

```bat
npm run build    # 生产构建
npm run preview  # 预览构建结果
```

## 项目结构

```
Agu-master/
├── start.bat                   # H5 一键启动
├── start-desktop.bat           # Win11 Electron 桌面版
├── build-installer.bat         # Windows NSIS 安装包构建
├── Product-Spec.md             # 产品需求文档
├── Product-Spec-CHANGELOG.md   # 需求变更记录
├── UI-Spec.md                  # UI 规范
├── README.md
├── desktop/                    # Electron 壳（Win11）
│   └── src/
│       ├── main.ts             # 主进程（窗口管理、IPC、系统托盘、弹窗）
│       ├── preload.ts          # 预加载桥接
│       └── userDataStore.ts    # 持久化存储（JSON 文件读写）
└── web/                        # Vue 3 + Vite 前端
    ├── agu.config.example.json
    ├── agu.config.local.json   # 个人配置（本地，勿提交）
    └── src/
        ├── components/         # Sidebar / ConfigPanel / StockCard / ToastContainer
        ├── composables/        # useAppState（核心状态与刷新流水线）
        ├── services/           # 行情 / LLM / 交易日历 / 调度 / 预警 / 持久化
        ├── utils/              # 关键位管理 / 穿透判定 / 工具函数
        ├── i18n/               # 中英文国际化
        ├── types/              # TypeScript 类型定义
        └── styles/             # 全局 CSS
```

## 使用提示

1. 先配置 API Key 与自选代码，再点「立即刷新」（全池）
2. 交易时段内按所选档位对齐自动刷新；单卡 ↻ 仅刷新该证券
3. 左侧侧边栏可新建分组管理自选；每张卡片上通过 ◌/⚡/⚡⚡ 控制刷新模式
4. ⚡⚡ 超频模式需先配置 AI 关键位，交易时段内每 30s 拉行情 + 预警，上限 5 只
5. 未配置 API Key 时仍可看行情与历史诊断，但不会调用 AI
6. 仅供个人学习与研究，**不构成投资建议**

## 技术栈

Vue 3 · TypeScript · Vite · Electron 28+（Win11 桌面）· 纯前端 JSONP 行情 · OpenAI 兼容 LLM API
