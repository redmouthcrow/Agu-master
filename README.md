# AguMaster — A 股 AI 实时诊断工具

在交易时段按所选档位自动拉取自选行情，调用大模型生成短线诊断与支撑/压力位，价格突破关键位时桌面弹窗提醒。

## 桌面版（推荐，Win11）

功能最完整：完整看板 + 悬浮窗 + 分组侧边栏 + 桌面通知预警。

### 快速启动

```bat
start-desktop.bat
```

首次自动安装依赖，后台启动 Vite，打开 Electron（完整看板 + 悬浮窗）。

### 打包安装包

```bat
build-installer.bat
```

输出 `desktop/release/staging/AguMaster-{version}-win-x64-setup.exe`，含 Electron 运行时与前端静态资源，目标电脑无需 Node.js。安装后配置保存在 `%APPDATA%/AguMaster/agu/`。

### 主要操作

| 操作 | 说明 |
|------|------|
| 添加自选 | 展开配置 → 输入代码（如 `600519`）→ 添加 |
| 自动刷新 | 选择刷新档位（5/15/30/60 分钟），交易时段自动对齐触发 |
| 手动刷新 | 点击「立即刷新」，全池 20 只同时拉行情 + AI 诊断 |
| 悬浮窗 | 配置区勾选 1–5 只钉选到桌面半透明小窗 |
| 分组管理 | 左侧侧边栏 → `+ 新建分组`，可重命名/删除；卡片下拉框选择归属分组 |
| 刷新模式 | 每张卡片的 ◌/⚡/⚡⚡ 按钮切换：关闭 / 正常 / 超频 |
| 超频刷新 | ⚡⚡ 模式——交易时段内每 30s 拉行情 + 关键位预警，上限 5 只，需先配置关键位 |
| 关键位 | AI 自动给出支撑/压力位，也可手动添加自定义警戒价（卡片上 `+` 按钮） |
| 桌面通知 | 配置区可开关：价格突破 / 高风险信号 / API 异常 / 行情异常 |
| 导出备份 | 配置区「导出用户数据备份」 |

### 配置面板

点击「展开配置」可设置：

- **API 连接**：Base URL、API Key、模型名称
- **刷新档位**：下拉选择 5 / 15 / 30 / 60 分钟
- **桌面悬浮窗**：勾选钉选证券、调整透明度、始终置顶
- **桌面通知预警**：独立开关各种通知类型

## H5 版（浏览器）

```bat
start.bat
```

启动后访问 `http://localhost:5180`，手机/平板/桌面浏览器均可使用。功能为桌面版子集（无悬浮窗、无桌面通知）。

## 个人配置

完整配置可通过两种方式修改：

### 方式一：编辑 JSON 文件（推荐）

编辑 `web/agu.config.local.json`（已加入 `.gitignore`）：

```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "sk-your-api-key-here",
  "model": "deepseek-chat",
  "refreshFrequency": 30,
  "watchlist": [
    { "code": "sh600519", "name": "贵州茅台", "market": "sh", "instrumentType": "stock" },
    { "code": "sh510500", "name": "中证500ETF", "market": "sh", "instrumentType": "fund_etf" }
  ],
  "widgetPinnedCodes": ["sh510500"],
  "groups": [
    { "id": "group_1", "name": "短线", "order": 0, "collapsed": false }
  ]
}
```

- 也可使用 `watchlistCodes` 简写（仅代码数组），详见 `web/agu.config.example.json`
- 修改后需**重启**生效

### 方式二：界面配置

在页面「展开配置」中填写 API Key、添加自选、创建分组，配置保存在本地存储，桌面版同步写入本地文件。

## 环境要求

- **Windows 11**（桌面版） / 任意现代浏览器（H5 版）
- **Node.js 18+**（一键脚本可自动安装）

## 项目结构

```
Agu-master/
├── start.bat                 # H5 一键启动
├── start-desktop.bat         # 桌面版一键启动
├── build-installer.bat       # 打包 Windows 安装包
├── Product-Spec.md           # 产品需求文档
├── UI-Spec.md                # UI 规范
├── desktop/                  # Electron 壳
│   └── src/                  # 主进程 / IPC / 持久化
└── web/                      # Vue 3 前端
    ├── agu.config.local.json # 个人配置（本地）
    └── src/                  # 组件 / 服务 / 工具
```

## 技术栈

Vue 3 · TypeScript · Vite · Electron 28+（Win11 桌面）· JSONP 行情 · OpenAI 兼容 API

## 免责声明

仅供个人学习与研究，**不构成投资建议**。
