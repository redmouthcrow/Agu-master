<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ConfigPanel from './components/ConfigPanel.vue';
import StockCard from './components/StockCard.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useAppState } from './composables/useAppState';
import { MAX_FUNDS, MAX_STOCKS } from './types';

const stockInput = ref('');

const {
  stockCards,
  fundCards,
  stockCount,
  fundCount,
  refreshing,
  configOpen,
  storageOk,
  usingFileConfig,
  calendarLabel,
  toasts,
  hasApiKey,
  config,
  saveConfigField,
  addSymbol,
  removeSymbol,
  runRefresh,
  initCalendar,
  bootstrap,
} = useAppState();

onMounted(() => {
  void bootstrap();
});
</script>

<template>
  <ConfigPanel
    :config="config"
    :config-open="configOpen"
    :refreshing="refreshing"
    :has-api-key="hasApiKey"
    :storage-ok="storageOk"
    :using-file-config="usingFileConfig"
    :calendar-label="calendarLabel"
    :stock-count="stockCount"
    :fund-count="fundCount"
    v-model:stock-input="stockInput"
    @toggle="configOpen = !configOpen"
    @save="saveConfigField"
    @add-symbol="addSymbol"
    @refresh="runRefresh(true)"
    @sync-calendar="initCalendar(true)"
  />

  <main class="main">
    <div
      v-if="stockCount === 0 && fundCount === 0"
      class="empty-state"
    >
      添加股票（最多 {{ MAX_STOCKS }}）或场内基金（最多 {{ MAX_FUNDS }}）开始监控
    </div>

    <template v-else>
      <section class="watch-section">
        <h2 class="section-title">股票监控 ({{ stockCount }}/{{ MAX_STOCKS }})</h2>
        <div v-if="stockCards.length === 0" class="section-empty">
          暂无股票，在上方输入框添加（如 600519）
        </div>
        <div v-else class="grid">
          <StockCard
            v-for="card in stockCards"
            :key="card.stock.code"
            :card="card"
            @remove="removeSymbol"
          />
        </div>
      </section>

      <section class="watch-section">
        <h2 class="section-title">基金监控 ({{ fundCount }}/{{ MAX_FUNDS }})</h2>
        <div v-if="fundCards.length === 0" class="section-empty">
          暂无场内基金，在上方输入框添加（如 510500、159915）
        </div>
        <div v-else class="grid">
          <StockCard
            v-for="card in fundCards"
            :key="card.stock.code"
            :card="card"
            @remove="removeSymbol"
          />
        </div>
      </section>
    </template>
  </main>

  <ToastContainer :toasts="toasts" />
</template>

<style>
@import './styles/global.css';
</style>
