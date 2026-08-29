<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MonitorPlay, Presentation, X } from "lucide-vue-next";
import { useChatStore } from "../../store";
import { useSermon } from "./useSermon";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; own: [] }>();

const store = useChatStore();
const sermon = useSermon({ getSocket: () => store.socket });
const error = ref("");
const accountId = computed(() => store.account?.id ?? null);
const permittedPresentations = computed(() =>
  sermon.directory.value.filter(
    (entry) =>
      entry.presenterId !== accountId.value &&
      entry.active &&
      (entry.scope === "assembly" || (accountId.value !== null && entry.invitedAccountIds.includes(accountId.value)))
  )
);

watch(() => props.open, (open) => {
  if (open) error.value = "";
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));

async function leaveCurrentIfNeeded(targetId?: number) {
  const joined = sermon.joinedPresentationId.value;
  if (joined === null || joined === targetId) return true;
  const result = await sermon.leave();
  if (!result.ok) {
    error.value = result.message;
    return false;
  }
  return true;
}

async function enterOwn() {
  error.value = "";
  if (!(await leaveCurrentIfNeeded())) return;
  emit("own");
}

async function watchPresentation(presenterId: number) {
  error.value = "";
  if (!(await leaveCurrentIfNeeded(presenterId))) return;
  const result = await sermon.join(presenterId);
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  emit("close");
}
</script>

<template>
  <section
    v-if="props.open"
    class="modal-shell sermon-entry-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="选择讲道台"
    @click.self="emit('close')"
  >
    <div class="sermon-entry-sheet">
      <header>
        <span>
          <strong>选择要进入的讲道台</strong>
          <small>进入他人的讲道台前会明确显示讲道者；服务端会再次检查观看许可。</small>
        </span>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')"><X :size="20" /></button>
      </header>
      <p v-if="error" class="sermon-entry-error" role="alert">{{ error }}</p>
      <button class="sermon-entry-option own" type="button" :disabled="sermon.pending.value" @click="enterOwn">
        <Presentation :size="24" />
        <span>
          <strong>进入自己的讲道台</strong>
          <small>准备、保存或主持你自己的讲道内容，不会操作别人的队列。</small>
        </span>
      </button>
      <div v-if="permittedPresentations.length" class="sermon-entry-others">
        <h3>已获准观看的讲道台</h3>
        <button
          v-for="entry in permittedPresentations"
          :key="entry.presenterId"
          class="sermon-entry-option"
          type="button"
          :disabled="sermon.pending.value"
          @click="watchPresentation(entry.presenterId)"
        >
          <MonitorPlay :size="24" />
          <span>
            <strong>进入 {{ entry.presenterName }} 的讲道台</strong>
            <small>{{ entry.scope === "assembly" ? "全体演示，已开放观看" : "小组演示，你已收到观看许可" }} · 只能观看</small>
          </span>
        </button>
      </div>
      <p v-else class="sermon-entry-empty">目前没有你获准进入的他人讲道台。</p>
    </div>
  </section>
</template>

<style scoped>
.sermon-entry-sheet {
  width: min(520px, calc(100vw - 28px));
  max-height: min(76vh, 620px);
  overflow-y: auto;
  padding: 18px;
  border-radius: 18px;
  background: var(--panel, #fff);
  color: var(--ink, #111827);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
}

.sermon-entry-sheet > header,
.sermon-entry-sheet > header > span,
.sermon-entry-option > span {
  display: flex;
  flex-direction: column;
}

.sermon-entry-sheet > header {
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sermon-entry-sheet small,
.sermon-entry-empty {
  color: var(--muted, #6b7280);
}

.sermon-entry-others h3 {
  margin: 18px 0 8px;
  font-size: 14px;
}

.sermon-entry-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 9px;
  padding: 13px;
  border: 1px solid var(--line, rgba(0, 0, 0, 0.1));
  border-radius: 14px;
  background: var(--panel-soft, rgba(127, 127, 127, 0.06));
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.sermon-entry-option.own {
  border-color: color-mix(in srgb, var(--accent, #2563eb) 55%, var(--line, transparent));
}

.sermon-entry-option > svg {
  flex: none;
  color: var(--accent, #2563eb);
}

.sermon-entry-option > span {
  min-width: 0;
}

.sermon-entry-error {
  color: #dc2626;
}

.sermon-entry-empty {
  margin: 14px 0 0;
  font-size: 13px;
}
</style>
