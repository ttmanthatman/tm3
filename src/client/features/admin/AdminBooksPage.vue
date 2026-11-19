<script setup lang="ts">
// 管理后台 · 图书：上传、上下架和回收站。
import { computed, onMounted, ref } from "vue";
import { BookUp2, LoaderCircle, Trash2 } from "lucide-vue-next";
import type { AdminBookDTO } from "@shared/types";
import AppModal from "../../components/ui/AppModal.vue";
import { api, getToken } from "../../api";

const emit = defineEmits<{ (e: "message", message: string): void }>();

const books = ref<AdminBookDTO[]>([]);
const loading = ref(true);
const error = ref("");
const uploading = ref(false);
const uploadError = ref("");
const actionBusy = ref(false);
const deleteTarget = ref<AdminBookDTO | null>(null);
const view = ref<"published" | "unpublished" | "trash">("published");
const tabs = [
  { id: "published", label: "已上架" },
  { id: "unpublished", label: "已下架" },
  { id: "trash", label: "回收站" }
] as const;
const visibleBooks = computed(() => books.value.filter(book => view.value === "trash"
  ? !!book.deletedAt : !book.deletedAt && book.isPublished === (view.value === "published")));
const fileInput = ref<HTMLInputElement | null>(null);

async function loadBooks() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ success: boolean; books: AdminBookDTO[] }>("/api/admin/books");
    books.value = res.books;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "图书列表加载失败";
  } finally {
    loading.value = false;
  }
}

function pickFile() {
  fileInput.value?.click();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".epub")) {
    uploadError.value = "只支持 .epub 文件";
    return;
  }
  uploading.value = true;
  uploadError.value = "";
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await api<{ success: boolean; book: AdminBookDTO }>("/api/admin/books", {
      method: "POST",
      body: form
    });
    books.value = [{ ...res.book, isPublished: true, deletedAt: null }, ...books.value];
    view.value = "published";
    emit("message", `已上传《${res.book.title}》`);
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}

async function removeBook() {
  const book = deleteTarget.value;
  if (!book || actionBusy.value) return;
  actionBusy.value = true;
  try {
    await api(`/api/admin/books/${book.id}`, { method: "DELETE" });
    book.deletedAt = new Date().toISOString();
    book.isPublished = false;
    deleteTarget.value = null;
    emit("message", `《${book.title}》已移入回收站，可随时恢复`);
  } catch (err) {
    emit("message", err instanceof Error ? err.message : "移入回收站失败");
  } finally {
    actionBusy.value = false;
  }
}

async function changeStatus(book: AdminBookDTO, action: "publish" | "unpublish" | "restore") {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    await api(`/api/admin/books/${book.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
    book.isPublished = action === "publish";
    book.deletedAt = null;
    emit("message", action === "restore" ? `《${book.title}》已恢复到已下架，可重新上架` : `《${book.title}》已${action === "publish" ? "上架" : "下架"}，所有数据均保留`);
  } catch (err) {
    emit("message", err instanceof Error ? err.message : "操作失败");
  } finally {
    actionBusy.value = false;
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

onMounted(loadBooks);
</script>

<template>
  <div class="admin-books">
    <div class="admin-books-toolbar">
      <input
        ref="fileInput"
        type="file"
        accept=".epub,application/epub+zip"
        hidden
        @change="onFileChange"
      />
      <button class="primary-btn" type="button" :disabled="uploading" @click="pickFile">
        <LoaderCircle v-if="uploading" :size="16" class="admin-books-spin" />
        <BookUp2 v-else :size="16" />
        {{ uploading ? "正在上传…" : "上传 EPUB 图书" }}
      </button>
      <p class="admin-books-hint">单本不超过 60MB；服务端自动提取标题、作者与封面；带 DRM 加密的书会被拒绝。</p>
    </div>
    <p v-if="uploadError" class="admin-books-error" role="alert">{{ uploadError }}</p>

    <nav class="admin-books-tabs" aria-label="图书状态">
      <button v-for="tab in tabs" :key="tab.id" type="button" class="mini-btn" :aria-pressed="view === tab.id" @click="view = tab.id">{{ tab.label }}</button>
    </nav>
    <p class="admin-books-hint">下架和移入回收站均保留图书文件、阅读进度与笔记；回收站不会自动清空，恢复后可重新上架。</p>
    <div v-if="loading" class="admin-page-state" role="status"><LoaderCircle :size="20" class="admin-books-spin" /> 正在加载…</div>
    <div v-else-if="error" class="admin-page-state error" role="alert">
      <p>{{ error }}</p>
      <button class="mini-btn" type="button" @click="loadBooks">重试</button>
    </div>
    <div v-else-if="!visibleBooks.length" class="admin-page-state">{{ view === "trash" ? "回收站为空" : view === "unpublished" ? "没有已下架的图书" : "没有已上架的图书" }}</div>

    <ul v-else class="admin-books-list">
      <li v-for="book in visibleBooks" :key="book.id" class="admin-books-row">
        <span class="admin-books-cover">
          <img v-if="book.coverName" :src="`/api/books/${book.id}/cover?token=${encodeURIComponent(getToken())}`" alt="" loading="lazy" />
          <span v-else class="admin-books-cover-fallback">{{ book.title.slice(0, 2) }}</span>
        </span>
        <span class="admin-books-meta">
          <strong>{{ book.title }}</strong>
          <small>{{ book.author || "佚名" }} · {{ formatSize(book.fileSize) }} · #{{ book.id }}</small>
        </span>
        <span class="admin-books-actions">
          <button v-if="book.deletedAt" class="mini-btn" type="button" :disabled="actionBusy" :aria-label="`恢复《${book.title}》`" @click="changeStatus(book, 'restore')">恢复</button>
          <template v-else>
            <button class="mini-btn" type="button" :disabled="actionBusy" :aria-label="`${book.isPublished ? '下架' : '上架'}《${book.title}》`" @click="changeStatus(book, book.isPublished ? 'unpublish' : 'publish')">{{ book.isPublished ? "下架" : "上架" }}</button>
            <button class="mini-btn danger-action" type="button" :disabled="actionBusy" :aria-label="`删除《${book.title}》`" @click="deleteTarget = book"><Trash2 :size="15" />删除</button>
          </template>
        </span>
      </li>
    </ul>
    <AppModal :open="!!deleteTarget" title="移入回收站" :busy="actionBusy" @close="deleteTarget = null">
      <p class="admin-books-confirm">确定将《{{ deleteTarget?.title }}》移入回收站？图书将从书架隐藏，文件、阅读进度和笔记均会保留，可在回收站恢复。</p>
      <div class="admin-books-actions admin-books-confirm">
        <button class="mini-btn" type="button" :disabled="actionBusy" @click="deleteTarget = null">取消</button>
        <button class="mini-btn danger-action" type="button" :disabled="actionBusy" @click="removeBook">{{ actionBusy ? "正在移入…" : "确认移入回收站" }}</button>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.admin-books-tabs, .admin-books-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.admin-books-tabs [aria-pressed="true"] { background: #e9eee8; color: #325338; }
.admin-books-actions { flex-shrink: 0; }
.admin-books-confirm { margin: 12px 16px; overflow-wrap: anywhere; }
@media (max-width: 480px) { .admin-books-row { flex-wrap: wrap; } .admin-books-row > .admin-books-actions { width: 100%; justify-content: flex-end; } }
.admin-books { display: flex; flex-direction: column; gap: 12px; }
.admin-books-toolbar { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.admin-books-hint { margin: 0; font-size: 12px; color: #8a8a8e; }
.admin-books-error { margin: 0; color: #a33; font-size: 13px; }
.admin-books-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.admin-books-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, .08);
  border-radius: 10px;
  background: #fff;
}
.admin-books-cover {
  flex: 0 0 auto;
  width: 40px;
  height: 58px;
  border-radius: 5px;
  overflow: hidden;
  background: #e4ddd0;
  display: grid;
  place-items: center;
}
.admin-books-cover img { width: 100%; height: 100%; object-fit: cover; }
.admin-books-cover-fallback { font-size: 12px; color: #8a765c; }
.admin-books-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.admin-books-meta strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-books-meta small { color: #8a8a8e; font-size: 12px; }
.admin-books-spin { animation: admin-books-rotate 1s linear infinite; }
@keyframes admin-books-rotate { to { transform: rotate(360deg); } }
</style>
