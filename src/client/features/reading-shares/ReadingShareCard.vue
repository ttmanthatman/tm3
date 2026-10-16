<script setup lang="ts">
import "./readingShares.css";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { readingShareWidth } from "./readingShareLayout";
const props = defineProps<{ kind: "bible" | "book"; text?: string; decoration?: "pencil" }>();
const preferredWidth = computed(() => `${Math.max(props.kind === "book" ? 390 : 280, readingShareWidth(props.text || ""))}px`);
const paper = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!entry || !paper.value) return;
    // Keep even very long passages inside the chat column as the whole sheet tilts.
    const angle = Math.min(1.1, Math.atan2(8, Math.max(entry.contentRect.width, entry.contentRect.height)) * 180 / Math.PI);
    paper.value.style.setProperty("--reading-share-angle", `${-angle}deg`);
  });
  if (paper.value) observer.observe(paper.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <article ref="paper" class="reading-share-card" :class="[`reading-share-${kind}`, { 'reading-share-with-pencil': decoration === 'pencil' }]" :style="{ width: preferredWidth }">
    <svg v-if="decoration === 'pencil'" class="reading-share-pencil" viewBox="0 0 80 18" aria-hidden="true">
      <path d="M12 3h53v12H12z" fill="#ce9c49" />
      <path d="M12 3h53v4H12z" fill="#edc777" />
      <path d="M12 12h53v3H12z" fill="#a87430" />
      <path d="M65 3l14 6-14 6z" fill="#e4c59a" />
      <path d="M74 7l5 2-5 2z" fill="#4b443b" />
      <path d="M5 3h7v12H5z" fill="#b7b4a5" />
      <path d="M5 3H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2z" fill="#c68d7c" />
    </svg>
    <div class="reading-share-card-content"><slot /></div>
  </article>
</template>
