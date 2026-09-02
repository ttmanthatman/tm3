<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Plus, Trash2, X } from "lucide-vue-next";
import type { ChainCreateFormValue } from "./useChain";

const props = defineProps<{
  open: boolean;
  busy: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [value: ChainCreateFormValue];
}>();

const topic = ref("");
const requiredSelection = ref(false);
const allowMultiple = ref(false);
const options = ref<string[]>([]);
const optionDraft = ref("");
const localError = ref("");

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    topic.value = "";
    requiredSelection.value = false;
    allowMultiple.value = false;
    options.value = [];
    optionDraft.value = "";
    localError.value = "";
  }
);

function cleanLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function addOption() {
  const label = cleanLabel(optionDraft.value);
  localError.value = "";
  if (!label) return;
  if ([...label].length > 20) {
    localError.value = "每个项目不能超过 20 个字";
    return;
  }
  if (label === "其他") {
    localError.value = "系统会自动提供“其他”，无需重复添加";
    return;
  }
  if (options.value.some((item) => item.toLocaleLowerCase() === label.toLocaleLowerCase())) {
    localError.value = "这个项目已经添加过了";
    return;
  }
  if (options.value.length >= 10) {
    localError.value = "最多可以添加 10 个项目";
    return;
  }
  options.value = [...options.value, label];
  optionDraft.value = "";
}

function removeOption(index: number) {
  options.value = options.value.filter((_, itemIndex) => itemIndex !== index);
  localError.value = "";
}

const canSubmit = computed(() => {
  if (!topic.value.trim() || props.busy) return false;
  if (!requiredSelection.value) return true;
  return options.value.length > 0 || !!optionDraft.value.trim();
});

function submitForm() {
  localError.value = "";
  if (!topic.value.trim()) return;
  if (requiredSelection.value && optionDraft.value.trim()) addOption();
  if (localError.value) return;
  if (requiredSelection.value && !options.value.length) {
    localError.value = "请至少添加一个参与项目";
    return;
  }
  emit("submit", {
    topic: topic.value.trim(),
    requiredSelection: requiredSelection.value,
    allowMultiple: requiredSelection.value && allowMultiple.value,
    options: [...options.value]
  });
}
</script>

<template>
  <section v-if="open" class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="chain-create-title" @click.self="emit('close')">
    <form class="small-modal chain-create-modal" @submit.prevent="submitForm">
      <header class="modal-head">
        <strong id="chain-create-title">发起接龙</strong>
        <button class="icon-btn" type="button" :disabled="busy" aria-label="关闭接龙" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="form-grid modal-form chain-create-form">
        <label for="chain-topic">接龙信息</label>
        <input id="chain-topic" v-model="topic" autocomplete="off" placeholder="例如：周六聚餐报名" />

        <label class="chain-require-row">
          <input v-model="requiredSelection" type="checkbox" />
          <span>
            <strong>参与者必须选择具体项目</strong>
            <small>确认参与后，还要从你设置的项目中选择。</small>
          </span>
        </label>

        <div v-if="requiredSelection" class="chain-option-editor">
          <label class="chain-require-row chain-multiple-row">
            <input v-model="allowMultiple" type="checkbox" />
            <span>
              <strong>允许多选</strong>
              <small>参与者可以同时选择多个项目。</small>
            </span>
          </label>
          <label for="chain-option">参与项目</label>
          <div v-if="options.length" class="chain-option-list">
            <div v-for="(item, index) in options" :key="item" class="chain-option-item">
              <span>{{ item }}</span>
              <button type="button" :disabled="busy" :aria-label="`删除项目 ${item}`" @click="removeOption(index)"><Trash2 :size="15" /></button>
            </div>
          </div>
          <div class="chain-option-add">
            <input
              id="chain-option"
              v-model="optionDraft"
              maxlength="20"
              autocomplete="off"
              placeholder="例如：跑步"
              @keydown.enter.prevent="addOption"
            />
            <button class="mini-btn secondary" type="button" :disabled="busy || !optionDraft.trim() || options.length >= 10" @click="addOption">
              <Plus :size="16" />添加
            </button>
          </div>
          <small>最多 10 项；参与时会自动提供“其他”，选择后必须填写内容。</small>
        </div>

        <p v-if="localError || error" class="form-error" role="alert">{{ localError || error }}</p>
        <button class="primary-btn" type="submit" :disabled="!canSubmit">{{ busy ? "正在发布…" : "发布接龙" }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.chain-create-modal {
  grid-template-rows: auto minmax(0, 1fr);
  color: var(--text);
  background: var(--panel);
}

.chain-create-modal .modal-head {
  color: var(--text);
  background: var(--panel);
}

.chain-create-form {
  overflow: auto;
}

.chain-create-form > input,
.chain-option-add input {
  color: var(--text);
  background: var(--bubble-other);
}

.chain-require-row {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 11px 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  background: var(--panel);
}

.chain-require-row input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--accent);
}

.chain-require-row span,
.chain-option-editor {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.chain-require-row small,
.chain-option-editor > small {
  color: var(--muted);
  line-height: 1.45;
}

.chain-option-editor {
  gap: 8px;
}

.chain-option-list {
  display: grid;
  gap: 6px;
}

.chain-option-item,
.chain-option-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.chain-option-item {
  min-height: 40px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 8px 0 12px;
}

.chain-option-item button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--muted);
}

.chain-option-add .mini-btn {
  min-height: 42px;
}
</style>
