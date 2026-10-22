<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import type { AssistantFeatureId } from "@shared/assistantTools";
import type { MessageSearchResultDTO } from "@shared/types";
import AppModal from "../../components/ui/AppModal.vue";

const UsageHelp = defineAsyncComponent(() => import("../chat/ChatUsageHelp.vue"));
const MessageSearch = defineAsyncComponent(() => import("../chat/MessageSearchWindow.vue"));
const ScoreLibrary = defineAsyncComponent(() => import("../music/MusicScoreLibrary.vue"));
const props = defineProps<{
  handlers: Record<Exclude<AssistantFeatureId, "help" | "search" | "scores">, () => unknown>;
  channelId: number | null;
}>();
const emit = defineEmits<{ jump: [result: MessageSearchResultDTO] }>();
const helpOpen = ref(false);
const searchOpen = ref(false);
const scoresOpen = ref(false);
const error = ref("");
async function open(feature: AssistantFeatureId) {
  if (feature === "help") helpOpen.value = true;
  else if (feature === "search") searchOpen.value = true;
  else if (feature === "scores") scoresOpen.value = true;
  else {
    try { await props.handlers[feature](); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "暂时无法打开此功能，请稍后重试"; }
  }
}
defineExpose({ open });
</script>

<template>
  <UsageHelp v-if="helpOpen" @close="helpOpen = false" />
  <MessageSearch v-if="searchOpen" @close="searchOpen = false" @jump="emit('jump', $event)" />
  <ScoreLibrary v-if="scoresOpen" :current-channel-id="channelId" @close="scoresOpen = false" />
  <AppModal :open="!!error" title="暂时无法打开功能" @close="error = ''"><p role="alert">{{ error }}</p></AppModal>
</template>
