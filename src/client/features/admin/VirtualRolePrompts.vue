<script setup lang="ts">
defineProps<{
  disabled: boolean;
  idPrefix: string;
  systemPrompt: string;
  activationJudgePrompt: string;
  questionAssistant: boolean;
  activationDurationMinutes: number;
  contextTurnLimit: number;
  contextWindowMinutes: number;
}>();

defineEmits<{
  "update:systemPrompt": [value: string];
  "update:activationJudgePrompt": [value: string];
  "update:activationDurationMinutes": [value: number];
  "update:contextTurnLimit": [value: number];
  "update:contextWindowMinutes": [value: number];
}>();
</script>

<template>
  <fieldset class="virtual-role-prompts" :disabled="disabled" :aria-busy="disabled">
    <label :for="`${idPrefix}-system-prompt`">底层系统提示</label>
    <textarea
      :id="`${idPrefix}-system-prompt`"
      :value="systemPrompt"
      rows="10"
      maxlength="12000"
      placeholder="附加的系统指令，可留空"
      @input="$emit('update:systemPrompt', ($event.target as HTMLTextAreaElement).value)"
    />
    <small>这是实际发给模型的系统指令。角色人设、记忆和当前对话会另行加入。</small>
    <template v-if="questionAssistant">
      <label :for="`${idPrefix}-activation-prompt`">激活判断提示</label>
      <textarea
        :id="`${idPrefix}-activation-prompt`"
        :value="activationJudgePrompt"
        rows="5"
        maxlength="6000"
        @input="$emit('update:activationJudgePrompt', ($event.target as HTMLTextAreaElement).value)"
      />
      <small>在激活保持时间内，判断后续普通发言是否仍需这个角色回答。</small>
      <div class="virtual-role-prompts__numbers">
        <label :for="`${idPrefix}-activation-duration`">
          激活保持时间（分钟）
          <input
            :id="`${idPrefix}-activation-duration`"
            :value="activationDurationMinutes"
            type="number"
            min="1"
            max="1440"
            step="1"
            @change="$emit('update:activationDurationMinutes', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <label :for="`${idPrefix}-context-turns`">
          回答参考轮数
          <input
            :id="`${idPrefix}-context-turns`"
            :value="contextTurnLimit"
            type="number"
            min="1"
            max="50"
            step="1"
            @change="$emit('update:contextTurnLimit', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <label :for="`${idPrefix}-context-window`">
          回答参考时间（分钟）
          <input
            :id="`${idPrefix}-context-window`"
            :value="contextWindowMinutes"
            type="number"
            min="1"
            max="1440"
            step="1"
            @change="$emit('update:contextWindowMinutes', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>
      <small>保持时间决定本次激活多久后结束；参考轮数和时间只决定回答时读取多少历史消息。也可 @角色 说“安静”“闭嘴”“你去买酱油吧”“你去跑步吧”或“你去睡觉吧”提前结束。</small>
    </template>
  </fieldset>
</template>

<style scoped>
.virtual-role-prompts { display: grid; gap: 8px; min-width: 0; margin: 16px 0 0; padding: 0; border: 0; }
.virtual-role-prompts textarea { box-sizing: border-box; min-width: 0; width: 100%; resize: vertical; }
.virtual-role-prompts small { color: var(--text-muted, #64748b); line-height: 1.5; overflow-wrap: anywhere; }
.virtual-role-prompts__numbers { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.virtual-role-prompts__numbers label { display: grid; gap: 6px; min-width: 0; }
.virtual-role-prompts__numbers input { box-sizing: border-box; width: 100%; min-width: 0; }
@media (max-width: 420px) { .virtual-role-prompts__numbers { grid-template-columns: 1fr; } }
</style>
