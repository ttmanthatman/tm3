<script setup lang="ts">
import "./readingShares.css";
import { readingSharePlant, readingSharePlantImage } from "./readingShareLayout";
defineProps<{ kind: "bible" | "book"; text?: string; paperSeed?: string | number; hidePlant?: boolean }>();
</script>

<template>
  <article class="reading-share-card" :class="`reading-share-${kind}`" :data-plant="readingSharePlant(paperSeed, kind)">
    <img v-if="!hidePlant" class="reading-share-plant" :src="readingSharePlantImage(paperSeed ?? '', kind)" alt="" aria-hidden="true" />
    <div class="reading-share-card-content"><slot /></div>
  </article>
</template>
