<script setup lang="ts">
import type { ZoomAnnouncementPayload } from "@shared/zoom";
import type { MessageDTO } from "@shared/types";
import { computed } from "vue";
import { useZoomAnnouncements } from "./useZoomAnnouncements";

const props = defineProps<{ announcement: ZoomAnnouncementPayload; message: MessageDTO }>();
const actions = useZoomAnnouncements();
const ended = computed(() => actions?.ended(props.message) ?? false);
</script>

<template>
  <button v-if="announcement.status === 'active' && ended" type="button" class="zoom-meeting-announcement" aria-label="Zoom会议开始了（会议已结束）" @click.stop="actions?.drop(message, $event)" @pointerdown.stop>Zoom会议开始了</button>
  <a v-else-if="announcement.status === 'active'" class="zoom-meeting-announcement" :href="announcement.url" target="_blank" rel="noopener noreferrer" @click.stop @pointerdown.stop>Zoom会议开始了</a>
  <span v-else class="zoom-meeting-announcement">Zoom会议结束了</span>
</template>

<style scoped>
.zoom-meeting-announcement { display: inline-block; max-width: 100%; padding: 4px 10px; border: 0; border-radius: 7px; background: #246bff; color: #fff; font-family: inherit; font-size: 13px; font-weight: 700; line-height: 1.6; text-align: center; text-decoration: none; text-shadow: none; overflow-wrap: anywhere; }
button.zoom-meeting-announcement { cursor: pointer; }
a.zoom-meeting-announcement:hover { background: #1758da; color: #fff; }
.zoom-meeting-announcement:focus-visible { outline: 2px solid #246bff; outline-offset: 3px; }
</style>
