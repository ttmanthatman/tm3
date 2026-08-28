<script setup lang="ts">
import { computed, ref } from "vue";
import { BookOpen, CheckCircle2, CircleOff } from "lucide-vue-next";
import type { MessageDTO, SermonRequestPayloadDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";

const props = defineProps<{ message: MessageDTO }>();

const store = useChatStore();

const payload = computed<SermonRequestPayloadDTO>(() => {
  const raw = (props.message.payload || {}) as Partial<SermonRequestPayloadDTO>;
  return {
    note: typeof raw.note === "string" ? raw.note : "",
    status: raw.status === "approved" || raw.status === "rejected" ? raw.status : "pending",
    decidedByName: raw.decidedByName || null,
    decidedAt: raw.decidedAt || null,
    grantedUntil: raw.grantedUntil || null
  };
});

const isAdmin = computed(() => !!store.account?.isAdmin);
const isMine = computed(() => store.account?.actorId === props.message.sender.id);

const statusText = computed(() => {
  if (payload.value.status === "approved") {
    return payload.value.grantedUntil
      ? `已批准至 ${new Date(payload.value.grantedUntil).toLocaleString("zh-CN", { hour12: false })}`
      : "已批准（长期有效）";
  }
  if (payload.value.status === "rejected") return "已拒绝";
  return "待审批";
});

const busy = ref(false);
const errorMessage = ref("");
const durationMenuOpen = ref(false);

const durationOptions = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "permanent", label: "永久" }
] as const;

async function decide(approve: boolean, duration?: (typeof durationOptions)[number]["value"]) {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = "";
  durationMenuOpen.value = false;
  try {
    await api(`/api/messages/${props.message.id}/sermon-request/decide`, {
      method: "POST",
      body: JSON.stringify({ approve, ...(approve && duration ? { duration } : {}) })
    });
    // 卡片内容通过 message:updated 广播刷新。
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "操作失败，请重试";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="sermon-request-card" :class="`status-${payload.status}`" @click.stop>
    <div class="sermon-request-head">
      <span><BookOpen :size="17" /></span>
      <strong>讲道权限申请</strong>
      <em>{{ statusText }}</em>
    </div>
    <div class="sermon-request-body">
      <span class="sermon-request-from">{{ message.sender.displayName }}</span>
      <p v-if="payload.note" class="sermon-request-note">{{ payload.note }}</p>
      <p v-else class="sermon-request-note muted">申请人未填写留言</p>
    </div>
    <small v-if="payload.decidedByName" class="sermon-request-meta">由 {{ payload.decidedByName }} 处理</small>
    <small v-else-if="isMine && payload.status === 'pending'" class="sermon-request-meta">管理员批准后即可使用讲道台</small>
    <div v-if="isAdmin && payload.status === 'pending'" class="sermon-request-actions">
      <div class="sermon-request-approve">
        <button class="mini-btn" type="button" :disabled="busy" @click="durationMenuOpen = !durationMenuOpen">
          <CheckCircle2 :size="15" />批准
        </button>
        <div v-if="durationMenuOpen" class="sermon-duration-menu">
          <button
            v-for="option in durationOptions"
            :key="option.value"
            class="sermon-duration-option"
            type="button"
            :disabled="busy"
            @click="decide(true, option.value)"
          >{{ option.label }}</button>
        </div>
      </div>
      <button class="mini-btn danger-soft" type="button" :disabled="busy" @click="decide(false)"><CircleOff :size="15" />拒绝</button>
    </div>
    <p v-if="errorMessage" class="sermon-request-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
