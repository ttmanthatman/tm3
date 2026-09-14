<script setup lang="ts">
import { CheckCircle2, X } from "lucide-vue-next";
import AvatarImage from "../../components/ui/AvatarImage.vue";

type OwnerTransferCandidate = {
  accountId?: number;
  displayName: string;
  username?: string;
  avatarPath?: string | null;
};

defineProps<{
  channelName: string;
  busy: boolean;
  msg: string;
  candidates: OwnerTransferCandidate[];
  avatarText: (name: string) => string;
  isAccountOnline: (accountId?: number | null) => boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const successorId = defineModel<number | null>("successorId", { required: true });
</script>

<template>
  <section class="modal-shell" @click.self="emit('close')">
    <form class="small-modal member-picker-modal" @submit.prevent="emit('submit')">
      <header class="modal-head">
        <div>
          <strong>移交负责人并退出</strong>
          <small>{{ channelName }}</small>
        </div>
        <button
          class="icon-btn"
          type="button"
          :disabled="busy"
          @click="emit('close')"
          aria-label="关闭负责人移交"
        >
          <X :size="20" />
        </button>
      </header>
      <p class="owner-transfer-note">
        选择一位现有成员作为新的频道负责人。确认后，你会立即退出这个频道。
      </p>
      <div class="member-picker-body">
        <div v-if="candidates.length" class="member-picker-list">
          <button
            v-for="candidate in candidates"
            :key="candidate.accountId"
            type="button"
            class="member-picker-row"
            :class="{ selected: successorId === candidate.accountId }"
            :disabled="busy"
            @click="successorId = candidate.accountId || null"
          >
            <div class="avatar presence-avatar">
              <AvatarImage :path="candidate.avatarPath">
                <span>{{ avatarText(candidate.displayName) }}</span>
              </AvatarImage>
              <i
                v-if="candidate.accountId && isAccountOnline(candidate.accountId)"
                class="online-dot"
                aria-label="在线"
              ></i>
            </div>
            <span>
              <strong>{{ candidate.displayName }}</strong>
              <small>@{{ candidate.username }}</small>
            </span>
            <CheckCircle2 v-if="successorId === candidate.accountId" :size="18" />
          </button>
        </div>
        <div v-else class="member-picker-empty">还没有可接任的成员，请先添加成员。</div>
      </div>
      <p v-if="msg" class="form-error owner-transfer-error">{{ msg }}</p>
      <div class="confirm-actions member-picker-actions">
        <button class="mini-btn secondary" type="button" :disabled="busy" @click="emit('close')">
          取消
        </button>
        <button
          class="primary-btn owner-transfer-submit"
          type="submit"
          :disabled="busy || !successorId"
        >
          {{ busy ? "正在移交..." : "指定并退出" }}
        </button>
      </div>
    </form>
  </section>
</template>
