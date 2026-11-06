<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { advanceWallpaperPan, initialWallpaperPanOffset, wallpaperPanBounds, wallpaperPanLayerPresentation, type WallpaperPanBounds, type WallpaperPanDirection } from "@shared/wallpaperPan";
import { wallpaperFitPresentation, type WallpaperConfig } from "@shared/wallpaper";
import { wallpaperLabelToneFromPixels } from "../../wallpaperContrast";
import AppModal from "../../components/ui/AppModal.vue";
const props = defineProps<{ busy: boolean; error: string; sharedBy: string }>();
const draft = defineModel<WallpaperConfig>({ required: true });
const emit = defineEmits<{ close: []; apply: [target: "personal" | "shared"] }>();
const viewport = ref<HTMLElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const phone = ref(false);
const original = ref(false);
const failed = ref(false);
const ready = ref(false);
const offset = ref(0);
const width = ref(0);
const light = ref(false);
let observer: ResizeObserver | undefined;
let bounds: WallpaperPanBounds | null = null;
let direction: WallpaperPanDirection = "left";
let lastScroll = 0;
const url = computed(() => `/backgrounds/${encodeURIComponent(draft.value.wallpaperPath || "")}`);
const style = computed(() => {
  const fit = wallpaperFitPresentation(draft.value.wallpaperFit);
  return { backgroundImage: draft.value.wallpaperFit === "pan" ? "none" : `url("${url.value}")`, backgroundSize: fit.size, backgroundRepeat: fit.repeat, backgroundPosition: "center" };
});
function measure() {
  if (!viewport.value || !image.value?.naturalWidth) return;
  bounds = wallpaperPanBounds(viewport.value.clientWidth, viewport.value.clientHeight, image.value.naturalWidth, image.value.naturalHeight);
  width.value = bounds.imageWidth;
  offset.value = initialWallpaperPanOffset(bounds, draft.value.wallpaperPanFocusX);
  direction = draft.value.wallpaperPanDirection;
}
function loaded() {
  ready.value = true;
  measure();
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context && image.value) { context.drawImage(image.value, 0, 0, 32, 32); light.value = wallpaperLabelToneFromPixels(context.getImageData(0, 0, 32, 32).data) === "light"; }
}
function scroll(event: Event) {
  const top = (event.target as HTMLElement).scrollTop;
  const delta = Math.abs(top - lastScroll); lastScroll = top;
  if (!bounds || draft.value.wallpaperFit !== "pan") return;
  const next = advanceWallpaperPan(offset.value, direction, delta * draft.value.wallpaperPanSpeed, bounds);
  offset.value = next.offset; direction = next.direction;
}
watch(() => [draft.value.wallpaperPanFocusX, draft.value.wallpaperPanDirection, draft.value.wallpaperFit], measure, { flush: "post" });
watch(url, () => { failed.value = false; ready.value = false; });
onMounted(() => { observer = new ResizeObserver(measure); if (viewport.value) observer.observe(viewport.value); });
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <AppModal :open="true" title="壁纸预览" size="medium" content-class="wallpaper-preview-modal" :busy="props.busy" @close="emit('close')">
    <div class="preview-layout">
      <div class="preview-stage">
        <div class="preview-toolbar"><button class="mini-btn secondary" @click="phone = !phone">{{ phone ? '当前窗口' : '手机比例' }}</button><button class="mini-btn secondary" @click="original = !original">{{ original ? '返回聊天效果' : '查看原图' }}</button></div>
        <div ref="viewport" class="wallpaper-scene" :class="{ phone, 'labels-light': light }" :style="style">
          <img ref="image" :src="url" alt="壁纸" :class="{ original, moving: draft.wallpaperFit === 'pan' && !original, hidden: draft.wallpaperFit !== 'pan' && !original }" :style="!original ? wallpaperPanLayerPresentation(width, offset) : {}" @load="loaded" @error="failed = true; ready = false" />
          <template v-if="!original">
            <header class="scene-head">主聊天室 <small>预览 · 示例消息</small></header>
            <div class="scene-messages" @scroll="scroll">
              <p class="scene-time">今天 10:30</p>
              <div v-for="i in 14" :key="i" class="scene-row" :class="{ mine: i % 3 === 0 }">
                <span class="scene-avatar">{{ i % 3 === 0 ? '我' : '友' }}</span><div><small>{{ i % 3 === 0 ? '我' : '小伙伴' }}</small><p>{{ ['换个风景，继续聊天。', '上下滚动，看看壁纸与消息的实际效果。', '愿你今天也有好心情。'][i % 3] }}</p></div>
              </div>
            </div>
            <footer class="scene-composer">在这里输入消息… <span>发送</span></footer>
          </template>
          <p v-if="failed" class="scene-status" role="alert">图片加载失败，请返回重试</p>
          <p v-else-if="!ready" class="scene-status" role="status">正在加载壁纸…</p>
        </div>
      </div>
      <aside class="preview-controls">
        <b>调整显示效果</b><p>关闭即放弃调整，保存前仅在这里预览。</p>
        <label>显示方式<select v-model="draft.wallpaperFit"><option value="cover">填满</option><option value="contain">完整显示</option><option value="stretch">拉伸</option><option value="repeat">平铺</option><option value="pan">推拉摇移</option></select></label>
        <template v-if="draft.wallpaperFit === 'pan'">
          <label>初始画面中心 {{ Math.round(draft.wallpaperPanFocusX * 100) }}%<input v-model.number="draft.wallpaperPanFocusX" aria-label="初始画面中心" type="range" min="0" max="1" step="0.01" /></label>
          <label>初始方向<select v-model="draft.wallpaperPanDirection"><option value="left">向左</option><option value="right">向右</option></select></label>
          <label>移动速度 {{ draft.wallpaperPanSpeed.toFixed(2) }}×<input v-model.number="draft.wallpaperPanSpeed" aria-label="移动速度" type="range" min="0.02" max="1" step="0.01" /></label>
          <p>上下滚动示例消息，体验壁纸移动。</p>
        </template>
        <p role="status">当前共享壁纸由 {{ props.sharedBy || '管理员' }} 设置。</p>
        <p v-if="props.error" class="error" role="alert">{{ props.error }}</p>
        <button class="primary-btn" :disabled="props.busy || !ready" @click="emit('apply', 'personal')">仅自己使用</button>
        <button class="primary-btn" :disabled="props.busy || !ready" @click="emit('apply', 'shared')">设为大家壁纸</button>
        <small>设为大家壁纸将影响正在跟随的成员，自己也会恢复跟随。</small>
        <button class="mini-btn secondary" :disabled="props.busy" @click="emit('close')">取消</button>
      </aside>
    </div>
  </AppModal>
</template>
<style>
.wallpaper-preview-modal.app-modal-medium { width:min(1400px,100%); height:calc(var(--app-height,100dvh) - 32px - var(--safe-top,0px) - var(--safe-bottom,0px)); max-height:none; display:flex; flex-direction:column; background:var(--panel,#fff); color:var(--text,#222); }
.preview-layout { display:grid; grid-template-columns:minmax(0,1fr) 260px; flex:1; min-height:0; }
.preview-stage { min-width:0; min-height:0; display:flex; flex-direction:column; padding:12px; background:var(--bg,#eee); }
.preview-toolbar { display:flex; gap:8px; padding-bottom:10px; }
.wallpaper-scene { position:relative; isolation:isolate; overflow:hidden; flex:1; min-height:200px; width:100%; margin:auto; display:flex; flex-direction:column; background-color:var(--chat-bg,#ededed); border-radius:10px; }
.wallpaper-scene.phone { max-width:390px; }
.wallpaper-scene>img { position:absolute; z-index:-1; height:100%; max-width:none; object-fit:cover; pointer-events:none; }
.wallpaper-scene>img.hidden { visibility:hidden; }
.wallpaper-scene>img.original { width:100%; object-fit:contain; }
.scene-head,.scene-composer { padding:14px; background:var(--panel,#f7f7f7); color:var(--text,#222); display:flex; justify-content:space-between; gap:12px; flex-shrink:0; }
.scene-head small { font-size:12px; }
.scene-messages { flex:1; min-height:0; overflow:auto; padding:16px; }
.scene-time { text-align:center; }
.scene-row { display:flex; gap:8px; margin:18px 0; }
.scene-avatar { width:32px; height:32px; display:grid; place-items:center; background:#c4dbcb; border-radius:8px; flex-shrink:0; color:#203d2b; }
.scene-row>div { max-width:78%; }
.scene-row p { margin:4px 0; padding:10px 13px; background:var(--bubble-other,#fff); color:var(--bubble-other-text,#111); border-radius:9px; }
.scene-row.mine { flex-direction:row-reverse; }
.scene-row.mine p { background:var(--bubble-mine,#95ec69); color:var(--bubble-mine-text,#111); }
.scene-time,.scene-row small { color:#18212b; text-shadow:0 1px 2px #fff; }
.labels-light .scene-time,.labels-light .scene-row small { color:#f8fafc; text-shadow:0 1px 3px #000; }
.scene-composer span { color:var(--accent,#1aad19); }
.scene-status { position:absolute; inset:40% 10% auto; background:var(--panel,#fff); padding:15px; text-align:center; }
.preview-controls { overflow:auto; padding:18px; display:flex; flex-direction:column; gap:14px; min-height:0; }
.preview-controls label { display:flex; flex-direction:column; gap:8px; }
.preview-controls select { width:100%; }
.preview-controls p,.preview-controls small { margin:0; font-size:12px; line-height:1.6; }
@media(max-width:700px) { .wallpaper-preview-modal.app-modal-medium { height:calc(var(--app-height,100dvh) - var(--safe-top,0px) - var(--safe-bottom,0px) - 12px); } .preview-layout { display:flex; flex-direction:column; overflow:auto; } .preview-stage { flex:0 0 50dvh; min-height:300px; padding:8px; } .preview-controls { overflow:visible; flex-shrink:0; padding:14px; } }
</style>
