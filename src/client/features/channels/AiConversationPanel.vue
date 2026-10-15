<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { DEFAULT_AI_CONVERSATION, type AiConversationConfig, type AiConversationStatus } from "@shared/aiConversation";
import { api } from "../../api";
const props = defineProps<{ channelId: number }>();
const config = ref<AiConversationConfig>(structuredClone(DEFAULT_AI_CONVERSATION));
const status = ref<AiConversationStatus>({state: "idle", messages: 0, contextChars: 0, elapsedSeconds: 0, reason: ""});
const characters = ref<{ id: number; displayName: string }[]>([]);
const canControl = ref(false);
const busy = ref(false);
const error = ref("");
const panelOpen = ref(false);
let active = true;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const stateNames = { idle: "未开始", running: "对话中", paused: "已暂停", stopped: "已终止", completed: "已完成", error: "发生错误" };
interface Snapshot { config: AiConversationConfig; status: AiConversationStatus; canControl: boolean; characters: {id:number;displayName:string}[] }
async function refresh(initial = false) {
  const version = revision;
  try {
    const result = await api<Snapshot>(`/api/channels/${props.channelId}/ai-conversation`);
    if (!active || version !== revision || busy.value) return;
    status.value = result.status; characters.value = result.characters; canControl.value = result.canControl;
    if (initial) config.value = result.config;
    const available = new Set(result.characters.map((character) => character.id));
    config.value.characterIds = config.value.characterIds.filter((id) => available.has(id));
  } catch (cause) { if (active) error.value = cause instanceof Error ? cause.message : "AI 对话状态加载失败"; }
  finally { if (active) timer = setTimeout(() => { if (document.visibilityState === "visible") void refresh(); else if (active) timer = setTimeout(() => { void refresh(); }, 10000); }, ["running", "paused"].includes(status.value.state) ? 3000 : 10000); }
}
async function control(action: "save" | "start" | "pause" | "resume" | "stop") {
  revision++; busy.value = true; error.value = "";
  try {
    const result = await api<Pick<Snapshot, "config" | "status">>(`/api/channels/${props.channelId}/ai-conversation`, { method: "POST", body: JSON.stringify({action, ...(["save", "start"].includes(action) ? { config: config.value } : {})}) });
    if (active) { config.value = result.config; status.value = result.status; }
  } catch (cause) { if (active) error.value = cause instanceof Error ? cause.message : "操作失败"; }
  finally { busy.value = false; }
}
onMounted(() => { void refresh(true); });
onUnmounted(() => { active = false; clearTimeout(timer); });
</script>
<template>
  <section v-if="canControl || config.enabled" class="ai-conversation-panel">
    <div class="ai-conversation-bar">
      <button type="button" class="mini-btn secondary" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">AI 自主对话 · {{stateNames[status.state]}}</button>
      <span v-if="config.enabled">{{status.messages}} / {{config.maxMessages}} 条 · {{status.elapsedSeconds}} 秒</span>
      <button v-if="canControl && status.state === 'running'" class="mini-btn" type="button" :disabled="busy" @click="control('pause')">暂停</button>
      <button v-if="canControl && status.state === 'paused'" class="mini-btn" type="button" :disabled="busy" @click="control('resume')">继续</button>
      <button v-if="canControl && ['running','paused'].includes(status.state)" class="mini-btn secondary" type="button" :disabled="busy" @click="control('stop')">终止</button>
    </div>
    <p v-if="error" role="alert" class="ai-conversation-error">{{error}}</p>
    <div v-if="panelOpen" class="ai-conversation-body">
      <p v-if="status.reason" role="status">{{status.reason}}</p>
      <p>累计上下文 {{status.contextChars.toLocaleString()}} / {{config.maxContextChars.toLocaleString()}} 字符。运行时间不含暂停，任一限额到达即结束；重启服务后须手动开始。</p>
      <form v-if="canControl" class="form-grid" @submit.prevent="control('save')">
        <fieldset :disabled="busy || ['running','paused'].includes(status.state)">
          <label class="check-row"><input v-model="config.enabled" type="checkbox" />将此频道设为 AI 强参与频道</label>
          <label>讨论主题<textarea v-model="config.topic" rows="2" maxlength="2000" placeholder="给角色一个开场话题，也可留空自由交流" /></label>
          <div class="ai-conversation-characters"><label v-for="character in characters" :key="character.id" class="check-row"><input v-model="config.characterIds" :value="character.id" type="checkbox" />{{character.displayName}}</label></div>
          <p v-if="characters.length < 2">请先在频道「添加成员」中邀请至少两个已启用的虚拟角色。</p>
          <div class="ai-conversation-limits">
            <label>发言条数上限<input v-model.number="config.maxMessages" type="number" min="1" max="500" required /></label>
            <label>累计上下文字符上限<input v-model.number="config.maxContextChars" type="number" min="1000" max="5000000" required /></label>
            <label>运行时间上限（秒）<input v-model.number="config.maxDurationSeconds" type="number" min="10" max="14400" required /></label>
            <label>每次读取最近几条<input v-model.number="config.contextMessages" type="number" min="1" max="100" required /></label>
            <label>发言间隔（秒）<input v-model.number="config.intervalSeconds" type="number" min="1" max="300" required /></label>
          </div>
          <small>上下文按每次请求的提示词和历史字符累计，取消或失败的请求也计入预算。每次回答最多 1024 token。</small>
          <div class="ai-conversation-bar"><button class="mini-btn" type="submit">保存频道设置</button><button class="primary-btn" type="button" :disabled="!config.enabled || config.characterIds.length < 2" @click="control('start')">开始自主对话</button></div>
        </fieldset>
      </form>
    </div>
  </section>
</template>
<style scoped>
.ai-conversation-panel { flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--line); background: var(--panel); }
.ai-conversation-bar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 12px; font-size:12px; }
.ai-conversation-error { margin: 0; padding: 8px 12px; color: var(--danger, #b91c1c); font-size: 12px; }
.ai-conversation-body { max-height:min(55vh,520px); overflow:auto; padding:12px; }
.ai-conversation-body p,.ai-conversation-body small {font-size:12px;color:var(--muted);line-height:1.5;}
fieldset { min-width:0; border:0; padding:0; display:grid; gap:10px; }
label { min-width:0; display:grid; gap:4px; }
.check-row { display:flex; align-items:center; gap:8px; }
.check-row input { width:16px; height:16px; margin:0; flex:0 0 auto; }
.ai-conversation-characters { display:flex; flex-wrap:wrap; gap:12px; }
.ai-conversation-limits {display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;}
input:not([type=checkbox]), textarea {width:100%;min-width:0;}
</style>
