<script setup lang="ts">
import "./readingShares.css";
import { computed } from "vue";
import { readingSharePlant, readingSharePlantImage, readingShareWidth } from "./readingShareLayout";
const props = defineProps<{ kind: "bible" | "book"; text?: string; paperSeed?: string | number }>();
const preferredWidth = computed(() => `${Math.max(props.kind === "book" ? 390 : 280, readingShareWidth(props.text || ""))}px`);
</script>

<template>
  <article class="reading-share-card" :class="`reading-share-${kind}`" :data-plant="readingSharePlant(paperSeed, kind)" :style="{ width: preferredWidth }">
    <img class="reading-share-plant" :src="readingSharePlantImage(paperSeed ?? '', kind)" alt="" aria-hidden="true" />
    <div class="reading-share-card-content"><slot /></div>
  </article>
</template>
