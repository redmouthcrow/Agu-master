<script setup lang="ts">
import { computed } from 'vue';
import type { StockCardState } from '../types';
import { formatPct, formatPrice, getSignalTone } from '../utils/display';

const props = defineProps<{
  card: StockCardState;
}>();

const emit = defineEmits<{
  remove: [code: string];
}>();

const signalText = computed(() => {
  if (props.card.quoteError) {
    return '—';
  }
  if (props.card.aiError) {
    return '诊断失败';
  }
  if (props.card.parseError) {
    return '解析失败';
  }
  return props.card.diagnosis?.signal ?? '等待首次诊断…';
});

const signalTone = computed(() =>
  getSignalTone(
    props.card.diagnosis?.signal ?? '',
    props.card.parseError || !!props.card.aiError || !props.card.diagnosis,
  ),
);

const pctClass = computed(() => {
  const n = props.card.snapshot?.changePct;
  if (n === null || n === undefined) {
    return 'flat';
  }
  if (n > 0) {
    return 'up';
  }
  if (n < 0) {
    return 'down';
  }
  return 'flat';
});
</script>

<template>
  <article class="stock-card">
    <div class="card-inner">
      <header class="card-header">
        <div class="title-block">
          <h2 class="stock-name">{{ card.stock.name }}</h2>
          <span class="stock-code">{{ card.stock.code }}</span>
        </div>
        <div class="price-block">
          <div class="price tabular">{{ formatPrice(card.snapshot?.price) }}</div>
          <div class="pct tabular" :class="pctClass">
            {{ formatPct(card.snapshot?.changePct) }}
          </div>
        </div>
        <button
          type="button"
          class="btn-remove"
          aria-label="删除自选"
          @click="emit('remove', card.stock.code)"
        >
          ×
        </button>
      </header>

      <div class="signal-bar" :class="`tone-${signalTone}`">
        {{ signalText }}
      </div>

      <div class="card-content">
        <template v-if="card.quoteError">
          <p class="muted">行情获取失败</p>
        </template>
        <template v-else-if="card.parseError">
          <p><span class="tag">[Raw]</span> {{ card.rawAiText }}</p>
        </template>
        <template v-else-if="card.diagnosis">
          <p class="line-clamp">
            <span class="tag">[形态]</span> {{ card.diagnosis.analysis }}
          </p>
          <p class="line-clamp risk-text">
            <span class="tag">[风险]</span> {{ card.diagnosis.risk }}
          </p>
        </template>
        <template v-else>
          <p class="muted">等待首次诊断…</p>
        </template>
      </div>

      <footer class="card-footer">
        <span>合规声明：AI生成不构成投资建议</span>
        <span v-if="card.updatedAt">
          {{
            card.diagnosisReused
              ? `行情未变·沿用 ${card.updatedAt}`
              : `更新于 ${card.updatedAt}`
          }}
        </span>
      </footer>

      <div v-if="card.loading" class="card-overlay">
        <span>诊断中…</span>
      </div>
      <div v-else-if="card.quoteError" class="card-overlay">
        <span>行情获取失败</span>
      </div>
    </div>
  </article>
</template>
