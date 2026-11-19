<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Play } from "lucide-vue-next";

const props = defineProps<{ src: string; fileName?: string | null }>();
const emit = defineEmits<{ open: [event: MouseEvent] }>();
const button = ref<HTMLButtonElement | null>(null);
const visible = ref(false);
const failed = ref(false);
const aspect = ref(16 / 9);
const frameReady = ref(false);
let observer: IntersectionObserver | null = null;
// A media fragment requests a still frame on Safari too, without autoplay.
const frameSrc = computed(() => `${props.src.split("#")[0]}#t=0.1`);
const style = computed(() => ({
  width: `min(260px, 62vw, ${300 * aspect.value}px)`,
  aspectRatio: String(aspect.value)
}));
function metadata(event: Event) {
  const video = event.target as HTMLVideoElement;
  if (video.videoWidth > 0 && video.videoHeight > 0) aspect.value = video.videoWidth / video.videoHeight;
}
onMounted(() => {
  if (!("IntersectionObserver" in window)) { visible.value = true; return; }
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    visible.value = true;
    observer?.disconnect();
  }, { rootMargin: "160px" });
  if (button.value) observer.observe(button.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <button ref="button" class="video-thumbnail" type="button" :style="style" :aria-label="`播放视频：${fileName || '视频'}`" @click.stop="emit('open', $event)">
    <video v-if="visible && !failed" :src="frameSrc" muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"
      @loadedmetadata="metadata" @loadeddata="frameReady = true" @error="failed = true" />
    <span class="video-thumbnail-play" aria-hidden="true"><Play :size="28" fill="currentColor" /></span>
    <span v-if="failed || !frameReady" class="video-thumbnail-hint">{{ failed ? '点击播放视频' : '视频' }}</span>
  </button>
</template>

<style scoped>
.video-thumbnail { position: relative; display: block; max-width: 100%; padding: 0; overflow: hidden; border: 0; border-radius: 6px; background: #25282c; color: #fff; cursor: pointer; }
.video-thumbnail video { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.video-thumbnail-play { position: absolute; inset: 0; margin: auto; width: 52px; height: 52px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.65); border-radius: 50%; background: rgba(0,0,0,.45); box-shadow: 0 2px 12px rgba(0,0,0,.2); pointer-events: none; }
.video-thumbnail-play svg { margin-left: 3px; }
.video-thumbnail-hint { position: absolute; bottom: 10px; left: 0; right: 0; font-size: 12px; text-align: center; pointer-events: none; }
.video-thumbnail:focus-visible { outline: 3px solid var(--primary, #27814a); outline-offset: 3px; }
</style>
