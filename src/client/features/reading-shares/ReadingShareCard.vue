<script setup lang="ts">
import "./readingShares.css";
import { computed } from "vue";
import { readingSharePlant, readingSharePlantImage, readingShareWidth } from "./readingShareLayout";
const props = defineProps<{ kind: "bible" | "book"; text?: string; paperSeed?: string | number }>();
const preferredWidth = computed(() => `${props.kind === "bible" ? 390 : Math.max(390, readingShareWidth(props.text || ""))}px`);
</script>

<template>
  <article class="reading-share-card" :class="`reading-share-${kind}`" :data-plant="readingSharePlant(paperSeed, kind)" :style="{ width: preferredWidth }">
    <img class="reading-share-plant" :src="readingSharePlantImage(paperSeed ?? '', kind)" alt="" aria-hidden="true" />
    <div class="reading-share-card-content"><slot /></div>
  </article>
</template>
