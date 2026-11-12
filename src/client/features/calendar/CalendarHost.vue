<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import AppModal from "../../components/ui/AppModal.vue";
import CalendarWorkspace from "./CalendarWorkspace.vue";
import { useChatStore } from "../../store";
import { api } from "../../api";
import type { CalendarNoticeDTO } from "../../../shared/calendar";
import "./calendarTheme.css";
const store = useChatStore();
const channelId = ref<number | null>(null),
  initialDate = ref<string>();
const notices = ref<CalendarNoticeDTO[]>([]),
  readBusy = ref(false),
  error = ref("");
let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0,
  fetching = false;
function open(id: number, date?: string) {
  channelId.value = id;
  initialDate.value = date;
}
defineExpose({ open });
async function refresh() {
  if (!store.account || store.account.isGuest || fetching || readBusy.value || document.hidden)
    return;
  const ticket = generation;
  fetching = true;
  try {
    const result = await api<{ notices: CalendarNoticeDTO[] }>("/api/calendar/notices");
    if (ticket === generation) {
      notices.value = result.notices;
      error.value = "";
    }
  } catch (cause) {
    if (ticket === generation && notices.value.length)
      error.value = cause instanceof Error ? cause.message : "提醒读取失败";
  } finally {
    fetching = false;
  }
}
async function acknowledge() {
  if (readBusy.value) return false;
  const ids = notices.value.map((n) => n.id),
    ticket = ++generation;
  readBusy.value = true;
  error.value = "";
  try {
    await api("/api/calendar/notices/read", { method: "POST", body: JSON.stringify({ ids }) });
    if (ticket === generation) notices.value = notices.value.filter((n) => !ids.includes(n.id));
    return ticket === generation;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "确认提醒失败，请重试";
    return false;
  } finally {
    readBusy.value = false;
  }
}
async function view(notice: CalendarNoticeDTO) {
  if (await acknowledge()) open(notice.channelId, notice.occurrenceAt);
}
function foreground() {
  if (!document.hidden) void refresh();
}
watch(
  () => store.account?.id,
  () => {
    generation++;
    notices.value = [];
    channelId.value = null;
    if (timer) clearInterval(timer);
    if (store.account && !store.account.isGuest) {
      void refresh();
      timer = setInterval(() => {
        void refresh();
      }, 15000);
    }
  },
  { immediate: true }
);
document.addEventListener("visibilitychange", foreground);
onBeforeUnmount(() => {
  generation++;
  if (timer) clearInterval(timer);
  document.removeEventListener("visibilitychange", foreground);
});
</script>
<template>
  <CalendarWorkspace
    v-if="channelId"
    :key="`${channelId}-${initialDate || ''}`"
    :channel-id="channelId"
    :date="initialDate"
    @close="channelId = null"
  />
  <Teleport to="body">
    <AppModal
      :open="notices.length > 0"
      class="calendar-notice-layer"
      content-class="calendar-notice-panel"
      :title="`日程提醒${notices.length > 1 ? `（${notices.length} 条）` : ''}`"
      :busy="readBusy"
      close-label="确认并关闭日程提醒"
      @close="acknowledge"
    >
      <div class="calendar-notice-list">
        <article v-for="notice in notices" :key="notice.id">
          <strong>{{ notice.title }}</strong>
          <p>
            {{
              new Intl.DateTimeFormat("zh-CN", {
                timeZone: notice.timeZone,
                dateStyle: "medium",
                ...(notice.allDay ? {} : { timeStyle: "short" })
              }).format(new Date(notice.occurrenceAt))
            }}{{ notice.allDay ? "（全天）" : "" }} · {{ notice.timeZone }}
          </p>
          <p v-if="notice.description" class="calendar-notice-description">
            {{ notice.description }}
          </p>
          <button class="mini-btn secondary" :disabled="readBusy" @click="view(notice)">
            查看日程
          </button>
        </article>
      </div>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <footer class="calendar-notice-actions">
        <small>私密提醒，仅你可见</small
        ><button class="primary-btn" :disabled="readBusy" @click="acknowledge">
          {{ readBusy ? "正在确认…" : "知道了" }}
        </button>
      </footer>
    </AppModal>
  </Teleport>
</template>
<style scoped>
.calendar-notice-layer {
  z-index: 2100;
}
:deep(.calendar-notice-panel) {
  display: flex;
  flex-direction: column;
  max-height: calc(
    var(--app-height, 100dvh) - 32px - var(--safe-top, 0px) - var(--safe-bottom, 0px)
  );
}
.calendar-notice-list {
  overflow: auto;
  min-height: 0;
  padding: 0 16px;
}
.calendar-notice-list article {
  border-bottom: 1px solid #ead0ce;
  padding: 12px 0;
  overflow-wrap: anywhere;
}
.calendar-notice-list p {
  font-size: 13px;
  color: #806775;
  line-height: 1.6;
}
.calendar-notice-description {
  white-space: pre-wrap;
}
.calendar-notice-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
}
.calendar-notice-actions small {
  color: #806775;
}
</style>
