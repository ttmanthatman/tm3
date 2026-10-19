import { computed, ref } from "vue";
import type { BibleAudioManifest, BibleAudioVersionManifest } from "@shared/bibleAudio";
import { authHeaders } from "../../api";

// 有声圣经 manifest 的应用级缓存：所有入口（工作区顶栏、消息长按菜单、卡拉OK条）
// 共用一份；服务端带 ETag，重新校验命中 304 时沿用内存副本。

const manifest = ref<BibleAudioManifest | null>(null);
const loading = ref(false);
const error = ref("");
let etag = "";
let loadPromise: Promise<BibleAudioManifest | null> | null = null;

export const bibleAudioManifest = manifest;
export const bibleAudioManifestLoading = loading;
export const bibleAudioManifestError = error;

export const bibleAudioDefaultVersion = computed<BibleAudioVersionManifest | null>(() => {
  const current = manifest.value;
  if (!current?.enabled) return null;
  return current.versions.find((version) => version.versionId === current.defaultVersionId) || current.versions[0] || null;
});

/** 功能对用户可见：服务端开关开启且存在可播放的版本 */
export const bibleAudioEnabled = computed(() => !!manifest.value?.enabled && !!bibleAudioDefaultVersion.value);

export async function loadBibleAudioManifest(force = false): Promise<BibleAudioManifest | null> {
  if (!force && manifest.value) return manifest.value;
  if (loadPromise) return loadPromise;
  loading.value = true;
  error.value = "";
  loadPromise = (async () => {
    try {
      const response = await fetch("/api/bible-audio/manifest", {
        headers: authHeaders(etag ? { "If-None-Match": etag } : {}),
        cache: "no-store"
      });
      if (response.status === 304 && manifest.value) return manifest.value;
      if (response.status === 401) {
        manifest.value = null;
        return null;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      etag = response.headers.get("etag") || "";
      const payload = (await response.json()) as BibleAudioManifest;
      manifest.value = payload;
      return payload;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "有声圣经信息加载失败";
      return manifest.value;
    } finally {
      loading.value = false;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export function resetBibleAudioManifest() {
  manifest.value = null;
  etag = "";
  error.value = "";
}
