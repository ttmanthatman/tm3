import { getCurrentScope, onScopeDispose, ref } from "vue";
import { GRACE_IMAGE_LIMIT } from "@shared/grace";
import { STORY_LIMITS } from "@shared/stories";
import { prepareStoryPhoto } from "../stories/storyClient";

export function useGracePhotos(channelId: () => number | null, existingCount: () => number, setError: (message: string) => void) {
  const photos = ref<Array<{ file: File; url: string }>>([]);
  const photoBusy = ref(false);
  let controller: AbortController | null = null;

  function remove(index: number) {
    const photo = photos.value[index];
    if (!photo) return;
    URL.revokeObjectURL(photo.url);
    photos.value.splice(index, 1);
  }
  function clear() {
    controller?.abort();
    controller = null;
    photoBusy.value = false;
    for (const photo of photos.value) URL.revokeObjectURL(photo.url);
    photos.value = [];
  }
  async function pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length || photoBusy.value) return;
    const channel = channelId();
    if (!channel) { setError("请先进入一个频道再记录恩典"); return; }
    if (files.length + photos.value.length + existingCount() > GRACE_IMAGE_LIMIT) { setError("最多附上 9 张照片"); return; }
    if (files.some((file) => file.size > STORY_LIMITS.fileBytes || (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)))) { setError("请选择 10 MB 以内的照片"); return; }
    setError("");
    photoBusy.value = true;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 180_000);
    try {
      const prepared: File[] = [];
      for (const file of files) prepared.push(await prepareStoryPhoto(file, request.signal, { url: "/api/grace/prepare-image", data: { channelId: channel } }));
      if (!request.signal.aborted) photos.value.push(...prepared.map((file) => ({ file, url: URL.createObjectURL(file) })));
    } catch (error) {
      if (controller === request) setError(request.signal.aborted ? "照片处理超时，请重新选择" : error instanceof Error ? error.message : "照片处理失败");
    } finally {
      clearTimeout(timeout);
      if (controller === request) { controller = null; photoBusy.value = false; }
    }
  }
  if (getCurrentScope()) onScopeDispose(clear);
  return { photos, photoBusy, pick, remove, clear };
}
