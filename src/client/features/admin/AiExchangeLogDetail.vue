<script setup lang="ts">
import type { AdminLoginLogDTO } from "@shared/types";

defineProps<{ log: AdminLoginLogDTO }>();
</script>

<template>
  <section class="ai-exchange-log" aria-label="虚拟角色问答详情">
    <div class="ai-exchange-log-context">
      <b>{{ log.aiRoleName || log.aiRoleUsername || "虚拟角色" }}</b>
      <span v-if="log.aiRoleUsername">@{{ log.aiRoleUsername }}</span>
      <span v-if="log.isPrivateConversation" class="ai-exchange-log-private">私聊</span>
    </div>
    <dl>
      <div>
        <dt>提问 <small v-if="log.questionMessageId">#{{ log.questionMessageId }}</small></dt>
        <dd>{{ log.questionText || "（无文字内容）" }}</dd>
      </div>
      <div>
        <dt>回答 <small v-if="log.answerMessageId">#{{ log.answerMessageId }}</small></dt>
        <dd>{{ log.answerText || "（无文字内容）" }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.ai-exchange-log {
  min-width: 0;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 10px;
}
.ai-exchange-log-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.ai-exchange-log-context > span { opacity: 0.7; }
.ai-exchange-log-private {
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent, #3c8d63) 12%, transparent);
}
.ai-exchange-log dl { display: grid; gap: 10px; margin: 10px 0 0; }
.ai-exchange-log dl > div { min-width: 0; }
.ai-exchange-log dt { margin-bottom: 4px; font-size: 12px; font-weight: 600; }
.ai-exchange-log dt small { margin-left: 4px; opacity: 0.55; font-weight: normal; }
.ai-exchange-log dd {
  max-height: 300px;
  margin: 0;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
}
</style>
