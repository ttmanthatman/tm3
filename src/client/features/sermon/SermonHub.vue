<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { BellOff, MonitorPlay, X } from "lucide-vue-next";
import { useChatStore } from "../../store";
import { clearSermonNotice, loadSermonMutedIds, muteSermonPresenter, useSermon } from "./useSermon";
import { computeWatchablePresentations, visibleSermonInvites } from "./sermonHub";

const store = useChatStore();
const sermon = useSermon({ getSocket: () => store.socket });
const { invites, directory, joinedPresentationId, notice } = sermon;

const accountId = computed(() => store.account?.id ?? null);

// 静音集合按账号命名空间持久化（team-chat-sermon-muted:{accountId}）。
const mutedIds = ref<Set<number>>(new Set());
onMounted(() => {
  if (accountId.value !== null) mutedIds.value = loadSermonMutedIds(accountId.value);
});

const dismissedIds = ref<Set<number>>(new Set());

/** 横幅邀请：排除已静音、已「稍后」、已入座该演示的。 */
const bannerInvites = computed(() =>
  visibleSermonInvites(invites.value, mutedIds.value).filter(
    (invite) =>
      !dismissedIds.value.has(invite.presenterId) && invite.presenterId !== joinedPresentationId.value
  )
);

const watchable = computed(() =>
  computeWatchablePresentations({
    directory: directory.value,
    invites: invites.value,
    mutedIds: mutedIds.value,
    joinedPresentationId: joinedPresentationId.value,
    ownAccountId: accountId.value
  })
);

/** 徽标数：可观看但尚未入座观看的演示数（受邀小组 + 进行中集会，排除已静音）。 */
const badgeCount = computed(() => watchable.value.filter((entry) => !entry.watching).length);

/** 已入座他人演示时，其他演示不能直接加入（自己主持时不提供「离开并加入」）。 */
function seatedElsewhere(presenterId: number) {
  const joined = joinedPresentationId.value;
  return joined !== null && joined !== presenterId && joined !== accountId.value;
}

function dismiss(presenterId: number) {
  dismissedIds.value = new Set([...dismissedIds.value, presenterId]);
}

function mute(presenterId: number) {
  const account = accountId.value;
  if (account === null) return;
  muteSermonPresenter(account, presenterId);
  mutedIds.value = loadSermonMutedIds(account);
}

const panelOpen = ref(false);
const joinError = ref("");

async function joinPresentation(presenterId: number) {
  joinError.value = "";
  const result = await sermon.join(presenterId);
  if (!result.ok) {
    joinError.value = result.message;
    return;
  }
  panelOpen.value = false;
}

async function leaveAndJoin(presenterId: number) {
  joinError.value = "";
  const left = await sermon.leave();
  if (!left.ok) {
    joinError.value = left.message;
    return;
  }
  await joinPresentation(presenterId);
}

function handlePanelKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") panelOpen.value = false;
}

onMounted(() => window.addEventListener("keydown", handlePanelKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handlePanelKeydown));

// removed/ended 轻提示：底部 toast，数秒自动消失。
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
  <button
    class="icon-btn sermon-hub-trigger"
    type="button"
    aria-label="可观看的讲道演示"
    title="讲道演示"
    @click.stop="panelOpen = true"
  >
    <MonitorPlay :size="20" />
    <span v-if="badgeCount" class="sermon-hub-badge">{{ badgeCount }}</span>
  </button>

  <div v-if="bannerInvites.length" class="sermon-hub-banners" role="region" aria-label="讲道演示邀请">
    <div v-for="invite in bannerInvites" :key="invite.presenterId" class="sermon-hub-banner" role="status">
      <MonitorPlay :size="17" aria-hidden="true" />
      <span class="sermon-hub-banner-text">{{ invite.presenterName }} 邀请你观看讲道演示（{{ invite.scope === "assembly" ? "集会" : "小组" }}）</span>
      <button v-if="seatedElsewhere(invite.presenterId)" class="mini-btn secondary" type="button" @click="leaveAndJoin(invite.presenterId)">
        离开当前并加入
      </button>
      <button v-else class="primary-btn" type="button" @click="joinPresentation(invite.presenterId)">加入</button>
      <button class="mini-btn secondary" type="button" @click="dismiss(invite.presenterId)">稍后</button>
      <button
        class="icon-btn sermon-hub-mute"
        type="button"
        :aria-label="`不再提示 ${invite.presenterName} 的邀请`"
        @click="mute(invite.presenterId)"
      >
        <BellOff :size="14" />
      </button>
    </div>
  </div>

  <div v-if="toast" class="sermon-hub-toast" role="status">{{ toast }}</div>

  <section
    v-if="panelOpen"
    class="modal-shell sermon-hub-panel"
    role="dialog"
    aria-modal="true"
    aria-label="可观看的讲道演示"
    @click.self="panelOpen = false"
  >
    <div class="sermon-hub-sheet">
      <header class="sermon-hub-sheet-head">
        <strong>可观看的讲道演示</strong>
        <button class="icon-btn" type="button" aria-label="关闭" @click="panelOpen = false"><X :size="20" /></button>
      </header>
      <div class="sermon-hub-sheet-body">
        <p v-if="joinError" class="sermon-hub-error" role="alert">{{ joinError }}</p>
        <p v-if="!watchable.length" class="sermon-hub-empty">暂无可观看的讲道演示。</p>
        <div v-for="entry in watchable" :key="entry.summary.presenterId" class="sermon-hub-row">
          <div class="sermon-hub-row-info">
            <strong>{{ entry.summary.presenterName }}</strong>
            <small>
              {{ entry.summary.scope === "assembly" ? "全体演示" : "小组演示" }}
              · {{ entry.summary.active ? "进行中" : "未开始展示" }}
            </small>
          </div>
          <span v-if="entry.watching" class="sermon-hub-watching">观看中</span>
          <button
            v-else-if="entry.blocked && entry.summary.scope === 'assembly'"
            class="mini-btn secondary"
            type="button"
            disabled
            title="你已入座其他演示，离开后即可加入"
          >离开后可用</button>
          <button v-else-if="entry.blocked" class="mini-btn secondary" type="button" @click="leaveAndJoin(entry.summary.presenterId)">
            离开当前并加入
          </button>
          <button v-else class="primary-btn" type="button" @click="joinPresentation(entry.summary.presenterId)">观看</button>
        </div>
        <p class="sermon-hub-hint">观众同一时间只能观看一场演示；小组演示需主持人邀请。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sermon-hub-trigger {
  position: relative;
}

.sermon-hub-badge {
  position: absolute;
  top: 2px;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}

.sermon-hub-banners {
  position: fixed;
  top: calc(60px + var(--safe-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 55;
}

.sermon-hub-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  font-size: 14px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
}

.sermon-hub-banner-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.sermon-hub-mute {
  color: rgba(255, 255, 255, 0.75);
  flex: none;
}

.sermon-hub-toast {
  position: fixed;
  left: 50%;
  bottom: calc(96px + var(--safe-bottom, 0px));
  transform: translateX(-50%);
  z-index: 60;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  font-size: 14px;
  text-align: center;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
}

.sermon-hub-sheet {
  width: min(420px, calc(100vw - 32px));
  max-height: min(70vh, 480px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--panel, #fff);
  color: var(--ink, #111827);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  overflow: hidden;
}

.sermon-hub-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line, rgba(0, 0, 0, 0.08));
}

.sermon-hub-sheet-body {
  padding: 12px 16px calc(12px + var(--safe-bottom, 0px));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sermon-hub-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sermon-hub-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sermon-hub-row-info strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sermon-hub-row-info small {
  color: var(--muted, #6b7280);
}

.sermon-hub-watching {
  flex: none;
  font-size: 13px;
  color: var(--accent, #2563eb);
}

.sermon-hub-error {
  margin: 0;
  color: #dc2626;
  font-size: 13px;
}

.sermon-hub-empty,
.sermon-hub-hint {
  margin: 0;
  color: var(--muted, #6b7280);
  font-size: 13px;
}

@media (max-width: 480px) {
  .sermon-hub-banner {
    flex-wrap: wrap;
  }

  .sermon-hub-banner .mini-btn {
    flex: 1;
  }
}
</style>
