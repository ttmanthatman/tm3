<script setup lang="ts">
import { ArrowDown, ArrowUp, FileUp, Save, Trash2 } from "lucide-vue-next";
import type { PinnedContentBlockDTO } from "@shared/types";
import type { PinnedMediaBlock } from "../messages/useMediaPreview";
import { compactBytes } from "../../time";

defineProps<{
  msg: string;
  pinnedFileUrl: (block: PinnedMediaBlock) => string;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
  clear: [];
}>();

const title = defineModel<string>("title", { required: true });
const blocks = defineModel<PinnedContentBlockDTO[]>("blocks", { required: true });

function addPinnedTextBlock() {
  blocks.value = [...blocks.value, { id: `new-${Date.now()}`, type: "text", text: "" }];
}

function movePinnedBlock(index: number, direction: -1 | 1) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= blocks.value.length) return;
  const next = [...blocks.value];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  blocks.value = next;
}

function removePinnedBlock(index: number) {
  blocks.value = blocks.value.filter((_block, idx) => idx !== index);
}
</script>

<template>
  <section
    class="modal-shell"
    role="dialog"
    aria-modal="true"
    aria-label="编辑置顶消息"
    @click.self="emit('close')"
  >
    <div class="small-modal pinned-editor-modal">
      <div class="form-grid">
        <label>标题（可选）</label>
        <input v-model="title" placeholder="置顶消息" />
        <label>正文</label>
        <div class="pinned-editor-blocks">
          <article v-for="(block, index) in blocks" :key="block.id" class="pinned-editor-block">
            <template v-if="block.type === 'text'">
              <textarea v-model="block.text" rows="5" placeholder="置顶正文"></textarea>
            </template>
            <template v-else>
              <img v-if="block.type === 'image'" :src="pinnedFileUrl(block)" alt="" />
              <div v-else class="file-card pinned-file-card">
                <FileUp :size="24" />
                <span>
                  <strong>{{ block.fileName }}</strong>
                  <small>{{ block.fileSize ? compactBytes(block.fileSize) : "文件" }}</small>
                </span>
              </div>
            </template>
            <div class="pinned-editor-block-actions">
              <button
                class="mini-btn secondary"
                :disabled="index === 0"
                @click="movePinnedBlock(index, -1)"
              >
                <ArrowUp :size="15" />上移
              </button>
              <button
                class="mini-btn secondary"
                :disabled="index === blocks.length - 1"
                @click="movePinnedBlock(index, 1)"
              >
                <ArrowDown :size="15" />下移
              </button>
              <button class="mini-btn danger-action" @click="removePinnedBlock(index)">
                <Trash2 :size="15" />删除此块
              </button>
            </div>
          </article>
        </div>
        <button class="mini-btn secondary" @click="addPinnedTextBlock">添加文字</button>
        <p v-if="msg" class="admin-msg">{{ msg }}</p>
        <div class="confirm-actions">
          <button class="mini-btn danger-action" @click="emit('clear')">撤下置顶</button>
          <button class="mini-btn secondary" @click="emit('close')">取消</button>
          <button class="primary-btn" @click="emit('save')"><Save :size="16" />保存</button>
        </div>
      </div>
    </div>
  </section>
</template>
