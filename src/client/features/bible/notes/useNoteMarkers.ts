import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { api } from "../../../api";
export function useNoteMarkers(translation: Ref<string>, bookCode: () => string, chapters: Ref<number[]>) {
  const markers = ref<Record<number, number[]>>({});
  const error = ref("");
  let sequence = 0;
  async function load() {
    const request = ++sequence;
    markers.value = {};
    error.value = "";
    const results = await Promise.allSettled(chapters.value.map(async (chapter) => {
      const query = new URLSearchParams({ translation: translation.value, bookCode: bookCode(), chapter: String(chapter) });
      const result = await api<{ verses: number[] }>(`/api/bible/notes/markers?${query}`);
      return { chapter, verses: result.verses };
    }));
    if (request !== sequence) return;
    for (const result of results) {
      if (result.status === "fulfilled") markers.value[result.value.chapter] = result.value.verses;
      else error.value = "笔记标记暂未加载，可重试";
    }
  }
  watch(() => [translation.value, bookCode(), chapters.value.join(",")], () => { void load(); }, { immediate: true });
  onMounted(() => window.addEventListener("bible-notes-changed", load));
  onBeforeUnmount(() => { sequence++; window.removeEventListener("bible-notes-changed", load); });
  return { markers, error, reload: load };
}
