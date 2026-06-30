<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Portfolio, UserGroup } from '../types';
import { useI18n } from '../i18n';

const props = defineProps<{
  groups: UserGroup[];
  watchlistCount: number;
  ungroupedCount: number;
  groupCounts: Record<string, number>;
  portfolios: Portfolio[];
  collapsed: boolean;
}>();

const emit = defineEmits<{
  toggleCollapse: [];
  addGroup: [name: string];
  renameGroup: [id: string, name: string];
  removeGroup: [id: string];
  closeSidebar: [];
  addPortfolio: [name: string];
  renamePortfolio: [id: string, name: string];
  removePortfolio: [id: string];
}>();

const { t } = useI18n();

const addingGroup = ref(false);
const newGroupName = ref('');
const addingPortfolio = ref(false);
const newPortfolioName = ref('');

const editingId = ref<string | null>(null);
const editName = ref('');
const editingPfId = ref<string | null>(null);
const editPfName = ref('');

const sortedGroups = computed(() => [...props.groups].sort((a, b) => a.order - b.order));

function confirmAddGroup() {
  const trimmed = newGroupName.value.trim();
  if (!trimmed) { addingGroup.value = false; return; }
  emit('addGroup', trimmed);
  newGroupName.value = ''; addingGroup.value = false;
}
function startRename(g: UserGroup) { editingId.value = g.id; editName.value = g.name; }
function confirmRename() {
  const t = editName.value.trim();
  if (t && editingId.value) emit('renameGroup', editingId.value, t);
  editingId.value = null; editName.value = '';
}
function cancelRename() { editingId.value = null; editName.value = ''; }

function confirmAddPortfolio() {
  const t = newPortfolioName.value.trim();
  if (!t) { addingPortfolio.value = false; return; }
  emit('addPortfolio', t);
  newPortfolioName.value = ''; addingPortfolio.value = false;
}
function startPfRename(p: Portfolio) { editingPfId.value = p.id; editPfName.value = p.name; }
function confirmPfRename() {
  const t = editPfName.value.trim();
  if (t && editingPfId.value) emit('renamePortfolio', editingPfId.value, t);
  editingPfId.value = null; editPfName.value = '';
}
function cancelPfRename() { editingPfId.value = null; editPfName.value = ''; }
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-collapsed': collapsed }">
    <div class="sidebar-header">
      <button v-if="collapsed" class="btn-collapse-expand" :title="t('sidebar.collapse')" @click="emit('toggleCollapse')">»</button>
      <template v-else>
        <span class="sidebar-title">AguMaster</span>
        <button class="btn-collapse" :title="t('sidebar.collapse')" @click="emit('toggleCollapse')">«</button>
      </template>
    </div>

    <template v-if="!collapsed">
      <div class="sidebar-body">
        <div class="sidebar-add"><button type="button" class="btn-sidebar-add" @click="addingGroup = true">{{ t('sidebar.newGroup') }}</button></div>
        <div v-if="addingGroup" class="edit-row">
          <input v-model="newGroupName" type="text" maxlength="10" class="edit-input" @keyup.enter="confirmAddGroup" @keyup.escape="addingGroup = false" />
          <button class="btn-link btn-link-sm" @click="confirmAddGroup">{{ t('common.save') }}</button>
          <button class="btn-link btn-link-sm" @click="addingGroup = false">{{ t('common.cancel') }}</button>
        </div>

        <div class="item-list">
          <div v-for="group in sortedGroups" :key="group.id" class="item-row">
            <template v-if="editingId === group.id">
              <input v-model="editName" type="text" maxlength="10" class="edit-input" @keyup.enter="confirmRename" @keyup.escape="cancelRename" />
              <button class="btn-link btn-link-sm" @click="confirmRename">{{ t('common.save') }}</button>
              <button class="btn-link btn-link-sm" @click="cancelRename">{{ t('common.cancel') }}</button>
            </template>
            <template v-else>
              <span class="item-name">{{ group.name }}<span class="item-count">({{ props.groupCounts[group.id] ?? 0 }})</span></span>
              <button class="btn-menu" @click="startRename(group)">{{ t('sidebar.renameGroup') }}</button>
              <button class="btn-menu btn-menu-danger" @click="emit('removeGroup', group.id)">{{ t('sidebar.deleteGroup') }}</button>
            </template>
          </div>
        </div>

        <div class="stats-footer"><span class="stat-text">{{ props.ungroupedCount }} {{ t('sidebar.ungrouped') }}</span></div>

        <div class="divider"></div>

        <div class="sidebar-add"><button type="button" class="btn-sidebar-add" @click="addingPortfolio = true">+ 新建组合</button></div>
        <div v-if="addingPortfolio" class="edit-row">
          <input v-model="newPortfolioName" type="text" maxlength="10" class="edit-input" @keyup.enter="confirmAddPortfolio" @keyup.escape="addingPortfolio = false" />
          <button class="btn-link btn-link-sm" @click="confirmAddPortfolio">{{ t('common.save') }}</button>
          <button class="btn-link btn-link-sm" @click="addingPortfolio = false">{{ t('common.cancel') }}</button>
        </div>

        <div class="item-list">
          <div v-for="p in portfolios" :key="p.id" class="item-row">
            <template v-if="editingPfId === p.id">
              <input v-model="editPfName" type="text" maxlength="10" class="edit-input" @keyup.enter="confirmPfRename" @keyup.escape="cancelPfRename" />
              <button class="btn-link btn-link-sm" @click="confirmPfRename">{{ t('common.save') }}</button>
              <button class="btn-link btn-link-sm" @click="cancelPfRename">{{ t('common.cancel') }}</button>
            </template>
            <template v-else>
              <span class="item-name">📊 {{ p.name }}</span>
              <button class="btn-menu" @click="startPfRename(p)">重命名</button>
              <button class="btn-menu btn-menu-danger" @click="emit('removePortfolio', p.id)">删除</button>
            </template>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.sidebar { width: 200px; min-width: 200px; height: 100dvh; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; transition: width 0.15s, min-width 0.15s; overflow: hidden; position: sticky; top: 0; align-self: flex-start; }
.sidebar-collapsed { width: 36px; min-width: 36px; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.sidebar-title { font-weight: 600; font-size: 14px; }
.btn-collapse, .btn-collapse-expand { background: none; border: 1px solid var(--border); color: var(--text-muted); border-radius: 4px; cursor: pointer; font-size: 14px; padding: 2px 8px; }
.sidebar-body { flex: 1; overflow-y: auto; padding: 8px 0; }
.sidebar-add { padding: 0 12px 8px; }
.btn-sidebar-add { width: 100%; min-height: 32px; border-radius: var(--radius); border: 1px dashed var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 13px; }
.btn-sidebar-add:hover { border-color: var(--text-muted); color: var(--text); }
.edit-row { display: flex; align-items: center; gap: 2px; padding: 0 12px 8px; }
.edit-row .btn-link { flex-shrink: 0; margin: 0; text-decoration: none; }
.edit-input { flex: 1; min-width: 0; min-height: 28px; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px; }
.item-list { padding: 0 12px; }
.item-row { display: flex; align-items: center; gap: 2px; padding: 4px 0; font-size: 13px; flex-wrap: wrap; row-gap: 2px; }
.item-name { flex: 1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-count { color: var(--text-muted); font-size: 11px; }
.btn-menu { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 11px; padding: 2px 4px; white-space: nowrap; }
.btn-menu:hover { color: var(--text); }
.btn-menu-danger:hover { color: var(--up); }
.stats-footer { padding: 12px; border-top: 1px solid var(--border); margin-top: 8px; }
.stat-text { color: var(--text-muted); font-size: 12px; }
.divider { height: 1px; background: var(--border); margin: 8px 12px; }
</style>
