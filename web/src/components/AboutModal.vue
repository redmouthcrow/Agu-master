<script setup lang="ts">
import { APP_NAME, APP_VERSION } from '../constants/app';
import { useI18n } from '../i18n';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const changelog = [
  { ver: '2.14.2', date: '2026-10-14', items: [
    '修复：悬浮窗卡片不显示长期建议（周期配置未同步到悬浮窗）',
    '建议行改为数据驱动渲染：只要有建议就一定显示，周期只决定优先显示哪一类',
  ]},
  { ver: '2.14.1', date: '2026-10-14', items: [
    '修复：切换投资周期后立即重新诊断（此前休市/行情未变时会沿用旧周期缓存，长期模式看不到建议）',
  ]},
  { ver: '2.14.0', date: '2026-10-14', items: [
    '新增「投资周期」配置：短线 / 波段 / 长期（与投资风格独立）',
    '长期模式：只看「长期策略」一行——中期趋势判断 + 持有/减仓动作 + 离场条件，看涨不因日内波动改口（跨日稳定）',
    '长期判断注入近 20 日历史；采纳弹窗新增 1/3、1/2、全部比例快捷按钮',
  ]},
  { ver: '2.13.1', date: '2026-10-14', items: [
    '修复：「已挂单」标记已成交后不再残留；建议变化后重新给出采纳/不采纳',
    '「已挂单」标记现在显示订单明细（如 卖出800@1.461），点击可撤销',
    '同一建议再次采纳自动替换原挂单，不再提示「已有挂单」',
  ]},
  { ver: '2.13.0', date: '2026-10-14', items: [
    '半自动采纳：点「采纳」打开弹窗，AI 只给价位与方向，数量由你填写',
    'AI 未给数量的纯文本建议也能采纳挂单，进入绩效统计',
    '弹窗实时校验：卖出不超持仓、买入不超可用资金',
  ]},
  { ver: '2.12.4', date: '2026-10-14', items: [
    '修复：有持仓时卡片只显示建仓建议——AI 混出空仓建仓字段遮挡波段/短期建议，现按持仓模式强制只展示对应建议',
  ]},
  { ver: '2.12.3', date: '2026-10-14', items: [
    '波段建议日内冻结：每天只更新一次（锚定关键位未变时盘中沿用），不再随每次刷新漂移',
    '支撑/阻力位偏离超过 0.5% 时允许盘中替换波段建议',
  ]},
  { ver: '2.12.2', date: '2026-10-14', items: [
    '修复：更新日志补全——补入 2.11.0 / 2.12.0 / 2.12.1 版本条目',
    '新增发布规则：版本变更必须同步本更新日志',
  ]},
  { ver: '2.12.1', date: '2026-10-13', items: [
    '绩效面板空态修正：净值曲线按快照数提示「需累积 2 天」/「暂无净值数据」',
    '无持仓时不写入空净值快照',
  ]},
  { ver: '2.12.0', date: '2026-10-13', items: [
    '绩效闭环：净值曲线（对比沪深300）+ 总收益/胜率/最大回撤/盈亏比 + 建议归因表',
    'A股成本模型：佣金 + 印花税（ETF 免）+ 过户费计入模拟成交',
    '每日净值快照：首个快照为收益基线，手工录入持仓不虚增收益',
    '引入自动化单测（20 例）',
  ]},
  { ver: '2.11.0', date: '2026-10-13', items: [
    'AI 盈亏目标策略：亏损→回本/止损建议，盈利→扩利/锁盈建议（结合投资风格）',
    '已实现盈亏与总仓位金额录入，AI 建议参考浮盈金额与仓位占比',
    '悬浮窗数据同步修复：持仓/诊断不再回退或丢失',
  ]},
  { ver: '2.10.1', date: '2026-09-11', items: [
    '卡片「已挂单」可点击撤销（取消采纳入口）',
    '挂单仅当日有效：跨自然日自动撤销，重新开盘不继承前一日挂单',
  ]},
  { ver: '2.10.0', date: '2026-09-11', items: [
    'AI 建议采纳：结构化操作指令（短期/波段/建仓建议行「采纳/不采纳」按钮）',
    '模拟自动成交：价格触发后按触发价自动记账，持仓/成本/已实现盈亏/可用资金联动',
    '模拟账户：初始资金、待触发订单（可撤销）、成交流水',
    '桌面成交通知弹窗',
  ]},
  { ver: '2.9.0', date: '2026-09-11', items: [
    '已实现盈亏录入（卡片持仓行 + 编辑面板）',
    '总资金录入（配置面板），卡片展示仓位权重',
  ]},
  { ver: '2.8.0', date: '2026-07-01', items: [
    '组合追踪：侧边栏组合列表、组合卡片、加权涨跌、权重编辑、排序',
    '港股代码支持（hk00700 / 00700）',
    '组合/分组排序（↑↓箭头）',
    '关于页面（版本号+更新日志）',
  ]},
  { ver: '2.7.0', date: '2026-07-01', items: [
    '全局投资风格（激进/中立/保守），三档减仓阈值→AI自适应',
    '前瞻性分析：日内振幅/位置/方向 → 3-5 日波段预判',
    '7 日价格走势自动记录，注入 AI Prompt',
  ]},
  { ver: '2.6.0', date: '2026-06-17', items: [
    '建仓建议（无持仓→锚定关键位的建仓方向+价位）',
    '短期+波段建议（有持仓）',
    '持仓入口（卡片上直接添加持仓成本）',
  ]},
];
</script>

<template>
  <div class="about-overlay" @click.self="emit('close')">
    <div class="about-modal">
      <div class="about-header">
        <h2>{{ APP_NAME }}</h2>
        <span class="about-version">v{{ APP_VERSION }}</span>
        <button class="btn-close" @click="emit('close')">×</button>
      </div>
      <div class="about-body">
        <p class="about-tagline">{{ t('app.tagline') }}</p>
        <p class="about-disclaimer">{{ t('card.footerDisclaimer') }}</p>
        <h3>更新日志</h3>
        <div v-for="entry in changelog" :key="entry.ver" class="cl-entry">
          <div class="cl-header">
            <strong>v{{ entry.ver }}</strong>
            <span class="cl-date">{{ entry.date }}</span>
          </div>
          <ul class="cl-items">
            <li v-for="(item, i) in entry.items" :key="i">{{ item }}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.about-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.about-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.about-header h2 { font-size: 18px; margin: 0; }
.about-version { color: var(--text-muted); font-size: 13px; }
.btn-close { margin-left: auto; background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.about-body { padding: 12px 20px 20px; }
.about-tagline { color: var(--text); margin-bottom: 4px; }
.about-disclaimer { color: var(--text-muted); font-size: 11px; margin-bottom: 16px; }
.about-body h3 { font-size: 15px; margin: 12px 0 8px; border-top: 1px solid var(--border); padding-top: 10px; }
.cl-entry { margin-bottom: 10px; }
.cl-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.cl-date { color: var(--text-dim); font-size: 11px; }
.cl-items { margin: 0; padding-left: 18px; }
.cl-items li { font-size: 12px; color: var(--text-muted); padding: 1px 0; }
</style>
