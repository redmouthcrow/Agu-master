<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfigPanel from './components/ConfigPanel.vue';
import Sidebar from './components/Sidebar.vue';
import StockCard from './components/StockCard.vue';
import PortfolioCard from './components/PortfolioCard.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useAppState } from './composables/useAppState';
import { DEFAULT_GROUP_ID } from './types';
import { applyDocumentTitle, useI18n } from './i18n';

const { t } = useI18n();
const stockInput = ref('');
const sidebarCollapsed = ref(false);

const {
  cards,
  watchlistCount,
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
  updateAlertSettings,
  addCustomKeyLevel,
  removeCustomKeyLevel,
  toggleKeyLevelsLock,
  cycleRefreshMode,
  addGroup,
  renameGroup,
  removeGroup,
  setSecurityGroup,
  toggleGroupCollapse,
  addPortfolio,
  renamePortfolio,
  removePortfolio,
  computePortfolioChange,
  getTrackingCodes,
  refreshTrackingQuotes,
  trackingSnapshots,
  upsertAssignment,
  removeAssignment,
  moveGroupUp,
  moveGroupDown,
  movePortfolioUp,
  movePortfolioDown,
} = useAppState();

const groups = computed(() => config.value.groups ?? []);

const ungroupedCount = computed(
  () => config.value.watchlist.filter(
    (w) => (!w.groupId || w.groupId === DEFAULT_GROUP_ID) && !w.trackingOnly,
  ).length,
);

const groupCounts = computed(() => {
  const map: Record<string, number> = {};
  for (const w of config.value.watchlist) {
    if (w.groupId && !w.trackingOnly) {
      map[w.groupId] = (map[w.groupId] ?? 0) + 1;
    }
  }
    return map;
  });

  // v2.8 portfolio data
  const portfolios = computed(() => config.value.portfolios ?? []);
  const assignments = computed(() => config.value.portfolioAssignments ?? []);
  const trackingCodes = computed(() => new Set(getTrackingCodes()));
  const holdingsMap = computed(() => {
    const map: Record<string, { name: string; changePct: number | null }> = {};
    for (const card of cards.value) {
      if (trackingCodes.value.has(card.stock.code)) {
        map[card.stock.code] = {
          name: card.stock.name || card.stock.code,
          changePct: card.snapshot?.changePct ?? null,
        };
      }
    }
    // Also include tracking-only codes without diagnosis cards.
    for (const [code, snap] of trackingSnapshots.value) {
      if (!map[code]) map[code] = { name: snap.name, changePct: snap.changePct };
    }
    return map;
  });

  const groupedCards = computed(() => {
  const result: { group: { id: string; name: string; collapsed: boolean } | null; cards: typeof cards.value }[] = [];
  const sortedGroups = [...groups.value].sort((a, b) => a.order - b.order);
  const handled = new Set<string>();

  for (const group of sortedGroups) {
    const groupCards = cards.value.filter((c) => c.stock.groupId === group.id && !c.stock.trackingOnly);
    if (groupCards.length > 0) {
      for (const c of groupCards) {
        handled.add(c.stock.code);
      }
      result.push({ group: { id: group.id, name: group.name, collapsed: group.collapsed }, cards: groupCards });
    } else if (!group.collapsed) {
      result.push({ group: { id: group.id, name: group.name, collapsed: false }, cards: [] });
    }
  }

  const ungroupedCards = cards.value.filter((c) => !handled.has(c.stock.code) && !c.stock.trackingOnly);
  result.push({ group: null, cards: ungroupedCards });

  return result;
});

onMounted(() => {
  applyDocumentTitle();
  void bootstrap();
});
</script>

<template>
  <div class="app-layout">
    <Sidebar
      :groups="groups"
      :watchlist-count="watchlistCount"
      :ungrouped-count="ungroupedCount"
      :group-counts="groupCounts"
      :portfolios="portfolios"
      :collapsed="sidebarCollapsed"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
      @add-group="addGroup"
      @rename-group="renameGroup"
      @remove-group="removeGroup"
      @move-group-up="moveGroupUp"
      @move-group-down="moveGroupDown"
      @add-portfolio="addPortfolio"
      @rename-portfolio="renamePortfolio"
      @remove-portfolio="removePortfolio"
      @move-portfolio-up="movePortfolioUp"
      @move-portfolio-down="movePortfolioDown"
    />

    <div class="app-main">
      <ConfigPanel
        :config="config"
        :config-open="configOpen"
        :refreshing="refreshing"
        :has-api-key="hasApiKey"
        :storage-ok="storageOk"
        :using-file-config="usingFileConfig"
        :is-desktop="isDesktop"
        :calendar-label="calendarLabel"
        :watchlist-count="watchlistCount"
        v-model:stock-input="stockInput"
        :try-add-symbol="addSymbol"
        @toggle="configOpen = !configOpen"
        @save="saveConfigField"
        @save-config="saveConfigField({}); showToast(t('config.saved'))"
        @alert-settings-change="updateAlertSettings"
        @toast="showToast"
        @refresh="runRefresh(true)"
        @sync-calendar="initCalendar(true)"
        @export-backup="exportUserBackup"
      />

      <main class="main">
        <!-- v2.8 portfolio cards -->
        <PortfolioCard
          v-for="p in portfolios"
          :key="p.id"
          :portfolio="p"
          :assets="assignments.filter(a => a.portfolioId === p.id)"
          :change-pct="computePortfolioChange(p.id)"
          :holdings="holdingsMap"
          @refresh="refreshTrackingQuotes"
          @remove="removePortfolio(p.id)"
          @update-weight="(code, w) => upsertAssignment(code, p.id, w)"
          @remove-asset="(code) => removeAssignment(code, p.id)"
          @add-asset="(code, w) => { addSymbol(code, undefined, undefined); upsertAssignment(code, p.id, w); const item = config.watchlist.find(x => x.code === code); if (item) item.trackingOnly = true; }"
        />

        <div
          v-if="watchlistCount === 0"
          class="empty-state"
        >
          {{ t('empty.watchlist') }}
        </div>

        <template v-else>
          <section
            v-for="gc in groupedCards"
            :key="gc.group?.id ?? '__ungrouped__'"
            class="watch-section"
          >
            <h2
              class="section-title"
              :class="{ 'section-title-clickable': !!gc.group }"
              @click="gc.group && toggleGroupCollapse(gc.group.id)"
            >
              {{ gc.group ? `${gc.group.name} (${gc.cards.length})` : t('sidebar.ungrouped') + ` (${gc.cards.length})` }}
              <span v-if="gc.group?.collapsed" class="group-collapsed-mark">▶</span>
            </h2>
            <div
              v-if="gc.cards.length === 0 && !gc.group?.collapsed"
              class="section-empty"
            >
              {{ t('sidebar.groupEmpty') }}
            </div>
            <div v-else-if="gc.group?.collapsed" class="section-empty">
              {{ t('sidebar.groupCollapsedHint') }}
            </div>
            <div v-else class="grid">
              <StockCard
                v-for="card in gc.cards"
                :key="card.stock.code"
                :card="card"
                :groups="groups"
                @remove="removeSymbol"
                @refresh="runRefreshSymbol"
                @update-position="updateSymbolPosition"
                @add-key-level="(code: string, price: number, label: string) => { addCustomKeyLevel(code, price, label); }"
                @remove-key-level="(code: string, index: number) => { removeCustomKeyLevel(code, index); }"
                @toggle-key-levels-lock="(code: string) => { toggleKeyLevelsLock(code); }"
                @cycle-refresh-mode="(code: string) => { cycleRefreshMode(code); }"
                @set-group="(code: string, groupId: string | undefined) => { setSecurityGroup(code, groupId); }"
                @toast="showToast"
              />
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>

  <ToastContainer :toasts="toasts" />
</template>

<style>
@import './styles/global.css';

.app-layout {
  display: flex;
  min-height: 100dvh;
}

.app-main {
  flex: 1;
  min-width: 0;
}
</style>
