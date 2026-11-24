<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import BibleStudyRecords from "./BibleStudyRecords.vue";

type StudyRoom = { id: number; label: string; username: string | null; accountId: number };
const rooms = ref<StudyRoom[]>([]);
const selected = ref<StudyRoom | null>(null);
const before = ref<number | null>(null);
const busy = ref(false);
const error = ref("");

async function load(older = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const query = older && before.value ? `?before=${before.value}` : "";
    const page = await api<{ rooms: StudyRoom[]; nextBefore: number | null }>(`/api/admin/bible-study/rooms${query}`);
    rooms.value = older ? [...rooms.value, ...page.rooms] : page.rooms;
    before.value = page.nextBefore;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "同行书房列表加载失败";
  } finally {
    busy.value = false;
  }
}
onMounted(() => load());
</script>

<template>
  <section v-if="selected" class="study-log">
    <header>
      <button class="mini-btn secondary" type="button" @click="selected = null">返回书房列表</button>
      <strong>{{ selected.label }}</strong>
    </header>
    <BibleStudyRecords
      :key="selected.id"
      :endpoint="`/api/admin/bible-study/rooms/${selected.id}`"
      empty-label="这个书房还没有查经答复。"
      show-sender
    />
  </section>
  <section v-else class="study-log" aria-label="同行书房列表" :aria-busy="busy">
    <header><button class="mini-btn secondary" type="button" :disabled="busy" @click="load()">刷新书房</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy && !rooms.length" role="status">正在读取同行书房…</p>
    <p v-else-if="!error && !rooms.length">还没有用户进入同行书房。</p>
    <button v-for="room in rooms" :key="room.id" class="study-room" type="button" @click="selected = room">
      <strong>{{ room.label }}</strong>
      <span>{{ room.username ? `@${room.username}` : `账号 ${room.accountId}` }}</span>
    </button>
    <button v-if="before" class="mini-btn secondary" type="button" :disabled="busy" @click="load(true)">更多书房</button>
  </section>
</template>

<style scoped>
.study-log { display: grid; align-content: start; gap: 0.7rem; min-width: 0; }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 0.65rem; }
.study-room {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: start;
  overflow-wrap: anywhere;
}
.study-room:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.study-room span { font-size: 0.8rem; opacity: 0.72; }
</style>
