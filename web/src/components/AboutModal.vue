<script setup lang="ts">
import { APP_NAME, APP_VERSION } from '../constants/app';
import { useI18n } from '../i18n';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const changelog = [
  { ver: '2.8.0', date: '2026-07-01', items: [
    '新增组合追踪（Portfolio）：侧边栏组合列表、组合卡片、加权涨跌、权重编辑',
    '港股代码支持（hk00700 / 00700）',
    '组合/分组排序（↑↓箭头）',
    '刷新开关关闭时全局刷新跳过该卡片',
    '启动自动全局刷新',
  ]},
  { ver: '2.7.0', date: '2026-07-01', items: [
    '新增全局投资风格（激进/中立/保守），影响 AI 减仓阈值与建议倾向',
    '前瞻性分析：日内振幅、高低位置、涨跌方向 → 3-5 日波段预判',
    '7 日价格走势自动记录，注入 AI Prompt',
  ]},
  { ver: '2.6.0', date: '2026-06-17', items: [
    '推翻无持仓波段逻辑：无持仓→建仓建议，有持仓→短期+波段建议',
    'Signal 词库 4→5 档（新增持股观望）',
    'ShortAction Prompt 加盈亏阈值约束',
  ]},
  { ver: '2.5.0', date: '2026-06-17', items: [
    'action→shortAction 重命名，新增 bandAction（波段建议）',
    '卡片添加持仓入口（+ 添加持仓按钮）',
    '超频刷新条件收紧（需持仓+关键位）',
  ]},
  { ver: '2.4.0', date: '2026-06-16', items: [
    '左侧可折叠分组侧边栏',
    '三态刷新开关（关闭/正常/超频 30s）',
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
