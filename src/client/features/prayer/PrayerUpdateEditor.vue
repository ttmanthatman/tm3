<script setup lang="ts">
import { ref } from "vue";
import { Image as ImageIcon, X } from "lucide-vue-next";

defineProps<{
  busy: boolean;
  error: string;
  photoPreview: string;
  canPublish: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  clearPhoto: [];
  photoPick: [event: Event];
}>();

const content = defineModel<string>("content", { required: true });

const prayerUpdateTextarea = ref<HTMLTextAreaElement | null>(null);
const prayerUpdatePhotoInput = ref<HTMLInputElement | null>(null);

function handlePhotoPick(event: Event) {
  emit("photoPick", event);
  const input = event.target as HTMLInputElement;
  input.value = "";
}
</script>

<template>
  <section class="modal-shell" @mousedown.self="emit('close')">
    <form class="small-modal prayer-update-modal" @submit.prevent="emit('submit')">
      <header class="modal-head">
        <strong>更新代祷最新动态</strong>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="关闭最新动态编辑">
          <X :size="20" />
        </button>
      </header>
      <div class="form-grid modal-form">
        <textarea
          ref="prayerUpdateTextarea"
          v-model="content"
          rows="9"
          placeholder="写下最新动态…"
        ></textarea>
        <div class="prayer-update-attach">
          <button
            class="mini-btn secondary"
            type="button"
            :disabled="busy"
            @click="prayerUpdatePhotoInput?.click()"
          >
            <ImageIcon :size="15" />附上照片
          </button>
          <span v-if="photoPreview" class="prayer-update-photo-chip">
            <img :src="photoPreview" alt="已选照片预览" />
            <button
              class="icon-btn"
              type="button"
              :disabled="busy"
              aria-label="移除照片"
              @click="emit('clearPhoto')"
            >
              <X :size="14" />
            </button>
          </span>
        </div>
        <input
          ref="prayerUpdatePhotoInput"
          class="hidden"
          type="file"
          accept="image/*"
          @change="handlePhotoPick"
        />
        <p v-if="error" class="form-error">{{ error }}</p>
        <div class="confirm-actions">
          <button class="mini-btn secondary" type="button" :disabled="busy" @click="emit('close')">
            取消
          </button>
          <button class="primary-btn" type="submit" :disabled="busy || !canPublish">
            {{ busy ? "正在更新..." : "更新并推送" }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
