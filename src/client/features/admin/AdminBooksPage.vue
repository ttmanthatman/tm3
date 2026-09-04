<script setup lang="ts">
// 管理后台 · 图书：上传 EPUB（服务端提取标题/作者/封面）、查看全部图书、删除。
import { onMounted, ref } from "vue";
import { BookUp2, LoaderCircle, Trash2 } from "lucide-vue-next";
import type { BookDTO } from "@shared/types";
import { api, getToken } from "../../api";

const emit = defineEmits<{ (e: "message", message: string): void }>();

const books = ref<BookDTO[]>([]);
const loading = ref(true);
const error = ref("");
const uploading = ref(false);
const uploadError = ref("");
const deletingId = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);

async function loadBooks() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api<{ success: boolean; books: BookDTO[] }>("/api/books");
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
    const res = await api<{ success: boolean; book: BookDTO }>("/api/admin/books", {
      method: "POST",
      body: form
    });
    books.value = [res.book, ...books.value];
    emit("message", `已上传《${res.book.title}》`);
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}

async function removeBook(book: BookDTO) {
  if (deletingId.value) return;
  deletingId.value = book.id;
  try {
    await api(`/api/admin/books/${book.id}`, { method: "DELETE" });
    books.value = books.value.filter((b) => b.id !== book.id);
    emit("message", `已删除《${book.title}》`);
  } catch (err) {
    emit("message", err instanceof Error ? err.message : "删除失败");
  } finally {
    deletingId.value = 0;
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

    <div v-if="loading" class="admin-page-state" role="status"><LoaderCircle :size="20" class="admin-books-spin" /> 正在加载…</div>
    <div v-else-if="error" class="admin-page-state error" role="alert">
      <p>{{ error }}</p>
      <button class="mini-btn" type="button" @click="loadBooks">重试</button>
    </div>
    <div v-else-if="!books.length" class="admin-page-state">还没有上传过图书</div>

    <ul v-else class="admin-books-list">
      <li v-for="book in books" :key="book.id" class="admin-books-row">
        <span class="admin-books-cover">
          <img v-if="book.coverName" :src="`/api/books/${book.id}/cover?token=${encodeURIComponent(getToken())}`" alt="" loading="lazy" />
          <span v-else class="admin-books-cover-fallback">{{ book.title.slice(0, 2) }}</span>
        </span>
        <span class="admin-books-meta">
          <strong>{{ book.title }}</strong>
          <small>{{ book.author || "佚名" }} · {{ formatSize(book.fileSize) }} · #{{ book.id }}</small>
        </span>
        <button
          class="mini-btn danger-action"
          type="button"
          :disabled="deletingId === book.id"
          :aria-label="`删除《${book.title}》`"
          @click="removeBook(book)"
        >
          <Trash2 :size="15" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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
