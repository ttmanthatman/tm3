<script setup lang="ts">
import type { BibleLookupDTO } from "@shared/types";
import type { BiblePassageShare } from "../reading-shares/readingShareMessage";
import BibleScriptureCard from "./BibleScriptureCard.vue";
defineProps<{
  passage: BiblePassageShare;
  openPassage: (lookup: BibleLookupDTO) => Promise<void>;
  paperSeed?: string | number;
  play?: () => Promise<unknown> | void;
}>();
</script>
<template>
  <BibleScriptureCard class="bible-passage-share-card" :passages="[passage]" :translation="passage.translation" :show-translation="passage.showTranslation" :paper-seed="paperSeed" :open-passage="openPassage" :play="play" />
</template>
