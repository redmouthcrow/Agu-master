<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Portfolio, PortfolioAssignment, StockCardState } from '../types';
import { normalizeWatchlistSymbol } from '../utils/stockCode';

const SECTORS = [
  { code: '', name: '不选' },
  { code: 'sh512480', name: '半导体' },
  { code: 'sh512690', name: '白酒' },
  { code: 'sh516160', name: '新能源' },
  { code: 'sh512010', name: '医药' },
  { code: 'sh512800', name: '银行' },
  { code: 'sh512660', name: '军工' },
  { code: 'sh515000', name: '科技' },
  { code: 'sh512880', name: '证券' },
  { code: 'sh512200', name: '地产' },
  { code: 'sh515220', name: '煤炭' },
  { code: 'sh512400', name: '有色' },
  { code: 'sh516880', name: '光伏' },
  { code: 'sh516110', name: '汽车' },
  { code: 'sh515070', name: '人工智能' },
  { code: 'sh512600', name: '消费' },
];

const props = defineProps<{
  portfolio: Portfolio;
  assets: PortfolioAssignment[];
  changePct: number | null;
  /** Map code → { name, changePct } for rendering top holdings */
  holdings: Record<string, { name: string; changePct: number | null }>;
  trackingSnapshots: Map<string, { name: string; price: number | null; changePct: number | null }>;
  cards: StockCardState[];
}>();

const emit = defineEmits<{
  refresh: [];
  remove: [];
  rename: [name: string];
  addAsset: [code: string, weight: number];
  updateWeight: [code: string, weight: number];
  removeAsset: [code: string];
  setSector: [sectorCode: string];
}>();

const expanded = ref(true);
const editingWeight = ref<string | null>(null);
const editWtValue = ref('');
const addingAsset = ref(false);
const newAssetCode = ref('');
const newAssetWt = ref('');
const loading = ref(false);
const showAll = ref(false);

function startEditWeight(code: string, currentWt: number) {
  editingWeight.value = code;
  editWtValue.value = String(currentWt);
}

function confirmWeight(code: string) {
  const w = Number(editWtValue.value);
  if (!isNaN(w) && w > 0 && w <= 100) {
    emit('updateWeight', code, w);
  }
  editingWeight.value = null;
}

function doRefresh() {
  loading.value = true;
  emit('refresh');
  setTimeout(() => (loading.value = false), 5000);
}

function confirmAddAsset() {
  const raw = newAssetCode.value.trim();
  const w = Number(newAssetWt.value);
  if (!raw || isNaN(w) || w <= 0 || w > 100) return;
  const parsed = normalizeWatchlistSymbol(raw);
  if (!parsed) return;
  emit('addAsset', parsed.code, w);
  newAssetCode.value = '';
  newAssetWt.value = '';
  addingAsset.value = false;
}

const sortedAssets = computed(() =>
  [...props.assets].sort((a, b) => b.weight - a.weight),
);

const top3 = computed(() => sortedAssets.value.slice(0, 3));

const restCount = computed(() =>
  Math.max(0, props.assets.length - 3),
);

const displayChange = computed(() => {
  const portfolio = props.portfolio;
  const assignments = props.assets;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const a of assignments) {
    const snap = props.trackingSnapshots.get(a.code) ?? props.cards.find((c) => c.stock.code === a.code)?.snapshot;
    if (!snap || snap.changePct == null) continue;
    weightedSum += a.weight * snap.changePct;
    totalWeight += a.weight;
  }
  if (totalWeight === 0) {
    if (portfolio.sectorCode) {
      const snap = props.trackingSnapshots.get(portfolio.sectorCode);
      return snap?.changePct != null ? snap.changePct : null;
    }
    return null;
  }
  let result = Math.round((weightedSum / totalWeight) * 100) / 100;
  if (portfolio.sectorCode && totalWeight < 100) {
    const sectorSnap = props.trackingSnapshots.get(portfolio.sectorCode);
    if (sectorSnap?.changePct != null) {
      result = result + sectorSnap.changePct * ((100 - totalWeight) / 100);
      result = Math.round(result * 100) / 100;
    }
  }
  return result;
});

const changeClass = computed(() => {
  if (displayChange.value == null) return '';
  return displayChange.value >= 0 ? 'up' : 'down';
});
</script>

<template>
  <section class="portfolio-card">
    <header class="pf-header">
      <button type="button" class="btn-ghost btn-sm" @click="expanded = !expanded">
        {{ expanded ? '▾' : '▸' }}
      </button>
      <span class="pf-name">{{ portfolio.name }}</span>
      <select class="pf-sector-select" :value="portfolio.sectorCode ?? ''" @change="emit('setSector', ($event.target as HTMLSelectElement).value)">
        <option v-for="s in SECTORS" :key="s.code" :value="s.code">{{ s.name }}</option>
      </select>
      <span class="pf-change" :class="changeClass">{{ displayChange != null ? (displayChange >= 0 ? '+' : '') + displayChange.toFixed(2) + '%' : '—' }}</span>
      <button type="button" class="btn-refresh" :disabled="loading" :title="loading ? '刷新中…' : '刷新组合行情'" @click="doRefresh">{{ loading ? '⌛' : '↻' }}</button>
      <button type="button" class="btn-remove" aria-label="删除组合" @click="emit('remove')">×</button>
    </header>

    <div v-if="expanded" class="pf-body">
      <div class="pf-top3">
        <div
          v-for="a in (showAll ? sortedAssets : top3)"
          :key="a.code"
          class="pf-row"
        >
          <span class="pf-code">{{ a.code.replace(/^(sh|sz|bj)/i, '') }}</span>
          <span class="pf-name-split">{{ props.holdings[a.code]?.name ?? a.code }}</span>
          <button class="btn-edit-wt" @click.stop="startEditWeight(a.code, a.weight)" title="编辑权重">✎</button>
          <span class="pf-wt" @click.stop="startEditWeight(a.code, a.weight)">
            <template v-if="editingWeight === a.code">
              <input
                v-model="editWtValue"
                type="number"
                min="0"
                max="100"
                class="wt-input"
                @keyup.enter="confirmWeight(a.code)"
                @keyup.escape="editingWeight = null"
              />
              <button class="btn-link btn-link-sm" @click.stop="confirmWeight(a.code)">保存</button>
            </template>
            <template v-else>{{ a.weight }}%</template>
          </span>
          <span
            class="pf-row-pct"
            :class="(props.holdings[a.code]?.changePct ?? 0) >= 0 ? 'up' : 'down'"
          >
            {{ props.holdings[a.code]?.changePct != null ? (props.holdings[a.code]!.changePct! >= 0 ? '+' : '') + props.holdings[a.code]!.changePct!.toFixed(2) + '%' : '—' }}
          </span>
          <button class="pf-remove" @click.stop="emit('removeAsset', a.code)">×</button>
        </div>
      </div>
      <div v-if="restCount > 0" class="pf-rest" @click="showAll = !showAll" style="cursor:pointer">
        {{ showAll ? '收起全部持仓' : `+ 其余 ${restCount} 只持仓` }}
      </div>
      <div v-if="!addingAsset" class="pf-rest">
        <button type="button" class="btn-link btn-link-sm" @click="addingAsset = true">
          + 添加证券
        </button>
      </div>
      <div v-else class="pf-add-row">
        <input v-model="newAssetCode" type="text" maxlength="8" placeholder="代码" class="add-code" @keyup.enter="confirmAddAsset" @keyup.escape="addingAsset = false" />
        <input v-model="newAssetWt" type="number" min="1" max="100" placeholder="权重%" class="add-wt" @keyup.enter="confirmAddAsset" @keyup.escape="addingAsset = false" />
        <button type="button" class="btn-link btn-link-sm" @click="confirmAddAsset">保存</button>
        <button type="button" class="btn-link btn-link-sm" @click="addingAsset = false">取消</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.portfolio-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 12px;
  overflow: hidden;
}

.pf-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--bg);
}

.pf-name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}
.pf-sector { font-size: 10px; color: var(--text-dim); background: var(--bg); padding: 1px 5px; border-radius: 3px; }
.pf-sector-select { min-height: 22px; padding: 0 3px; border-radius: 3px; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font-size: 10px; max-width: 72px; }

.pf-change {
  font-size: 14px;
  font-weight: 600;
}
.pf-change.up { color: var(--up); }
.pf-change.down { color: var(--down); }

.wt-input { width: 44px; min-height: 20px; padding: 1px 3px; border-radius: 3px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 11px; text-align: right; }

.btn-refresh {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 8px;
  color: var(--text-muted);
}

.pf-body {
  padding: 0 12px 8px;
}

.pf-top3 {
  margin: 6px 0;
}

.pf-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 13px;
}

.pf-code {
  color: var(--text-muted);
  font-size: 11px;
  min-width: 48px;
}

.pf-name-split {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-wt {
  color: var(--text-dim);
  font-size: 11px;
  min-width: 36px;
  text-align: right;
}

.pf-row-pct {
  font-size: 12px;
  min-width: 56px;
  text-align: right;
}
.pf-row-pct.up { color: var(--up); }
.pf-row-pct.down { color: var(--down); }

.pf-rest {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 0;
}

.btn-sm {
  padding: 0 4px;
  font-size: 12px;
}

.pf-add-row { display: flex; align-items: center; gap: 4px; padding: 6px 0; }
.add-code { width: 200px; min-height: 26px; padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; }
.add-wt { width: 100px; min-height: 26px; padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12px; }
.pf-remove { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1; }
.pf-remove:hover { color: var(--up); }
.btn-edit-wt { background: none; border: none; color: #faad14; cursor: pointer; font-size: 11px; padding: 0 2px; font-weight: 600; }
.btn-edit-wt:hover { color: var(--text); }
</style>
