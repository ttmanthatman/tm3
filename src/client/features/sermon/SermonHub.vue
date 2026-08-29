<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { MonitorPlay } from "lucide-vue-next";
import { useChatStore } from "../../store";
import { clearSermonNotice, useSermon } from "./useSermon";
import { computeWatchablePresentations } from "./sermonHub";
import { sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";
import SermonFloatingButton from "./SermonFloatingButton.vue";

const SermonStage = defineAsyncComponent(() => import("./SermonStage.vue"));

const store = useChatStore();
const sermon = useSermon({ getSocket: () => store.socket });
const { invites, directory, joinedPresentationId, notice, previews } = sermon;
const accountId = computed(() => store.account?.id ?? null);
const ignoredIds = ref<Set<number>>(new Set());
const joinError = ref("");

const watchable = computed(() =>
  computeWatchablePresentations({
    directory: directory.value,
    invites: invites.value,
    mutedIds: new Set(),
    joinedPresentationId: joinedPresentationId.value,
    ownAccountId: accountId.value
  })
);

const watchableWithPreview = computed(() =>
  watchable.value.map((entry) => ({
    ...entry,
    summary: {
      ...entry.summary,
      preview: previews.value[entry.summary.presenterId] ?? entry.summary.preview
    }
  }))
);

const liveNotifications = computed(() =>
  watchableWithPreview.value.filter(
    (entry) => entry.summary.active && entry.summary.preview && !entry.watching && !ignoredIds.value.has(entry.summary.presenterId)
  )
);

const minimizedEntries = computed(() =>
  watchableWithPreview.value.filter(
    (entry) => entry.summary.active && !entry.watching && ignoredIds.value.has(entry.summary.presenterId)
  )
);

watch(directory, (entries) => {
  const alive = new Set(entries.map((entry) => entry.presenterId));
  if ([...ignoredIds.value].some((id) => !alive.has(id))) {
    ignoredIds.value = new Set([...ignoredIds.value].filter((id) => alive.has(id)));
  }
});

function ignore(presenterId: number) {
  ignoredIds.value = new Set([...ignoredIds.value, presenterId]);
}

async function joinPresentation(presenterId: number) {
  joinError.value = "";
  const joined = joinedPresentationId.value;
  if (joined !== null && joined !== presenterId) {
    const left = await sermon.leave();
    if (!left.ok) {
      joinError.value = left.message;
      return;
    }
  }
  const result = await sermon.join(presenterId);
  if (!result.ok) {
    joinError.value = result.message;
    return;
  }
  ignoredIds.value = new Set([...ignoredIds.value].filter((id) => id !== presenterId));
}

const toast = ref("");
let toastTimer: number | undefined;

watch(notice, (value) => {
  if (!value) return;
  toast.value =
    value.kind === "removed"
      ? `你已被${value.presenterName ? ` ${value.presenterName} ` : ""}移出演示`
      : `${value.presenterName ? `${value.presenterName} 的` : ""}演示已结束`;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
    clearSermonNotice();
    toastTimer = undefined;
  }, 4000);
});

onBeforeUnmount(() => {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
});
</script>

<template>
  <div v-if="liveNotifications.length" class="sermon-live-notifications" role="region" aria-label="正在讲道通知">
    <article v-for="entry in liveNotifications" :key="entry.summary.presenterId" class="sermon-live-card">
      <header>
        <span>
          <strong>{{ entry.summary.presenterName }} 正在讲道</strong>
          <small>{{ entry.summary.scope === "assembly" ? "全体演示" : "你已获准观看的小组演示" }}</small>
        </span>
      </header>
      <div
        v-if="entry.summary.preview"
        class="sermon-overlay sermon-live-preview"
        :style="sermonDisplayStyle(entry.summary.preview.display)"
        v-bind="sermonDisplayAttrs(entry.summary.preview.display)"
      >
        <div class="sermon-overlay-card">
          <SermonStage :item="entry.summary.preview.item" :presenter-name="entry.summary.presenterName" />
        </div>
      </div>
      <p v-if="joinError" class="sermon-live-error" role="alert">{{ joinError }}</p>
      <footer>
        <button class="mini-btn secondary" type="button" @click="ignore(entry.summary.presenterId)">忽略并最小化</button>
        <button class="primary-btn" type="button" :disabled="sermon.pending.value" @click="joinPresentation(entry.summary.presenterId)">
          点击进入观看
        </button>
      </footer>
    </article>
  </div>

  <SermonFloatingButton
    v-for="(entry, index) in minimizedEntries"
    :key="entry.summary.presenterId"
    :accessible-label="`进入观看 ${entry.summary.presenterName} 的讲道`"
    :storage-key="`team-chat-sermon-float:${accountId ?? 'guest'}:${entry.summary.presenterId}`"
    :offset="index * 56"
    @activate="joinPresentation(entry.summary.presenterId)"
  >
    <MonitorPlay :size="17" />
    <span>{{ entry.summary.presenterName }} 正在讲道</span>
  </SermonFloatingButton>

  <div v-if="toast" class="sermon-hub-toast" role="status">{{ toast }}</div>
</template>

<style scoped>
.sermon-live-notifications {
  position: fixed;
  top: calc(58px + var(--safe-top, 0px));
  left: 50%;
  z-index: 57;
  width: min(440px, calc(100vw - 24px));
  max-height: calc(100dvh - 76px - var(--safe-top, 0px) - var(--safe-bottom, 0px));
  overflow-y: auto;
  transform: translateX(-50%);
}

.sermon-live-card {
  overflow: hidden;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 18px;
  background: rgba(17, 24, 39, 0.96);
  color: #fff;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(16px);
}

.sermon-live-card + .sermon-live-card {
  margin-top: 10px;
}

.sermon-live-card header > span {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
}

.sermon-live-card header small {
  color: rgba(255, 255, 255, 0.68);
}

.sermon-live-preview {
  position: relative;
  width: 100%;
  height: clamp(170px, 34vh, 250px);
  min-height: 0;
  padding: 12px;
  border-radius: 13px;
  pointer-events: none;
}

.sermon-live-preview :deep(.sermon-overlay-head) {
  padding-bottom: 6px;
}

.sermon-live-preview :deep(.sermon-passage) {
  font-size: clamp(16px, 4.4vw, 24px);
  line-height: 1.65;
}

.sermon-live-preview :deep(.sermon-overlay-share) {
  display: none;
}

.sermon-live-card footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.sermon-live-error {
  margin: 8px 0 0;
  color: #fecaca;
  font-size: 13px;
}

.sermon-hub-toast {
  position: fixed;
  left: 50%;
  bottom: calc(96px + var(--safe-bottom, 0px));
  z-index: 60;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  font-size: 14px;
  text-align: center;
  transform: translateX(-50%);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
}

@media (max-width: 480px) {
  .sermon-live-card footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }
}
</style>
