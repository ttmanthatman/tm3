<script setup lang="ts">
import { ref } from "vue";
import type { BibleTopicDTO } from "@shared/bibleTopics";
import AppModal from "../../components/ui/AppModal.vue";

// 经文主题转发确认框：与 BiblePassageShareDialog 同款的应用内确认（AppModal），
// 代替系统 window.confirm；转发本身走服务端 share 路由（传入的 share 回调）。
const props = defineProps<{
  channelName: string;
  share: (topicId: number) => Promise<unknown>;
}>();
const emit = defineEmits<{ sent: [topic: BibleTopicDTO]; failed: [message: string] }>();
const topic = ref<BibleTopicDTO | null>(null);
const busy = ref(false);
const error = ref("");

function open(candidate: BibleTopicDTO) {
  if (busy.value || !candidate.passages.length) return;
  topic.value = candidate;
  error.value = "";
}

async function confirmShare() {
  if (busy.value || !topic.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.share(topic.value.id);
    const sent = topic.value;
    topic.value = null;
    emit("sent", sent);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "转发失败，请重试";
    emit("failed", error.value);
  } finally {
    busy.value = false;
  }
}

defineExpose({ open, busy });
</script>

<template>
  <Teleport to="body">
    <AppModal :open="!!topic" title="转发经文主题" :busy="busy" content-class="bible-topic-share-dialog" @close="topic = null">
      <div v-if="topic" class="topic-share-preview">
        <strong>{{ topic.name }}</strong>
        <small>{{ topic.passages.length }} 段经文</small>
        <ul>
          <li v-for="passage in topic.passages" :key="passage.id">{{ passage.reference }}</li>
        </ul>
      </div>
      <p>发送到：{{ channelName }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer><button type="button" :disabled="busy" @click="confirmShare">{{ busy ? "转发中…" : "转发到聊天室" }}</button></footer>
    </AppModal>
  </Teleport>
</template>

<style scoped>
:global(.bible-topic-share-dialog) { max-height: calc(var(--app-height, 100dvh) - 32px); display: flex; flex-direction: column; gap: 12px; color: #604b32; }
:global(.bible-topic-share-dialog .modal-head) { flex-shrink: 0; }
.topic-share-preview { min-height: 0; margin: 0 16px; padding: 12px; background: #faf4e8; border-radius: 8px; display: grid; gap: 4px; }
.topic-share-preview strong { font-family: "Songti SC", "STSong", serif; overflow-wrap: anywhere; }
.topic-share-preview small { color: #766650; }
.topic-share-preview ul { margin: 8px 0 0; padding: 0 0 0 4px; list-style: none; max-height: 200px; overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 2px; color: #574330; font-size: 14px; }
.topic-share-preview li::before { content: "· "; color: #95704a; }
footer { display: flex; flex-shrink: 0; justify-content: flex-end; margin: 0 16px 16px; }
footer button { min-height: 40px; padding: 8px 16px; border: 0; border-radius: 20px; background: #b9582b; color: white; font: inherit; cursor: pointer; }
footer button:disabled { opacity: .55; cursor: wait; }
p { flex-shrink: 0; margin: 0 16px; }
[role="alert"] { color: #a33429; }
</style>
