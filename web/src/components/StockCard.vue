<script setup lang="ts">
import { computed, ref } from 'vue';
import type { StockCardState, UserGroup } from '../types';
import { formatCostPrice, formatPct, formatPrice, getSignalTone } from '../utils/display';
import { calcPnlPct, hasPosition, parsePositionInputs } from '../utils/position';
import { useI18n } from '../i18n';

const props = defineProps<{
  card: StockCardState;
  groups?: UserGroup[];
  /** 悬浮窗：只读，隐藏删除与持仓编辑 */
  widgetMode?: boolean;
}>();

const emit = defineEmits<{
  remove: [code: string];
  refresh: [code: string];
  updatePosition: [code: string, positionQty?: number, costPrice?: number];
  toast: [message: string];
  addKeyLevel: [code: string, price: number, label: string];
  removeKeyLevel: [code: string, index: number];
  toggleKeyLevelsLock: [code: string];
  cycleRefreshMode: [code: string];
  setGroup: [code: string, groupId: string | undefined];
}>();

const { t } = useI18n();

const editingPosition = ref(false);
const editQty = ref('');
const editCost = ref('');

const addingKeyLevel = ref(false);
const newKlPrice = ref('');
const newKlLabel = ref('');

const signalText = computed(() => {
  if (props.card.quoteError) {
    return '—';
  }
  if (props.card.aiError) {
    return t('card.diagnoseFailed');
  }
  if (props.card.parseError) {
    return t('card.parseFailed');
  }
  return props.card.diagnosis?.signal ?? t('card.waitDiagnosis');
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
  const unit =
    props.card.stock.instrumentType === 'fund_etf'
      ? t('common.fundUnit')
      : t('common.stockUnit');
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

const footerTime = computed(() => {
  if (!props.card.updatedAt) {
    return null;
  }
  if (props.card.diagnosisReused) {
    return t('card.reusedAt', { time: props.card.updatedAt });
  }
  return t('card.updatedAt', { time: props.card.updatedAt });
});

const keyLevels = computed(() => props.card.stock.keyLevels ?? []);

const levelLabel = (level: { type: string; label: string }) => {
  if (level.type === 'support') return t('card.levelSupport');
  if (level.type === 'resistance') return t('card.levelResistance');
  return level.label;
};

function isCodeLikeName(name: string, code: string): boolean {
  const normalized = code.replace(/^(sh|sz|bj)/i, '');
  return name === code || name === normalized || /^\d{6}$/.test(name);
}

const displayName = computed(() => {
  const code = props.card.stock.code;
  const snapName = props.card.snapshot?.name?.trim();
  if (snapName && !isCodeLikeName(snapName, code)) {
    return snapName;
  }
  const stored = props.card.stock.name?.trim();
  if (stored && !isCodeLikeName(stored, code)) {
    return stored;
  }
  if (snapName) {
    return snapName;
  }
  if (stored) {
    return stored;
  }
  return t('card.namePending');
});

const displayCode = computed(() =>
  props.card.stock.code.replace(/^(sh|sz|bj)/i, ''),
);

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

function startAddKeyLevel() {
  newKlPrice.value = '';
  newKlLabel.value = '';
  addingKeyLevel.value = true;
}

function saveKeyLevel() {
  const price = parseFloat(newKlPrice.value);
  if (isNaN(price) || price <= 0) {
    emit('toast', t('card.klPriceInvalid'));
    return;
  }
  const label = newKlLabel.value.trim() || price.toFixed(3);
  emit('addKeyLevel', props.card.stock.code, price, label);
  addingKeyLevel.value = false;
}

const isKeyLevelsLocked = computed(() => props.card.stock.keyLevelsLocked === true);

const refreshModeLabel = computed(() => {
  const mode = props.card.stock.refreshMode ?? 'normal';
  if (mode === 'off') {
    return t('card.refreshModeOff');
  }
  if (mode === 'overclock') {
    return t('card.refreshModeOverclock');
  }
  return t('card.refreshModeNormal');
});

const refreshModeTitle = computed(() => {
  const mode = props.card.stock.refreshMode ?? 'normal';
  if (mode === 'off') {
    return t('card.refreshModeOffTitle');
  }
  if (mode === 'overclock') {
    return t('card.refreshModeOverclockTitle');
  }
  return t('card.refreshModeNormalTitle');
});

const customKeyLevelCount = computed(
  () => props.card.stock.keyLevels?.filter((l) => l.source === 'manual').length ?? 0,
);
</script>

<template>
  <article class="stock-card" :class="{ 'stock-card-widget': widgetMode }">
    <div class="card-inner">
      <header class="card-header">
        <div class="title-block">
          <h2 class="stock-name">
            {{ displayName }}
            <span class="stock-code">({{ displayCode }})</span>
          </h2>
        </div>
        <div class="price-block">
          <div class="price tabular">{{ formatPrice(card.snapshot?.price) }}</div>
          <div class="pct tabular" :class="pctClass">
            {{ formatPct(card.snapshot?.changePct) }}
          </div>
        </div>
        <button
          v-if="!widgetMode"
          type="button"
          class="btn-refresh-mode"
          :title="refreshModeTitle"
          @click="emit('cycleRefreshMode', card.stock.code)"
        >
          {{ refreshModeLabel }}
        </button>
        <select
          v-if="!widgetMode && groups && groups.length > 0"
          class="group-select"
          :value="card.stock.groupId ?? ''"
          @change="emit('setGroup', card.stock.code, ($event.target as HTMLSelectElement).value || undefined)"
        >
          <option value="">{{ t('sidebar.ungrouped') }}</option>
          <option
            v-for="g in groups"
            :key="g.id"
            :value="g.id"
          >{{ g.name }}</option>
        </select>
        <button
          type="button"
          class="btn-refresh"
          :disabled="card.loading"
          :aria-label="t('card.refreshAria')"
          :title="widgetMode ? t('card.refreshTitle') : t('card.refreshAria')"
          @click="emit('refresh', card.stock.code)"
        >
          ↻
        </button>
        <button
          v-if="!widgetMode"
          type="button"
          class="btn-remove"
          :aria-label="t('card.removeAria')"
          @click="emit('remove', card.stock.code)"
        >
          ×
        </button>
      </header>

      <div v-if="positionLine && !editingPosition" class="position-line">
        <span>
          {{ t('card.positionQty') }} {{ positionLine.qty }}{{ positionLine.unit }} ·
          {{ t('card.positionCost') }}
          {{ formatCostPrice(positionLine.cost) }}
          <template v-if="positionLine.pnl !== null">
            · {{ t('card.positionPnl') }}
            <span class="tabular" :class="pnlClass">{{ formatPct(positionLine.pnl) }}</span>
          </template>
        </span>
        <button
          v-if="!widgetMode"
          type="button"
          class="btn-link btn-link-sm"
          @click="startEditPosition"
        >
          {{ t('common.edit') }}
        </button>
      </div>
      <div v-else-if="!widgetMode" class="position-line">
        <button
          type="button"
          class="btn-link btn-link-sm"
          @click="startEditPosition"
        >
          {{ t('card.addPosition') }}
        </button>
      </div>

      <div v-if="editingPosition && !widgetMode" class="position-edit">
        <input v-model="editQty" type="number" min="1" step="1" :placeholder="t('card.positionQty')" />
        <input v-model="editCost" type="number" min="0.001" step="0.001" :placeholder="t('card.positionCost')" />
        <button type="button" class="btn-link btn-link-sm" @click="savePosition">
          {{ t('common.save') }}
        </button>
        <button type="button" class="btn-link btn-link-sm" @click="clearPosition">
          {{ t('common.clear') }}
        </button>
        <button type="button" class="btn-link btn-link-sm" @click="editingPosition = false">
          {{ t('common.cancel') }}
        </button>
      </div>

      <div v-if="keyLevels.length > 0 || addingKeyLevel" class="key-levels">
        <span
          v-for="(level, idx) in keyLevels"
          :key="idx"
          class="kl-chip"
          :class="{
            'kl-support': level.type === 'support',
            'kl-resistance': level.type === 'resistance',
            'kl-custom': level.type === 'custom',
          }"
        >
          {{ levelLabel(level) }} {{ level.price.toFixed(3) }}
          <button
            v-if="level.source === 'manual' && !widgetMode"
            type="button"
            class="kl-remove"
            @click.stop="emit('removeKeyLevel', card.stock.code, idx)"
          >×</button>
        </span>
        <template v-if="!widgetMode">
          <button
            v-if="!addingKeyLevel && customKeyLevelCount < 2"
            type="button"
            class="kl-add"
            @click="startAddKeyLevel"
          >+</button>
          <button
            v-if="keyLevels.length > 0"
            type="button"
            class="btn-link btn-link-sm"
            :title="t('card.klLockHint')"
            @click="emit('toggleKeyLevelsLock', card.stock.code)"
          >
            {{ isKeyLevelsLocked ? t('card.klLocked') : t('card.klUnlocked') }}
          </button>
        </template>
      </div>

      <div v-if="addingKeyLevel && !widgetMode" class="position-edit">
        <input
          v-model="newKlPrice"
          type="number"
          min="0.001"
          step="0.001"
          :placeholder="t('card.klPricePlaceholder')"
        />
        <input
          v-model="newKlLabel"
          type="text"
          maxlength="10"
          :placeholder="t('card.klLabelPlaceholder')"
        />
        <button type="button" class="btn-link btn-link-sm" @click="saveKeyLevel">
          {{ t('common.save') }}
        </button>
        <button type="button" class="btn-link btn-link-sm" @click="addingKeyLevel = false">
          {{ t('common.cancel') }}
        </button>
      </div>

      <div class="signal-bar" :class="`tone-${signalTone}`">
        {{ signalText }}
      </div>

      <div class="card-content">
        <template v-if="card.quoteError">
          <p class="muted">{{ t('card.quoteFailed') }}</p>
        </template>
        <template v-else-if="card.parseError">
          <p><span class="tag">{{ t('card.tagRaw') }}</span> {{ card.rawAiText }}</p>
        </template>
        <template v-else-if="card.diagnosis">
          <p class="line-clamp">
            <span class="tag">{{ t('card.tagShape') }}</span> {{ card.diagnosis.analysis }}
          </p>
          <p class="line-clamp risk-text">
            <span class="tag">{{ t('card.tagRisk') }}</span> {{ card.diagnosis.risk }}
          </p>
          <p v-if="card.diagnosis.buildPositionAdvice" class="line-clamp line-clamp-loose action-text">
            {{ t('card.buildPositionAdvicePrefix') }}{{ card.diagnosis.buildPositionAdvice }}
          </p>
          <template v-else-if="card.diagnosis.bandAction">
            <p class="line-clamp line-clamp-loose action-text">
              {{ t('card.bandActionPrefix') }}{{ card.diagnosis.bandAction }}
            </p>
            <p v-if="card.diagnosis.shortAction" class="line-clamp line-clamp-loose action-text">
              {{ t('card.shortActionPrefix') }}{{ card.diagnosis.shortAction }}
            </p>
          </template>
        </template>
        <template v-else>
          <p class="muted">{{ t('card.waitDiagnosis') }}</p>
        </template>
      </div>

      <footer class="card-footer">
        <span>{{ t('card.footerDisclaimer') }}</span>
        <span v-if="footerTime">{{ footerTime }}</span>
      </footer>

      <div v-if="card.loading" class="card-overlay">
        <span>{{ t('card.diagnosing') }}</span>
      </div>
      <div v-else-if="card.quoteError" class="card-overlay card-overlay-error">
        <span>{{ t('card.quoteFailed') }}</span>
        <button
          type="button"
          class="btn-secondary btn-overlay"
          @click="emit('refresh', card.stock.code)"
        >
          {{ t('common.retry') }}
        </button>
      </div>
    </div>
  </article>
</template>
