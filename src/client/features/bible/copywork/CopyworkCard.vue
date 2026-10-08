<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { CopyworkDTO, CopyworkGlyph, CopyworkPlacement } from "@shared/bibleCopywork";
import { api } from "../../../api";
import CopyworkPage from "./CopyworkPage.vue";
import { openCopyworkViewer } from "./copyworkViewerState";
const props = withDefaults(defineProps<{ id: string; reference?: string; message?: boolean; surfaceActive?: boolean }>(), { surfaceActive: true });
const root = ref<HTMLElement | null>(null);
const work = ref<CopyworkDTO | null>(null);
const placements = shallowRef<CopyworkPlacement[]>([]);
const glyphs = shallowRef<Array<CopyworkGlyph & { index: number }>>([]);
const error = ref("");
let observer: IntersectionObserver | null = null;
let alive = true;
let loading = false;
async function load() {
  if (loading || !alive) return;
  loading = true;
  error.value = "";
  try {
    const [data, ink] = await Promise.all([
      api<{ work: CopyworkDTO; pages: CopyworkPlacement[][] }>(`/api/bible/copyworks/${props.id}`),
      api<{ glyphs: Array<CopyworkGlyph & { index: number }> }>(`/api/bible/copyworks/${props.id}/pages/0`)
    ]);
    if (alive) {
      work.value = data.work;
      placements.value = data.pages[0];
      glyphs.value = ink.glyphs;
    }
  } catch (e) {
    if (alive) {
      work.value = null;
      glyphs.value = [];
      error.value = e instanceof Error ? e.message : "作品加载失败";
    }
  } finally {
    loading = false;
  }
}
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      void load();
      observer?.disconnect();
    }
  }, { rootMargin: "400px 0px" });
  if (root.value) observer.observe(root.value);
  window.addEventListener("bible-copyworks-changed", load);
});
onBeforeUnmount(() => {
  alive = false;
  observer?.disconnect();
  window.removeEventListener("bible-copyworks-changed", load);
});
</script>
<template>
  <div ref="root" class="copywork-card" :class="{ message }" :data-copywork-id="id" @click.stop>
    <template v-if="message">
      <CopyworkPage v-if="work" :glyphs="glyphs" :placements="placements" :source="work.source"
        compact interactive :active="surfaceActive" />
      <div v-else class="card-state" :role="error ? 'alert' : 'status'">
        {{ error || "正在铺开册页…" }}<button v-if="error" type="button" @click="load">重试</button>
      </div>
    </template>
    <button
      v-else
      class="card-open"
      :aria-label="`查看抄写：${work?.source.reference || reference || '经文'}`"
      @click="openCopyworkViewer(id)"
    >
      <CopyworkPage
        v-if="work"
        :glyphs="glyphs"
        :placements="placements"
        :source="work.source"
        :author="work.author"
        :date="work.completedAt"
      />
      <span v-else class="card-state">{{ error || "正在铺开册页…" }}</span>
      <strong>{{ work?.source.reference || reference || "经文抄写" }}</strong
      ><small v-if="work"
        >{{ work.author }} · {{ work.source.translationName }} · {{ work.pageCount }} 页</small
      >
    </button>
  </div>
</template>
<style scoped>
.copywork-card {
  width: min(270px, 100%);
}
.copywork-card.message { width: 100%; max-width: 100%; }
.card-open {
  display: grid;
  gap: 9px;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  color: #695439;
  cursor: pointer;
  font: inherit;
}
.card-open strong {
  font-size: 14px;
}
.card-open small {
  color: #8b7a63;
  font-size: 11px;
}
.card-state {
  display: grid;
  place-items: center;
  min-height: 150px;
  background: #eee5d5;
  border: 1px solid #ddcfb7;
  font-size: 13px;
  padding: 16px;
}
</style>
