<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CopyworkDTO, CopyworkGlyph, CopyworkPlacement } from "@shared/bibleCopywork";
import AppModal from "../../../components/ui/AppModal.vue";
import { api } from "../../../api";
import { copyworkWrite } from "./copyworkApi";
import { useChatStore } from "../../../store";
import CopyworkPage from "./CopyworkPage.vue";
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; changed: []; chat: [] }>();
const store = useChatStore();
const work = ref<CopyworkDTO | null>(null);
const pages = ref<CopyworkPlacement[][]>([]);
const glyphs = ref<Array<CopyworkGlyph & { index: number }>>([]);
const page = ref(0);
const error = ref("");
const busy = ref(false);
const loading = ref(false);
const zoom = ref(false);
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
      title="抄写册页"
      size="medium"
      content-class="copywork-viewer"
      @close="emit('close')"
    >
      <div class="viewer-body">
        <p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
        <template v-if="work">
          <header class="viewer-heading">
            <h2>{{ work.source.reference }}</h2>
            <span>{{
              mine
                ? work.publishedAt
                  ? "已公开 · 站内可见"
                  : "已保存 · 仅自己及已分享聊天室可见"
                : work.author + "的抄写"
            }}</span>
          </header>
          <div class="folio-scroll">
            <div class="folio-size" :class="{ zoomed: zoom }">
              <CopyworkPage
                ref="folio"
                :glyphs="glyphs"
                :placements="pages[page] || []"
                :source="work.source"
                :author="work.author"
                :date="work.completedAt"
              />
            </div>
          </div>
          <p v-if="loading" role="status">正在铺开册页…</p>
          <nav class="viewer-actions" aria-label="册页操作">
            <button :disabled="page === 0 || loading" @click="page--">上一页</button
            ><span>{{ page + 1 }} / {{ pages.length }}</span
            ><button :disabled="page >= pages.length - 1 || loading" @click="page++">下一页</button
            ><button :disabled="loading" @click="folio?.play()">回放本页</button
            ><button @click="folio?.stop()">停止回放</button
            ><button :aria-pressed="zoom" @click="zoom = !zoom">
              {{ zoom ? "适合屏幕" : "放大" }}
            </button>
          </nav>
          <details>
            <summary>抄写来源</summary>
            <p>{{ work.source.text }}</p>
            <small>{{ work.source.copyright }} · 原文仅供对照，未识别或核对手写内容。</small>
          </details>
          <div v-if="mine" class="viewer-actions">
            <button :disabled="busy" @click="work.publishedAt ? publish() : (publicOpen = true)">
              {{ work.publishedAt ? "取消公开" : "公开到经文下" }}</button
            ><button :disabled="busy" @click="openShare">分享到聊天室</button
            ><button class="danger" :disabled="busy" @click="deleteOpen = true">删除作品</button>
          </div>
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
}
:deep(.copywork-viewer) {
  display: flex;
  flex-direction: column;
  background: #f5f0e7;
  color: #5c4e3b;
}
.viewer-body {
  padding: 20px;
  overflow: auto;
  min-height: 0;
}
.viewer-heading {
  text-align: center;
  margin-bottom: 22px;
}
.viewer-heading h2 {
  font:
    25px "Songti SC",
    serif;
  margin: 0 0 10px;
}
.viewer-heading span {
  font-size: 12px;
  color: #88765e;
}
.folio-scroll {
  overflow: auto;
}
.folio-size {
  max-width: 440px;
  margin: auto;
}
.folio-size.zoomed {
  width: 720px;
  max-width: none;
}
.viewer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 16px 0;
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
.danger {
  color: #9b4130;
}
.notice {
  padding: 16px;
  margin: 12px 0;
  background: #e9e1d1;
  border-radius: 9px;
}
.notice button {
  margin: 4px;
}
details {
  font-size: 13px;
  line-height: 1.8;
}
small {
  color: #82715d;
}
@media (max-width: 700px) {
  :deep(.copywork-viewer) {
    max-height: 100dvh;
    width: 100%;
    border-radius: 0;
  }
  .viewer-body {
    padding: 16px;
  }
}
</style>
