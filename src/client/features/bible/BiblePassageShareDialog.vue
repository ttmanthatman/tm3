<script setup lang="ts">
import { inject, ref } from "vue";
import type { BibleLookupDTO } from "@shared/types";
import { bibleAccountStateKey } from "./useBibleAccountState";
import AppModal from "../../components/ui/AppModal.vue";
import { BIBLE_BULK_SHARE_NOTICE, mergedBiblePassageContent, shouldMergeBiblePassages } from "./biblePassageSharing";

const props = defineProps<{
  channelName: string;
  sendPassage: (lookup: BibleLookupDTO, includeTranslation?: boolean) => Promise<void>;
  sendText: (content: string, requestId: string) => Promise<void>;
}>();
const emit = defineEmits<{ sent: [] }>();
const accountState = inject(bibleAccountStateKey, null);
const confirmationOpen = ref(true);
const passages = ref<BibleLookupDTO[]>([]);
const includeTranslation = ref(false);
const shareBusy = ref(false);
const error = ref("");
const merged = ref(false);
let requestId = "";

function open(lookups: BibleLookupDTO[]) {
  if (shareBusy.value || !lookups.length) return;
  passages.value = [...lookups];
  merged.value = shouldMergeBiblePassages(lookups);
  requestId = crypto.randomUUID();
  includeTranslation.value = accountState?.preferences.value?.shareIncludeTranslation ?? false;
  confirmationOpen.value = merged.value || (accountState?.preferences.value?.shareConfirm ?? true);
  error.value = "";
  if (!confirmationOpen.value) void share();
}
async function share() {
  if (shareBusy.value || !passages.value.length) return;
  shareBusy.value = true;
  error.value = "";
  try {
    if (merged.value) {
      await props.sendText(mergedBiblePassageContent(passages.value, includeTranslation.value), requestId);
      passages.value = [];
    }
    // Remove confirmed passages so retrying a later failure does not resend them.
    while (passages.value.length) {
      await props.sendPassage(passages.value[0], includeTranslation.value);
      passages.value.shift();
    }
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
      <p v-if="merged" class="passage-share-notice" role="status">{{ BIBLE_BULK_SHARE_NOTICE }}</p>
      <div class="passage-share-preview">
        <article v-for="passage in passages" :key="passage.normalizedReference">
          <strong>{{ passage.normalizedReference }}</strong>
          <p>{{ passage.verses.map(verse => verse.text).join('') }}</p>
          <small v-if="includeTranslation">{{ passage.translation }}</small>
        </article>
      </div>
      <label class="passage-share-option"><input v-model="includeTranslation" type="checkbox" :disabled="shareBusy || (merged && !!error)" />显示版本信息</label>
      <p>发送到：{{ channelName }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer><button type="button" :disabled="shareBusy" @click="share">{{ shareBusy ? '发送中…' : merged ? '合并发送到聊天室' : '发送到聊天室' }}</button></footer>
    </AppModal>
  </Teleport>
</template>

<style scoped>
:global(.bible-passage-share-dialog) { max-height: calc(var(--app-height, 100dvh) - 32px); display: flex; flex-direction: column; gap: 12px; color: #604b32; }
:global(.bible-passage-share-dialog .modal-head) { flex-shrink: 0; }
.passage-share-preview { min-height: 0; margin: 0 16px; overflow-y: auto; overscroll-behavior: contain; }
.passage-share-preview article { padding: 12px; background: #faf4e8; border-radius: 8px; }
.passage-share-preview article + article { margin-top: 8px; }
.passage-share-preview p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.passage-share-preview small { display: block; margin-top: 8px; color: #766650; }
.passage-share-option { display: flex; flex-shrink: 0; align-items: center; gap: 8px; min-height: 32px; margin: 0 16px; cursor: pointer; }
.passage-share-option input { width: 18px; height: 18px; accent-color: #b9582b; }
.passage-share-notice { flex-shrink: 0; margin: 0 16px; line-height: 1.6; }
footer { display: flex; flex-shrink: 0; justify-content: flex-end; margin: 0 16px 16px; }
div + p, label + p, [role="alert"] { flex-shrink: 0; margin: 0 16px; }
footer button { min-height: 40px; padding: 8px 16px; border: 0; border-radius: 20px; background: #b9582b; color: white; font: inherit; cursor: pointer; }
footer button:disabled { opacity: .55; cursor: wait; }
[role="alert"] { color: #a33429; }
</style>
