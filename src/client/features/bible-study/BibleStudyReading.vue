<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, Copy, Check } from "lucide-vue-next";
import type { BibleStudyReading } from "@shared/bibleStudy";

const props = defineProps<{ reading: BibleStudyReading; reference?: string }>();
const expanded = ref(false);
const excerpt = computed(() => {
  const first = props.reading.paragraphs[0] ?? [];
  return [first.slice(0, 2)];
});
const canExpand = computed(() => !!props.reference && (props.reading.paragraphs.length > 1 ||
  (props.reading.paragraphs[0]?.length ?? 0) > excerpt.value[0].length));
const paragraphs = computed(() => canExpand.value && !expanded.value ? excerpt.value : props.reading.paragraphs);
const copyState = ref<"ready" | "copied" | "failed">("ready");

async function copy() {
  try {
    const text = props.reading.paragraphs.map(paragraph => paragraph.map(fragment => fragment.text).join("")).join("\n\n");
    await navigator.clipboard.writeText(text);
    copyState.value = "copied";
  } catch {
    copyState.value = "failed";
  }
}
</script>

<template>
  <section class="message-text study-reading" :class="{ 'workspace-reading': reference }" aria-label="本次经文">
    <template v-if="reference">
      <div class="reading-kicker">本次经文</div>
      <h2 class="reading-heading">{{ reference }}</h2>
    </template>
    <strong v-else class="reading-title">{{ reading.title }}</strong>
    <div class="reading-text">
      <p v-for="(paragraph, index) in paragraphs" :key="index"><template v-for="(fragment, fragmentIndex) in paragraph" :key="fragmentIndex"><sup v-if="fragment.number" :data-number="fragment.number" aria-hidden="true"></sup>{{ fragment.text }}</template></p>
    </div>
    <div class="reading-actions">
      <button v-if="canExpand" class="copy-reading" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? "收起经文" : "展开全段" }} <ChevronDown :size="16" />
      </button>
      <button class="copy-reading" type="button" aria-live="polite" @click.stop="copy">
        <Check v-if="copyState === 'copied'" :size="14" /><Copy v-else :size="14" />
        {{ copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败，点击重试" : "复制经文" }}
      </button>
    </div>
    <p v-if="!reference" class="reading-question">{{ reading.question }}</p>
  </section>
</template>

<style scoped>
.study-reading { display: grid; gap: 0.55em; overflow-wrap: anywhere; }
.reading-title { font-size: 0.94em; }
.reading-text { border-inline-start: 2px solid color-mix(in srgb, currentColor 36%, transparent); padding-inline-start: 0.65em; line-height: 1.62; }
.reading-text p, .reading-question { margin: 0; }
.reading-text p + p { margin-top: 0.65em; }
sup { position: relative; top: -0.45em; vertical-align: baseline; font-size: 0.58em; line-height: 0; margin-inline-end: 0.12em; opacity: 0.65; user-select: none; -webkit-user-select: none; }
sup::before { content: attr(data-number); }
.copy-reading { display: inline-flex; justify-self: start; align-items: center; gap: 5px; padding: 5px 0; border: 0; background: transparent; color: inherit; font-size: 0.78em; cursor: pointer; }
.reading-actions { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.workspace-reading { color: var(--study-ink); gap: 9px; }
.workspace-reading .reading-kicker { border-inline-start: 4px solid var(--study-gold); padding-inline-start: 9px; font-size: .84rem; font-weight: 600; }
.workspace-reading .reading-heading { font-size: clamp(1.35rem, 4.8cqi, 1.95rem); line-height: 1.2; margin: 0 0 .3rem; }
.workspace-reading .reading-text {
  border: 0; border-block-start: 1px solid var(--study-line); padding: 13px 0 0;
  font: 1.1rem/1.85 "Songti SC", "Noto Serif CJK SC", "STSong", serif;
}
.workspace-reading sup { color: var(--study-bronze); opacity: 1; }
.workspace-reading .copy-reading { color: var(--study-pine); min-height: 40px; font-size: .86rem; }
</style>
