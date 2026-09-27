<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Minus, Search, X } from "lucide-vue-next";
import type { MessageSearchCursorDTO, MessageSearchPageDTO, MessageSearchResultDTO } from "@shared/types";
import AppModal from "../../components/ui/AppModal.vue";
import { api } from "../../api";
import { plainTextFromHtml } from "../messages/messageRendering";
import {
  highlightMessageSearchText,
  messageSearchPageUrl,
  messageSearchSnippet,
  normalizeMessageSearchQuery
} from "./messageSearch";

const emit = defineEmits<{
  close: [];
  jump: [result: MessageSearchResultDTO];
}>();

const query = ref("");
const searchedQuery = ref("");
const results = ref<MessageSearchResultDTO[]>([]);
const nextCursor = ref<MessageSearchCursorDTO | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const minimized = ref(false);
const queryInput = ref<HTMLInputElement | null>(null);
let requestVersion = 0;
let activeController: AbortController | null = null;

const visibleResults = computed(() => results.value.map((result) => {
  const text = plainTextFromHtml(result.content);
  const snippet = messageSearchSnippet(text, searchedQuery.value);
  return {
    result,
    snippet,
    segments: highlightMessageSearchText(snippet.text, searchedQuery.value)
  };
}));

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function loadPage(cursor: MessageSearchCursorDTO | null, append: boolean) {
  const term = searchedQuery.value;
  const version = ++requestVersion;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  if (append) loadingMore.value = true;
  else loading.value = true;
  error.value = "";
  try {
    const response = await api<MessageSearchPageDTO>(
      messageSearchPageUrl(term, cursor),
      { signal: controller.signal }
    );
    if (version !== requestVersion) return;
    results.value = append ? [...results.value, ...response.results] : response.results;
    nextCursor.value = response.nextCursor;
  } catch (cause) {
    if (controller.signal.aborted || version !== requestVersion) return;
    error.value = cause instanceof Error ? cause.message : "搜索失败，请稍后重试";
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      loadingMore.value = false;
      activeController = null;
    }
  }
}

async function search() {
  const term = normalizeMessageSearchQuery(query.value);
  query.value = term;
  searchedQuery.value = term;
  results.value = [];
  nextCursor.value = null;
  if (!term) {
    activeController?.abort();
    requestVersion += 1;
    loading.value = false;
    loadingMore.value = false;
    error.value = "";
    return;
  }
  await loadPage(null, false);
}

function loadMore() {
  if (!nextCursor.value || loadingMore.value) return;
  void loadPage(nextCursor.value, true);
}

function jumpToResult(result: MessageSearchResultDTO) {
  minimized.value = true;
  emit("jump", result);
}

onMounted(() => {
  void nextTick(() => queryInput.value?.focus());
});
onBeforeUnmount(() => {
  requestVersion += 1;
  activeController?.abort();
});
</script>

<template>
  <AppModal
    v-if="!minimized"
    :open="true"
    size="medium"
    aria-label="查找聊天记录"
    content-class="message-search-modal"
    @close="emit('close')"
  >
    <template #header>
      <strong>查找聊天记录</strong>
      <div class="message-search-head-actions">
        <button class="icon-btn" type="button" aria-label="最小化搜索窗口" @click="minimized = true"><Minus :size="19" /></button>
        <button class="icon-btn" type="button" aria-label="关闭搜索窗口" @click="emit('close')"><X :size="19" /></button>
      </div>
    </template>
    <form class="message-search-form" role="search" @submit.prevent="search">
      <input
        ref="queryInput"
        v-model="query"
        type="search"
        maxlength="100"
        placeholder="输入要查找的信息"
        aria-label="搜索聊天记录"
      />
      <button type="submit" :disabled="loading"><Search :size="17" />搜索</button>
    </form>
    <div class="message-search-body" aria-live="polite">
      <p v-if="error" class="message-search-state error" role="alert">{{ error }}</p>
      <p v-if="loading && !results.length" class="message-search-state">正在搜索聊天记录…</p>
      <p v-else-if="!searchedQuery" class="message-search-state">搜索所有你可以访问的聊天记录</p>
      <p v-else-if="!results.length && !error && !loading" class="message-search-state">没有找到相关聊天记录</p>
      <template v-else-if="results.length">
        <p class="message-search-count">“{{ searchedQuery }}” · {{ results.length }} 条{{ nextCursor ? "以上" : "结果" }}</p>
        <button
          v-for="item in visibleResults"
          :key="item.result.id"
          class="message-search-result"
          type="button"
          :aria-label="`${item.result.channelName}，${item.result.senderName}，${formatTime(item.result.createdAt)}，跳转到消息`"
          @click="jumpToResult(item.result)"
        >
          <span class="message-search-result-meta">
            <strong>{{ item.result.channelName }}</strong>
            <span>{{ item.result.senderName }} · {{ formatTime(item.result.createdAt) }}</span>
          </span>
          <span class="message-search-result-text">
            <span v-if="item.snippet.startsEarlier" aria-hidden="true">…</span><template v-for="(segment, index) in item.segments" :key="index"><mark v-if="segment.match">{{ segment.text }}</mark><span v-else>{{ segment.text }}</span></template><span v-if="item.snippet.endsLater" aria-hidden="true">…</span>
          </span>
        </button>
        <button v-if="nextCursor" class="message-search-more" type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? "正在加载…" : "加载更多" }}
        </button>
      </template>
    </div>
  </AppModal>
  <div v-else class="message-search-floating" role="group" aria-label="已最小化的聊天记录搜索">
    <button class="message-search-restore" type="button" aria-label="恢复聊天记录搜索" @click="minimized = false">
      <Search :size="17" /><span>聊天搜索</span><span v-if="results.length" class="message-search-floating-count">{{ results.length }}</span>
    </button>
    <button class="message-search-floating-close" type="button" aria-label="关闭搜索窗口" @click="emit('close')"><X :size="14" /></button>
  </div>
</template>

<style scoped>
.message-search-modal {
  width: min(640px, 100%);
}

.message-search-head-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}

.message-search-form {
  display: flex;
  gap: 8px;
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--line);
}

.message-search-form input {
  min-width: 0;
  flex: 1;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  background: var(--surface, #fff);
  font: inherit;
}

.message-search-form button,
.message-search-more {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--button-text, #fff);
  background: var(--accent);
  font: inherit;
  font-weight: 700;
}

.message-search-form button:disabled,
.message-search-more:disabled {
  opacity: 0.6;
}

.message-search-body {
  min-height: 160px;
  max-height: min(56vh, 520px);
  padding: 8px 18px 18px;
  overflow: auto;
  overscroll-behavior: contain;
}

.message-search-state,
.message-search-count {
  margin: 18px 0;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
}

.message-search-state.error {
  color: var(--danger, #b42318);
}

.message-search-result {
  width: 100%;
  padding: 12px 10px;
  border: 0;
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 8px;
  color: var(--text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.message-search-result:hover,
.message-search-result:focus-visible {
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: -2px;
}

.message-search-result-meta {
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.message-search-result-meta strong,
.message-search-result-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-search-result-meta span {
  color: var(--muted);
  font-size: 12px;
}

.message-search-result-text {
  overflow-wrap: anywhere;
  line-height: 1.55;
}

.message-search-result-text mark {
  border-radius: 3px;
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 25%, #ffe680);
  font-weight: 800;
}

.message-search-more {
  width: 100%;
  margin-top: 12px;
}

.message-search-floating {
  position: fixed;
  z-index: 120;
  top: calc(var(--safe-top, 0px) + 12px);
  right: max(16px, env(safe-area-inset-right));
  min-height: 42px;
  padding: 0 30px 0 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--line));
  border-radius: 12px;
  display: flex;
  align-items: center;
  color: var(--text);
  background: var(--surface, #fff);
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.2);
}

.message-search-restore,
.message-search-floating-close {
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.message-search-restore {
  min-height: 40px;
  gap: 7px;
  font: inherit;
  font-weight: 700;
}

.message-search-floating-count {
  min-width: 20px;
  padding: 2px 5px;
  border-radius: 99px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 11%, transparent);
  font-size: 11px;
  text-align: center;
}

.message-search-floating-close {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: var(--muted);
}

.message-search-floating-close:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 10%, transparent);
}

@media (max-width: 600px) {
  .message-search-form {
    padding-inline: 12px;
  }

  .message-search-body {
    max-height: min(52vh, 420px);
    padding-inline: 12px;
  }

  .message-search-result-meta {
    display: grid;
    gap: 3px;
  }
}
</style>
