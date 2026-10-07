<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { CopyworkDTO, CopyworkGlyph, CopyworkPlacement } from "@shared/bibleCopywork";
import { Ellipsis, CircleHelp } from "lucide-vue-next";
import AppModal from "../../../components/ui/AppModal.vue";
import { api } from "../../../api";
import { copyworkWrite } from "./copyworkApi";
import { useChatStore } from "../../../store";
import CopyworkPage from "./CopyworkPage.vue";
import { openCopyworkSource } from "./copyworkViewerState";
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; changed: []; chat: [] }>();
const store = useChatStore();
const work = ref<CopyworkDTO | null>(null);
const pages = shallowRef<CopyworkPlacement[][]>([]);
const glyphs = shallowRef<Array<CopyworkGlyph & { index: number }>>([]);
const page = ref(0);
const error = ref("");
const busy = ref(false);
const loading = ref(false);
const tipsOpen = ref(false);
const toolsOpen = ref(false);
const shareOpen = ref(false);
const deleteOpen = ref(false);
const publicOpen = ref(false);
const channelId = ref<number | null>(null);
const sharedChannel = ref<number | null>(null);
const folio = ref<InstanceType<typeof CopyworkPage> | null>(null);
let sequence = 0;
let shareRequestId = crypto.randomUUID();
const mine = computed(() => work.value?.accountId === store.account?.id);
const channels = computed(() =>
  store.channels.filter((c) => ["standard", "direct"].includes(c.kind) && c.canWrite !== false)
);
async function loadPage() {
  const request = ++sequence;
  loading.value = true;
  glyphs.value = [];
  error.value = "";
  try {
    const data = await api<{ glyphs: Array<CopyworkGlyph & { index: number }> }>(
      `/api/bible/copyworks/${props.id}/pages/${page.value}`
    );
    if (request === sequence) glyphs.value = data.glyphs;
  } catch (e) {
    if (request === sequence) error.value = e instanceof Error ? e.message : "册页加载失败";
  } finally {
    if (request === sequence) loading.value = false;
  }
}
async function load() {
  error.value = "";
  try {
    const data = await api<{ work: CopyworkDTO; pages: CopyworkPlacement[][] }>(
      `/api/bible/copyworks/${props.id}`
    );
    work.value = data.work;
    pages.value = data.pages;
    await loadPage();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "作品加载失败";
  }
}
function turnPage(direction: -1 | 1) {
  if (loading.value) return;
  const next = page.value + direction;
  if (next >= 0 && next < pages.value.length) page.value = next;
}
async function openSource() {
  if (!work.value) return;
  folio.value?.stop();
  try {
    await openCopyworkSource(work.value.source);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "经文跳转失败";
  }
}
function changed() {
  window.dispatchEvent(new Event("bible-copyworks-changed"));
  emit("changed");
}
async function publish() {
  if (!work.value) return;
  busy.value = true;
  error.value = "";
  try {
    await copyworkWrite(`/api/bible/copyworks/${props.id}`, {
      method: "PATCH",
      body: JSON.stringify({ published: !work.value.publishedAt })
    });
    publicOpen.value = false;
    changed();
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "公开设置失败";
  } finally {
    busy.value = false;
  }
}
async function remove() {
  busy.value = true;
  error.value = "";
  try {
    await copyworkWrite(`/api/bible/copyworks/${props.id}`, { method: "DELETE" });
    changed();
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "删除失败";
  } finally {
    busy.value = false;
  }
}
function openShare() {
  channelId.value = channels.value[0]?.id || null;
  shareOpen.value = true;
  shareRequestId = crypto.randomUUID();
}
async function share() {
  if (!channelId.value) return;
  busy.value = true;
  error.value = "";
  try {
    await copyworkWrite(`/api/bible/copyworks/${props.id}/share`, {
      method: "POST",
      body: JSON.stringify({ channelId: channelId.value, clientRequestId: shareRequestId })
    });
    sharedChannel.value = channelId.value;
    shareOpen.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "分享失败，可重试";
  } finally {
    busy.value = false;
  }
}
async function goToChat() {
  if (sharedChannel.value) {
    await store.switchChannel(sharedChannel.value);
    emit("chat");
    emit("close");
  }
}
watch(page, () => {
  folio.value?.stop();
  void loadPage();
});
watch(channelId, () => {
  shareRequestId = crypto.randomUUID();
});
watch(
  () => props.id,
  () => {
    page.value = 0;
    void load();
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  sequence++;
});
</script>
<template>
  <Teleport to="body"
    ><AppModal
      class="copywork-viewer-shell"
      :open="true"
      :busy="busy"
      aria-label="抄写册页"
      size="medium"
      content-class="copywork-viewer"
      @close="emit('close')"
    >
      <template #header>
        <div class="viewer-header">
          <button
            v-if="work"
            type="button"
            class="viewer-reference"
            :aria-label="`在圣经中阅读：${work.source.reference}`"
            @click="openSource"
          >
            {{ work.source.reference }}
          </button>
          <span v-else class="viewer-loading" role="status">正在铺开册页…</span>
          <span v-if="pages.length > 1" class="viewer-page-count" aria-label="当前册页"
            >{{ page + 1 }} / {{ pages.length }}</span
          >
          <button
            type="button"
            class="viewer-icon"
            aria-label="抄写操作提示"
            :aria-expanded="tipsOpen"
            aria-controls="copywork-tips"
            @click="
              tipsOpen = !tipsOpen;
              toolsOpen = false;
            "
          >
            <CircleHelp :size="20" />
          </button>
          <button
            v-if="mine"
            type="button"
            class="viewer-icon"
            aria-label="作品操作"
            :aria-expanded="toolsOpen"
            aria-controls="copywork-tools"
            @click="
              toolsOpen = !toolsOpen;
              tipsOpen = false;
            "
          >
            <Ellipsis :size="20" />
          </button>
        </div>
      </template>
      <div class="viewer-body">
        <aside v-if="tipsOpen" id="copywork-tips" class="viewer-popover" aria-label="抄写操作提示">
          <strong>操作提示</strong>
          <p>
            左边缘：上一页<br />右边缘：下一页<br />中间单击：播放 / 暂停<br />中间双击：从头播放<br />按住左右拖动：调整进度
          </p>
          <small>也可用空格播放 / 暂停，方向键翻页。</small>
        </aside>
        <div
          v-if="mine && toolsOpen && work"
          id="copywork-tools"
          class="viewer-popover viewer-tools"
          role="group"
          aria-label="作品操作"
        >
          <button
            :disabled="busy"
            @click="
              work.publishedAt ? publish() : (publicOpen = true);
              toolsOpen = false;
            "
          >
            {{ work.publishedAt ? "取消公开" : "公开到经文下" }}
          </button>
          <button
            :disabled="busy"
            @click="
              openShare();
              toolsOpen = false;
            "
          >
            分享到聊天室
          </button>
          <button
            class="danger"
            :disabled="busy"
            @click="
              deleteOpen = true;
              toolsOpen = false;
            "
          >
            删除作品
          </button>
        </div>
        <p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
        <template v-if="work">
          <div class="folio-scroll" :aria-busy="loading">
            <div class="folio-size" :data-page-index="page">
              <CopyworkPage
                ref="folio"
                :glyphs="glyphs"
                :placements="pages[page] || []"
                :source="work.source"
                compact
                interactive
                paging
                :disabled="loading"
                @turn="turnPage"
              />
            </div>
          </div>
          <p v-if="loading" role="status">正在铺开册页…</p>
          <div v-if="sharedChannel" class="notice" role="status">
            分享成功 <button @click="goToChat">前往聊天室</button>
          </div>
          <section v-if="publicOpen" class="notice">
            <p>
              公开后，站内登录用户可以从对应经文查看此作品。取消公开不会撤回已分享的聊天室消息。
            </p>
            <button :disabled="busy" @click="publish">确认公开</button
            ><button @click="publicOpen = false">取消</button>
          </section>
          <section v-if="shareOpen" class="notice">
            <label
              >分享到
              <select v-model="channelId" :disabled="busy">
                <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select></label
            >
            <p>仅此聊天室成员可查看，不会自动公开到经文下。</p>
            <button :disabled="busy || !channelId" @click="share">发送作品</button
            ><button @click="shareOpen = false">取消</button>
          </section>
          <section v-if="deleteOpen" class="notice">
            <p>删除后不可恢复，聊天室里的作品也将无法查看。</p>
            <button class="danger" :disabled="busy" @click="remove">确认删除作品</button
            ><button @click="deleteOpen = false">保留作品</button>
          </section>
        </template>
      </div>
    </AppModal></Teleport
  >
</template>
<style scoped>
.copywork-viewer-shell {
  z-index: 160;
  padding: max(12px, var(--safe-top)) max(8px, env(safe-area-inset-right))
    max(12px, var(--safe-bottom)) max(8px, env(safe-area-inset-left));
}
:deep(.copywork-viewer) {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: calc(var(--app-height) - max(12px, var(--safe-top)) - max(12px, var(--safe-bottom)));
  background: #fffaf0;
  color: #315b4e;
}
:deep(.modal-head) {
  flex-shrink: 0;
  min-height: 52px;
  padding: 4px 8px 4px 16px;
  border-bottom: 0;
  background: transparent;
  gap: 0;
}
:deep(.modal-head .icon-btn) {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
}
.viewer-header {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 4px;
}
.viewer-reference {
  margin-right: auto;
  padding: 4px 0;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  font-size: 14px;
}
.viewer-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border: 0;
  background: transparent;
  padding: 0;
}
.viewer-page-count {
  white-space: nowrap;
  font-size: 12px;
  color: #7b7b7b;
}
.viewer-body {
  padding: 0 16px 16px;
  overflow: auto;
  min-height: 0;
}
.folio-size {
  width: 100%;
}
/* The only citation is in the fixed header. */
.folio-size :deep(.copywork-reference) {
  display: none;
}
.viewer-popover {
  position: absolute;
  z-index: 2;
  top: 52px;
  right: 12px;
  max-width: calc(100% - 24px);
  padding: 14px;
  border: 1px solid #e3dfd6;
  border-radius: 8px;
  background: #fff;
  color: #48514d;
  box-shadow: 0 6px 20px #0002;
  font-size: 13px;
}
.viewer-popover p {
  margin: 8px 0;
  line-height: 1.9;
}
.viewer-popover small {
  color: #6c756e;
}
.viewer-tools {
  display: grid;
  gap: 4px;
}
button,
select {
  min-height: 40px;
  border: 1px solid #d8ccb7;
  border-radius: 7px;
  background: #fffaf0;
  color: inherit;
  padding: 7px 12px;
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.viewer-reference,
.viewer-icon {
  border: 0;
  background: transparent;
}
.danger {
  color: #9b4130;
}
.notice {
  padding: 16px;
  margin: 12px 0 0;
  background: #f1ece1;
  border-radius: 9px;
}
.notice button {
  margin: 4px;
}
@media (max-width: 700px) {
  :deep(.copywork-viewer) {
    width: 100%;
  }
}
</style>
