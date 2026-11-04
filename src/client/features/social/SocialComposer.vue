<script setup lang="ts">
import { ref, watch } from "vue";
import { pollSchema, bottleTextSchema } from "@shared/social";
import { api } from "../../api";
import AppModal from "../../components/ui/AppModal.vue";
const props = defineProps<{ mode: "poll" | "bottle" | null; channelId: number }>();
const emit = defineEmits<{ close: []; requestBottleMotion: [] }>();
const question = ref("");
const options = ref(["", ""]);
const text = ref("");
const submitBusy = ref(false);
const error = ref("");
let requestId = crypto.randomUUID();
watch(() => props.mode, () => { error.value = ""; requestId = crypto.randomUUID(); });
async function submit() {
  if (submitBusy.value) return;
  const poll = pollSchema.safeParse({ kind: "poll", question: question.value, options: options.value });
  const bottle = bottleTextSchema.safeParse(text.value);
  if (props.mode === "poll" ? !poll.success : !bottle.success) { error.value = props.mode === "poll" ? "请填写问题和 2–12 个不重复的选项" : "请填写 1–2000 字的瓶中信"; return; }
  if (props.mode === "bottle") emit("requestBottleMotion");
  submitBusy.value = true; error.value = "";
  try {
    if (props.mode === "poll" && poll.success) await api(`/api/channels/${props.channelId}/polls`, { method: "POST", body: JSON.stringify({ poll: poll.data, requestId }) });
    else if (bottle.success) await api(`/api/channels/${props.channelId}/bottles`, { method: "POST", body: JSON.stringify({ text: bottle.data }) });
    question.value = ""; options.value = ["", ""]; text.value = ""; emit("close");
  } catch (e) { error.value = e instanceof Error ? e.message : "发送失败，请重试"; }
  finally { submitBusy.value = false; }
}
</script>
<template>
  <Teleport defer to=".app-shell">
  <AppModal class="social-dialog" :open="!!mode" :title="mode === 'poll' ? '发起投票' : '扔一个漂流瓶'" :busy="submitBusy" @close="emit('close')">
    <form class="social-form" @submit.prevent="submit">
      <template v-if="mode === 'poll'">
        <label>问题<input v-model="question" maxlength="200" required placeholder="想听听大家的选择…" /></label>
        <label v-for="(_, index) in options" :key="index">选项 {{ index + 1 }}<span class="option-input"><input v-model="options[index]" maxlength="100" required /><button v-if="options.length > 2" type="button" :aria-label="`删除选项 ${index + 1}`" @click="options.splice(index, 1)">删除</button></span></label>
        <button v-if="options.length < 12" type="button" class="mini-btn" @click="options.push('')">＋ 添加选项</button>
      </template>
      <label v-else>匿名瓶中信<textarea v-model="text" rows="6" maxlength="2000" required placeholder="留一段话，等一个有缘人。"></textarea><small>不署名，捡起后仅可阅读一次。岸边最多容纳 12 个不同外观的瓶子。</small></label>
      <p v-if="error" role="alert">{{ error }}</p>
      <button class="primary-btn" type="submit" :disabled="submitBusy">{{ submitBusy ? '发送中…' : mode === 'poll' ? '发起投票' : '扔出去' }}</button>
    </form>
  </AppModal>
  </Teleport>
</template>
<style scoped>
.social-dialog { z-index: 160; }
.social-form { display: grid; gap: 12px; padding: 16px; max-height: 70dvh; overflow-y: auto; }
label { display: grid; gap: 6px; }
input, textarea { width: 100%; min-width: 0; box-sizing: border-box; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--text); font: inherit; }
.option-input { display: flex; gap: 8px; }
small { color: var(--muted); line-height: 1.6; }
</style>
