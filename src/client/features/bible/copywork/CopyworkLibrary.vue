<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CopyworkDTO } from "@shared/bibleCopywork";
import { api } from "../../../api";
import { copyworkDrafts, type CopyworkDraft } from "./copyworkDrafts";
import CopyworkCard from "./CopyworkCard.vue";
const props = defineProps<{
  accountId: number;
  filter?: { translation: string; bookCode: string; chapter: number; verse: number };
  revision?: number;
}>();
const emit = defineEmits<{ resume: [draft: CopyworkDraft] }>();
const scope = ref<"mine" | "public">(props.filter ? "public" : "mine");
const works = ref<CopyworkDTO[]>([]);
const drafts = ref<CopyworkDraft[]>([]);
const error = ref("");
const busy = ref(false);
const hasMore = ref(false);
let sequence = 0;
async function load(more = false) {
  const request = ++sequence;
  busy.value = true;
  error.value = "";
  if (!more) works.value = [];
  try {
    const params = new URLSearchParams({ scope: scope.value, offset: String(works.value.length) });
    if (props.filter)
      Object.entries(props.filter).forEach(([key, value]) => params.set(key, String(value)));
    const data = await api<{ works: CopyworkDTO[]; hasMore: boolean }>(
      `/api/bible/copyworks?${params}`
    );
    if (request !== sequence) return;
    works.value = more ? [...works.value, ...data.works] : data.works;
    hasMore.value = data.hasMore;
    drafts.value =
      scope.value === "mine"
        ? (await copyworkDrafts.list(props.accountId)).filter(
            (d) =>
              !props.filter ||
              (d.source.translation === props.filter.translation &&
                d.source.bookCode === props.filter.bookCode &&
                d.source.chapter === props.filter.chapter &&
                d.source.verseStart <= props.filter.verse &&
                d.source.verseEnd >= props.filter.verse)
          )
        : [];
  } catch (e) {
    if (request === sequence) error.value = e instanceof Error ? e.message : "作品加载失败";
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () => [scope.value, props.filter, props.revision],
  () => {
    void load();
  }
);
function refresh() {
  void load();
}
onMounted(() => {
  void load();
  window.addEventListener("bible-copyworks-changed", refresh);
});
onBeforeUnmount(() => {
  sequence++;
  window.removeEventListener("bible-copyworks-changed", refresh);
});
</script>
<template>
  <section class="copywork-library">
    <nav aria-label="抄写作品分类">
      <button :class="{ selected: scope === 'public' }" @click="scope = 'public'">公开作品</button
      ><button :class="{ selected: scope === 'mine' }" @click="scope = 'mine'">我的抄写</button>
    </nav>
    <p v-if="error" role="alert">{{ error }} <button @click="load()">重试</button></p>
    <div v-if="scope === 'mine' && drafts.length" class="drafts">
      <button v-for="draft in drafts" :key="draft.id" @click="emit('resume', draft)">
        <strong>{{ draft.source.reference }}</strong
        ><span>本机草稿 · 已写 {{ draft.glyphs.length }} 字</span><em>继续抄写 →</em>
      </button>
    </div>
    <p v-if="!busy && !works.length" class="empty">
      {{
        scope === "mine"
          ? "把喜欢的经文亲手写下来。在阅读时选择经文，再点「抄写」。"
          : "这里还没有公开的抄写，愿你的笔迹成为第一份分享。"
      }}
    </p>
    <div class="works">
      <article v-for="work in works" :key="work.id">
        <CopyworkCard :id="work.id" :reference="work.source.reference" /><small
          v-if="scope === 'mine'"
          >{{ work.publishedAt ? "已公开" : "私人保存" }}</small
        >
      </article>
    </div>
    <p v-if="busy" role="status">正在寻找册页…</p>
    <button v-if="hasMore" :disabled="busy" @click="load(true)">更多作品</button>
  </section>
</template>
<style scoped>
.copywork-library {
  max-width: 1080px;
  margin: auto;
  padding: 20px;
  color: #69553c;
}
nav {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}
button {
  min-height: 42px;
  padding: 9px 16px;
  border: 1px solid #d9cdb8;
  background: #fffaf1;
  color: inherit;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}
button.selected {
  background: #5c705e;
  border-color: #5c705e;
  color: white;
}
.works {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 28px;
}
.works article {
  min-width: 0;
}
.works small {
  display: block;
  margin-top: 8px;
  color: #8b7b64;
  font-size: 12px;
}
.empty {
  padding: 44px 12px;
  text-align: center;
  line-height: 1.9;
}
.drafts {
  display: grid;
  gap: 10px;
  margin-bottom: 24px;
}
.drafts button {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  text-align: left;
}
.drafts span {
  font-size: 12px;
}
.drafts em {
  margin-left: auto;
  font-size: 13px;
  font-style: normal;
}
</style>
