<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronUp, Minus } from "lucide-vue-next";
import type { SermonQueueItem } from "@shared/types";
import SermonStage from "./SermonStage.vue";
import { SERMON_DISPLAY_FALLBACK, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";
import { useSermon } from "./useSermon";
import { useChatStore } from "../../store";

const store = useChatStore();
const { sermonState } = useSermon({ getSocket: () => store.socket });

const minimized = ref(false);

const currentItem = computed<SermonQueueItem | null>(() => {
  const state = sermonState.value;
  if (!state) return null;
  return state.queue.find((item) => item.id === state.currentItemId) || null;
});

const display = computed(() => sermonState.value?.display ?? SERMON_DISPLAY_FALLBACK);

// 推送新条目时自动展开浮动条；仅在展示激活时挂载，卸载即无后台工作。
watch(
  () => sermonState.value?.currentItemId,
  (id, previous) => {
    if (id && id !== previous) minimized.value = false;
  }
);
</script>

<template>
  <button v-if="minimized" class="sermon-mini-bar" type="button" @click="minimized = false">
    <span>讲道经文<template v-if="currentItem"> · {{ currentItem.normalizedReference }}</template></span>
    <ChevronUp :size="16" />
  </button>
  <section
    v-else
    class="modal-shell sermon-overlay"
    aria-label="讲道经文展示"
    :style="sermonDisplayStyle(display)"
    v-bind="sermonDisplayAttrs(display)"
  >
    <div class="sermon-overlay-card">
      <SermonStage :item="currentItem" :presenter-name="sermonState?.presenterName || ''">
        <template #head-actions>
          <button class="sermon-overlay-minimize" type="button" aria-label="最小化讲道经文" @click="minimized = true"><Minus :size="20" /></button>
        </template>
      </SermonStage>
    </div>
  </section>
</template>
