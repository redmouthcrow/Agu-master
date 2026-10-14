<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ActionPlan, PlanType, WatchlistItem } from '../types';
import { useI18n } from '../i18n';
import { calcTradeFee } from '../services/tradingCost';
import { hasPosition } from '../utils/position';
import {
  buildManualPlan,
  computeSellRatioQty,
  inferAdviceCondition,
  inferAdviceSide,
  pickTriggerPrice,
  type AdviceCondition,
  type AdviceSide,
} from '../utils/adviceText';

/**
 * v2.13.0: 半自动采纳弹窗。AI 建议只给价位与方向；数量必须由用户填写。
 * AI 已给出完整计划（plan）时全部字段作为预填值供修改。
 */
const props = defineProps<{
  stock: WatchlistItem;
  planType: PlanType;
  advice: string;
  plan?: ActionPlan | null;
  refPrice?: number | null;
  availableCash?: number | null;
}>();

const emit = defineEmits<{
  confirm: [plan: ActionPlan];
  cancel: [];
}>();

const { t } = useI18n();

const unit = computed(() =>
  props.stock.instrumentType === 'fund_etf' ? t('common.fundUnit') : t('common.stockUnit'),
);
const heldQty = computed(() => (hasPosition(props.stock) ? props.stock.positionQty! : null));
const advicePrefix = computed(() => {
  if (props.planType === 'band') {
    return t('card.bandActionPrefix');
  }
  if (props.planType === 'short') {
    return t('card.shortActionPrefix');
  }
  return t('card.buildPositionAdvicePrefix');
});

const side = ref<AdviceSide>(props.plan?.side ?? inferAdviceSide(props.planType, props.advice));
const condition = ref<AdviceCondition>(
  props.plan?.condition ?? inferAdviceCondition(props.advice, side.value),
);
function initialPriceStr(): string {
  if (props.plan?.triggerPrice != null) {
    return String(props.plan.triggerPrice);
  }
  const prefer = condition.value === 'gte' ? 'above' : 'below';
  const picked = pickTriggerPrice(props.advice, props.refPrice ?? null, prefer);
  return picked == null ? '' : String(picked);
}
const priceStr = ref(initialPriceStr());
const qtyStr = ref<string>(props.plan?.qty != null ? String(props.plan.qty) : '');
const error = ref('');
const qtyInput = ref<HTMLInputElement | null>(null);

// 切换方向时把触发方式回到该方向的默认配对（用户仍可再改）。
watch(side, (s) => {
  condition.value =
    props.plan != null && s === props.plan.side
      ? props.plan.condition
      : inferAdviceCondition(props.advice, s);
});

onMounted(() => {
  qtyInput.value?.focus();
});

function confirm() {
  const built = buildManualPlan({
    side: side.value,
    condition: condition.value,
    triggerPrice: Number(priceStr.value.trim()),
    qty: Number(qtyStr.value.trim()),
  });
  if ('error' in built) {
    error.value =
      built.error === 'price_invalid'
        ? t('adoptDialog.errorPrice')
        : t('adoptDialog.errorQty');
    return;
  }
  const plan = built.plan;
  if (plan.side === 'sell') {
    const held = heldQty.value;
    if (held == null) {
      error.value = t('adoptDialog.errorNoPosition');
      return;
    }
    if (plan.qty > held) {
      error.value = t('adoptDialog.errorSellExceeds', { max: held, unit: unit.value });
      return;
    }
  } else if (props.availableCash != null && Number.isFinite(props.availableCash)) {
    const amount = Math.round(plan.qty * plan.triggerPrice * 100) / 100;
    const fee = calcTradeFee('buy', amount, props.stock.instrumentType);
    if (amount + fee > props.availableCash) {
      error.value = t('adoptDialog.errorCash');
      return;
    }
  }
  error.value = '';
  emit('confirm', plan);
}
</script>

<template>
  <div class="adopt-overlay" @click.self="emit('cancel')">
    <div class="adopt-modal">
      <div class="adopt-header">
        <h3>{{ t('adoptDialog.title') }}</h3>
        <button type="button" class="btn-close" @click="emit('cancel')">×</button>
      </div>
      <p class="adopt-advice">{{ advicePrefix }}{{ advice }}</p>

      <div class="field">
        <label>{{ t('adoptDialog.side') }}</label>
        <div class="seg">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: side === 'sell' }"
            @click="side = 'sell'"
          >{{ t('adoptDialog.sideSell') }}</button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: side === 'buy' }"
            @click="side = 'buy'"
          >{{ t('adoptDialog.sideBuy') }}</button>
        </div>
      </div>

      <div class="field">
        <label>{{ t('adoptDialog.condition') }}</label>
        <div class="seg">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: condition === 'gte' }"
            @click="condition = 'gte'"
          >{{ t('adoptDialog.conditionGte') }} ≥</button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: condition === 'lte' }"
            @click="condition = 'lte'"
          >{{ t('adoptDialog.conditionLte') }} ≤</button>
        </div>
      </div>

      <div class="field">
        <label>
          {{ t('adoptDialog.triggerPrice') }}
          <span v-if="refPrice != null" class="ref-price">
            {{ t('adoptDialog.refPrice', { price: refPrice.toFixed(3) }) }}
          </span>
        </label>
        <input
          v-model="priceStr"
          class="text-input"
          inputmode="decimal"
          :placeholder="t('adoptDialog.pricePlaceholder')"
        />
      </div>

      <div class="field">
        <label>
          {{ t('adoptDialog.qty') }}
          <span class="ref-price">{{ unit }}</span>
        </label>
        <input
          ref="qtyInput"
          v-model="qtyStr"
          class="text-input"
          inputmode="numeric"
          :placeholder="t('adoptDialog.qtyPlaceholder')"
          @keyup.enter="confirm"
        />
        <!-- v2.14.0: 「卖掉一部分」比例快捷 —— 按持仓自动换算数量 -->
        <div v-if="side === 'sell' && heldQty != null" class="ratio-row">
          <button
            type="button"
            class="ratio-btn"
            @click="qtyStr = String(computeSellRatioQty(heldQty, 1 / 3))"
          >1/3</button>
          <button
            type="button"
            class="ratio-btn"
            @click="qtyStr = String(computeSellRatioQty(heldQty, 1 / 2))"
          >1/2</button>
          <button
            type="button"
            class="ratio-btn"
            @click="qtyStr = String(computeSellRatioQty(heldQty, 1))"
          >{{ t('adoptDialog.ratioAll') }}</button>
        </div>
      </div>

      <p v-if="side === 'sell' && heldQty != null" class="hint">
        {{ t('adoptDialog.holdHint', { qty: heldQty, unit }) }}
      </p>
      <p v-else-if="side === 'buy' && availableCash != null" class="hint">
        {{ t('adoptDialog.cashHint', { cash: Math.round(availableCash) }) }}
      </p>
      <p class="measure-note">{{ t('adoptDialog.measureNote') }}</p>
      <p v-if="error" class="error-text">{{ error }}</p>

      <div class="adopt-actions">
        <button type="button" class="btn-primary" @click="confirm">
          {{ t('adoptDialog.confirm') }}
        </button>
        <button type="button" class="btn-link" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.adopt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.adopt-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 340px;
  max-height: 85vh;
  overflow-y: auto;
  padding: 16px 20px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.adopt-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.adopt-header h3 {
  font-size: 15px;
  margin: 0;
}
.btn-close {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
}
.adopt-advice {
  font-size: 12px;
  color: var(--text-muted);
  border-left: 2px solid var(--border);
  padding-left: 8px;
  margin: 4px 0 12px;
}
.field {
  margin-bottom: 10px;
}
.field label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.ref-price {
  font-size: 11px;
  color: var(--text-dim);
}
.seg {
  display: flex;
  gap: 6px;
}
.seg-btn {
  flex: 1;
  background: var(--bg);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 8px;
  font-size: 13px;
  cursor: pointer;
}
.seg-btn.active {
  color: #1677ff;
  border-color: #1677ff;
  background: #1677ff1a;
}
.text-input {
  width: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.text-input:focus {
  outline: none;
  border-color: #1677ff;
}
.ratio-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.ratio-btn {
  flex: 1;
  background: var(--bg);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.ratio-btn:hover {
  color: #1677ff;
  border-color: #1677ff;
}
.hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 2px 0 0;
}
.measure-note {
  font-size: 11px;
  color: var(--text-dim);
  margin: 6px 0 0;
}
.error-text {
  font-size: 12px;
  color: var(--risk);
  margin: 6px 0 0;
}
.adopt-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.adopt-actions .btn-primary {
  min-height: 36px;
  flex: 1;
}
.adopt-actions .btn-link {
  min-height: 36px;
}
</style>
