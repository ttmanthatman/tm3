<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { X } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    size?: "small" | "medium";
    busy?: boolean;
    ariaLabel?: string;
    closeLabel?: string;
    contentClass?: string;
  }>(),
  { title: "", size: "small", busy: false, ariaLabel: "", closeLabel: "关闭", contentClass: "" }
);
const emit = defineEmits<{ close: [] }>();

function requestClose() {
  if (props.busy) return;
  emit("close");
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  requestClose();
}

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener("keydown", handleEscape);
    else document.removeEventListener("keydown", handleEscape);
  },
  { immediate: true }
);
onBeforeUnmount(() => document.removeEventListener("keydown", handleEscape));
</script>

<template>
  <section
    v-if="open"
    class="modal-shell"
    role="dialog"
    aria-modal="true"
    :aria-label="ariaLabel || title || undefined"
    @click.self="requestClose"
  >
    <div :class="[size === 'small' ? 'small-modal' : 'app-modal-medium', contentClass]">
      <header v-if="title || $slots.header" class="modal-head">
        <slot name="header"><strong>{{ title }}</strong></slot>
        <button class="icon-btn" type="button" :disabled="busy" :aria-label="closeLabel" @click="requestClose"><X :size="20" /></button>
      </header>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.app-modal-medium {
  width: min(760px, 100%);
  min-height: 0;
  max-height: min(760px, calc(var(--app-height) - var(--safe-top) - var(--safe-bottom) - 24px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}
</style>
