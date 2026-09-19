<script setup lang="ts">
import { ref, watch } from "vue";
import { BookOpen } from "lucide-vue-next";
import { storyTitle, type StoryAuthorDTO } from "@shared/stories";
import { api } from "../../api";
const props = defineProps<{ actorId: number }>();
const emit = defineEmits<{ open: [actorId: number] }>();
const author = ref<StoryAuthorDTO | null>(null);
const failed = ref(false);
watch(() => props.actorId, async (actorId, _, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  author.value = null;
  failed.value = false;
  try {
    const result = await api<{ author: StoryAuthorDTO }>(`/api/stories/authors/${actorId}`, { signal: controller.signal });
    if (!controller.signal.aborted) author.value = result.author;
  } catch { if (!controller.signal.aborted) failed.value = true; }
}, { immediate: true });
</script>

<template>
  <button class="mini-btn story-entry" :disabled="!author" @click="emit('open', actorId)">
    <BookOpen :size="15" />{{ failed ? "故事暂不可见" : author ? storyTitle(author.gender, author.own) : "正在读取故事…" }}
  </button>
</template>

<style scoped>
.story-entry { color: #50694e; background: #eef1e9; width: 100%; margin-top: 7px; min-height: 32px; }
</style>
