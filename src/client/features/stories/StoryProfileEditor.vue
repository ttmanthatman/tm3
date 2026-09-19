<script setup lang="ts">
import { ref } from "vue";
import { STORY_BIO_MAX, STORY_DEFAULT_BIO } from "@shared/stories";
import AppModal from "../../components/ui/AppModal.vue";
import { saveStoryBio } from "./storyClient";
const props = defineProps<{ bio: string }>();
const emit = defineEmits<{ close: []; saved: [bio: string] }>();
const draft = ref(props.bio);
const busy = ref(false);
const error = ref("");
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { emit("saved", (await saveStoryBio(draft.value)).bio); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "签名保存失败，请重试"; }
  finally { busy.value = false; }
}
</script>
<template>
  <AppModal open title="编辑故事签名" :busy="busy" content-class="story-bio-editor story-surface" @close="emit('close')">
    <form class="story-composer-body" @submit.prevent="save">
      <label class="story-field-label" for="story-bio">故事签名</label>
      <textarea id="story-bio" v-model="draft" :maxlength="STORY_BIO_MAX" :placeholder="STORY_DEFAULT_BIO" :disabled="busy" rows="3" />
      <p class="story-muted">{{ draft.length }} / {{ STORY_BIO_MAX }} · 留空恢复默认签名</p>
      <p v-if="error" class="story-error" role="alert">{{ error }}</p>
      <button class="story-primary-button" type="submit" :disabled="busy">{{ busy ? "保存中…" : "保存签名" }}</button>
    </form>
  </AppModal>
</template>
