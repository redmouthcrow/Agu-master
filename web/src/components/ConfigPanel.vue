<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AppConfig, RefreshFrequency, WatchlistItem } from '../types';
import { maskApiKey } from '../utils/display';
import { parsePositionInputs } from '../utils/position';
import {
  MAX_WIDGET_PINNED,
  MIN_WIDGET_PINNED,
  clampWidgetOpacity,
} from '../utils/widgetPin';
import { useI18n } from '../i18n';

const props = defineProps<{
  config: AppConfig;
  configOpen: boolean;
  refreshing: boolean;
  hasApiKey: boolean;
  storageOk: boolean;
  usingFileConfig: boolean;
  isDesktop: boolean;
  calendarLabel: string;
  watchlistCount: number;
  tryAddSymbol: (code: string, positionQty?: number, costPrice?: number) => boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  save: [partial: Partial<AppConfig>];
  saveConfig: [];
  alertSettingsChange: [partial: Record<string, boolean>];
  refresh: [];
  syncCalendar: [];
  toast: [message: string];
  exportBackup: [];
  removeAssignment: [code: string, portfolioId: string];
}>();

// v2.8 portfolio asset management
const selectedPfId = ref('');
const pfCode = ref('');
const pfWeight = ref('');

function addPfAsset() {
  const code = pfCode.value.trim();
  const w = Number(pfWeight.value);
  if (!code || isNaN(w) || w <= 0 || w > 100 || !selectedPfId.value) return;
  emit('removeAssignment', code, selectedPfId.value); // clear old weight first
  // add via save (upsert handled by useAppState)
  emit('save', {
    portfolioAssignments: [
      ...(props.config.portfolioAssignments ?? []).filter(
        (a) => !(a.code === code && a.portfolioId === selectedPfId.value),
      ),
      { code, portfolioId: selectedPfId.value, weight: w },
    ],
  } as Partial<AppConfig>);
  pfCode.value = '';
  pfWeight.value = '';
}

const { t } = useI18n();

const stockInput = defineModel<string>('stockInput', { default: '' });
const positionQtyInput = ref('');
const costPriceInput = ref('');

const refreshOptions = computed((): { value: RefreshFrequency; label: string }[] => [
  { value: 5, label: t('config.refresh5') },
  { value: 15, label: t('config.refresh15') },
  { value: 30, label: t('config.refresh30') },
  { value: 60, label: t('config.refresh60') },
]);

function onAdd() {
  const code = stockInput.value.trim();
  if (!code) {
    emit('toast', t('toast.enterCode'));
    return;
  }

  const position = parsePositionInputs(positionQtyInput.value, costPriceInput.value);
  if (position.error) {
    emit('toast', position.error);
    return;
  }

  const ok = props.tryAddSymbol(code, position.positionQty, position.costPrice);
  if (!ok) {
    return;
  }

  stockInput.value = '';
  positionQtyInput.value = '';
  costPriceInput.value = '';
}

function onRefreshFrequencyChange(e: Event) {
  const value = Number((e.target as HTMLSelectElement).value) as RefreshFrequency;
  emit('save', { refreshFrequency: value });
}

const pinnedSet = computed(
  () => new Set(props.config.widgetPinnedCodes ?? []),
);

function watchlistLabel(item: WatchlistItem): string {
  const pool =
    item.instrumentType === 'stock'
      ? t('common.stockPoolShort')
      : t('common.fundPoolShort');
  return `${item.name || item.code} (${pool})`;
}

function onPinToggle(code: string, checked: boolean) {
  const current = [...(props.config.widgetPinnedCodes ?? [])];
  if (checked) {
    if (current.includes(code)) {
      return;
    }
    if (current.length >= MAX_WIDGET_PINNED) {
      emit('toast', t('toast.widgetPinMax', { max: MAX_WIDGET_PINNED }));
      return;
    }
    current.push(code);
  } else {
    const idx = current.indexOf(code);
    if (idx >= 0) {
      current.splice(idx, 1);
    }
  }
  emit('save', { widgetPinnedCodes: current });
}

function onOpacityInput(e: Event) {
  const raw = Number((e.target as HTMLInputElement).value);
  const opacity = clampWidgetOpacity(raw / 100);
  window.aguDesktop?.setOpacity(opacity);
}

function onOpacityChange(e: Event) {
  const raw = Number((e.target as HTMLInputElement).value);
  emit('save', { widgetOpacity: clampWidgetOpacity(raw / 100) });
}

function onAlwaysOnTopChange(e: Event) {
  emit('save', {
    widgetAlwaysOnTop: (e.target as HTMLInputElement).checked,
  });
}
</script>

<template>
  <header class="config-header">
    <div class="config-bar">
      <button type="button" class="btn-ghost" @click="emit('toggle')">
        {{ configOpen ? t('config.toggleClose') : t('config.toggleOpen') }}
      </button>
      <span class="calendar-status">{{ calendarLabel }}</span>
      <button type="button" class="btn-link" @click="emit('syncCalendar')">
        {{ t('config.syncCalendar') }}
      </button>
      <button
        type="button"
        class="btn-primary"
        :disabled="refreshing"
        @click="emit('refresh')"
      >
        {{ refreshing ? t('config.refreshing') : t('config.refreshNow') }}
      </button>
      <button type="button" class="btn-save" @click="emit('saveConfig')">
        {{ t('config.saveConfig') }}
      </button>
    </div>

    <div v-if="!storageOk" class="banner banner-warn">
      {{ t('config.storageWarn') }}
    </div>
    <div v-if="usingFileConfig" class="banner banner-info">
      {{ t('config.fileConfigInfo') }}
    </div>
    <div v-if="!hasApiKey" class="banner banner-warn">
      {{ t('config.apiKeyWarn') }}
    </div>

    <section v-show="configOpen" class="config-panel">
      <label class="field">
        <span>{{ t('config.baseUrl') }}</span>
        <input
          :value="config.baseUrl"
          type="url"
          placeholder="https://api.deepseek.com/v1"
          @change="emit('save', { baseUrl: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="field">
        <span>{{ t('config.apiKey') }}</span>
        <input
          :value="config.apiKey"
          type="password"
          :placeholder="config.apiKey ? maskApiKey(config.apiKey) : 'sk-...'"
          autocomplete="off"
          @change="emit('save', { apiKey: ($event.target as HTMLInputElement).value })"
        />
        <span v-if="config.apiKey" class="field-hint">
          {{ t('config.apiKeyConfigured', { mask: maskApiKey(config.apiKey) }) }}
        </span>
      </label>
      <label class="field">
        <span>{{ t('config.model') }}</span>
        <input
          :value="config.model"
          type="text"
          placeholder="deepseek-chat"
          @change="emit('save', { model: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="field">
        <span>{{ t('config.investmentStyle') }}</span>
        <select
          :value="config.investmentStyle ?? 'neutral'"
          class="field-select"
          @change="emit('save', { investmentStyle: ($event.target as HTMLSelectElement).value as AppConfig['investmentStyle'] })"
        >
          <option value="aggressive">{{ t('config.styleAggressive') }}</option>
          <option value="neutral">{{ t('config.styleNeutral') }}</option>
          <option value="conservative">{{ t('config.styleConservative') }}</option>
        </select>
      </label>
      <label class="field">
        <span>{{ t('config.refreshFrequency') }}</span>
        <select
          :value="config.refreshFrequency"
          class="field-select"
          @change="onRefreshFrequencyChange"
        >
          <option
            v-for="opt in refreshOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>
      <div class="add-row">
        <label class="field grow">
          <span>{{
            t('config.addWatchlist', { max: 20 })
          }}</span>
          <input
            v-model="stockInput"
            type="text"
            :placeholder="t('config.addWatchlistPlaceholder')"
            @keyup.enter="onAdd"
          />
        </label>
        <button type="button" class="btn-secondary" @click="onAdd">{{ t('config.addBtn') }}</button>
      </div>
      <div class="add-row optional-row">
        <label class="field grow">
          <span>{{ t('config.positionQty') }}</span>
          <input
            v-model="positionQtyInput"
            type="number"
            min="1"
            step="1"
            placeholder="1000"
            @keyup.enter="onAdd"
          />
        </label>
        <label class="field grow">
          <span>{{ t('config.positionCost') }}</span>
          <input
            v-model="costPriceInput"
            type="number"
            min="0.001"
            step="0.001"
            placeholder="6.350"
            @keyup.enter="onAdd"
          />
        </label>
      </div>
      <section v-if="isDesktop" class="desktop-settings">
        <h3 class="settings-heading">{{ t('config.desktopSection') }}</h3>
        <p class="field-hint">
          {{ t('config.desktopPinHint', { total: watchlistCount }) }}
        </p>
        <div v-if="config.watchlist.length === 0" class="field-hint">
          {{ t('config.desktopPinEmpty') }}
        </div>
        <div v-else class="pin-list">
          <label
            v-for="item in config.watchlist"
            :key="item.code"
            class="pin-item"
          >
            <input
              type="checkbox"
              :checked="pinnedSet.has(item.code)"
              @change="onPinToggle(item.code, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ watchlistLabel(item) }}</span>
            <code class="pin-code">{{ item.code }}</code>
          </label>
        </div>
        <p
          v-if="(config.widgetPinnedCodes?.length ?? 0) > 0 && (config.widgetPinnedCodes?.length ?? 0) < MIN_WIDGET_PINNED"
          class="field-hint warn-hint"
        >
          {{ t('config.desktopPinMinWarn') }}
        </p>
        <label class="field">
          <span>{{
            t('config.widgetOpacity', {
              percent: Math.round((config.widgetOpacity ?? 0.9) * 100),
            })
          }}</span>
          <input
            type="range"
            min="70"
            max="100"
            step="1"
            :value="Math.round((config.widgetOpacity ?? 0.9) * 100)"
            @input="onOpacityInput"
            @change="onOpacityChange"
          />
        </label>
        <label class="pin-item">
          <input
            type="checkbox"
            :checked="config.widgetAlwaysOnTop !== false"
            @change="onAlwaysOnTopChange"
          />
          <span>{{ t('config.widgetAlwaysOnTop') }}</span>
        </label>
        <p class="field-hint">{{ t('config.userDataHint') }}</p>
        <button type="button" class="btn-secondary" @click="emit('exportBackup')">
          {{ t('config.exportBackup') }}
        </button>
        <section class="alert-settings">
          <h3 class="settings-heading">{{ t('config.alertSection') }}</h3>
          <label class="pin-item">
            <input
              type="checkbox"
              :checked="(config.alertSettings?.enabled) !== false"
              @change="emit('alertSettingsChange', { enabled: ($event.target as HTMLInputElement).checked })"
            />
            <span>{{ t('config.alertEnabled') }}</span>
          </label>
          <template v-if="(config.alertSettings?.enabled) !== false">
            <label class="pin-item">
              <input
                type="checkbox"
                :checked="(config.alertSettings?.priceAlert) !== false"
                @change="emit('alertSettingsChange', { priceAlert: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ t('config.alertPrice') }}</span>
            </label>
            <label class="pin-item">
              <input
                type="checkbox"
                :checked="(config.alertSettings?.signalAlert) !== false"
                @change="emit('alertSettingsChange', { signalAlert: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ t('config.alertSignal') }}</span>
            </label>
            <label class="pin-item">
              <input
                type="checkbox"
                :checked="(config.alertSettings?.authErrorAlert) !== false"
                @change="emit('alertSettingsChange', { authErrorAlert: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ t('config.alertAuthError') }}</span>
            </label>
            <label class="pin-item">
              <input
                type="checkbox"
                :checked="(config.alertSettings?.quoteErrorAlert) !== false"
                @change="emit('alertSettingsChange', { quoteErrorAlert: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ t('config.alertQuoteError') }}</span>
            </label>
          </template>
        </section>
        <!-- v2.8 portfolio asset management -->
        <section v-if="(config.portfolios?.length ?? 0) > 0" class="config-section">
          <h3 class="section-subtitle">组合管理</h3>
          <label class="field">
            <span>选择组合</span>
            <select v-model="selectedPfId" class="field-select">
              <option value="">—</option>
              <option v-for="p in config.portfolios" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <template v-if="selectedPfId">
            <div class="pf-assets-list">
              <div v-for="a in config.portfolioAssignments?.filter(x => x.portfolioId === selectedPfId) ?? []" :key="a.code" class="pf-row">
                <span>{{ a.code }}</span>
                <span>{{ a.weight }}%</span>
                <button class="btn-link btn-link-sm" @click="emit('removeAssignment', a.code, selectedPfId)">×</button>
              </div>
            </div>
            <div class="edit-row">
              <input v-model="pfCode" type="text" maxlength="8" placeholder="代码" class="edit-input" />
              <input v-model="pfWeight" type="number" min="0" max="100" placeholder="权重%" class="edit-input-narrow" />
              <button type="button" class="btn-link btn-link-sm" @click="addPfAsset">添加</button>
            </div>
          </template>
        </section>
      </section>
    </section>
  </header>
</template>

<style scoped>
.section-subtitle { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.pf-assets-list { margin-bottom: 4px; }
.pf-row { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
.edit-row { display: flex; align-items: center; gap: 4px; }
.edit-input { flex: 1; min-width: 0; min-height: 26px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; }
.edit-input-narrow { width: 52px; min-height: 26px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; }
</style>
