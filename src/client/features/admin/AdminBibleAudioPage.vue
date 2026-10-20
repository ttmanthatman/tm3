<script setup lang="ts">
// 管理后台 · 有声圣经：上传卷包 zip（可多选、逐个上传、重复卷替换）、查看版本覆盖进度、
// 选择默认版本并启用朗读（默认版本 66 卷齐才允许开启）、删除版本。
import { computed, onMounted, ref } from "vue";
import { CheckCircle2, CircleAlert, Headphones, LoaderCircle, Trash2, Upload } from "lucide-vue-next";
import type { BibleAudioAdminVersion } from "@shared/bibleAudio";
import { BIBLE_BOOK_CODES, BIBLE_BOOK_COUNT, BIBLE_CHAPTER_COUNT, isBibleBookCode } from "@shared/bibleBooks";
import { api, getToken } from "../../api";
import { loadBibleAudioManifest } from "../bible/bibleAudioManifest";

type BibleAudioSettings = { enabled: boolean; defaultVersion: string | null };

type UploadJob = {
  id: number;
  file: File;
  bookCode: string | null;
  versionId: string | null;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  message: string;
};

const emit = defineEmits<{ (e: "message", message: string): void }>();

const versions = ref<BibleAudioAdminVersion[]>([]);
const settings = ref<BibleAudioSettings>({ enabled: false, defaultVersion: null });
const loading = ref(true);
const error = ref("");
const settingsBusy = ref(false);
const settingsError = ref("");
const deletingVersion = ref("");
const uploads = ref<UploadJob[]>([]);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
let jobSequence = 0;

const defaultVersion = computed(() => versions.value.find((version) => version.versionId === settings.value.defaultVersion) || null);
const canEnable = computed(() => !!defaultVersion.value?.completed);
const uploadedBooks = computed(() => new Set(versions.value.flatMap((version) => version.books.map((book) => `${version.versionId}:${book}`))));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await api<{ success: boolean; versions: BibleAudioAdminVersion[]; settings: BibleAudioSettings }>("/api/admin/bible-audio/versions");
    versions.value = result.versions;
    settings.value = result.settings;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "有声圣经信息加载失败";
  } finally {
    loading.value = false;
  }
}

function parseBundleName(name: string) {
  const match = /^bible-audio-([a-z0-9-]{3,40})-([A-Z0-9]{3})\.zip$/i.exec(name.trim());
  if (!match) return { versionId: null, bookCode: null };
  const bookCode = match[2].toUpperCase();
  return { versionId: match[1].toLowerCase(), bookCode: isBibleBookCode(bookCode) ? bookCode : null };
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function pickFiles() {
  fileInput.value?.click();
}

function onFilesChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  for (const file of files) {
    const { versionId, bookCode } = parseBundleName(file.name);
    uploads.value.push({
      id: ++jobSequence,
      file,
      bookCode,
      versionId,
      status: "pending",
      progress: 0,
      message: !file.name.toLowerCase().endsWith(".zip")
        ? "不是 zip 卷包"
        : versionId && bookCode && uploadedBooks.value.has(`${versionId}:${bookCode}`)
          ? "已存在，将替换"
          : ""
    });
  }
  void runUploads();
}

function uploadBundle(job: UploadJob) {
  return new Promise<{ success: boolean; version: BibleAudioAdminVersion; book: { code: string; nameZh: string; chapterCount: number; replaced: boolean } }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/bible-audio/bundles");
    request.setRequestHeader("Authorization", `Bearer ${getToken()}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) job.progress = Math.round((event.loaded / event.total) * 100);
    };
    request.onerror = () => reject(new Error("网络错误，上传中断"));
    request.onload = () => {
      let payload: { success?: boolean; message?: string } = {};
      try {
        payload = JSON.parse(request.responseText || "{}");
      } catch {
        payload = {};
      }
      if (request.status >= 200 && request.status < 300 && payload.success) resolve(payload as never);
      else reject(new Error(payload.message || `HTTP ${request.status}`));
    };
    const form = new FormData();
    form.append("file", job.file);
    request.send(form);
  });
}

async function runUploads() {
  if (uploading.value) return;
  uploading.value = true;
  try {
    for (;;) {
      const job = uploads.value.find((item) => item.status === "pending");
      if (!job) break;
      if (!job.file.name.toLowerCase().endsWith(".zip")) {
        job.status = "error";
        job.message = "只支持 .zip 卷包";
        continue;
      }
      job.status = "uploading";
      job.message = "";
      try {
        const result = await uploadBundle(job);
        job.status = "done";
        job.progress = 100;
        job.message = `${result.book.nameZh} ${result.book.chapterCount} 章${result.book.replaced ? "（已替换）" : ""}`;
        const index = versions.value.findIndex((version) => version.versionId === result.version.versionId);
        if (index >= 0) versions.value.splice(index, 1, result.version);
        else versions.value.push(result.version);
      } catch (cause) {
        job.status = "error";
        job.message = cause instanceof Error ? cause.message : "上传失败";
      }
    }
  } finally {
    uploading.value = false;
    void loadBibleAudioManifest(true);
  }
}

function clearFinishedUploads() {
  uploads.value = uploads.value.filter((job) => job.status === "pending" || job.status === "uploading");
}

async function saveSettings(patch: Partial<BibleAudioSettings>) {
  if (settingsBusy.value) return;
  settingsBusy.value = true;
  settingsError.value = "";
  try {
    const result = await api<{ success: boolean; settings: BibleAudioSettings }>("/api/admin/bible-audio/settings", {
      method: "POST",
      body: JSON.stringify(patch)
    });
    settings.value = result.settings;
    emit("message", result.settings.enabled ? "有声圣经已对用户开放" : "已保存有声圣经设置");
    void loadBibleAudioManifest(true);
  } catch (cause) {
    settingsError.value = cause instanceof Error ? cause.message : "设置保存失败";
  } finally {
    settingsBusy.value = false;
  }
}

function onDefaultVersionChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  void saveSettings({ defaultVersion: value || null, ...(value ? {} : { enabled: false }) });
}

function toggleEnabled() {
  void saveSettings({ enabled: !settings.value.enabled });
}

async function removeVersion(version: BibleAudioAdminVersion) {
  if (deletingVersion.value) return;
  if (!window.confirm(`删除「${version.name}」（${version.versionId}）及其 ${version.chapterCount} 章音频？此操作不可恢复。`)) return;
  deletingVersion.value = version.versionId;
  try {
    const result = await api<{ success: boolean; settings: BibleAudioSettings; disabled: boolean }>(`/api/admin/bible-audio/versions/${encodeURIComponent(version.versionId)}`, { method: "DELETE" });
    versions.value = versions.value.filter((item) => item.versionId !== version.versionId);
    settings.value = result.settings;
    emit("message", result.disabled ? "已删除该版本，有声圣经已随之关闭" : "已删除该版本");
    void loadBibleAudioManifest(true);
  } catch (cause) {
    emit("message", cause instanceof Error ? cause.message : "删除失败");
  } finally {
    deletingVersion.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div class="admin-bible-audio">
    <section class="admin-bible-audio-card">
      <header><Headphones :size="18" /><strong>启用有声圣经</strong></header>
      <label class="admin-bible-audio-field">
        <span>默认版本</span>
        <select :value="settings.defaultVersion || ''" :disabled="settingsBusy || !versions.length" @change="onDefaultVersionChange">
          <option value="">未选择</option>
          <option v-for="version in versions" :key="version.versionId" :value="version.versionId">{{ version.name }}（{{ version.versionId }}，{{ version.bookCount }}/{{ BIBLE_BOOK_COUNT }} 卷）</option>
        </select>
      </label>
      <div class="admin-bible-audio-toggle">
        <button class="primary-btn" type="button" :disabled="settingsBusy || (!settings.enabled && !canEnable)" @click="toggleEnabled">
          <LoaderCircle v-if="settingsBusy" :size="16" class="admin-bible-audio-spin" />
          {{ settings.enabled ? "关闭有声圣经" : "启用有声圣经" }}
        </button>
        <small v-if="settings.enabled" class="ok"><CheckCircle2 :size="14" /> 已对用户开放：圣经工作区顶栏显示播放控件，经文分享可长按播放。</small>
        <small v-else-if="!defaultVersion">请先上传卷包并选择默认版本。</small>
        <small v-else-if="!canEnable" class="warn"><CircleAlert :size="14" /> 资源未上传完整（{{ defaultVersion.bookCount }}/{{ BIBLE_BOOK_COUNT }} 卷、{{ defaultVersion.chapterCount }}/{{ BIBLE_CHAPTER_COUNT }} 章），无法开启。</small>
        <small v-else>默认版本已完整，可以开启。</small>
      </div>
      <p v-if="settingsError" class="admin-bible-audio-error" role="alert">{{ settingsError }}</p>
    </section>

    <section class="admin-bible-audio-card">
      <header><Upload :size="18" /><strong>上传卷包</strong></header>
      <input ref="fileInput" type="file" accept=".zip,application/zip" multiple hidden @change="onFilesChange" />
      <div class="admin-bible-audio-upload-row">
        <button class="primary-btn" type="button" :disabled="uploading" @click="pickFiles">
          <LoaderCircle v-if="uploading" :size="16" class="admin-bible-audio-spin" />
          <Upload v-else :size="16" />
          {{ uploading ? "正在上传…" : "选择卷包 zip（可多选）" }}
        </button>
        <button v-if="uploads.some((job) => job.status === 'done' || job.status === 'error')" class="mini-btn secondary" type="button" @click="clearFinishedUploads">清除已完成</button>
      </div>
      <ol class="admin-bible-audio-guide">
        <li>选择打包目录下全部 66 个 <code>bible-audio-&lt;版本&gt;-&lt;书卷&gt;.zip</code>，顺序无关，可分批、可中断后重传；重复的卷会被替换。</li>
        <li>全部卷显示「已上传」且版本为「完整（66/66）」后，选择默认版本并打开「启用有声圣经」。</li>
        <li>用户侧圣经工作区顶栏出现播放控件即成功。服务端逐包校验 md5 与结构，失败的卷会列出原因。</li>
      </ol>
      <ul v-if="uploads.length" class="admin-bible-audio-jobs">
        <li v-for="job in uploads" :key="job.id" class="admin-bible-audio-job" :class="job.status">
          <span class="admin-bible-audio-job-name">
            <strong>{{ job.bookCode || job.file.name }}</strong>
            <small>{{ job.file.name }} · {{ formatBytes(job.file.size) }}</small>
          </span>
          <span class="admin-bible-audio-job-state">
            <LoaderCircle v-if="job.status === 'uploading'" :size="14" class="admin-bible-audio-spin" />
            <CheckCircle2 v-else-if="job.status === 'done'" :size="14" />
            <CircleAlert v-else-if="job.status === 'error'" :size="14" />
            <template v-if="job.status === 'uploading'">{{ job.progress }}%</template>
            <template v-else-if="job.status === 'done'">已上传</template>
            <template v-else-if="job.status === 'error'">失败</template>
            <template v-else>等待</template>
            <small v-if="job.message">{{ job.message }}</small>
          </span>
          <span v-if="job.status === 'uploading'" class="admin-bible-audio-job-bar" aria-hidden="true"><span :style="{ width: `${job.progress}%` }"></span></span>
        </li>
      </ul>
    </section>

    <div v-if="loading" class="admin-page-state" role="status"><LoaderCircle :size="20" class="admin-bible-audio-spin" /> 正在加载…</div>
    <div v-else-if="error" class="admin-page-state error" role="alert">
      <p>{{ error }}</p>
      <button class="mini-btn" type="button" @click="load">重试</button>
    </div>
    <div v-else-if="!versions.length" class="admin-page-state">还没有上传过有声圣经卷包</div>
    <section v-for="version in versions" v-else :key="version.versionId" class="admin-bible-audio-card">
      <header>
        <strong>{{ version.name }}</strong>
        <span class="admin-bible-audio-badge" :class="{ complete: version.completed }">{{ version.completed ? `完整（${version.bookCount}/${BIBLE_BOOK_COUNT}）` : `${version.bookCount}/${BIBLE_BOOK_COUNT} 卷` }}</span>
        <button class="mini-btn danger-action" type="button" :disabled="deletingVersion === version.versionId" :aria-label="`删除 ${version.name}`" @click="removeVersion(version)"><Trash2 :size="15" /></button>
      </header>
      <dl class="admin-bible-audio-facts">
        <div><dt>版本 ID</dt><dd>{{ version.versionId }}</dd></div>
        <div><dt>译本</dt><dd>{{ version.translation }}</dd></div>
        <div><dt>章节</dt><dd>{{ version.chapterCount }}/{{ BIBLE_CHAPTER_COUNT }}</dd></div>
        <div><dt>体积</dt><dd>{{ formatBytes(version.totalBytes) }}</dd></div>
        <div v-if="version.style || version.dialect"><dt>风格</dt><dd>{{ [version.style, version.dialect].filter(Boolean).join(" · ") }}</dd></div>
      </dl>
      <div class="admin-bible-audio-books" :aria-label="`${version.name} 已上传书卷`">
        <span v-for="code in BIBLE_BOOK_CODES" :key="code" class="admin-bible-audio-book" :class="{ uploaded: version.books.includes(code) }">{{ code }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.admin-bible-audio { display: flex; flex-direction: column; gap: 12px; }
.admin-bible-audio-card { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 1px solid rgba(0, 0, 0, .08); border-radius: 12px; background: #fff; }
.admin-bible-audio-card > header { display: flex; align-items: center; gap: 8px; }
.admin-bible-audio-card > header strong { flex: 1; min-width: 0; font-size: 14px; }
.admin-bible-audio-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.admin-bible-audio-field select { max-width: 100%; }
.admin-bible-audio-toggle { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.admin-bible-audio-toggle small { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #8a8a8e; }
.admin-bible-audio-toggle small.ok { color: #2f7d4f; }
.admin-bible-audio-toggle small.warn { color: #b25d0f; }
.admin-bible-audio-error { margin: 0; color: #a33; font-size: 13px; }
.admin-bible-audio-upload-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.admin-bible-audio-guide { margin: 0; padding-left: 18px; font-size: 12px; color: #6f6a62; line-height: 1.6; }
.admin-bible-audio-guide code { font-size: 11px; }
.admin-bible-audio-jobs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.admin-bible-audio-job { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 10px 10px; border: 1px solid rgba(0, 0, 0, .06); border-radius: 8px; background: #faf8f4; overflow: hidden; }
.admin-bible-audio-job.done { background: #f1f8f3; }
.admin-bible-audio-job.error { background: #fbf1ee; }
.admin-bible-audio-job-name { display: flex; flex-direction: column; min-width: 0; }
.admin-bible-audio-job-name strong { font-size: 13px; }
.admin-bible-audio-job-name small, .admin-bible-audio-job-state small { color: #8a8a8e; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-bible-audio-job-state { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 12px; font-weight: 700; text-align: right; }
.admin-bible-audio-job.error .admin-bible-audio-job-state { color: #a33; }
.admin-bible-audio-job.done .admin-bible-audio-job-state { color: #2f7d4f; }
.admin-bible-audio-job-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(194, 115, 58, .15); }
.admin-bible-audio-job-bar span { display: block; height: 100%; background: #c2733a; transition: width 200ms linear; }
.admin-bible-audio-badge { flex: none; padding: 2px 8px; border-radius: 999px; background: #f1e8d8; color: #8a6b3f; font-size: 11px; font-weight: 700; }
.admin-bible-audio-badge.complete { background: #e3f3e8; color: #2f7d4f; }
.admin-bible-audio-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px 12px; margin: 0; font-size: 12px; }
.admin-bible-audio-facts dt { color: #8a8a8e; }
.admin-bible-audio-facts dd { margin: 0; font-weight: 600; word-break: break-all; }
.admin-bible-audio-books { display: flex; flex-wrap: wrap; gap: 4px; }
.admin-bible-audio-book { min-width: 34px; padding: 2px 4px; border-radius: 5px; background: #f1ede6; color: #b0a89c; font-size: 10px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
.admin-bible-audio-book.uploaded { background: #e3f3e8; color: #2f7d4f; }
.admin-bible-audio-spin { animation: admin-bible-audio-rotate 1s linear infinite; }
@keyframes admin-bible-audio-rotate { to { transform: rotate(360deg); } }
</style>
