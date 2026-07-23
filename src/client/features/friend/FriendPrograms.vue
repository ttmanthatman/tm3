<script setup lang="ts">
import { onMounted } from "vue";
import { X, RefreshCw, Play, Pause } from "lucide-vue-next";
import type { FriendPlayer } from "./useFriendPlayer";

const props = defineProps<{ player: FriendPlayer }>();
defineEmits<{ close: [] }>();

const { programs, listLoading, listError, currentProgramId, playing, error, progress } = props.player.state;
const controls = props.player.controls;

onMounted(() => {
  if (!programs.value.length) void controls.loadPrograms();
});
</script>

<template>
  <section class="modal-shell" role="dialog" aria-modal="true" aria-label="良友节目" @click.self="$emit('close')">
    <div class="small-modal friend-programs-modal">
      <header class="modal-head">
        <strong>良友节目</strong>
        <button
          class="icon-btn"
          type="button"
          :disabled="listLoading"
          aria-label="刷新节目单"
          @click="controls.loadPrograms()"
        ><RefreshCw :size="18" :class="{ 'friend-spin': listLoading }" /></button>
        <button class="icon-btn" type="button" aria-label="关闭良友节目" @click="$emit('close')"><X :size="20" /></button>
      </header>
      <div class="modal-form friend-programs-body">
        <p v-if="listLoading && !programs.length" class="friend-programs-status">正在加载节目单…</p>
        <template v-else-if="listError && !programs.length">
          <p class="friend-programs-status">{{ listError }}</p>
          <button class="mini-btn secondary" type="button" @click="controls.loadPrograms()">重试</button>
        </template>
        <ul v-else class="friend-program-list">
          <li v-for="program in programs" :key="program.id">
            <button
              class="friend-program-row"
              :class="{ active: currentProgramId === program.id }"
              type="button"
              @click="controls.toggleProgram(program)"
            >
              <img
                v-if="program.imageUrl"
                class="friend-program-cover"
                :src="controls.resolveMediaUrl(program.imageUrl)"
                alt=""
                loading="lazy"
              />
              <span class="friend-program-text">
                <span class="friend-program-series">{{ program.seriesTitle }}<template v-if="program.date"> · {{ program.date }}</template></span>
                <span class="friend-program-title">{{ program.title }}</span>
                <span v-if="program.notes" class="friend-program-notes">{{ program.notes }}</span>
                <span
                  v-if="currentProgramId === program.id"
                  class="friend-program-progress"
                  aria-hidden="true"
                ><span class="friend-program-progress-bar" :style="{ width: `${Math.round(progress * 100)}%` }" /></span>
              </span>
              <span class="friend-program-action" aria-hidden="true">
                <Pause v-if="currentProgramId === program.id && playing" :size="18" />
                <Play v-else :size="18" />
              </span>
            </button>
          </li>
        </ul>
        <p v-if="error" class="form-error">{{ error }}</p>
      </div>
    </div>
  </section>
</template>
