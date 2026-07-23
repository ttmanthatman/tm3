<script setup lang="ts">
import { onMounted, ref } from "vue";
import { X, ChevronLeft, ChevronRight } from "lucide-vue-next";
import type { FriendPlaybackDTO, FriendProgramDTO } from "../../../shared/types";
import type { FriendPlayer } from "./useFriendPlayer";
import FriendProgramList from "./FriendProgramList.vue";

const props = defineProps<{ player: FriendPlayer }>();
defineEmits<{ close: [] }>();

const {
  programs, listLoading, listError,
  categories, categoriesLoading, categoriesError,
  activeSeries, seriesPrograms, seriesLoading, seriesError,
  history, historyLoading, historyError,
  error
} = props.player.state;
const controls = props.player.controls;

const activeTab = ref<"today" | "more" | "history">("today");

function selectTab(tab: "today" | "more" | "history") {
  activeTab.value = tab;
  if (tab === "more" && !categories.value.length) void controls.loadCategories();
  if (tab === "history" && !history.value.length) void controls.loadHistory();
}

function historyToProgram(item: FriendPlaybackDTO): FriendProgramDTO {
  return {
    id: item.programId,
    seriesId: "",
    seriesTitle: item.seriesTitle,
    title: item.title,
    date: item.playedAt.slice(0, 10),
    audioUrl: item.audioUrl,
    imageUrl: item.imageUrl
  };
}

onMounted(() => {
  if (!programs.value.length) void controls.loadPrograms();
  if (!history.value.length) void controls.loadHistory();
});
</script>

<template>
  <section class="modal-shell" role="dialog" aria-modal="true" aria-label="良友节目" @click.self="$emit('close')">
    <div class="small-modal friend-programs-modal">
      <header class="modal-head">
        <strong>良友节目</strong>
        <button class="icon-btn" type="button" aria-label="关闭良友节目" @click="$emit('close')"><X :size="20" /></button>
      </header>
      <nav class="friend-tabs" aria-label="节目列表切换">
        <button
          class="friend-tab"
          type="button"
          :class="{ active: activeTab === 'today' }"
          :aria-pressed="activeTab === 'today'"
          @click="selectTab('today')"
        >今日节目</button>
        <button
          class="friend-tab"
          type="button"
          :class="{ active: activeTab === 'more' }"
          :aria-pressed="activeTab === 'more'"
          @click="selectTab('more')"
        >更多节目</button>
        <button
          class="friend-tab"
          type="button"
          :class="{ active: activeTab === 'history' }"
          :aria-pressed="activeTab === 'history'"
          @click="selectTab('history')"
        >最近收听</button>
      </nav>
      <div class="modal-form friend-programs-body">
        <template v-if="activeTab === 'today'">
          <p v-if="listLoading && !programs.length" class="friend-programs-status">正在加载节目单…</p>
          <p v-else-if="listError && !programs.length" class="friend-programs-status">{{ listError }}</p>
          <FriendProgramList v-else :player="player" :programs="programs" />
        </template>
        <template v-else-if="activeTab === 'history'">
          <p v-if="historyLoading && !history.length" class="friend-programs-status">正在加载收听记录…</p>
          <p v-else-if="historyError && !history.length" class="friend-programs-status">{{ historyError }}</p>
          <p v-else-if="!history.length" class="friend-programs-status">还没有收听记录</p>
          <FriendProgramList v-else :player="player" :programs="history.map(historyToProgram)" />
        </template>
        <template v-else-if="activeSeries">
          <button class="friend-series-back" type="button" @click="controls.closeSeries()">
            <ChevronLeft :size="16" aria-hidden="true" />
            <span>{{ activeSeries.title }}</span>
          </button>
          <p v-if="seriesLoading && !seriesPrograms.length" class="friend-programs-status">正在加载节目列表…</p>
          <p v-else-if="seriesError && !seriesPrograms.length" class="friend-programs-status">{{ seriesError }}</p>
          <FriendProgramList v-else :player="player" :programs="seriesPrograms" />
        </template>
        <template v-else>
          <p v-if="categoriesLoading && !categories.length" class="friend-programs-status">正在加载节目分类…</p>
          <p v-else-if="categoriesError && !categories.length" class="friend-programs-status">{{ categoriesError }}</p>
          <template v-else>
            <div v-for="category in categories" :key="category.id" class="friend-category">
              <h3 class="friend-category-title">{{ category.title }}</h3>
              <ul class="friend-program-list">
                <li v-for="series in category.series" :key="series.alias">
                  <button class="friend-program-row" type="button" @click="controls.openSeries(series)">
                    <img
                      v-if="series.imageUrl"
                      class="friend-program-cover"
                      :src="controls.resolveMediaUrl(series.imageUrl)"
                      alt=""
                      loading="lazy"
                    />
                    <span class="friend-program-text">
                      <span class="friend-program-title">{{ series.title }}</span>
                      <span v-if="series.description" class="friend-program-series">{{ series.description }}</span>
                    </span>
                    <span class="friend-program-action" aria-hidden="true"><ChevronRight :size="18" /></span>
                  </button>
                </li>
              </ul>
            </div>
          </template>
        </template>
        <p v-if="error" class="form-error">{{ error }}</p>
      </div>
    </div>
  </section>
</template>
