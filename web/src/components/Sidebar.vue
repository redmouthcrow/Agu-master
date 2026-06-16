<script setup lang="ts">
import { ref, computed } from 'vue';
import type { UserGroup } from '../types';
import { useI18n } from '../i18n';

const props = defineProps<{
  groups: UserGroup[];
  watchlistCount: number;
  ungroupedCount: number;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  toggleCollapse: [];
  addGroup: [name: string];
  renameGroup: [id: string, name: string];
  removeGroup: [id: string];
  closeSidebar: [];
}>();

const { t } = useI18n();

const addingGroup = ref(false);
const newGroupName = ref('');

const editingId = ref<string | null>(null);
const editName = ref('');

const sortedGroups = computed(() =>
  [...props.groups].sort((a, b) => a.order - b.order),
);

function confirmAddGroup() {
  const trimmed = newGroupName.value.trim();
  if (!trimmed) {
    addingGroup.value = false;
    return;
  }
  emit('addGroup', trimmed);
  newGroupName.value = '';
  addingGroup.value = false;
}

function startRename(group: UserGroup) {
  editingId.value = group.id;
  editName.value = group.name;
}

function confirmRename() {
  const trimmed = editName.value.trim();
  if (trimmed && editingId.value) {
    emit('renameGroup', editingId.value, trimmed);
  }
  editingId.value = null;
  editName.value = '';
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-collapsed': collapsed }">
    <div class="sidebar-header">
      <button
        v-if="collapsed"
        class="btn-collapse-expand"
        :title="t('sidebar.collapse')"
        @click="emit('toggleCollapse')"
      >»</button>
      <template v-else>
        <span class="sidebar-title">AguMaster</span>
        <button
          class="btn-collapse"
          :title="t('sidebar.collapse')"
          @click="emit('toggleCollapse')"
        >«</button>
      </template>
    </div>

    <template v-if="!collapsed">
      <div class="sidebar-body">
        <div class="sidebar-add">
          <button
            type="button"
            class="btn-sidebar-add"
            @click="addingGroup = true"
          >{{ t('sidebar.newGroup') }}</button>
        </div>

        <div v-if="addingGroup" class="group-edit-row">
          <input
            v-model="newGroupName"
            type="text"
            maxlength="10"
            class="group-edit-input"
            @keyup.enter="confirmAddGroup"
            @keyup.escape="addingGroup = false"
          />
          <button class="btn-link btn-link-sm" @click="confirmAddGroup">
            {{ t('common.save') }}
          </button>
          <button class="btn-link btn-link-sm" @click="addingGroup = false">
            {{ t('common.cancel') }}
          </button>
        </div>

        <div class="group-list">
          <div
            v-for="group in sortedGroups"
            :key="group.id"
            class="group-item"
          >
            <template v-if="editingId === group.id">
              <input
                v-model="editName"
                type="text"
                maxlength="10"
                class="group-edit-input"
                @keyup.enter="confirmRename"
                @keyup.escape="editingId = null"
              />
            </template>
            <template v-else>
              <span class="group-name">{{ group.name }}</span>
              <button
                class="btn-menu"
                @click="startRename(group)"
              >{{ t('sidebar.renameGroup') }}</button>
              <button
                class="btn-menu btn-menu-danger"
                @click="emit('removeGroup', group.id)"
              >{{ t('sidebar.deleteGroup') }}</button>
            </template>
          </div>
        </div>

        <div class="group-stats">
          <span class="stat-text">{{ props.ungroupedCount }} {{ t('sidebar.ungrouped') }}</span>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  min-width: 200px;
  height: 100dvh;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width 0.15s, min-width 0.15s;
  overflow: hidden;
}

.sidebar-collapsed {
  width: 36px;
  min-width: 36px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  font-weight: 600;
  font-size: 14px;
}

.btn-collapse,
.btn-collapse-expand {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 8px;
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.sidebar-add {
  padding: 0 12px 8px;
}

.btn-sidebar-add {
  width: 100%;
  min-height: 32px;
  border-radius: var(--radius);
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
}

.btn-sidebar-add:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

.group-edit-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px 8px;
}

.group-edit-input {
  flex: 1;
  min-height: 28px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.group-list {
  padding: 0 12px;
}

.group-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  font-size: 13px;
}

.group-name {
  flex: 1;
  color: var(--text);
}

.btn-menu {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 0 4px;
}

.btn-menu:hover {
  color: var(--text);
}

.btn-menu-danger:hover {
  color: var(--up);
}

.group-stats {
  padding: 12px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}

.stat-text {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
