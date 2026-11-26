<script setup lang="ts">
import { shallowRef, watch, type CSSProperties } from "vue";
import AppModal from "../../components/ui/AppModal.vue";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const palettes = [
  ["#40213f", "#713451", "#a3474b"],
  ["#242c4e", "#514371", "#82517a"],
  ["#123f4a", "#356475", "#64705a"],
  ["#3e2857", "#654776", "#925663"],
  ["#4d292b", "#7f4238", "#9f583a"],
  ["#203b49", "#3d5b70", "#62678e"]
] as const;
const theme = shallowRef<CSSProperties>({});
let previous = -1;
watch(() => props.open, open => {
  if (!open) return;
  // Keep a new opening distinct; typing and resizing never change its colors.
  let next = Math.floor(Math.random() * (palettes.length - (previous < 0 ? 0 : 1)));
  if (previous >= 0 && next >= previous) next++;
  previous = next;
  const [start, middle, end] = palettes[next]!;
  theme.value = {
    "--book-dialog-background": `linear-gradient(145deg, ${start}, ${middle} 52%, ${end})`,
    "--book-dialog-heading": start
  };
}, { immediate: true });
</script>

<template>
  <AppModal v-bind="$attrs" :open="open" :style="theme" @close="emit('close')"><slot /></AppModal>
</template>
