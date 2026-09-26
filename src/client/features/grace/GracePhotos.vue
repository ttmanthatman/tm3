<script setup lang="ts">
import { ref } from "vue";
import { ArrowLeft, ArrowRight } from "lucide-vue-next";
import type { GraceImage } from "@shared/types";
import AppModal from "../../components/ui/AppModal.vue";
import { graceImageUrl } from "./graceImages";

defineProps<{ messageId: number; images: GraceImage[] }>();
const selected = ref<number | null>(null);
</script>

<template>
  <div v-if="images.length" class="grace-photo-grid">
    <button v-for="(image, index) in images" :key="image.fileName" class="image-preview-button grace-card-photo" type="button" :aria-label="`查看恩典照片 ${index + 1}，共 ${images.length} 张`" @click.stop="selected = index">
      <img class="chat-image" :src="graceImageUrl(messageId, image.fileName)" alt="恩典记录附带照片" loading="lazy" />
    </button>
  </div>
  <Teleport to="body">
    <AppModal v-if="selected !== null && images[selected]" open :title="`恩典照片 ${selected + 1} / ${images.length}`" :aria-label="`恩典照片 ${selected + 1} / ${images.length}`" content-class="grace-photo-lightbox" @close="selected = null">
      <img :src="graceImageUrl(messageId, images[selected].fileName)" alt="恩典照片原图" />
      <nav aria-label="照片翻页">
        <button class="icon-btn" :disabled="selected === 0" aria-label="上一张照片" @click="selected--"><ArrowLeft :size="20" /></button>
        <button class="icon-btn" :disabled="selected === images.length - 1" aria-label="下一张照片" @click="selected++"><ArrowRight :size="20" /></button>
      </nav>
    </AppModal>
  </Teleport>
</template>
