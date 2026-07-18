<script setup lang="ts">
import { onMounted } from "vue";
import { CircleOff, FilePlus, Trash2 } from "lucide-vue-next";
import { useChatStore } from "../../store";
import { useAdminAccounts } from "./useAdminAccounts";

const emit = defineEmits<{
  message: [message: string];
}>();

const store = useChatStore();
const {
  accounts,
  accountEdits,
  newUser,
  loading,
  error,
  loadAccounts,
  addUser,
  updateAccount,
  canDeleteAccount,
  deleteAccount,
  uploadAccountAvatar
} = useAdminAccounts({
  currentAccountId: () => store.account?.id ?? null,
  onCurrentAccountUpdated: (account) => {
    store.account = account;
  },
  onMessage: (message) => emit("message", message)
});

function avatarText(name: string) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function avatarUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/avatars/${path}`;
}

onMounted(loadAccounts);
</script>

<template>
  <div v-if="loading" class="admin-page-state" role="status"><span class="loading-dot"></span>正在加载...</div>
  <div v-else-if="error" class="admin-page-state error" role="alert">
    <CircleOff :size="20" />
    <span>{{ error }}</span>
    <button class="mini-btn secondary" @click="loadAccounts">重试</button>
  </div>
  <section v-else class="form-grid admin-page-section">
    <label>新增用户</label>
    <input v-model="newUser.username" placeholder="username" />
    <input v-model="newUser.displayName" placeholder="显示名" />
    <input v-model="newUser.password" minlength="10" maxlength="128" placeholder="初始密码（至少 10 位）" type="password" />
    <button class="primary-btn" @click="addUser"><FilePlus :size="16" />添加用户</button>
    <div class="user-admin-list">
      <article v-for="account in accounts" :key="account.id" class="user-admin-row" data-testid="admin-account-row" :data-account-username="account.username">
        <label class="avatar upload-avatar-trigger" :aria-label="`上传 ${account.displayName} 的头像`" title="点击上传头像">
          <img v-if="avatarUrl(account.avatarPath)" :src="avatarUrl(account.avatarPath)" alt="" />
          <span v-else>{{ avatarText(account.displayName) }}</span>
          <input class="hidden" type="file" accept="image/*" @change="uploadAccountAvatar(account, $event)" />
        </label>
        <div class="user-admin-main">
          <strong>@{{ account.username }}</strong>
          <div class="user-admin-edit-grid">
            <div class="user-admin-fields">
              <input v-model="accountEdits[account.id].displayName" placeholder="昵称" />
              <input v-model="accountEdits[account.id].password" minlength="10" maxlength="128" placeholder="重置密码，留空不改（至少 10 位）" type="password" />
            </div>
            <div class="user-admin-flags">
              <label class="check-row"><input v-model="accountEdits[account.id].isAdmin" type="checkbox" /> 管理员</label>
              <label class="check-row"><input v-model="accountEdits[account.id].canPinMessages" type="checkbox" /> 户部尚书（默认频道置顶）</label>
            </div>
          </div>
        </div>
        <div class="user-admin-actions">
          <button class="mini-btn" @click="updateAccount(account)">保存</button>
          <button class="mini-btn danger-action" :disabled="!canDeleteAccount(account)" @click="deleteAccount(account)"><Trash2 :size="15" />删除</button>
        </div>
      </article>
    </div>
  </section>
</template>
