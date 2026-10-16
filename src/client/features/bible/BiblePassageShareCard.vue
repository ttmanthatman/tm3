<script setup lang="ts">
import { ref } from "vue";
import { ArrowRight, BookOpen } from "lucide-vue-next";
import type { BibleLookupDTO } from "@shared/types";
import { api } from "../../api";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";
import type { BiblePassageShare } from "../reading-shares/readingShareMessage";
const props = defineProps<{ passage: BiblePassageShare; openPassage: (lookup: BibleLookupDTO) => Promise<void>; paperSeed?: string | number }>();
const jumpBusy = ref(false);
const error = ref("");
async function jump(reference: string) {
  if (jumpBusy.value) return;
  jumpBusy.value = true; error.value = "";
  try {
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(`/api/bible/lookup?reference=${encodeURIComponent(reference)}`);
    if (!response.success || !response.result?.verses.length) throw new Error(response.message || "暂时找不到这处经文");
    await props.openPassage(response.result);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "经文打开失败，请重试"; }
  finally { jumpBusy.value = false; }
}
</script>
<template>
  <ReadingShareCard kind="bible" :paper-seed="paperSeed" class="bible-passage-share-card" :text="passage.text">
    <span class="reading-share-label"><BookOpen :size="14" />经文分享</span>
    <strong class="reading-share-heading">{{ passage.reference }}</strong>
    <blockquote class="reading-share-quote">{{ passage.text }}</blockquote>
    <small v-if="passage.translation" class="reading-share-meta">{{ passage.translation }}</small>
    <button type="button" class="reading-share-action" :disabled="jumpBusy" @click.stop="jump(passage.reference)"><BookOpen :size="17" />{{ jumpBusy ? '正在打开…' : '跳转到经文' }}<ArrowRight :size="16" /></button>
    <p v-if="error" class="reading-share-error" role="alert">{{ error }}</p>
  </ReadingShareCard>
</template>
