<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { sermonMapSchema, type SermonMap } from "@shared/sermonMap";
import { importXmind, revealPoint } from "./xmind";
const props = defineProps<{ live?: SermonMap; busy: boolean; accountId: number | null }>();
const emit = defineEmits<{ project: [map: SermonMap]; scripture: [title: string] }>();
const sheets = ref<SermonMap[]>([]), sheet = ref(0), selected = ref(0), error = ref(""), loading = ref(false);
const map = computed(() => sheets.value[sheet.value]);
const frame = computed(() => {
  const live = props.live;
  return live && map.value && live.title === map.value.title && live.nodes.every(n => map.value.nodes[n.id]?.title === n.title) ? live : undefined;
});
const pick = computed(() => map.value?.nodes[selected.value]);
watch(() => props.accountId, id => {
  sheets.value = []; sheet.value = 0; selected.value = 0; error.value = "";
  if (!id) return;
  try {
    const saved = localStorage.getItem(`sermon-xmind.${id}`);
    if (saved) sheets.value = sermonMapSchema.array().parse(JSON.parse(saved));
  } catch { error.value = "无法恢复本机导图，请重新导入"; }
}, { immediate: true });
watch(frame, (next, prior) => {
  if (next?.overview && !prior?.overview && next.focus === selected.value && selected.value + 1 < map.value.nodes.length) selected.value++;
});
async function load(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  loading.value = true;
  const owner = props.accountId;
  try {
    const imported = await importXmind(file);
    if (owner !== props.accountId) return;
    sheets.value = imported; sheet.value = 0; selected.value = 0; error.value = "";
    if (owner) {
      try { localStorage.setItem(`sermon-xmind.${owner}`, JSON.stringify(imported)); }
      catch { error.value = "已导入，当前浏览器空间不足，下次打开时请重新导入"; }
    }
  }
  catch (e) { error.value = e instanceof Error && !(e.name === "ZodError") ? e.message : "无法读取这份 XMind 导图"; }
  finally { loading.value = false; input.value = ""; }
}
function advance() {
  if (!map.value) return;
  if (frame.value && !frame.value.overview && selected.value === frame.value.focus) {
    emit("project", { ...frame.value, overview: true });
  } else {
    emit("project", revealPoint(map.value, frame.value?.nodes.map(n => n.id) ?? [], selected.value));
  }
}
</script>
<template>
  <section class="sermon-block map-desk">
    <h3>思维导图</h3>
    <label>导入 XMind <input type="file" accept=".xmind" :disabled="loading || busy" @change="load"></label>
    <small v-if="error" role="alert">{{ error }}</small>
    <template v-if="map">
      <select v-if="sheets.length > 1" v-model="sheet" aria-label="画布" @change="selected = 0"><option v-for="(s,i) in sheets" :key="i" :value="i">{{ s.title }}</option></select>
      <label>待讲要点<select v-model="selected"><option v-for="n in map.nodes" :key="n.id" :value="n.id">{{ '　'.repeat(Math.min(n.column,6)) }}{{ n.title }}</option></select></label>
      <div><button class="primary-btn" :disabled="busy" @click="advance">{{ frame && !frame.overview && frame.focus === selected ? '归位，看已讲全图' : '投出这一点' }}</button>
        <button class="mini-btn secondary" @click="emit('scripture', pick.title)">带入经文与文字</button></div>
    </template>
  </section>
</template>
<style scoped>
.map-desk{display:grid;gap:10px}.map-desk label{display:grid;gap:6px;font-size:13px}.map-desk select,.map-desk input{width:100%;max-width:100%;min-width:0}.map-desk div{display:flex;flex-wrap:wrap;gap:8px}
</style>
