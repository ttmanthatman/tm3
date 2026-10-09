<script setup lang="ts">
import { computed } from "vue";
import type { BookReaderPresenceDTO } from "@shared/types";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import { useChatStore } from "../../store";

const props = defineProps<{ bookTitle: string; readers: BookReaderPresenceDTO[] }>();
const store = useChatStore();
const people = computed(() => props.readers
  .filter((reader) => reader.bookTitle === props.bookTitle && reader.accountId !== store.account?.id)
  .map((reader) => ({ ...reader, avatarPath: store.online.find((person) => person.accountId === reader.accountId)?.avatarPath })));
</script>

<template>
  <div v-if="people.length" class="book-reader-presence" aria-label="正在共读">
    <span>正在阅读</span>
    <span v-for="person in people" :key="person.accountId" class="book-reader-person">
      <span class="book-reader-avatar"><AvatarImage :path="person.avatarPath"><span>{{ Array.from(person.displayName)[0] }}</span></AvatarImage></span>
      <span>{{ person.displayName }}</span>
    </span>
  </div>
</template>

<style scoped>
.book-reader-presence { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 12px; font-size: 12px; color: #8a765c; }
.book-reader-person { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; overflow-wrap: anywhere; }
.book-reader-avatar { width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; color: #604b32; background: #e8ddc8; }
.book-reader-avatar :deep(img) { width: 100%; height: 100%; object-fit: cover; }
</style>
