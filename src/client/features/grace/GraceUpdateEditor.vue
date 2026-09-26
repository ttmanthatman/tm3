<script setup lang="ts">
import { ref } from "vue";
import { Image as ImageIcon, X } from "lucide-vue-next";
import AppModal from "../../components/ui/AppModal.vue";
import type { useGrace } from "./useGrace";
import { graceImageUrl } from "./graceImages";
import { getToken } from "../../api";

const props = defineProps<{ grace: ReturnType<typeof useGrace> }>();
const {
  pendingGraceUpdate, graceUpdateContent, graceUpdateBusy, graceUpdateError,
  graceUpdatePhotos, graceUpdatePhotoBusy, graceUpdateImages, graceUpdateImageMessageId,
  graceUpdateCanPublish, closeGraceUpdateEditor, publishGraceUpdate,
  handleGraceUpdatePhotoPick, removeGraceUpdatePhoto
} = props.grace;
const photoInput = ref<HTMLInputElement | null>(null);
</script>

<template>
  <AppModal :open="!!pendingGraceUpdate" title="编辑恩典卡片" aria-label="编辑恩典卡片" close-label="关闭恩典见证编辑" :busy="graceUpdateBusy" content-class="grace-composer-modal" @close="closeGraceUpdateEditor()">
    <form class="form-grid modal-form grace-composer-form" @submit.prevent="publishGraceUpdate">
      <textarea v-model="graceUpdateContent" rows="7" aria-label="恩典内容" placeholder="写下恩典见证…" :disabled="graceUpdateBusy" />
      <div class="grace-attach-row">
        <button class="mini-btn secondary" type="button" :disabled="graceUpdateBusy || graceUpdatePhotoBusy" @click="photoInput?.click()"><ImageIcon :size="15" />附上照片（最多 9 张）</button>
        <span v-if="graceUpdateImageMessageId" class="grace-photo-chip">
          <img :src="`/api/files/${graceUpdateImageMessageId}?token=${encodeURIComponent(getToken())}`" alt="原有照片" />
          <button class="icon-btn" type="button" :disabled="graceUpdateBusy" aria-label="移除原有照片" @click="graceUpdateImageMessageId = null"><X :size="14" /></button>
        </span>
        <span v-for="(image, index) in graceUpdateImages" :key="image.fileName" class="grace-photo-chip">
          <img :src="graceImageUrl(pendingGraceUpdate!.id, image.fileName)" :alt="`原有照片 ${index + 1}`" />
          <button class="icon-btn" type="button" :disabled="graceUpdateBusy" :aria-label="`移除原有照片 ${index + 1}`" @click="graceUpdateImages.splice(index, 1)"><X :size="14" /></button>
        </span>
        <span v-for="(photo, index) in graceUpdatePhotos" :key="photo.url" class="grace-photo-chip">
          <img :src="photo.url" alt="已选照片预览" />
          <button class="icon-btn" type="button" :disabled="graceUpdateBusy" :aria-label="`移除新增照片 ${index + 1}`" @click="removeGraceUpdatePhoto(index)"><X :size="14" /></button>
        </span>
      </div>
      <input ref="photoInput" class="hidden" type="file" multiple accept="image/*,.heic,.heif" aria-label="添加恩典照片" :disabled="graceUpdateBusy || graceUpdatePhotoBusy" @change="handleGraceUpdatePhotoPick" />
      <p v-if="graceUpdatePhotoBusy" role="status">正在处理照片…</p>
      <p v-if="graceUpdateError" class="form-error" role="alert">{{ graceUpdateError }}</p>
      <div class="confirm-actions">
        <button class="mini-btn secondary" type="button" :disabled="graceUpdateBusy" @click="closeGraceUpdateEditor()">取消</button>
        <button class="grace-submit-btn" type="submit" :disabled="graceUpdateBusy || !graceUpdateCanPublish">{{ graceUpdateBusy ? "正在保存…" : "保存并同步故事" }}</button>
      </div>
    </form>
  </AppModal>
</template>
