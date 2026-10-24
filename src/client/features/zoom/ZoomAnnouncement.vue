<script setup lang="ts">
import type { ZoomAnnouncementPayload } from "@shared/zoom";

defineProps<{ announcement: ZoomAnnouncementPayload }>();
</script>

<template>
  <a v-if="announcement.status === 'active'" class="zoom-meeting-announcement" :href="announcement.url" target="_blank" rel="noopener noreferrer" @click.stop @pointerdown.stop>Zoom会议开始了</a>
  <span v-else class="zoom-meeting-announcement">Zoom会议结束了</span>
</template>

<style scoped>
.zoom-meeting-announcement { display: inline-block; max-width: 100%; padding: 4px 10px; border-radius: 7px; background: #246bff; color: #fff; font-size: 13px; font-weight: 700; line-height: 1.6; text-align: center; text-decoration: none; text-shadow: none; overflow-wrap: anywhere; }
a.zoom-meeting-announcement:hover { background: #1758da; color: #fff; }
a.zoom-meeting-announcement:focus-visible { outline: 2px solid #246bff; outline-offset: 3px; }
</style>
