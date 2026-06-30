<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Portfolio, PortfolioAssignment } from '../types';

const props = defineProps<{
  portfolio: Portfolio;
  assets: PortfolioAssignment[];
  changePct: number | null;
  /** Map code → { name, changePct } for rendering top holdings */
  holdings: Record<string, { name: string; changePct: number | null }>;
}>();

const emit = defineEmits<{
  refresh: [];
  remove: [];
  rename: [name: string];
  addAsset: [];
}>();

const expanded = ref(true);

const top3 = computed(() =>
  [...props.assets]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3),
);

const restCount = computed(() =>
  Math.max(0, props.assets.length - 3),
);

const changeClass = computed(() => {
  if (props.changePct == null) return '';
  return props.changePct >= 0 ? 'up' : 'down';
});

const changeText = computed(() => {
  if (props.changePct == null) return '—';
  const sign = props.changePct >= 0 ? '+' : '';
  return `${sign}${props.changePct.toFixed(2)}%`;
});
</script>

<template>
  <section class="portfolio-card">
    <header class="pf-header">
      <button type="button" class="btn-ghost btn-sm" @click="expanded = !expanded">
        {{ expanded ? '▾' : '▸' }}
      </button>
      <span class="pf-name">{{ portfolio.name }}</span>
      <span class="pf-change" :class="changeClass">{{ changeText }}</span>
      <button type="button" class="btn-refresh" title="刷新组合行情" @click="emit('refresh')">↻</button>
      <button type="button" class="btn-link btn-link-sm" @click="emit('remove')">×</button>
    </header>

    <div v-if="expanded" class="pf-body">
      <div class="pf-top3">
        <div
          v-for="a in top3"
          :key="a.code"
          class="pf-row"
        >
          <span class="pf-code">{{ a.code.replace(/^(sh|sz|bj)/i, '') }}</span>
          <span class="pf-name-split">{{ props.holdings[a.code]?.name ?? a.code }}</span>
          <span class="pf-wt">{{ a.weight }}%</span>
          <span
            class="pf-row-pct"
            :class="(props.holdings[a.code]?.changePct ?? 0) >= 0 ? 'up' : 'down'"
          >
            {{ props.holdings[a.code]?.changePct != null ? (props.holdings[a.code]!.changePct! >= 0 ? '+' : '') + props.holdings[a.code]!.changePct!.toFixed(2) + '%' : '—' }}
          </span>
        </div>
      </div>
      <div v-if="restCount > 0" class="pf-rest">
        + 其余 {{ restCount }} 只持仓
      </div>
      <button type="button" class="btn-link btn-link-sm" @click="emit('addAsset')">
        + 添加证券
      </button>
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

.pf-change {
  font-size: 14px;
  font-weight: 600;
}
.pf-change.up { color: var(--up); }
.pf-change.down { color: var(--down); }

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
</style>
