<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ConfigPanel from './components/ConfigPanel.vue';
import StockCard from './components/StockCard.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useAppState } from './composables/useAppState';
import { applyDocumentTitle, useI18n } from './i18n';

const { t } = useI18n();
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
  isDesktop,
  saveConfigField,
  addSymbol,
  showToast,
  updateSymbolPosition,
  removeSymbol,
  runRefresh,
  runRefreshSymbol,
  initCalendar,
  bootstrap,
  exportUserBackup,
} = useAppState();

onMounted(() => {
  applyDocumentTitle();
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
    :is-desktop="isDesktop"
    :calendar-label="calendarLabel"
    :stock-count="stockCount"
    :fund-count="fundCount"
    v-model:stock-input="stockInput"
    :try-add-symbol="addSymbol"
    @toggle="configOpen = !configOpen"
    @save="saveConfigField"
    @toast="showToast"
    @refresh="runRefresh(true)"
    @sync-calendar="initCalendar(true)"
  @export-backup="exportUserBackup"
  />

  <main class="main">
    <div
      v-if="stockCount === 0 && fundCount === 0"
      class="empty-state"
    >
      {{ t('empty.dualPool') }}
    </div>

    <template v-else>
      <section class="watch-section">
        <h2 class="section-title">{{ t('section.stock', { count: stockCount }) }}</h2>
        <div v-if="stockCards.length === 0" class="section-empty">
          {{ t('section.stockEmpty') }}
        </div>
        <div v-else class="grid">
          <StockCard
            v-for="card in stockCards"
            :key="card.stock.code"
            :card="card"
            @remove="removeSymbol"
            @refresh="runRefreshSymbol"
            @update-position="updateSymbolPosition"
            @toast="showToast"
          />
        </div>
      </section>

      <section class="watch-section">
        <h2 class="section-title">{{ t('section.fund', { count: fundCount }) }}</h2>
        <div v-if="fundCards.length === 0" class="section-empty">
          {{ t('section.fundEmpty') }}
        </div>
        <div v-else class="grid">
          <StockCard
            v-for="card in fundCards"
            :key="card.stock.code"
            :card="card"
            @remove="removeSymbol"
            @refresh="runRefreshSymbol"
            @update-position="updateSymbolPosition"
            @toast="showToast"
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
