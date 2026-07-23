<script setup lang="ts">
import { Play, Pause } from "lucide-vue-next";
import type { FriendProgramDTO } from "../../../shared/types";
import type { FriendPlayer } from "./useFriendPlayer";

const props = defineProps<{ player: FriendPlayer; programs: FriendProgramDTO[] }>();
const { currentProgramId, playing, progress } = props.player.state;
const controls = props.player.controls;
</script>

<template>
  <ul class="friend-program-list">
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
</template>
