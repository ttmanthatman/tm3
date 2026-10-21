<script setup lang="ts">
import type { BibleLookupDTO } from "@shared/types";
import type { BibleTopicMessagePayload } from "@shared/bibleTopics";
import BibleScriptureCard from "./BibleScriptureCard.vue";
defineProps<{
  topic: BibleTopicMessagePayload;
  openPassage: (lookup: BibleLookupDTO) => Promise<void>;
  paperSeed?: string | number;
  play?: () => Promise<unknown> | void;
}>();
</script>
<template>
  <BibleScriptureCard class="bible-topic-share-card" :title="topic.name" :passages="topic.passages" :translation="topic.translation" show-translation :paper-seed="paperSeed" :open-passage="openPassage" :play="play" />
</template>
