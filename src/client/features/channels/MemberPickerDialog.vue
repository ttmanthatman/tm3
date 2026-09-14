<script setup lang="ts">
import { CheckCircle2, X } from "lucide-vue-next";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import type { MemberPickerCandidate } from "./useChannelManagement";

defineProps<{
  title: string;
  busy: boolean;
  candidates: MemberPickerCandidate[];
  selectedIds: string[];
  candidateKey: (candidate: MemberPickerCandidate) => string;
  avatarText: (name: string) => string;
  isAccountOnline: (accountId?: number | null) => boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  toggle: [candidate: MemberPickerCandidate];
}>();
</script>

<template>
  <section class="modal-shell" @click.self="emit('close')">
    <form class="small-modal member-picker-modal" @submit.prevent="emit('submit')">
      <header class="modal-head">
        <strong>{{ title }}</strong>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="关闭添加成员">
          <X :size="20" />
        </button>
      </header>
      <div class="member-picker-body">
        <div v-if="busy" class="member-picker-empty">加载中...</div>
        <div v-else-if="candidates.length" class="member-picker-list">
          <button
            v-for="candidate in candidates"
            :key="candidateKey(candidate)"
            type="button"
            class="member-picker-row"
            :class="{ selected: selectedIds.includes(candidateKey(candidate)) }"
            @click="emit('toggle', candidate)"
          >
            <div class="avatar presence-avatar" :class="{ bot: candidate.kind === 'virtual' }">
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
              <small>{{
                candidate.kind === "virtual" ? "AI 角色" : `@${candidate.username}`
              }}</small>
            </span>
            <CheckCircle2 v-if="selectedIds.includes(candidateKey(candidate))" :size="18" />
          </button>
        </div>
        <div v-else class="member-picker-empty">没有可添加的人</div>
      </div>
      <div class="confirm-actions member-picker-actions">
        <button class="mini-btn secondary" type="button" :disabled="busy" @click="emit('close')">
          取消
        </button>
        <button class="primary-btn" type="submit" :disabled="busy || !selectedIds.length">
          {{ busy ? "添加中..." : `添加 ${selectedIds.length || ""}` }}
        </button>
      </div>
    </form>
  </section>
</template>
