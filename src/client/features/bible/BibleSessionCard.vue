<script setup lang="ts">
import { computed } from "vue";
import { BookOpen, ChevronRight } from "lucide-vue-next";
import type { MessageDTO } from "@shared/types";
import { bibleSessionPaneLabel, parseBibleSessionPayload } from "../../bibleSessionShare";

const props = defineProps<{ message: MessageDTO }>();
const emit = defineEmits<{ open: [message: MessageDTO] }>();

const payload = computed(() => parseBibleSessionPayload(props.message.payload));
const paneSummary = computed(() =>
  (payload.value?.panes || []).map((pane, index) => `${String.fromCharCode(65 + index)}.${bibleSessionPaneLabel(pane)}`).join("  ")
);
</script>

<template>
  <div class="bible-session-wrap">
    <p v-if="payload?.description" class="bible-session-description">{{ payload.description }}</p>
    <button v-if="payload" type="button" class="bible-session-card" @click.stop="emit('open', message)">
      <span class="bible-session-icon"><BookOpen :size="22" /></span>
      <span class="bible-session-copy">
        <strong>打开的圣经 · {{ payload.panes.length }} 个窗格</strong>
        <em>{{ paneSummary }}</em>
        <small>{{ payload.translation || "圣经" }} · 点击一起阅读</small>
      </span>
      <ChevronRight :size="18" />
    </button>
    <p v-else class="bible-session-description">这条圣经分享内容已失效</p>
  </div>
</template>

<style scoped>
.bible-session-wrap {
  display: grid;
  gap: 6px;
}

.bible-session-description {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.bible-session-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 340px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.75);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.bible-session-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 8px;
  background: #8b6f47;
  color: #fff;
}

.bible-session-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.bible-session-copy strong {
  font-size: 14px;
}

.bible-session-copy em {
  font-style: normal;
  font-size: 12.5px;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.bible-session-copy small {
  font-size: 11.5px;
  opacity: 0.65;
}
</style>
