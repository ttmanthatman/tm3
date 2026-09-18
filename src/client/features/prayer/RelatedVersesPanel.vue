<script setup lang="ts">
import { BookOpen, ChevronDown, ChevronUp } from "lucide-vue-next";
import type { AiSuggestionDTO, BibleLookupDTO } from "@shared/types";
import { adminDate } from "../admin/adminFormat";

defineProps<{
  suggestions: AiSuggestionDTO[];
  suggestionCount: number;
  limitReached: boolean;
  expanded: boolean;
  busy: boolean;
  error: string;
  isReferenceExpanded: (scope: string | number, reference: string) => boolean;
  isReferenceBusy: (scope: string | number, reference: string) => boolean;
  referenceLookup: (scope: string | number, reference: string) => BibleLookupDTO | null | undefined;
  formatLookup: (lookup: BibleLookupDTO | null | undefined, reference: string) => string;
}>();

const emit = defineEmits<{
  toggle: [];
  generate: [];
  toggleReference: [scope: string | number, reference: string];
  openReference: [scope: string | number, reference: string];
}>();
</script>

<template>
  <div class="prayer-ai" @click.stop>
    <button class="prayer-ai-toggle" type="button" @click="emit('toggle')">
      <BookOpen :size="15" />
      <span>也许相关的经文<template v-if="suggestionCount"> · {{ suggestionCount }}</template></span>
      <ChevronUp v-if="expanded" :size="15" />
      <ChevronDown v-else :size="15" />
    </button>
    <div v-if="expanded" class="prayer-ai-body">
      <article v-for="suggestion in suggestions" :key="suggestion.id" class="prayer-ai-suggestion">
        <div class="prayer-ai-meta">
          <span>{{ adminDate(suggestion.createdAt) }}</span>
          <small v-if="suggestion.createdByName">由 {{ suggestion.createdByName }} 生成</small>
        </div>
        <div v-for="reference in suggestion.references" :key="`${suggestion.id}-${reference}`" class="prayer-ai-reference">
          <button class="prayer-ai-reference-btn" type="button" @click="emit('toggleReference', suggestion.id, reference)">
            <span>{{ reference }}</span>
            <ChevronUp v-if="isReferenceExpanded(suggestion.id, reference)" :size="14" />
            <ChevronDown v-else :size="14" />
          </button>
          <div v-if="isReferenceExpanded(suggestion.id, reference)" class="prayer-ai-verses">
            <p v-if="isReferenceBusy(suggestion.id, reference)" class="prayer-ai-empty">正在查找经文...</p>
            <template v-else-if="referenceLookup(suggestion.id, reference)?.verses.length">
              <small>{{ referenceLookup(suggestion.id, reference)?.translation }}</small>
              <div class="inline-bible-passage">
                <p class="formatted-bible-text">{{ formatLookup(referenceLookup(suggestion.id, reference), reference) }}</p>
                <button class="inline-bible-reader-link" type="button" title="在圣经中阅读" aria-label="在圣经中阅读并高亮这处经文" @click.stop="emit('openReference', suggestion.id, reference)">
                  <BookOpen :size="15" />
                </button>
              </div>
            </template>
            <p v-else class="prayer-ai-empty">暂时找不到这处经文</p>
          </div>
        </div>
      </article>
      <p v-if="!suggestions.length && !busy" class="prayer-ai-empty">还没有经文建议</p>
      <p v-if="error" class="prayer-ai-error">{{ error }}</p>
      <div class="prayer-ai-actions">
        <button class="mini-btn secondary" :disabled="busy || limitReached" @click="emit('generate')">
          {{ busy ? "正在寻找相关经文..." : suggestions.length ? "换一组" : "生成建议" }}
        </button>
        <small v-if="limitReached">这张卡片的经文建议已达到上限</small>
      </div>
    </div>
  </div>
</template>
