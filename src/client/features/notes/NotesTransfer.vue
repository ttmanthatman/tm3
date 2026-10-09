<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Download, Upload } from "lucide-vue-next";
import AppModal from "../../components/ui/AppModal.vue";
import { getToken } from "../../api";
import { exportNotesBackup, importNotesBackup, NOTES_BACKUP_MAX_BYTES, parseNotesBackup, serializeNotesBackup, type ImportResult, type NotesBackup, type NotesDomain } from "./notesBackup";
import { notesTransferClient } from "./notesTransferClient";

const props = defineProps<{ domain: NotesDomain; accountId: number }>();
const emit = defineEmits<{ imported: [] }>();
const fileInput = ref<HTMLInputElement | null>(null);
const transferBusy = ref(false);
const transferOpen = ref(false);
const backup = ref<NotesBackup | null>(null);
const fileName = ref("");
const error = ref("");
const result = ref<ImportResult | null>(null);
const label = computed(() => props.domain === "bible" ? "圣经笔记" : "电子书笔记");
let sequence = 0;
let mounted = true;
const downloads = new Map<string, ReturnType<typeof setTimeout>>();

function releaseDownloads() {
  for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
  downloads.clear();
}

function reset() {
  sequence++;
  transferBusy.value = false;
  transferOpen.value = false;
  backup.value = null;
  result.value = null;
  error.value = "";
}
watch(() => [props.accountId, props.domain], reset);
onBeforeUnmount(() => { mounted = false; sequence++; releaseDownloads(); });
function begin() {
  const request = ++sequence;
  const accountId = props.accountId;
  const domain = props.domain;
  const token = getToken();
  const assertActive = () => {
    if (!mounted || request !== sequence || props.accountId !== accountId || props.domain !== domain || !token || getToken() !== token) throw new Error("账号已切换，请重新操作");
  };
  transferBusy.value = true;
  error.value = "";
  return { request, accountId, domain, assertActive };
}
async function download() {
  const operation = begin();
  try {
    const exported = await exportNotesBackup(operation.domain, operation.accountId, notesTransferClient, operation);
    operation.assertActive();
    const url = URL.createObjectURL(new Blob([serializeNotesBackup(exported)], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${operation.domain === "bible" ? "bible" : "ebook"}-notes-${exported.exportedAt.slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // WebKit needs the object URL to survive the download click's navigation task.
    downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60_000));
  } catch (cause) {
    if (mounted && operation.request === sequence) error.value = cause instanceof Error ? cause.message : "笔记导出失败";
  } finally { if (mounted && operation.request === sequence) transferBusy.value = false; }
}
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const operation = begin();
  result.value = null;
  backup.value = null;
  try {
    if (file.size > NOTES_BACKUP_MAX_BYTES) throw new Error("笔记文件不能超过 10 MB");
    const text = await file.text();
    operation.assertActive();
    backup.value = parseNotesBackup(text, operation.domain);
    fileName.value = file.name;
    transferOpen.value = true;
  } catch (cause) {
    if (mounted && operation.request === sequence) error.value = cause instanceof Error ? cause.message : "笔记文件读取失败";
  } finally { if (mounted && operation.request === sequence) transferBusy.value = false; }
}
async function importFile() {
  if (!backup.value || transferBusy.value) return;
  const selected = backup.value;
  const operation = begin();
  try {
    const imported = await importNotesBackup(selected, operation.accountId, notesTransferClient, operation);
    operation.assertActive();
    result.value = imported;
    error.value = imported.error;
    if (operation.domain === "bible") window.dispatchEvent(new Event("bible-notes-changed"));
    emit("imported");
  } catch (cause) {
    if (mounted && operation.request === sequence) error.value = cause instanceof Error ? cause.message : "笔记导入失败";
  } finally { if (mounted && operation.request === sequence) transferBusy.value = false; }
}
function close() {
  if (transferBusy.value) return;
  transferOpen.value = false;
  backup.value = null;
  result.value = null;
  error.value = "";
}
</script>

<template>
  <div class="notes-transfer" :aria-label="`${label}导入与导出`">
    <div class="transfer-buttons">
      <button type="button" :disabled="transferBusy" @click="download"><Download :size="16" />{{ transferBusy && !transferOpen ? '处理中…' : '导出笔记' }}</button>
      <button type="button" :disabled="transferBusy" @click="fileInput?.click()"><Upload :size="16" />导入笔记</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden :aria-label="`选择${label}备份文件`" @change="chooseFile" />
    </div>
    <p v-if="error && !transferOpen" class="transfer-error" role="alert">{{ error }}</p>
    <Teleport to="body"><AppModal :open="transferOpen" :title="`导入${label}`" :busy="transferBusy" content-class="notes-transfer-modal" @close="close">
      <div class="transfer-body">
        <p class="file-name">{{ fileName }}</p>
        <p>文件中有 {{ backup?.notes.length ?? 0 }} 条笔记，将添加到当前账号。</p>
        <p class="transfer-help">重复笔记会跳过，现有笔记不会被覆盖。{{ domain === 'bible' ? '导入的圣经笔记仅自己可见。' : '只导入书架中能匹配到的图书，缺失或无法区分的图书会跳过。' }}</p>
        <div v-if="result" class="transfer-result" role="status">
          <p>本次导入 {{ result.imported }} 条；重复 {{ result.duplicates }} 条。</p>
          <p v-if="result.conflicts">{{ result.conflicts }} 条编号冲突，已保留现有笔记。</p>
          <p v-if="result.unavailable">{{ result.unavailable }} 条找不到对应图书，请将图书加入书架后重新导入。</p>
          <p v-if="result.remaining">还有 {{ result.remaining }} 条待处理，重试会跳过已经导入的笔记。</p>
        </div>
        <p v-if="error" class="transfer-error" role="alert">{{ error }}</p>
        <p v-if="transferBusy" role="status">正在导入笔记…</p>
      </div>
      <footer class="transfer-footer">
        <button type="button" :disabled="transferBusy" @click="close">{{ result && !error ? '完成' : '取消' }}</button>
        <button v-if="!result || error" type="button" :disabled="transferBusy || !backup?.notes.length" @click="importFile">{{ transferBusy ? '导入中…' : error ? '重试导入' : '开始导入' }}</button>
      </footer>
    </AppModal></Teleport>
  </div>
</template>

<style scoped>
.notes-transfer { min-width: 0; color: #69553c; }
.transfer-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.transfer-buttons button, .transfer-footer button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 8px 12px; border: 1px solid #c5b394; border-radius: 6px; background: #fffaf1; color: inherit; font: inherit; cursor: pointer; }
button:disabled { opacity: .55; cursor: wait; }
:deep(.notes-transfer-modal) { grid-template-rows: auto minmax(0, 1fr) auto; color: #69553c; }
.transfer-body { min-height: 0; overflow: auto; padding: 16px; line-height: 1.7; overflow-wrap: anywhere; }
.transfer-body p { margin: 0 0 12px; }
.file-name { font-weight: 600; }
.transfer-help { font-size: 13px; color: #776b59; }
.transfer-result { padding: 12px; border-radius: 6px; background: #eef3e7; }
.transfer-result p:last-child { margin-bottom: 0; }
.transfer-error { color: #a14d38; font-size: 14px; overflow-wrap: anywhere; }
.transfer-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid #d9cdb8; }
.transfer-footer button:last-child { background: #647d61; border-color: #647d61; color: white; }
</style>
