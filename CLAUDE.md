# AguMaster — Project Context

## Versioning (SemVer)

本项目遵循语义化版本号：`主版本.次版本.修订版本`

| 变更类型 | 版本位 | 示例 |
|---|---|---|
| 重大产品重构 / 架构变更 | 第一位 +1 | 3.0.0 |
| 新增功能 / PRD 变更（如新增字段、新增输出路径） | 第二位 +1 | 2.7.0 |
| Bug 修复 / UI 微调 / 无新增功能的改动 | 第三位 +1 | 2.6.1 |

**规则：每次代码调整后，必须同步更新以下文档和版本号：**
- `desktop/package.json` + `package-lock.json`（版本号）
- `web/package.json` + `package-lock.json`（版本号）
- `web/src/constants/app.ts`（APP_VERSION）
- `Product-Spec.md`（文档版本 + 功能状态）
- `Product-Spec-CHANGELOG.md`（变更条目）
- `README.md`（用户可见功能说明）
- Bug 修复 → 第三位 +1；新增功能 → 第二位 +1

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Code audit / dead-code removal → invoke /dev-builder with audit context
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

## Tech stack

Vue 3 · TypeScript · Vite · Electron 33（Win11 桌面）· JSONP 行情 · OpenAI 兼容 API
