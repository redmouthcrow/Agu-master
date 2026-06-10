<script setup lang="ts">
import { ref } from 'vue';
import type { AppConfig, RefreshFrequency } from '../types';
import { maskApiKey } from '../utils/display';
import { parsePositionInputs } from '../utils/position';

const props = defineProps<{
  config: AppConfig;
  configOpen: boolean;
  refreshing: boolean;
  hasApiKey: boolean;
  storageOk: boolean;
  usingFileConfig: boolean;
  calendarLabel: string;
  stockCount: number;
  fundCount: number;
  tryAddSymbol: (code: string, positionQty?: number, costPrice?: number) => boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  save: [partial: Partial<AppConfig>];
  refresh: [];
  syncCalendar: [];
  toast: [message: string];
}>();

const stockInput = defineModel<string>('stockInput', { default: '' });
const positionQtyInput = ref('');
const costPriceInput = ref('');

const refreshOptions: { value: RefreshFrequency; label: string }[] = [
  { value: 60, label: '60 分钟 · 省 Token' },
  { value: 30, label: '30 分钟 · 标准' },
];

function onAdd() {
  const code = stockInput.value.trim();
  if (!code) {
    emit('toast', '请先输入证券代码');
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
</script>

<template>
  <header class="config-header">
    <div class="config-bar">
      <button type="button" class="btn-ghost" @click="emit('toggle')">
        {{ configOpen ? '收起配置' : '展开配置' }}
      </button>
      <span class="calendar-status">{{ calendarLabel }}</span>
      <button type="button" class="btn-link" @click="emit('syncCalendar')">
        重新同步日历
      </button>
      <button
        type="button"
        class="btn-primary"
        :disabled="refreshing"
        @click="emit('refresh')"
      >
        {{ refreshing ? '刷新中…' : '立即刷新' }}
      </button>
    </div>

    <div v-if="!storageOk" class="banner banner-warn">
      本地存储不可用，刷新后数据将丢失
    </div>
    <div v-if="usingFileConfig" class="banner banner-info">
      个人配置来自 web/agu.config.local.json（已忽略 Git）。修改后请重启开发服务。
    </div>
    <div v-if="!hasApiKey" class="banner banner-warn">
      请先配置 API Key
    </div>

    <section v-show="configOpen" class="config-panel">
      <label class="field">
        <span>API Base URL</span>
        <input
          :value="config.baseUrl"
          type="url"
          placeholder="https://api.deepseek.com/v1"
          @change="emit('save', { baseUrl: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="field">
        <span>API Key</span>
        <input
          :value="config.apiKey"
          type="password"
          :placeholder="config.apiKey ? maskApiKey(config.apiKey) : 'sk-...'"
          autocomplete="off"
          @change="emit('save', { apiKey: ($event.target as HTMLInputElement).value })"
        />
        <span v-if="config.apiKey" class="field-hint">
          已配置 {{ maskApiKey(config.apiKey) }}
        </span>
      </label>
      <label class="field">
        <span>Model</span>
        <input
          :value="config.model"
          type="text"
          placeholder="deepseek-chat"
          @change="emit('save', { model: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="field">
        <span>自动刷新档位（交易时段对齐触发）</span>
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
          <span>添加自选（股票 {{ stockCount }}/5 · 基金 {{ fundCount }}/5）</span>
          <input
            v-model="stockInput"
            type="text"
            placeholder="600519 / 510500 / 159915"
            @keyup.enter="onAdd"
          />
        </label>
        <button type="button" class="btn-secondary" @click="onAdd">添加</button>
      </div>
      <div class="add-row optional-row">
        <label class="field grow">
          <span>持仓数量（可选，与成本成对填写）</span>
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
          <span>成本价（可选，元，最多4位小数）</span>
          <input
            v-model="costPriceInput"
            type="number"
            min="0.0001"
            step="0.0001"
            placeholder="6.3500"
            @keyup.enter="onAdd"
          />
        </label>
      </div>
    </section>
  </header>
</template>
