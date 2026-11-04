<script setup lang="ts">
import { ref, watch } from "vue";
import type { Poll, PollResults } from "@shared/social";
import { api } from "../../api";
import { useSocialRefresh } from "./useSocialRefresh";
const props = defineProps<{ id: number; poll: Poll }>();
const results = ref<PollResults>({ counts: [], total: 0, selected: null });
const error = ref("");
const voteBusy = ref(false);
const colors = ["#269b84", "#4a8ddd", "#dfad47", "#bb78cb", "#e58174", "#68ae58", "#717dd0", "#c38b53", "#42b9bc", "#dc79ab", "#89975a", "#81888f"];
let generation = 0;
const refresh = useSocialRefresh(async () => {
  const current = ++generation;
  const id = props.id;
  try {
    const value = await api<PollResults>(`/api/polls/${id}`);
    if (current === generation && id === props.id) { results.value = value; error.value = ""; }
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : "结果加载失败"; }
}, (event) => event.pollId === props.id);
watch(() => props.id, () => { generation++; results.value = { counts: [], total: 0, selected: null }; void refresh(); });
async function vote(option: number) {
  if (voteBusy.value) return;
  voteBusy.value = true;
  try {
    await api(`/api/polls/${props.id}/vote`, { method: "PUT", body: JSON.stringify({ option }) });
    await refresh();
  } catch (e) { error.value = e instanceof Error ? e.message : "投票失败，请重试"; }
  finally { voteBusy.value = false; }
}
</script>
<template>
  <section class="poll-card" @click.stop>
    <small>投票 · 单选，可改选</small>
    <h3>{{ poll.question }}</h3>
    <button v-for="(option, index) in poll.options" :key="index" type="button" class="poll-option" @pointerdown.stop :aria-pressed="results.selected === index" :disabled="voteBusy" @click="vote(index)">
      <span class="poll-bar" :style="{ width: `${results.total ? (results.counts[index] || 0) / results.total * 100 : 0}%`, background: colors[index] }"></span>
      <span class="poll-option-label"><i :style="{ background: colors[index] }"></i>{{ results.selected === index ? '✓ ' : '' }}{{ option }}</span>
      <span>{{ results.counts[index] || 0 }} 票 · {{ results.total ? Math.round((results.counts[index] || 0) / results.total * 100) : 0 }}%</span>
    </button>
    <small aria-live="polite">共 {{ results.total }} 票</small>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refresh">重试</button></p>
  </section>
</template>
<style scoped>
.poll-card { width: min(360px, 100%); min-width: min(250px, 65vw); color: var(--text); padding: 8px; }
h3 { margin: 8px 0 12px; font-size: 16px; overflow-wrap: anywhere; }
small { opacity: .75; }
.poll-option { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; overflow: hidden; margin: 8px 0; border: 1px solid var(--line); border-radius: 8px; padding: 12px 8px; background: transparent; color: inherit; }
.poll-option > span { position: relative; z-index: 1; }
.poll-option > .poll-bar { position: absolute; z-index: 0; inset: 0 auto 0 0; opacity: .22; transition: width .25s; }
.poll-option-label { overflow-wrap: anywhere; flex: 1; }
.poll-option i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; }
@media (prefers-reduced-motion: reduce) { .poll-option > .poll-bar { transition: none; } }
</style>
