<script setup lang="ts">
defineProps<{
  toasts: { id: number; message: string }[];
}>();
</script>

<template>
  <div class="toast-stack" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast">
      {{ t.message }}
    </div>
  </div>
</template>
