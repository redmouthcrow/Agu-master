<script setup lang="ts">
import { computed, ref } from 'vue';
import type { StockCardState } from '../types';
import { formatCostPrice, formatPct, formatPrice, getSignalTone } from '../utils/display';
import { calcPnlPct, hasPosition, parsePositionInputs } from '../utils/position';

const props = defineProps<{
  card: StockCardState;
}>();

const emit = defineEmits<{
  remove: [code: string];
  refresh: [code: string];
  updatePosition: [code: string, positionQty?: number, costPrice?: number];
  toast: [message: string];
}>();

const editingPosition = ref(false);
const editQty = ref('');
const editCost = ref('');

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

const positionLine = computed(() => {
  if (!hasPosition(props.card.stock)) {
    return null;
  }
  const unit = props.card.stock.instrumentType === 'fund_etf' ? '份' : '股';
  const pnl = calcPnlPct(props.card.snapshot?.price, props.card.stock.costPrice!);
  return {
    qty: props.card.stock.positionQty,
    unit,
    cost: props.card.stock.costPrice,
    pnl,
  };
});

const pnlClass = computed(() => {
  const pnl = positionLine.value?.pnl;
  if (pnl === null || pnl === undefined) {
    return 'flat';
  }
  if (pnl > 0) {
    return 'up';
  }
  if (pnl < 0) {
    return 'down';
  }
  return 'flat';
});

function startEditPosition() {
  editQty.value =
    props.card.stock.positionQty != null
      ? String(props.card.stock.positionQty)
      : '';
  editCost.value =
    props.card.stock.costPrice != null
      ? formatCostPrice(props.card.stock.costPrice)
      : '';
  editingPosition.value = true;
}

function savePosition() {
  const position = parsePositionInputs(editQty.value, editCost.value);
  if (position.error) {
    emit('toast', position.error);
    return;
  }
  emit(
    'updatePosition',
    props.card.stock.code,
    position.positionQty,
    position.costPrice,
  );
  editingPosition.value = false;
}

function clearPosition() {
  emit('updatePosition', props.card.stock.code);
  editingPosition.value = false;
}
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
          class="btn-refresh"
          :disabled="card.loading"
          aria-label="刷新此证券"
          title="刷新此证券"
          @click="emit('refresh', card.stock.code)"
        >
          ↻
        </button>
        <button
          type="button"
          class="btn-remove"
          aria-label="删除自选"
          @click="emit('remove', card.stock.code)"
        >
          ×
        </button>
      </header>

      <div v-if="positionLine && !editingPosition" class="position-line">
        <span>
          持仓 {{ positionLine.qty }}{{ positionLine.unit }} · 成本
          {{ formatCostPrice(positionLine.cost) }}
          <template v-if="positionLine.pnl !== null">
            · 浮盈
            <span class="tabular" :class="pnlClass">{{ formatPct(positionLine.pnl) }}</span>
          </template>
        </span>
        <button type="button" class="btn-link btn-link-sm" @click="startEditPosition">
          编辑
        </button>
      </div>

      <div v-if="editingPosition" class="position-edit">
        <input v-model="editQty" type="number" min="1" step="1" placeholder="数量" />
        <input v-model="editCost" type="number" min="0.0001" step="0.0001" placeholder="成本" />
        <button type="button" class="btn-link btn-link-sm" @click="savePosition">保存</button>
        <button type="button" class="btn-link btn-link-sm" @click="clearPosition">清空</button>
        <button type="button" class="btn-link btn-link-sm" @click="editingPosition = false">
          取消
        </button>
      </div>

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
          <p v-if="card.diagnosis.action" class="line-clamp line-clamp-loose action-text">
            <span class="tag">[操作建议]</span> {{ card.diagnosis.action }}
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
        <span>刷新中…</span>
      </div>
      <div v-else-if="card.quoteError" class="card-overlay card-overlay-error">
        <span>行情获取失败</span>
        <button
          type="button"
          class="btn-secondary btn-overlay"
          @click="emit('refresh', card.stock.code)"
        >
          重试
        </button>
      </div>
    </div>
  </article>
</template>
