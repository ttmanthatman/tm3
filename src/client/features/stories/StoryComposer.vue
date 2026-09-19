<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ImagePlus, Mic, Square, X, ChevronLeft, ChevronRight, Send } from "lucide-vue-next";
import { STORY_LIMITS, type StoryDTO } from "@shared/stories";
import AppModal from "../../components/ui/AppModal.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import StoryVoice from "./StoryVoice.vue";
import { useStoryRecording } from "./useStoryRecording";
import { publishStory, prepareStoryPhoto } from "./storyClient";
const emit = defineEmits<{ close: []; published: [story: StoryDTO] }>();
const text = ref("");
const images = ref<Array<{ file: File; url: string }>>([]);
const busy = ref(false);
const error = ref("");
const discardOpen = ref(false);
const photoBusy = ref(false);
let photoController: AbortController | null = null;
const { file: voice, preview, recording, starting, durationMs, error: recordingError, start, stop, clear } = useStoryRecording();
const canPublish = computed(() => !busy.value && !photoBusy.value && !recording.value && !starting.value && (images.value.length > 0 || !!voice.value));
let requestId = crypto.randomUUID();
let controller: AbortController | null = null;
watch([text, () => images.value.map((image) => image.url).join(","), voice], () => { requestId = crypto.randomUUID(); }, { flush: "sync" });

async function pick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files || [])];
  input.value = "";
  error.value = "";
  if (files.length + images.value.length > STORY_LIMITS.images) { error.value = "每篇最多 9 张图片"; return; }
  if (photoBusy.value || !files.length) return;
  if (files.some((file) => (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) || file.size > STORY_LIMITS.fileBytes)) { error.value = "请选择 10 MB 以内的图片"; return; }
  photoBusy.value = true;
  const request = new AbortController();
  photoController = request;
  const timeout = setTimeout(() => request.abort(), 60_000);
  try {
    const prepared: File[] = [];
    for (const file of files) prepared.push(await prepareStoryPhoto(file, request.signal));
    if (!request.signal.aborted) images.value.push(...prepared.map((file) => ({ file, url: URL.createObjectURL(file) })));
  } catch (cause) { error.value = request.signal.aborted ? "照片处理已取消或超时，请重新选择" : cause instanceof Error ? cause.message : "照片处理失败，请重新选择"; }
  finally { clearTimeout(timeout); photoBusy.value = false; }
}
function remove(index: number) { URL.revokeObjectURL(images.value[index].url); images.value.splice(index, 1); }
function move(index: number, direction: number) { const [image] = images.value.splice(index, 1); images.value.splice(index + direction, 0, image); }
function close() {
  if (busy.value) return;
  if (text.value.trim() || images.value.length || voice.value || recording.value || starting.value || photoBusy.value) discardOpen.value = true;
  else emit("close");
}
async function submit() {
  if (!canPublish.value) return;
  busy.value = true;
  error.value = "";
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 180_000);
  try {
    const result = await publishStory(requestId, text.value, images.value.map((image) => image.file), voice.value, controller.signal);
    emit("published", result.story);
  } catch (cause) { error.value = controller.signal.aborted ? "发布超时，内容已保留。请重试，重复提交不会重复发布。" : cause instanceof Error ? cause.message : "发布失败，请重试"; }
  finally { clearTimeout(timeout); busy.value = false; }
}
onBeforeUnmount(() => { controller?.abort(); photoController?.abort(); for (const image of images.value) URL.revokeObjectURL(image.url); });
</script>

<template>
  <AppModal open title="留下一段故事" :busy="busy" content-class="story-composer story-surface" @close="close">
    <form class="story-composer-body" @submit.prevent="submit">
      <p class="story-muted">用照片留住此刻，用声音讲给以后。</p>
      <label class="story-field-label" for="story-text">这一刻，想说些什么 <small>选填</small></label>
      <textarea id="story-text" v-model="text" :maxlength="STORY_LIMITS.text" :disabled="busy" rows="4" placeholder="给这段记忆，留几句旁白…" />
      <small class="story-count">{{ text.length }} / {{ STORY_LIMITS.text }}</small>
      <div v-if="images.length" class="story-draft-images">
        <div v-for="(image, index) in images" :key="image.url" class="story-draft-image">
          <img :src="image.url" :alt="`待发布照片 ${index + 1}`" />
          <button type="button" class="story-remove-image" :disabled="busy" :aria-label="`移除照片 ${index + 1}`" @click="remove(index)"><X :size="16" /></button>
          <div class="story-image-order">
            <button type="button" :disabled="busy || index === 0" :aria-label="`照片 ${index + 1} 前移`" @click="move(index, -1)"><ChevronLeft :size="17" /></button>
            <span>{{ index + 1 }}</span>
            <button type="button" :disabled="busy || index === images.length - 1" :aria-label="`照片 ${index + 1} 后移`" @click="move(index, 1)"><ChevronRight :size="17" /></button>
          </div>
        </div>
      </div>
      <div v-if="preview" class="story-draft-voice">
        <StoryVoice :src="preview" :duration-ms="durationMs" />
        <button type="button" class="story-text-button" :disabled="busy" @click="clear">移除语音</button>
      </div>
      <div class="story-add-media">
        <label class="story-secondary-button" :class="{ disabled: busy || photoBusy || images.length === 9 }">
          <ImagePlus :size="20" />添加照片 <small>{{ images.length }}/9</small>
          <input type="file" accept="image/*,.heic,.heif" multiple :disabled="busy || photoBusy || images.length === 9" aria-label="添加故事照片" @change="pick" />
        </label>
        <button v-if="!recording" type="button" class="story-secondary-button" :disabled="busy || starting || !!voice" @click="start"><Mic :size="20" />{{ starting ? "准备录音…" : "录一段声音" }}</button>
        <button v-else type="button" class="story-secondary-button recording" @click="stop"><Square :size="18" />结束录音 · {{ Math.floor(durationMs / 1000) }} 秒</button>
      </div>
      <p v-if="photoBusy" class="story-muted" role="status">正在处理照片，请稍候…</p>
      <p v-if="error || recordingError" class="story-error" role="alert">{{ error || recordingError }}</p>
      <footer class="story-composer-footer">
        <p>共同频道成员可见。至少添加一张照片或一段语音，语音最长 3 分钟。</p>
        <button class="story-primary-button" type="submit" :disabled="!canPublish"><Send :size="17" />{{ busy ? "正在发布…" : "发布故事" }}</button>
      </footer>
    </form>
  </AppModal>
  <ConfirmDialog :open="discardOpen" title="放弃这段故事？" message="尚未发布的文字、照片和录音将被丢弃。" confirm-text="放弃" cancel-text="继续编辑" danger @close="discardOpen = false" @confirm="emit('close')" />
</template>
