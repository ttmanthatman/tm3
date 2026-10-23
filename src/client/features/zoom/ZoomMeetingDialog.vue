<script setup lang="ts">
import { computed, ref } from "vue";
import { DEFAULT_MEETING_TIME_ZONE, meetingEndLabel } from "@shared/zoom";
import AppModal from "../../components/ui/AppModal.vue";
import type { useZoomMeeting } from "./useZoomMeeting";

const props = defineProps<{ zoom: ReturnType<typeof useZoomMeeting>; isAdmin: boolean }>();
const emit = defineEmits<{ close: [] }>();
const activeDraft = ref(!props.zoom.active.value);
const durationMinutes = ref(60);
const timeZone = ref(props.zoom.settings.value.meeting?.timeZone || DEFAULT_MEETING_TIME_ZONE);
const busy = ref(false);
const error = ref("");
const endPreview = computed(() => {
  try { return meetingEndLabel({ endsAt: new Date(Date.now() + durationMinutes.value * 60_000).toISOString(), timeZone: timeZone.value }); }
  catch { return "请填写有效的时长和时区"; }
});
async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await props.zoom.save("meeting", { active: activeDraft.value, durationMinutes: durationMinutes.value, timeZone: timeZone.value });
    emit("close");
  } catch (reason) { error.value = reason instanceof Error ? reason.message : "会议状态保存失败"; }
  finally { busy.value = false; }
}
</script>

<template>
  <AppModal open title="Zoom 会议状态" :busy="busy" @close="emit('close')">
    <form class="modal-form zoom-meeting-form" @submit.prevent="submit">
      <p role="status">{{ zoom.active.value ? '正在开会' : '当前未开会' }}</p>
      <p v-if="zoom.active.value && zoom.settings.value.meeting">状态将于 {{ meetingEndLabel(zoom.settings.value.meeting) }} 结束（{{ zoom.settings.value.meeting.timeZone === DEFAULT_MEETING_TIME_ZONE ? '北京时间' : zoom.settings.value.meeting.timeZone }}）。</p>
      <p v-if="!isAdmin">会议状态由管理员统一设置。</p>
      <template v-else>
        <label>是否切换会议状态？<select v-model="activeDraft" :disabled="busy || !zoom.ready.value"><option :value="true">正在开会</option><option :value="false">未开会</option></select></label>
        <label>状态持续时间（分钟）<input v-model.number="durationMinutes" type="number" min="1" max="10080" required :disabled="busy || !activeDraft" /></label>
        <label>所在时区<input v-model="timeZone" list="zoom-time-zones" required maxlength="100" :disabled="busy || !activeDraft" /></label>
        <datalist id="zoom-time-zones"><option value="Asia/Shanghai">北京时间</option><option value="Asia/Hong_Kong">香港</option><option value="Asia/Taipei">台北</option><option value="America/New_York">纽约</option><option value="America/Los_Angeles">洛杉矶</option><option value="Europe/London">伦敦</option><option value="Australia/Sydney">悉尼</option><option value="UTC" /></datalist>
        <small v-if="activeDraft">默认北京时间（Asia/Shanghai）；预计 {{ endPreview }} 自动结束。</small>
      </template>
      <p v-if="error || zoom.error.value" class="error" role="alert">{{ error || zoom.error.value }}</p>
      <button v-if="isAdmin" class="primary-btn" type="submit" :disabled="busy || !zoom.ready.value">{{ busy ? '保存中…' : '确认切换' }}</button>
    </form>
  </AppModal>
</template>

<style scoped>
.zoom-meeting-form { display: grid; gap: 14px; overflow: auto; }
.zoom-meeting-form p { margin: 0; }
.zoom-meeting-form label { display: grid; gap: 6px; }
.zoom-meeting-form input, .zoom-meeting-form select { width: 100%; min-height: 40px; box-sizing: border-box; }
.zoom-meeting-form small { color: var(--muted); line-height: 1.6; }
</style>
