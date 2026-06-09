<script setup lang="ts">
import type { AppConfig } from '../types';

defineProps<{
  config: AppConfig;
  configOpen: boolean;
  refreshing: boolean;
  hasApiKey: boolean;
  storageOk: boolean;
  calendarLabel: string;
  stockCount: number;
  fundCount: number;
}>();

const emit = defineEmits<{
  toggle: [];
  save: [partial: Partial<AppConfig>];
  addSymbol: [code: string];
  refresh: [];
  syncCalendar: [];
}>();

const stockInput = defineModel<string>('stockInput', { default: '' });

function onAdd() {
  if (!stockInput.value.trim()) {
    return;
  }
  emit('addSymbol', stockInput.value);
  stockInput.value = '';
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
          placeholder="sk-..."
          autocomplete="off"
          @change="emit('save', { apiKey: ($event.target as HTMLInputElement).value })"
        />
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
    </section>
  </header>
</template>
