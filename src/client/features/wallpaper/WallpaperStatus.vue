<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useChatStore } from "../../store";
const store = useChatStore();
const notice = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => store.wallpaper?.version, (next, previous) => {
  if (timer) clearTimeout(timer);
  notice.value = "";
  if (!next || !previous || next === previous || store.wallpaper?.preference.mode !== "follow") return;
  notice.value = `${store.wallpaper.updatedBy} 更换了大家的壁纸`;
  timer = setTimeout(() => { notice.value = ""; }, 5000);
});
onBeforeUnmount(() => { if (timer) clearTimeout(timer); });
</script>
<template><div v-if="notice" class="wallpaper-notice" role="status">{{ notice }}</div></template>
<style scoped>
.wallpaper-notice { position:fixed; z-index:200; bottom:calc(90px + var(--safe-bottom,0px)); left:50%; transform:translateX(-50%); max-width:90vw; padding:12px 18px; border-radius:12px; background:var(--panel,#fff); color:var(--text,#222); box-shadow:0 3px 20px #0002; pointer-events:none; }
</style>
