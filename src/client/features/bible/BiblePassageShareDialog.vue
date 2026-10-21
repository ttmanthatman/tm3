<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { BibleLookupDTO } from "@shared/types";
import { bibleAccountStateKey } from "./useBibleAccountState";
import AppModal from "../../components/ui/AppModal.vue";
import { biblePassageDraft, type BibleShareTextSender } from "./biblePassageSharing";

const props = defineProps<{
  channelName: string;
  sendText: BibleShareTextSender;
}>();
const emit = defineEmits<{ sent: [] }>();
const accountState = inject(bibleAccountStateKey, null);
const confirmationOpen = ref(true);
const passages = ref<BibleLookupDTO[]>([]);
const includeTranslation = ref(false);
const shareBusy = ref(false);
const error = ref("");
// A retry reuses both the request ID and the original options.
const optionsLocked = computed(() => shareBusy.value || !!error.value);
const submitLabel = computed(() => shareBusy.value ? "发送中…" : "发送到聊天室");
let requestId = "";

function open(lookups: BibleLookupDTO[]) {
  if (shareBusy.value || !lookups.length) return;
  passages.value = [...lookups];
  requestId = crypto.randomUUID();
  includeTranslation.value = accountState?.preferences.value?.shareIncludeTranslation ?? false;
  confirmationOpen.value = accountState?.preferences.value?.shareConfirm ?? true;
  error.value = "";
  if (!confirmationOpen.value) void share();
}
async function share() {
  if (shareBusy.value || !passages.value.length) return;
  shareBusy.value = true;
  error.value = "";
  try {
    const draft = biblePassageDraft(passages.value, includeTranslation.value);
    await props.sendText(draft.content, requestId, draft.payload);
    passages.value = [];
    emit("sent");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "发送失败，请重试";
  } finally {
    shareBusy.value = false;
  }
}
defineExpose({ open, busy: shareBusy });
</script>

<template>
  <Teleport to="body">
    <AppModal :open="!!passages.length && (confirmationOpen || !!error)" title="分享经文" :busy="shareBusy" content-class="bible-passage-share-dialog" @close="passages = []">
      <p class="passage-share-hint">{{ passages.length > 1 ? `已选 ${passages.length} 段经文，将合成一张经文卡片。` : "将以经文卡片分享。" }}长经文可展开阅读。</p>
      <div class="passage-share-preview">
        <article v-for="passage in passages" :key="passage.normalizedReference">
          <strong>{{ passage.normalizedReference }}</strong>
          <p>{{ passage.verses.map(verse => verse.text).join('') }}</p>
          <small v-if="includeTranslation">{{ passage.translation }}</small>
        </article>
      </div>
      <div class="passage-share-options">
        <label class="passage-share-option"><input v-model="includeTranslation" type="checkbox" :disabled="optionsLocked" />显示版本信息</label>
      </div>
      <p class="passage-share-target">发送到：{{ channelName }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer><button type="button" :disabled="shareBusy" @click="share">{{ submitLabel }}</button></footer>
    </AppModal>
  </Teleport>
</template>

<style scoped>
:global(.bible-passage-share-dialog) { max-height: calc(var(--app-height, 100dvh) - 32px); display: flex; flex-direction: column; gap: 12px; color: #604b32; }
:global(.bible-passage-share-dialog .modal-head) { flex-shrink: 0; }
.passage-share-preview { min-height: 0; margin: 0 16px; padding: 12px; background: #faf4e8; border-radius: 8px; overflow-y: auto; overscroll-behavior: contain; }
.passage-share-preview article { padding: 4px; }
.passage-share-preview article + article { margin-top: 12px; padding-top: 12px; border-top: 1px solid #8b705222; }
.passage-share-preview p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.passage-share-preview small { display: block; margin-top: 8px; color: #766650; }
.passage-share-options { display: flex; flex-shrink: 0; flex-wrap: wrap; gap: 0 18px; margin: 0 16px; }
.passage-share-option { display: flex; flex-shrink: 0; align-items: center; gap: 8px; min-height: 32px; cursor: pointer; }
.passage-share-option input { width: 18px; height: 18px; accent-color: #b9582b; }
.passage-share-option:has(input:disabled) { opacity: .55; cursor: default; }
.passage-share-hint { flex-shrink: 0; margin: 0 16px; font-size: 13px; line-height: 1.5; color: #766650; }
footer { display: flex; flex-shrink: 0; justify-content: flex-end; margin: 0 16px 16px; }
.passage-share-target, [role="alert"] { flex-shrink: 0; margin: 0 16px; }
footer button { min-height: 40px; padding: 8px 16px; border: 0; border-radius: 20px; background: #b9582b; color: white; font: inherit; cursor: pointer; }
footer button:disabled { opacity: .55; cursor: wait; }
[role="alert"] { color: #a33429; }
</style>
