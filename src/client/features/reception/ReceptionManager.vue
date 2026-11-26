<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, Clock3, Copy, DoorOpen, Plus, RotateCcw, Trash2 } from "lucide-vue-next";
import type { ChannelDTO } from "@shared/types";
import { api } from "../../api";
import AppModal from "../../components/ui/AppModal.vue";

const props = defineProps<{ open: boolean; channels: ChannelDTO[] }>();
const emit = defineEmits<{
  close: [];
  created: [channel: ChannelDTO];
  updated: [channel: ChannelDTO];
  deleted: [channelId: number];
  select: [channelId: number];
}>();

const roomName = ref("临时会客厅");
const code = ref("");
const durationHours = ref(24);
const busy = ref(false);
const error = ref("");
const editCode = ref<Record<number, string>>({});
const editDuration = ref<Record<number, number>>({});
const copyingRoomId = ref<number | null>(null);
const copiedRoomId = ref<number | null>(null);
const now = ref(Date.now());
let clock: number | undefined;

const rooms = computed(() => props.channels.filter((channel) => channel.kind === "reception"));
const ownedRooms = computed(() => rooms.value.filter((channel) => channel.canManage));
watch(rooms, values => {
  for (const room of values) editDuration.value[room.id] ??= 24;
}, { immediate: true });

function expiryText(value?: string | null) {
  if (!value) return "未设置期限";
  const remaining = new Date(value).getTime() - now.value;
  if (remaining <= 0) return "正在回收";
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  if (minutes < 60) return `${minutes} 分钟后回收`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} 小时后回收`;
  return `${Math.ceil(hours / 24)} 天后回收`;
}

async function createRoom() {
  error.value = "";
  busy.value = true;
  try {
    const result = await api<{ success: boolean; channel: ChannelDTO }>("/api/reception/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: roomName.value.trim(),
        code: code.value.trim(),
        durationHours: durationHours.value
      })
    });
    code.value = "";
    emit("created", result.channel);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "会客厅创建失败";
  } finally {
    busy.value = false;
  }
}

async function updateRoom(room: ChannelDTO) {
  error.value = "";
  busy.value = true;
  try {
    const nextCode = editCode.value[room.id]?.trim();
    const result = await api<{ success: boolean; channel: ChannelDTO }>(`/api/reception/rooms/${room.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        durationHours: editDuration.value[room.id] || 24,
        ...(nextCode ? { code: nextCode } : {})
      })
    });
    editCode.value[room.id] = "";
    emit("updated", result.channel);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "会客厅设置失败";
  } finally {
    busy.value = false;
  }
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("浏览器没有允许复制，请稍后重试");
}

async function copyInvitation(room: ChannelDTO) {
  error.value = "";
  copyingRoomId.value = room.id;
  try {
    const result = await api<{ success: boolean; invitePath: string; inviteUrl: string | null }>(`/api/reception/rooms/${room.id}/invitation`, {
      method: "POST"
    });
    const url = result.inviteUrl || new URL(result.invitePath, window.location.origin).toString();
    await writeClipboard(`${url}\n\n不要在微信直接点击，请复制到浏览器打开。`);
    copiedRoomId.value = room.id;
    window.setTimeout(() => {
      if (copiedRoomId.value === room.id) copiedRoomId.value = null;
    }, 2500);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "邀请链接生成失败";
  } finally {
    copyingRoomId.value = null;
  }
}

async function deleteRoom(room: ChannelDTO) {
  if (!window.confirm(`确定回收“${room.name}”吗？其中的来访账号、消息和附件会立即清除。`)) return;
  error.value = "";
  busy.value = true;
  try {
    await api(`/api/reception/rooms/${room.id}`, { method: "DELETE" });
    emit("deleted", room.id);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "会客厅回收失败";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  clock = window.setInterval(() => { now.value = Date.now(); }, 30_000);
});
onBeforeUnmount(() => {
  if (clock) window.clearInterval(clock);
});
</script>

<template>
  <AppModal :open="open" :busy="busy" class="reception-shell" content-class="reception-panel" aria-label="会客厅管理" @close="emit('close')">
      <template #header>
        <span class="title-icon"><DoorOpen :size="22" /></span>
        <div class="panel-title"><strong>会客厅</strong><small>受邀者只会看到进入的会客厅</small></div>
      </template>

      <div class="scroll-area">
        <form class="create-card" @submit.prevent="createRoom">
          <div class="section-title"><Plus :size="18" /><strong>开一个会客厅</strong></div>
          <label>名称<input v-model="roomName" maxlength="80" required /></label>
          <label>来访口令<input v-model="code" autocapitalize="none" autocomplete="off" maxlength="32" placeholder="可用中文、字母，或至少 6 位数字" required /></label>
          <label>有效期
            <select v-model.number="durationHours">
              <option :value="1">1 小时</option><option :value="6">6 小时</option><option :value="24">1 天</option>
              <option :value="72">3 天</option><option :value="168">7 天</option><option :value="720">30 天</option>
            </select>
          </label>
          <p>中文或字母口令至少 2 个字，纯数字至少 6 位。</p>
          <p>口令可供多人使用；每位来访者都有独立的昵称和编号。到期后，来访账号、消息和附件会自动清除。</p>
          <button class="primary" :disabled="busy || !roomName.trim() || !code.trim()" type="submit">创建会客厅</button>
        </form>

        <div v-if="rooms.length" class="room-list">
          <div class="section-title"><DoorOpen :size="18" /><strong>我的会客厅</strong></div>
          <article v-for="room in rooms" :key="room.id" class="room-card">
            <button class="room-main" type="button" @click="emit('select', room.id)">
              <span><b>{{ room.name }}</b><small><Clock3 :size="14" />{{ expiryText(room.receptionExpiresAt) }}</small></span>
              <span class="enter">进入</span>
            </button>
            <div v-if="room.canManage" class="room-settings">
              <label>更新口令（选填）<input v-model="editCode[room.id]" maxlength="32" autocapitalize="none" autocomplete="off" placeholder="留空保留当前口令" /></label>
              <label>延长有效期<select v-model.number="editDuration[room.id]">
                <option :value="1">续 1 小时</option><option :value="6">续 6 小时</option><option :value="24">续 1 天</option>
                <option :value="72">续 3 天</option><option :value="168">续 7 天</option><option :value="720">续 30 天</option>
              </select></label>
              <div class="room-actions">
              <button type="button" :disabled="copyingRoomId === room.id" @click="copyInvitation(room)">
                <Check v-if="copiedRoomId === room.id" :size="16" /><Copy v-else :size="16" />
                {{ copiedRoomId === room.id ? "已复制" : copyingRoomId === room.id ? "生成中" : "复制邀请链接" }}
              </button>
              <button type="button" :disabled="busy" title="从现在起重新计时" @click="updateRoom(room)"><RotateCcw :size="16" />更新</button>
              <button class="danger" type="button" :disabled="busy" @click="deleteRoom(room)"><Trash2 :size="16" />回收</button>
              </div>
            </div>
          </article>
        </div>
        <p v-else class="empty">还没有会客厅。创建后，可在聊天室成员栏邀请正式成员加入。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="ownedRooms.length" class="privacy-note">管理员只能看到会客厅编号、创建者、期限和用量，不能从管理页面查看聊天内容。</p>
      </div>
  </AppModal>
</template>

<style scoped>
.reception-shell { z-index: 120; background: rgba(10, 18, 25, .48); }
.reception-shell :deep(.reception-panel) {
  width: min(720px, 100%);
  min-width: 0;
  max-height: min(820px, calc(var(--app-height) - var(--safe-top) - var(--safe-bottom) - 24px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--panel, #fff);
  color: var(--text, #17212b);
  border-radius: 20px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, .28);
  overflow: hidden;
}
.reception-shell :deep(.modal-head) { display: flex; align-items: center; gap: 12px; margin: 0; padding: 18px 20px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.panel-title { display: grid; gap: 2px; flex: 1; min-width: 0; }
.panel-title small, .room-main small { opacity: .66; }
.title-icon { width: 40px; height: 40px; flex-shrink: 0; border-radius: 14px; display: grid; place-items: center; background: #e8f4ec; color: #2c7d4f; }
.scroll-area { min-width: 0; min-height: 0; padding: 18px; overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 18px; }
.create-card, .room-card { min-width: 0; border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 16px; padding: 16px; background: color-mix(in srgb, var(--panel, #fff) 94%, #4f9d6f 6%); }
.create-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.section-title { display: flex; align-items: center; gap: 8px; grid-column: 1 / -1; }
.create-card label, .room-settings label { min-width: 0; display: grid; gap: 6px; font-size: 13px; }
.create-card label:first-of-type { grid-column: 1 / -1; }
.create-card input, .create-card select, .room-settings input, .room-settings select { width: 100%; min-width: 0; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 10px; background: var(--panel, #fff); color: inherit; padding: 10px 11px; font-family: inherit; font-size: 16px; line-height: 1.4; }
.create-card p { grid-column: 1 / -1; margin: 0; font-size: 12px; line-height: 1.65; opacity: .72; overflow-wrap: anywhere; }
.primary { grid-column: 1 / -1; border: 0; border-radius: 11px; padding: 11px 16px; background: #2f8656; color: #fff; font-weight: 700; }
.room-list { min-width: 0; display: grid; gap: 10px; }
.room-card { padding: 8px; }
.room-main { width: 100%; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; border: 0; background: transparent; color: inherit; padding: 8px; }
.room-main span:first-child { min-width: 0; display: grid; gap: 5px; overflow-wrap: anywhere; }
.room-main small { display: flex; align-items: center; gap: 5px; }
.enter { flex-shrink: 0; color: #2f8656; font-weight: 700; }
.room-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px 8px 8px; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.room-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
.room-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 40px; flex: 1 1 auto; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); background: var(--panel, #fff); color: inherit; border-radius: 9px; padding: 8px 12px; }
.room-actions .danger { color: #b43838; }
button { cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
.empty, .privacy-note, .error { margin: 0; padding: 12px; border-radius: 12px; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.empty, .privacy-note { background: color-mix(in srgb, currentColor 6%, transparent); }
.error { background: #fff0f0; color: #a32626; }
@media (max-width: 600px) {
  .reception-shell :deep(.modal-head) { padding: 14px; }
  .scroll-area { padding: 12px; gap: 14px; }
  .create-card { padding: 14px; grid-template-columns: minmax(0, 1fr); }
  .room-settings { grid-template-columns: minmax(0, 1fr); }
}
</style>
