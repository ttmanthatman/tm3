<script setup lang="ts">
import { computed, ref } from "vue";
import { Minus, MonitorPlay } from "lucide-vue-next";
import type { SermonQueueItem } from "@shared/types";
import SermonStage from "./SermonStage.vue";
import SermonFloatingButton from "./SermonFloatingButton.vue";
import { SERMON_DISPLAY_FALLBACK, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";
import { useSermon } from "./useSermon";
import { useChatStore } from "../../store";

const store = useChatStore();
const { watchedState: sermonState } = useSermon({ getSocket: () => store.socket });

const minimized = ref(false);

const currentItem = computed<SermonQueueItem | null>(() => {
  const state = sermonState.value;
  if (!state) return null;
  return state.queue.find((item) => item.id === state.currentItemId) || null;
});

const display = computed(() => sermonState.value?.display ?? SERMON_DISPLAY_FALLBACK);

const floatingStorageKey = computed(() =>
  `team-chat-sermon-float:${store.account?.id ?? "guest"}:${sermonState.value?.presenterId ?? "watching"}`
);
</script>

<template>
  <SermonFloatingButton
    v-if="minimized"
    :accessible-label="`展开 ${sermonState?.presenterName || ''} 的讲道`"
    :storage-key="floatingStorageKey"
    @activate="minimized = false"
  >
    <MonitorPlay :size="17" />
    <span>{{ sermonState?.presenterName || "讲道" }}<template v-if="currentItem"> · {{ currentItem.normalizedReference }}</template></span>
  </SermonFloatingButton>
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
