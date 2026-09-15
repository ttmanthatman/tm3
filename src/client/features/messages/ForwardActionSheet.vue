<script setup lang="ts">
const emit = defineEmits<{
  close: [];
  choose: [mode: "separate" | "merged"];
}>();
</script>

<template>
  <section class="modal-shell forward-sheet-shell" @click.self="emit('close')">
    <div class="forward-action-sheet" role="dialog" aria-label="选择转发方式">
      <button type="button" @click="emit('choose', 'separate')">逐条转发</button>
      <button type="button" @click="emit('choose', 'merged')">合并转发</button>
      <button type="button" class="forward-action-cancel" @click="emit('close')">取消</button>
    </div>
  </section>
</template>
