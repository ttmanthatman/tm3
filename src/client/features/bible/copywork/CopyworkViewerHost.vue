<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { useChatStore } from "../../../store";
import CopyworkViewer from "./CopyworkViewer.vue";
import { viewedCopyworkId } from "./copyworkViewerState";
const emit = defineEmits<{ chat: [] }>();
const store = useChatStore();
watch(
  () => store.account?.id,
  () => {
    viewedCopyworkId.value = "";
  }
);
onBeforeUnmount(() => {
  viewedCopyworkId.value = "";
});
</script>
<template>
  <CopyworkViewer
    v-if="viewedCopyworkId"
    :key="viewedCopyworkId"
    :id="viewedCopyworkId"
    @close="viewedCopyworkId = ''"
    @chat="emit('chat')"
  />
</template>
