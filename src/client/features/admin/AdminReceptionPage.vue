<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Clock3, DoorOpen, RefreshCw, Trash2 } from "lucide-vue-next";
import type { AdminReceptionRoomDTO } from "@shared/types";
import { api } from "../../api";
import { compactBytes } from "../../time";

const rooms = ref<AdminReceptionRoomDTO[]>([]);
const loading = ref(true);
const error = ref("");

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "暂无消息";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    rooms.value = (await api<{ rooms: AdminReceptionRoomDTO[] }>("/api/admin/reception-rooms")).rooms;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "会客厅列表加载失败";
  } finally {
    loading.value = false;
  }
}

async function collect(room: AdminReceptionRoomDTO) {
  if (!window.confirm(`确定回收 ${room.name} 吗？其中的来访账号、消息和附件会立即清除。`)) return;
  try {
    await api(`/api/admin/reception-rooms/${room.id}`, { method: "DELETE" });
    await load();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "会客厅回收失败";
  }
}

onMounted(load);
</script>

<template>
  <section class="admin-reception">
    <div class="notice"><DoorOpen :size="20" /><span><b>只显示运维资料</b><small>这里不会展示会客厅名称、口令、成员姓名或聊天内容。</small></span><button class="mini-btn secondary" @click="load"><RefreshCw :size="15" />刷新</button></div>
    <div v-if="loading" class="state">正在加载会客厅…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="!rooms.length" class="state">目前没有会客厅。</div>
    <div v-else class="room-grid">
      <article v-for="room in rooms" :key="room.id">
        <header><span><b>{{ room.name }}</b><small>创建者：{{ room.ownerName }}</small></span><button class="danger" title="立即回收" @click="collect(room)"><Trash2 :size="17" /></button></header>
        <dl>
          <div><dt><Clock3 :size="14" />到期</dt><dd>{{ dateTime(room.expiresAt) }}</dd></div>
          <div><dt>人数</dt><dd>{{ room.memberCount }} 人（来访 {{ room.guestCount }}）</dd></div>
          <div><dt>用量</dt><dd>{{ room.messageCount }} 条消息 · {{ compactBytes(room.attachmentBytes) }}</dd></div>
          <div><dt>最近活动</dt><dd>{{ dateTime(room.lastMessageAt) }}</dd></div>
        </dl>
      </article>
    </div>
  </section>
</template>

<style scoped>
.admin-reception{display:grid;gap:14px}.notice{display:flex;align-items:center;gap:12px;padding:14px;border-radius:14px;background:color-mix(in srgb,var(--accent,#3c8d63) 10%,transparent)}.notice span{display:grid;gap:3px;flex:1}.notice small{opacity:.7}.notice button{display:flex;align-items:center;gap:5px}.state{padding:28px;text-align:center;border:1px dashed color-mix(in srgb,currentColor 18%,transparent);border-radius:14px;opacity:.75}.state.error{color:#a32626}.room-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.room-grid article{padding:15px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:15px}.room-grid header{display:flex;align-items:center;justify-content:space-between}.room-grid header span{display:grid;gap:4px}.room-grid header small{opacity:.68}.danger{border:0;background:#fff0f0;color:#ae3333;border-radius:9px;padding:8px}.room-grid dl{display:grid;gap:8px;margin:14px 0 0}.room-grid dl div{display:flex;justify-content:space-between;gap:12px;font-size:13px}.room-grid dt{display:flex;align-items:center;gap:5px;opacity:.65}.room-grid dd{margin:0;text-align:right}
</style>
