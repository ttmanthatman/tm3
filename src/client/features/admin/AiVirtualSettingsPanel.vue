<script setup lang="ts">
import { computed, ref } from "vue";
import { AI_PROVIDERS, type AiProvider } from "@shared/aiProviders";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import type { useAiSettings } from "./useAiSettings";
const props = defineProps<{ tools: ReturnType<typeof useAiSettings> }>();
const draft = computed(() => props.tools.newVirtual.value);
const selectedId = ref<number | null>(null);
const creating = ref(false);
const section = ref("profile");
const busy = ref(false);
const error = ref("");
const selected = computed(() => props.tools.virtuals.value.find((item) => item.id === selectedId.value));
function provider(character: { config?: unknown }) {
  const generation = (character.config as { generation?: { provider?: AiProvider } } | undefined)?.generation;
  return generation?.provider || "";
}
function setProvider(character: { config?: unknown }, value: string) {
  const config = (character.config || {}) as Record<string, unknown>;
  character.config = { ...config, generation: { ...(config.generation as object || {}), provider: value } };
}
async function save() {
  busy.value = true; error.value = "";
  try {
    if (creating.value) { await props.tools.addVirtual(); creating.value = false; }
    else if (selected.value) await props.tools.saveVirtualCharacter(selected.value);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "角色保存失败"; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="ai-settings-subsection ai-settings-card">
    <div class="ai-settings-inline-actions"><div class="ai-section-title"><strong>虚拟角色</strong><small>先选择角色，再编辑档案、模型或记忆。</small></div><button type="button" class="mini-btn" @click="creating = true; selectedId = null; section = 'profile'">新增角色</button></div>
    <div class="ai-role-choices">
      <button v-for="character in tools.virtuals.value" :key="character.id" type="button" class="ai-role-choice" :class="{ active: selectedId === character.id }" @click="selectedId = character.id; creating = false; section = 'profile'">
        <span class="avatar"><AvatarImage :path="character.actor.avatarPath"><span>{{ character.actor.displayName.slice(0, 1) }}</span></AvatarImage></span>
        <span><strong>{{ character.actor.displayName }}</strong><small>@{{ character.actor.username }} · {{ tools.virtualEnabled(character) ? '启用' : '停用' }}</small></span><span>设置 ›</span>
      </button>
    </div>
    <p v-if="!selected && !creating" class="settings-note">选择一个角色查看详细设置。角色默认在综合频道，私聊由频道创建者邀请。</p>
    <div v-if="selected || creating" class="ai-role-editor">
      <nav class="ai-role-sections" aria-label="角色设置分类">
        <button v-for="tab in [{id:'profile',name:'身份与人设'},{id:'model',name:'模型'},{id:'memory',name:'记忆'},{id:'channels',name:'频道'}]" :key="tab.id" type="button" :class="{active:section === tab.id}" @click="section = tab.id">{{ tab.name }}</button>
      </nav>
      <div v-if="creating" class="ai-detail-fields">
        <template v-if="section === 'profile'"><label>ID<input v-model="draft.username" placeholder="ai_luna" /></label><label>昵称<input v-model="draft.displayName" placeholder="小月" /></label><label>人设<textarea v-model="draft.persona" rows="6" /></label><label class="check-row"><input v-model="draft.enabled" type="checkbox" />创建后启用</label></template>
        <template v-if="section === 'model'"><label>平台<select aria-label="平台" v-model="draft.provider"><option value="">跟随系统默认</option><option v-for="(item,id) in AI_PROVIDERS" :key="id" :value="id">{{item.name}}</option></select></label><label>模型 ID<input v-model="draft.model" placeholder="留空跟随平台默认模型" /></label><label class="check-row"><input v-model="draft.thinkingEnabled" type="checkbox" />开启思考（模型须支持）</label></template>
        <template v-if="section === 'memory'"><label>短期记忆<textarea v-model="draft.shortTermMemory" rows="4" /></label><label>中期记忆<textarea v-model="draft.midTermMemory" rows="4" /></label><label>长期记忆<textarea v-model="draft.longTermMemory" rows="4" /></label></template>
        <p v-if="section === 'channels'">默认只在综合频道。创建角色后，私聊频道的创建者可以通过「添加成员」邀请。</p>
      </div>
      <div v-else-if="selected" class="ai-detail-fields">
        <template v-if="section === 'profile'">
          <strong>@{{ selected.actor.username }}</strong>
          <label>头像<input type="file" accept="image/*" @change="tools.uploadVirtualAvatar(selected, $event).catch(cause => error = String(cause))" /></label>
          <label>昵称<input :value="selected.actor.displayName" @input="tools.setVirtualDisplayName(selected, ($event.target as HTMLInputElement).value)" /></label>
          <label>人设<textarea :value="tools.virtualPersona(selected)" rows="6" @input="tools.setVirtualPersona(selected, ($event.target as HTMLTextAreaElement).value)" /></label>
          <label class="check-row"><input :checked="tools.virtualEnabled(selected)" type="checkbox" @change="tools.setVirtualEnabled(selected, ($event.target as HTMLInputElement).checked)" />启用角色</label>
        </template>
        <template v-if="section === 'model'"><label>平台<select aria-label="平台" :value="provider(selected)" @change="setProvider(selected, ($event.target as HTMLSelectElement).value)"><option value="">跟随系统默认</option><option v-for="(item,id) in AI_PROVIDERS" :key="id" :value="id">{{item.name}}</option></select></label><label>模型 ID<input :value="tools.virtualModel(selected)" placeholder="留空跟随平台默认模型" @input="tools.setVirtualModel(selected, ($event.target as HTMLInputElement).value)" /></label><label class="check-row"><input :checked="tools.virtualThinkingEnabled(selected)" type="checkbox" @change="tools.setVirtualThinkingEnabled(selected, ($event.target as HTMLInputElement).checked)" />开启思考（模型须支持）</label></template>
        <template v-if="section === 'memory'"><label v-for="memory in [{id:'shortTerm' as const,name:'短期记忆'},{id:'midTerm' as const,name:'中期记忆'},{id:'longTerm' as const,name:'长期记忆'}]" :key="memory.id">{{memory.name}}<textarea :value="tools.virtualManualMemory(selected)[memory.id]" rows="4" @input="tools.setVirtualManualMemory(selected, memory.id, ($event.target as HTMLTextAreaElement).value)" /></label></template>
        <p v-if="section === 'channels'">默认只在综合频道。原先的频道铺开设置已重置，私聊请由频道创建者在「添加成员」中重新邀请。退出角色也在频道成员列表操作。</p>
      </div>
      <p v-if="error" role="alert" class="settings-note">{{ error }}</p>
      <button type="button" class="primary-btn" :disabled="busy || (creating && (!tools.newVirtual.value.username.trim() || !tools.newVirtual.value.displayName.trim()))" @click="save">{{busy ? '保存中…' : creating ? '创建角色' : '保存这个角色'}}</button>
    </div>
  </section>
</template>
