<script setup lang="ts">
import { Upload, X } from "lucide-vue-next";
import type { AdminAttachmentDTO } from "@shared/types";
import { backgroundAttachmentLabel } from "./adminFormat";
import type { AppearanceFitField, WallpaperFit } from "./useAppearanceSettings";

type PickerState = {
  title: string;
  hint: string;
  fitField?: AppearanceFitField;
};

defineProps<{
  picker: PickerState;
  selection: string | null;
  fit: string | null;
  fitOptions: Array<{ value: WallpaperFit; label: string }>;
  images: AdminAttachmentDTO[];
  wallpaperUrl: (path?: string | null) => string;
}>();

const emit = defineEmits<{
  close: [];
  upload: [event: Event];
  clear: [];
  select: [fileName: string];
}>();

const edit = defineModel<Record<AppearanceFitField, string>>("edit", { required: true });
</script>

<template>
  <section class="modal-shell appearance-picker-shell" @click.self="emit('close')">
    <div class="small-modal appearance-picker-modal">
      <header class="modal-head">
        <strong>{{ picker.title }}</strong>
        <button class="icon-btn" @click="emit('close')" aria-label="关闭图片选择">
          <X :size="20" />
        </button>
      </header>
      <div class="appearance-picker-body">
        <p class="settings-note">{{ picker.hint }}</p>
        <div class="appearance-picker-actions">
          <label class="primary-btn">
            <Upload :size="16" />上传新图片
            <input class="hidden" type="file" accept="image/*" @change="emit('upload', $event)" />
          </label>
          <button class="mini-btn secondary" :disabled="!selection" @click="emit('clear')">
            移除当前
          </button>
          <select v-if="picker.fitField" v-model="edit[picker.fitField]" aria-label="图片显示方式">
            <option v-for="option in fitOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div v-if="selection" class="appearance-picker-current">
          <img :src="wallpaperUrl(selection)" alt="" />
          <div>
            <b>当前草稿</b>
            <small
              >{{ selection
              }}<template v-if="fit">
                · {{ fitOptions.find((option) => option.value === fit)?.label }}</template
              ></small
            >
          </div>
        </div>
        <div v-if="images.length" class="appearance-image-grid picker-grid">
          <button
            v-for="image in images"
            :key="image.id"
            class="appearance-image-card"
            :class="{ active: image.fileName === selection }"
            @click="emit('select', image.fileName)"
          >
            <img :src="wallpaperUrl(image.fileName)" alt="" />
            <span>
              <b>{{ image.label }}</b>
              <small>{{ backgroundAttachmentLabel(image) }}</small>
            </span>
          </button>
        </div>
        <p v-else class="empty-note">还没有可选图片。上传后会自动选中为当前草稿。</p>
      </div>
    </div>
  </section>
</template>
