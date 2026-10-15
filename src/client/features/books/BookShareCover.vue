<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BookOpen } from "lucide-vue-next";
import { getToken } from "../../api";
const props = defineProps<{ bookId: number; title: string }>();
const failed = ref(false);
watch(() => props.bookId, () => { failed.value = false; });
const cover = computed(() => `/api/books/${props.bookId}/cover?token=${encodeURIComponent(getToken())}`);
</script>
<template>
  <img v-if="!failed" class="book-share-cover" :src="cover" :alt="`《${title}》封面`" loading="lazy" @error="failed = true" />
  <span v-else class="book-share-cover fallback" role="img" :aria-label="`《${title}》暂无封面`"><BookOpen :size="28" /></span>
</template>
<style scoped>
.book-share-cover { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 3px; box-shadow: 1px 2px 4px #49331820; }
.fallback { display: grid; place-items: center; background: #e2dbc8; color: #806c50; }
</style>
