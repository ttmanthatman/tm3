<script setup lang="ts">
import { computed } from "vue";
import type { MessageDTO } from "@shared/types";

const props = defineProps<{ message: MessageDTO }>();
const ended = computed(() => {
  if (props.message.sender.kind !== "virtual") return false;
  const payload = props.message.payload as { aiSessionEnded?: { at?: string } } | null;
  return typeof payload?.aiSessionEnded?.at === "string";
});
</script>

<template>
  <span v-if="ended" class="chain-ended-stamp ai-session-ended-stamp" role="img" aria-label="已结束">
    <img src="/images/chain-ended-stamp.webp" alt="" />
  </span>
</template>
