<script setup lang="ts">
import { APP_NAME, APP_VERSION } from '../constants/app';
import { useI18n } from '../i18n';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const changelog = [
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
