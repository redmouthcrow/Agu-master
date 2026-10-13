<script setup lang="ts">
import { computed } from 'vue';
import type { EquitySnapshot, PerformanceStats } from '../types';
import { useI18n } from '../i18n';

const props = defineProps<{
  stats: PerformanceStats;
  snapshots: EquitySnapshot[];
  skipped: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtNum(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

const hasTrades = computed(() => props.stats.attribution.length > 0 || props.stats.realizedPnl !== 0);
const hasCurve = computed(() => props.snapshots.length >= 2);

/** SVG polyline points for one series, normalized into the chart box. */
function polyline(values: number[], w: number, h: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const CHART_W = 360;
const CHART_H = 120;

const equityLine = computed(() =>
  polyline(props.snapshots.map((s) => s.totalAssets), CHART_W, CHART_H),
);

const benchmarkLine = computed(() => {
  const idx = props.snapshots.filter((s) => s.indexClose != null && s.indexClose > 0);
  if (idx.length < 2) return '';
  return polyline(idx.map((s) => s.indexClose!), CHART_W, CHART_H);
});

const attributionLabels: Record<string, string> = {
  short: 'perf.planShort',
  band: 'perf.planBand',
  build: 'perf.planBuild',
  manual: 'perf.planManual',
};
</script>

<template>
  <div class="perf-overlay" @click.self="emit('close')">
    <div class="perf-modal">
      <div class="perf-header">
        <h2>{{ t('perf.title') }}</h2>
        <button class="btn-close" @click="emit('close')">×</button>
      </div>

      <div class="perf-body">
        <!-- 指标行 -->
        <div class="metric-grid">
          <div class="metric">
            <span class="metric-label">{{ t('perf.totalReturn') }}</span>
            <span class="metric-value" :class="(stats.totalReturn ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPct(stats.totalReturn) }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ t('perf.excess') }}</span>
            <span class="metric-value" :class="(stats.excessReturn ?? 0) >= 0 ? 'up' : 'down'">{{ fmtPct(stats.excessReturn) }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ t('perf.realized') }}</span>
            <span class="metric-value" :class="stats.realizedPnl >= 0 ? 'up' : 'down'">{{ fmtNum(stats.realizedPnl) }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ t('perf.winRate') }}</span>
            <span class="metric-value">{{ stats.winRate == null ? '—' : stats.winRate.toFixed(2) + '%' }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ t('perf.maxDrawdown') }}</span>
            <span class="metric-value down">{{ stats.maxDrawdown == null ? '—' : Math.abs(stats.maxDrawdown).toFixed(2) + '%' }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ t('perf.profitFactor') }}</span>
            <span class="metric-value">{{ stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2) }}</span>
          </div>
        </div>

        <!-- 跳过提示 -->
        <div v-if="skipped" class="perf-notice">{{ t('perf.skippedDay') }}</div>

        <!-- 净值曲线 -->
        <div class="perf-chart">
          <template v-if="hasCurve">
            <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="chart-svg">
              <polyline v-if="benchmarkLine" :points="benchmarkLine" class="line-benchmark" />
              <polyline :points="equityLine" class="line-equity" />
            </svg>
            <div class="chart-legend">
              <span class="legend-equity">{{ t('perf.legendEquity') }}</span>
              <span v-if="benchmarkLine" class="legend-benchmark">{{ t('perf.legendBenchmark') }}</span>
            </div>
          </template>
          <div v-else class="perf-empty">
            {{ hasTrades ? t('perf.curveAccumulating') : t('perf.empty') }}
          </div>
        </div>

        <!-- 归因表 -->
        <table v-if="hasTrades" class="attr-table">
          <thead>
            <tr>
              <th>{{ t('perf.attrType') }}</th>
              <th>{{ t('perf.attrCount') }}</th>
              <th>{{ t('perf.attrWinRate') }}</th>
              <th>{{ t('perf.attrPnl') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stats.attribution" :key="row.planType">
              <td>{{ t(attributionLabels[row.planType] as never) }}</td>
              <td>{{ row.sellCount }}</td>
              <td>{{ row.winRate == null ? '—' : row.winRate.toFixed(2) + '%' }}</td>
              <td :class="row.totalPnl >= 0 ? 'up' : 'down'">{{ fmtNum(row.totalPnl) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="perf-empty">{{ t('perf.empty') }}</div>

        <div class="perf-footnote">{{ t('perf.scopeNote') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.perf-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.perf-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.perf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.perf-header h2 { font-size: 16px; margin: 0; }
.btn-close { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.perf-body { padding: 12px 18px 16px; }

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px 10px;
  margin-bottom: 12px;
}
.metric { display: flex; flex-direction: column; gap: 2px; }
.metric-label { font-size: 11px; color: var(--text-muted); }
.metric-value { font-size: 14px; font-weight: 600; }
.metric-value.up { color: var(--up); }
.metric-value.down { color: var(--down); }

.perf-notice {
  font-size: 11px;
  color: #faad14;
  padding: 4px 8px;
  background: rgba(250, 173, 20, 0.08);
  border-radius: 4px;
  margin-bottom: 10px;
}

.perf-chart { margin-bottom: 12px; }
.chart-svg { width: 100%; height: 120px; display: block; background: var(--bg); border-radius: 6px; }
.line-equity { fill: none; stroke: #4096ff; stroke-width: 2; }
.line-benchmark { fill: none; stroke: var(--text-dim); stroke-width: 1.5; stroke-dasharray: 4 3; }
.chart-legend { display: flex; gap: 12px; font-size: 10px; color: var(--text-muted); margin-top: 4px; }
.legend-equity::before { content: '— '; color: #4096ff; }
.legend-benchmark::before { content: '-- '; color: var(--text-dim); }

.perf-empty {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 24px 0;
}

.attr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.attr-table th {
  text-align: left;
  color: var(--text-muted);
  font-weight: 500;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.attr-table td { padding: 4px 6px; }
.attr-table td.up { color: var(--up); }
.attr-table td.down { color: var(--down); }

.perf-footnote { font-size: 10px; color: var(--text-dim); margin-top: 10px; }
</style>
