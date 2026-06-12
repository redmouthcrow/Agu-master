<script setup lang="ts">
import { computed, onMounted } from 'vue';
import StockCard from './StockCard.vue';
import ToastContainer from './ToastContainer.vue';
import { APP_NAME } from '../constants/app';
import { useAppState } from '../composables/useAppState';
import { applyDocumentTitle, useI18n } from '../i18n';
import { canShowWidget } from '../utils/widgetPin';

const { t } = useI18n();

const {
  pinnedCards,
  pinnedCodes,
  hasApiKey,
  toasts,
  runRefreshSymbol,
  bootstrap,
} = useAppState();

const widgetReady = computed(() => canShowWidget(pinnedCodes.value));

const cardsMissing = computed(
  () => widgetReady.value && pinnedCards.value.length === 0,
);

function openDashboard() {
  window.aguDesktop?.openDashboard();
}

function hideWidget() {
  window.aguDesktop?.hideWidget();
}

function minimizeWidget() {
  window.aguDesktop?.minimizeWidget();
}

onMounted(() => {
  document.documentElement.classList.add('widget-mode');
  applyDocumentTitle();
  void bootstrap();
});
</script>

<template>
  <div class="widget-root">
    <header class="widget-titlebar">
      <span class="widget-drag-label">{{ APP_NAME }}</span>
      <div class="widget-titlebar-actions">
        <button
          type="button"
          class="btn-ghost widget-btn"
          :title="t('widget.openDashboard')"
          @click="openDashboard"
        >
          ⤢
        </button>
        <button
          type="button"
          class="btn-ghost widget-btn"
          :title="t('widget.minimize')"
          @click="minimizeWidget"
        >
          ─
        </button>
        <button
          type="button"
          class="btn-ghost widget-btn"
          :title="t('widget.hide')"
          @click="hideWidget"
        >
          ✕
        </button>
      </div>
    </header>

    <div v-if="!hasApiKey" class="banner banner-warn widget-banner">
      {{ t('widget.apiKeyWarn') }}
    </div>

    <main class="widget-body">
      <div v-if="!widgetReady" class="widget-empty">
        <p>{{ t('widget.pinEmpty') }}</p>
        <button type="button" class="btn-primary" @click="openDashboard">
          {{ t('widget.openDashboard') }}
        </button>
      </div>

      <div v-else-if="cardsMissing" class="widget-empty">
        <p>{{ t('widget.syncing') }}</p>
        <button type="button" class="btn-primary" @click="openDashboard">
          {{ t('widget.openDashboard') }}
        </button>
      </div>

      <div v-else class="widget-cards">
        <StockCard
          v-for="card in pinnedCards"
          :key="card.stock.code"
          :card="card"
          widget-mode
          @refresh="runRefreshSymbol"
        />
      </div>
    </main>

    <ToastContainer :toasts="toasts" />
  </div>
</template>

<style>
.widget-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: rgba(20, 20, 20, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  color: var(--text);
}

.widget-titlebar {
  flex: 0 0 auto;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  background: rgba(0, 0, 0, 0.35);
  -webkit-app-region: drag;
  user-select: none;
}

.widget-drag-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.widget-titlebar-actions {
  display: flex;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.widget-btn {
  min-width: 28px;
  min-height: 24px;
  padding: 0 6px;
  font-size: 12px;
}

.widget-banner {
  flex: 0 0 auto;
  margin: 8px 12px 0;
}

.widget-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 6px 8px 10px;
  overflow-y: auto;
}

.widget-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.widget-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 160px;
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
}
</style>
