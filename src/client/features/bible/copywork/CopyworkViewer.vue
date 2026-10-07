<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { CopyworkDTO, CopyworkGlyph, CopyworkPlacement } from "@shared/bibleCopywork";
import { Ellipsis, CircleHelp } from "lucide-vue-next";
import AppModal from "../../../components/ui/AppModal.vue";
import { api } from "../../../api";
import { copyworkWrite } from "./copyworkApi";
import { useChatStore } from "../../../store";
import CopyworkPage from "./CopyworkPage.vue";
import { openCopyworkSource, type CopyworkVerseFilter } from "./copyworkViewerState";
const props = defineProps<{ id?: string; filter?: CopyworkVerseFilter }>();
const emit = defineEmits<{ close: []; changed: []; chat: [] }>();
const store = useChatStore();
const work = ref<CopyworkDTO | null>(null);
const selectedId = ref("");
const choices = shallowRef<CopyworkDTO[]>([]);
const choiceScope = ref<"public" | "mine">("public");
const choiceBusy = ref(false);
const choiceError = ref("");
const hasMoreChoices = ref(false);
const choicesOpen = ref(false);
const detailsOpen = ref(false);
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
let workSequence = 0;
let choiceSequence = 0;
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
      `/api/bible/copyworks/${selectedId.value}/pages/${page.value}`
    );
    if (request === sequence) glyphs.value = data.glyphs;
  } catch (e) {
    if (request === sequence) error.value = e instanceof Error ? e.message : "册页加载失败";
  } finally {
    if (request === sequence) loading.value = false;
  }
}
async function load() {
  const request = ++workSequence;
  error.value = "";
  try {
    const data = await api<{ work: CopyworkDTO; pages: CopyworkPlacement[][] }>(
      `/api/bible/copyworks/${selectedId.value}`
    );
    if (request !== workSequence) return;
    work.value = data.work;
    pages.value = data.pages;
    await loadPage();
  } catch (e) {
    if (request === workSequence) error.value = e instanceof Error ? e.message : "作品加载失败";
  }
}
async function loadChoices(scope: "public" | "mine", more = false) {
  if (!props.filter) return;
  const request = ++choiceSequence;
  choiceScope.value = scope;
  choiceBusy.value = true;
  choiceError.value = "";
  if (!more) {
    choices.value = [];
    hasMoreChoices.value = false;
  }
  const params = new URLSearchParams({ scope, offset: String(choices.value.length) });
  Object.entries(props.filter).forEach(([key, value]) => params.set(key, String(value)));
  try {
    const data = await api<{ works: CopyworkDTO[]; hasMore: boolean }>(`/api/bible/copyworks?${params}`);
    if (request !== choiceSequence) return;
    choices.value = more ? [...choices.value, ...data.works] : data.works;
    hasMoreChoices.value = data.hasMore;
    return data.works;
  } catch (e) {
    if (request === choiceSequence) choiceError.value = e instanceof Error ? e.message : "作品加载失败";
  } finally {
    if (request === choiceSequence) choiceBusy.value = false;
  }
}
async function openVerse() {
  error.value = "";
  let available = await loadChoices("public");
  if (available && !available.length) available = await loadChoices("mine");
  if (available?.length) selectedId.value = available[0].id;
  else if (choiceError.value) error.value = choiceError.value;
}
function selectWork(id: string) {
  if (busy.value) return;
  selectedId.value = id;
  toolsOpen.value = false;
  choicesOpen.value = false;
  detailsOpen.value = false;
}
function retry() {
  if (selectedId.value) void load();
  else void openVerse();
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
    emit("close");
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
    await copyworkWrite(`/api/bible/copyworks/${selectedId.value}`, {
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
    await copyworkWrite(`/api/bible/copyworks/${selectedId.value}`, { method: "DELETE" });
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
    await copyworkWrite(`/api/bible/copyworks/${selectedId.value}/share`, {
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
  if (!work.value || work.value.id !== selectedId.value) return;
  folio.value?.stop();
  void loadPage();
});
watch(channelId, () => {
  shareRequestId = crypto.randomUUID();
});
watch(selectedId, (id) => {
    folio.value?.stop();
    sequence++;
    workSequence++;
    work.value = null;
    pages.value = [];
    glyphs.value = [];
    loading.value = false;
    page.value = 0;
    shareOpen.value = false;
    publicOpen.value = false;
    deleteOpen.value = false;
    sharedChannel.value = null;
    if (id) void load();
});
watch(
  () => [props.id, props.filter],
  () => {
    selectedId.value = props.id || "";
    if (!props.id && props.filter) void openVerse();
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  sequence++;
  workSequence++;
  choiceSequence++;
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
          <span v-else class="viewer-loading" role="status">{{ error || (!selectedId && !choiceBusy) ? "抄写册页" : "正在铺开册页…" }}</span>
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
            v-if="work || filter"
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
          v-if="toolsOpen"
          id="copywork-tools"
          class="viewer-popover viewer-tools"
          role="group"
          aria-label="作品操作"
        >
          <button v-if="work" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen; choicesOpen = false">作品详情</button>
          <dl v-if="work && detailsOpen" class="viewer-details">
            <dt>经文</dt><dd>{{ work.source.reference }}</dd>
            <dt>版本</dt><dd>{{ work.source.translationName }}</dd>
            <dt>抄写人</dt><dd>{{ work.author }}</dd>
            <dt>完成日期</dt><dd>{{ new Date(work.completedAt).toLocaleDateString() }}</dd>
            <dt>公开状态</dt><dd>{{ work.publishedAt ? "已公开 · 站内可见" : "私人保存" }}</dd>
          </dl>
          <template v-if="filter">
            <button :aria-expanded="choicesOpen" @click="choicesOpen = !choicesOpen; detailsOpen = false; choicesOpen && loadChoices(choiceScope)">选择其他抄写</button>
            <section v-if="choicesOpen" class="viewer-choices" aria-label="此节经文的其他抄写">
              <nav aria-label="抄写作品分类">
                <button :aria-pressed="choiceScope === 'public'" @click="loadChoices('public')">公开作品</button>
                <button :aria-pressed="choiceScope === 'mine'" @click="loadChoices('mine')">我的抄写</button>
              </nav>
              <p v-if="choiceError" role="alert">{{ choiceError }} <button @click="loadChoices(choiceScope)">重试</button></p>
              <button v-for="choice in choices" :key="choice.id" class="viewer-choice" :disabled="busy" :aria-pressed="choice.id === selectedId" @click="selectWork(choice.id)">
                <strong>{{ choice.source.reference }}</strong><span>{{ choice.author }} · {{ new Date(choice.completedAt).toLocaleDateString() }}</span>
              </button>
              <p v-if="choiceBusy" role="status">正在寻找册页…</p>
              <p v-else-if="!choices.length && !choiceError">这里还没有{{ choiceScope === 'public' ? '公开的' : '我的' }}抄写。</p>
              <button v-if="hasMoreChoices" :disabled="choiceBusy" @click="loadChoices(choiceScope, true)">更多作品</button>
            </section>
          </template>
          <button
            v-if="mine && work"
            :disabled="busy"
            @click="
              work.publishedAt ? publish() : (publicOpen = true);
              toolsOpen = false;
            "
          >
            {{ work.publishedAt ? "取消公开" : "公开到经文下" }}
          </button>
          <button
            v-if="mine"
            :disabled="busy"
            @click="
              openShare();
              toolsOpen = false;
            "
          >
            分享到聊天室
          </button>
          <button
            v-if="mine"
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
        <p v-if="error" role="alert">{{ error }} <button @click="retry">重试</button></p>
        <p v-else-if="!work && !selectedId && !choiceBusy" class="viewer-empty">此节经文暂无可查看的抄写。</p>
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
  max-height: calc(var(--app-height) - 110px);
  overflow: auto;
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
  position: relative;
  top: auto;
  right: auto;
  width: fit-content;
  max-width: 100%;
  margin: 0 0 12px auto;
  display: grid;
  gap: 4px;
}
.viewer-choices { width: min(300px, 100%); }
.viewer-choices nav { display: flex; gap: 6px; margin: 8px 0; }
.viewer-choice { display: grid; gap: 4px; width: 100%; text-align: left; margin: 6px 0; }
.viewer-choice span { font-size: 12px; color: #6c756e; }
.viewer-choice[aria-pressed="true"], .viewer-choices nav button[aria-pressed="true"] { border-color: #315b4e; }
.viewer-details { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 12px; margin: 8px 0; }
.viewer-details dt { color: #6c756e; }
.viewer-details dd { margin: 0; overflow-wrap: anywhere; }
.viewer-empty { font-size: 14px; color: #6c756e; }
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
