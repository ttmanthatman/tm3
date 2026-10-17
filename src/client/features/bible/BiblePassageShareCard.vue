<script setup lang="ts">
import { ref } from "vue";
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
    <a class="reading-share-heading reading-share-reference" href="#bible" :aria-disabled="jumpBusy" :aria-busy="jumpBusy" title="在圣经中阅读这处经文" @click.stop.prevent="jump(passage.reference)">{{ passage.reference }}</a>
    <blockquote class="reading-share-quote">{{ passage.text }}</blockquote>
    <p v-if="passage.showTranslation && passage.translation" class="reading-share-meta">{{ passage.translation }}</p>
    <p v-if="error" class="reading-share-error" role="alert">{{ error }}</p>
  </ReadingShareCard>
</template>
