<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { defaultWallpaper, effectiveWallpaper, type WallpaperConfig, type WallpaperImage, type WallpaperState } from "@shared/wallpaper";
import { api } from "../../api";
import { useChatStore } from "../../store";
import WallpaperPreview from "./WallpaperPreview.vue";
const store = useChatStore();
const root = ref<HTMLElement | null>(null);
const previewTheme = ref<Record<string, string>>({});
const busy = ref(false);
const error = ref("");
const notice = ref("");
const mine = ref(false);
const draft = ref<WallpaperConfig | null>(null);
const previewVersion = ref("");
const images = computed(() => (store.wallpaper?.images || []).filter(image => !image.withdrawn && !image.banned && (!mine.value || image.contributorId === store.account?.id)));
const current = computed(() => effectiveWallpaper(store.wallpaper, store.appearance));
const mode = computed(() => store.wallpaper?.preference.mode || "follow");
function preview(image?: WallpaperImage) {
  if (root.value) {
    const style = getComputedStyle(root.value);
    previewTheme.value = Object.fromEntries(["--panel", "--text", "--bg", "--chat-bg", "--line", "--accent", "--bubble-other", "--bubble-other-text", "--bubble-mine", "--bubble-mine-text"].map(key => [key, style.getPropertyValue(key)]));
  }
  error.value = "";
  draft.value = image ? { ...defaultWallpaper, wallpaperPath: image.fileName } : { ...current.value };
  previewVersion.value = store.wallpaper?.version || "legacy";
}
async function preference(next: "follow" | "off") { await save("/api/wallpapers/preference", "PATCH", { mode: next }); }
async function save(url: string, method: string, body: unknown) {
  busy.value = true; error.value = ""; notice.value = "";
  try {
    await api<WallpaperState>(url, { method, body: JSON.stringify(body) });
    await store.loadWallpaper();
    if (store.wallpaperError) throw new Error(store.wallpaperError);
    draft.value = null; notice.value = "壁纸设置已保存";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "保存失败，请重试";
    await store.loadWallpaper();
    // Preserve all draft edits; a second explicit click acknowledges the newer shared version.
    if (error.value.includes("刚刚更新")) previewVersion.value = store.wallpaper?.version || previewVersion.value;
  } finally { busy.value = false; }
}
async function apply(target: "personal" | "shared") {
  if (!draft.value) return;
  if (target === "shared") await save("/api/wallpapers/shared", "PUT", { config: draft.value, version: previewVersion.value });
  else await save("/api/wallpapers/preference", "PATCH", { mode: "personal", config: draft.value });
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  busy.value = true; error.value = "";
  try {
    const data = new FormData(); data.append("file", file);
    const result = await api<{ image: WallpaperImage }>("/api/wallpapers", { method: "POST", body: data });
    await store.loadWallpaper(); preview(result.image); notice.value = "已贡献到壁纸库，尚未更改任何人的壁纸";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "上传失败"; }
  finally { busy.value = false; input.value = ""; }
}
async function withdraw(image: WallpaperImage) {
  const admin = !!store.account?.isAdmin;
  if (!confirm(admin ? "下架这张壁纸？正在使用它的成员将回到主题底色。" : "撤下这张壁纸？已有使用会保留，但大家不能再新选它。")) return;
  busy.value = true; error.value = "";
  try { await api(`/api/wallpapers/${image.id}`, { method: "DELETE" }); await store.loadWallpaper(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "撤下失败"; }
  finally { busy.value = false; }
}
onMounted(() => { void store.loadWallpaper(); });
</script>
<template>
  <section ref="root" class="wallpaper-panel">
    <div class="wallpaper-current">
      <img v-if="current.wallpaperPath" :src="`/backgrounds/${encodeURIComponent(current.wallpaperPath)}`" alt="正在使用的壁纸" />
      <div><b>当前：{{ { follow:'跟随大家', personal:'使用自己的', off:'不使用壁纸' }[mode] }}</b><p>{{ store.wallpaper?.updatedBy || '管理员' }} 设置了大家的壁纸</p><button v-if="current.wallpaperPath" class="mini-btn secondary" :disabled="busy" @click="preview()">预览当前壁纸</button></div>
    </div>
    <div class="wallpaper-actions"><button class="mini-btn secondary" :disabled="busy || mode === 'follow'" @click="preference('follow')">跟随大家</button><button class="mini-btn secondary" :disabled="busy || mode === 'off'" @click="preference('off')">不使用壁纸</button><label class="primary-btn" :class="{ disabled: busy }">{{ busy ? '处理中…' : '上传贡献壁纸' }}<input class="hidden" type="file" accept="image/*" :disabled="busy" @change="upload" /></label></div>
    <p class="settings-note">支持最大 15 MB 的图片。上传加入共享图库；选择图片预览后，再决定仅自己使用或设为大家壁纸。</p>
    <p v-if="error || store.wallpaperError" class="error" role="alert">{{ error || store.wallpaperError }} <button class="mini-btn secondary" @click="store.loadWallpaper()">重新加载</button></p><p v-if="notice" role="status">{{ notice }}</p>
    <div class="wallpaper-actions"><button class="mini-btn secondary" :aria-pressed="!mine" @click="mine = false">全部</button><button class="mini-btn secondary" :aria-pressed="mine" @click="mine = true">我贡献的</button></div>
    <div class="wallpaper-library"><article v-for="image in images" :key="image.id"><button class="wallpaper-card" :disabled="busy" @click="preview(image)"><img :src="`/backgrounds/${encodeURIComponent(image.fileName)}`" alt="点击预览壁纸" loading="lazy" /><span>{{ image.contributorName }} 贡献</span><small><template v-if="image.fileName === store.wallpaper?.shared.wallpaperPath">大家正在用 </template><template v-if="image.fileName === current.wallpaperPath">我正在用</template></small></button><button v-if="image.contributorId === store.account?.id || (store.account?.isAdmin && image.contributorId !== 0)" class="mini-btn secondary" :disabled="busy" @click="withdraw(image)">{{ store.account?.isAdmin ? '下架' : '撤下' }}</button></article></div>
    <p v-if="!images.length && !store.wallpaperError" class="settings-note">{{ mine ? '你还没有贡献壁纸。' : '还没有壁纸，贡献第一张吧。' }}</p>
    <Teleport to="body"><WallpaperPreview v-if="draft" v-model="draft" :style="previewTheme" :busy="busy" :error="error" :shared-by="store.wallpaper?.updatedBy || ''" @close="draft = null" @apply="apply" /></Teleport>
  </section>
</template>
<style scoped>
.wallpaper-panel { display:grid; gap:16px; padding:18px; min-width:0; }
.wallpaper-current { display:flex; gap:16px; align-items:center; }
.wallpaper-current img { width:100px; height:80px; object-fit:cover; border-radius:10px; }
.wallpaper-current p { font-size:12px; }
.wallpaper-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.wallpaper-library { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:14px; }
.wallpaper-library article { min-width:0; }
.wallpaper-card { width:100%; display:flex; flex-direction:column; gap:6px; padding:0 0 10px; border:1px solid var(--line,#ddd); border-radius:10px; overflow:hidden; background:var(--panel,#fff); color:var(--text,#222); text-align:left; }
.wallpaper-card img { width:100%; height:130px; object-fit:cover; }
.wallpaper-card span,.wallpaper-card small { padding:0 10px; overflow-wrap:anywhere; }
.wallpaper-card small { color:var(--accent,#1aad19); }
@media(max-width:400px) { .wallpaper-panel { padding:10px; } .wallpaper-library { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
