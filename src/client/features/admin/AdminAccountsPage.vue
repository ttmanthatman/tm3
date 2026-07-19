<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  CircleOff,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-vue-next";
import type { AccountDTO } from "@shared/types";
import { useChatStore } from "../../store";
import {
  type NewAdminAccountField,
  useAdminAccounts
} from "./useAdminAccounts";

const emit = defineEmits<{
  message: [message: string];
}>();

const store = useChatStore();
const createMode = ref(false);
const mobileDetailOpen = ref(false);
const passwordOpen = ref(false);
const newPassword = ref("");
const confirmPassword = ref("");
const usernameInput = ref<HTMLInputElement | null>(null);
const displayNameInput = ref<HTMLInputElement | null>(null);
const passwordInput = ref<HTMLInputElement | null>(null);

const {
  accounts,
  filteredAccounts,
  selectedAccount,
  selectedAccountId,
  accountEdits,
  newUser,
  query,
  loading,
  error,
  creating,
  createError,
  createFieldErrors,
  savingAccountId,
  saveError,
  deletingAccountId,
  deleteError,
  avatarUploadingAccountId,
  avatarError,
  resettingPasswordAccountId,
  passwordError,
  passwordFieldErrors,
  loadAccounts,
  selectAccount,
  clearMessage,
  resetCreateForm,
  addUser,
  updateAccount,
  canDeleteAccount,
  deleteDisabledReason,
  adminPermissionLocked,
  deleteAccount,
  resetPassword,
  uploadAccountAvatar
} = useAdminAccounts({
  currentAccountId: () => store.account?.id ?? null,
  onCurrentAccountUpdated: (account) => {
    store.account = account;
  },
  onMessage: (nextMessage) => emit("message", nextMessage)
});

function avatarText(name: string) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function avatarUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/avatars/${path}`;
}

function openAccount(account: AccountDTO) {
  clearMessage();
  createMode.value = false;
  mobileDetailOpen.value = true;
  selectAccount(account.id);
}

function beginCreate() {
  clearMessage();
  resetCreateForm();
  createMode.value = true;
  mobileDetailOpen.value = true;
  passwordOpen.value = false;
  void nextTick(() => usernameInput.value?.focus());
}

function closeDetail() {
  mobileDetailOpen.value = false;
}

function cancelCreate() {
  clearMessage();
  resetCreateForm();
  createMode.value = false;
  mobileDetailOpen.value = false;
}

function clearCreateFieldError(field: NewAdminAccountField) {
  delete createFieldErrors.value[field];
  createError.value = "";
}

async function handleCreate() {
  const created = await addUser();
  if (created) {
    createMode.value = false;
    mobileDetailOpen.value = true;
    return;
  }
  const firstInvalid = (["username", "displayName", "password"] as const).find(
    (field) => createFieldErrors.value[field]
  );
  if (!firstInvalid) return;
  await nextTick();
  const inputs = {
    username: usernameInput.value,
    displayName: displayNameInput.value,
    password: passwordInput.value
  };
  inputs[firstInvalid]?.focus();
}

function togglePasswordReset() {
  passwordOpen.value = !passwordOpen.value;
  newPassword.value = "";
  confirmPassword.value = "";
}

async function handlePasswordReset() {
  if (!selectedAccount.value) return;
  const reset = await resetPassword(
    selectedAccount.value,
    newPassword.value,
    confirmPassword.value
  );
  if (reset) {
    newPassword.value = "";
    confirmPassword.value = "";
    passwordOpen.value = false;
  }
}

async function handleDelete(account: AccountDTO) {
  const deleted = await deleteAccount(account);
  if (deleted && !selectedAccountId.value) mobileDetailOpen.value = false;
}

watch(selectedAccountId, () => {
  passwordOpen.value = false;
  newPassword.value = "";
  confirmPassword.value = "";
});

onMounted(loadAccounts);
</script>

<template>
  <div v-if="loading" class="admin-page-state" role="status">
    <span class="loading-dot"></span>正在加载用户...
  </div>
  <div v-else-if="error" class="admin-page-state error" role="alert">
    <CircleOff :size="20" />
    <span>{{ error }}</span>
    <button type="button" class="mini-btn secondary" @click="loadAccounts">重试</button>
  </div>
  <section
    v-else
    class="admin-accounts-page"
    :class="{ 'mobile-detail-open': mobileDetailOpen }"
    aria-label="用户与权限管理"
  >
    <header class="admin-accounts-toolbar">
      <div class="admin-accounts-title">
        <strong>用户与权限</strong>
        <span>{{ accounts.length }} 位用户</span>
      </div>
      <label class="admin-account-search">
        <Search :size="16" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="搜索用户……" aria-label="搜索用户" />
      </label>
      <button type="button" class="primary-btn admin-account-add" @click="beginCreate">
        <Plus :size="17" />新增用户
      </button>
    </header>

    <div class="admin-accounts-workspace">
      <aside class="admin-account-list-pane" aria-label="用户列表">
        <div class="admin-account-list" role="list">
          <button
            v-for="account in filteredAccounts"
            :key="account.id"
            type="button"
            class="admin-account-list-row"
            :class="{ active: !createMode && selectedAccountId === account.id }"
            data-testid="admin-account-row"
            :data-account-username="account.username"
            :aria-current="!createMode && selectedAccountId === account.id ? 'true' : undefined"
            @click="openAccount(account)"
          >
            <span class="avatar admin-account-list-avatar">
              <img v-if="avatarUrl(account.avatarPath)" :src="avatarUrl(account.avatarPath)" alt="" />
              <span v-else>{{ avatarText(account.displayName) }}</span>
            </span>
            <span class="admin-account-list-copy">
              <span class="admin-account-list-name">
                <b>{{ account.displayName }}</b>
                <em v-if="account.id === store.account?.id">当前账号</em>
              </span>
              <small>@{{ account.username }}</small>
            </span>
            <span class="admin-account-badges">
              <em v-if="account.isAdmin">管理员</em>
              <em v-if="account.canPinMessages">置顶</em>
            </span>
            <ChevronRight class="admin-account-list-chevron" :size="17" aria-hidden="true" />
          </button>
          <p v-if="!filteredAccounts.length" class="admin-account-empty">
            {{ query.trim() ? "没有匹配的用户" : "还没有用户" }}
          </p>
        </div>
      </aside>

      <main class="admin-account-detail-pane">
        <button type="button" class="mobile-only admin-account-mobile-back" @click="closeDetail">
          <ArrowLeft :size="18" />返回用户列表
        </button>

        <form
          v-if="createMode"
          class="admin-account-create-view"
          aria-label="创建新用户"
          novalidate
          @submit.prevent="handleCreate"
        >
          <div class="admin-account-detail-heading create">
            <span class="admin-account-detail-icon"><Plus :size="23" /></span>
            <div>
              <strong>创建新用户</strong>
              <small>创建后会立即加入所有公共频道。</small>
            </div>
          </div>

          <section class="admin-account-section">
            <div class="admin-account-section-heading">
              <b>账号资料</b>
              <small>用户名创建后不可修改。</small>
            </div>
            <label class="admin-account-field">
              <span>用户名</span>
              <input
                ref="usernameInput"
                v-model="newUser.username"
                type="text"
                autocomplete="off"
                maxlength="40"
                placeholder="例如 xiaoma"
                :aria-invalid="Boolean(createFieldErrors.username)"
                aria-describedby="new-user-username-rule new-user-username-error"
                @input="clearCreateFieldError('username')"
              />
              <small id="new-user-username-rule">必填，2–40 位；仅限英文字母、数字、下划线、点和短横线。</small>
              <em v-if="createFieldErrors.username" id="new-user-username-error" class="admin-field-error" role="alert">
                {{ createFieldErrors.username }}
              </em>
            </label>
            <label class="admin-account-field">
              <span>显示名</span>
              <input
                ref="displayNameInput"
                v-model="newUser.displayName"
                type="text"
                maxlength="80"
                placeholder="用户看到的昵称"
                :aria-invalid="Boolean(createFieldErrors.displayName)"
                aria-describedby="new-user-display-name-rule new-user-display-name-error"
                @input="clearCreateFieldError('displayName')"
              />
              <small id="new-user-display-name-rule">必填，最长 80 个字符。</small>
              <em v-if="createFieldErrors.displayName" id="new-user-display-name-error" class="admin-field-error" role="alert">
                {{ createFieldErrors.displayName }}
              </em>
            </label>
            <label class="admin-account-field">
              <span>初始密码</span>
              <input
                ref="passwordInput"
                v-model="newUser.password"
                type="password"
                autocomplete="new-password"
                maxlength="128"
                placeholder="输入初始密码"
                :aria-invalid="Boolean(createFieldErrors.password)"
                aria-describedby="new-user-password-rule new-user-password-error"
                @input="clearCreateFieldError('password')"
              />
              <small id="new-user-password-rule">必填，长度 10–128 位。</small>
              <em v-if="createFieldErrors.password" id="new-user-password-error" class="admin-field-error" role="alert">
                {{ createFieldErrors.password }}
              </em>
            </label>
          </section>

          <section class="admin-account-section">
            <div class="admin-account-section-heading">
              <b>初始权限</b>
              <small>权限可以稍后修改。</small>
            </div>
            <label class="admin-account-permission">
              <input v-model="newUser.isAdmin" type="checkbox" />
              <span><b>管理员</b><small>可以进入管理后台并管理账号。</small></span>
            </label>
            <label class="admin-account-permission">
              <input v-model="newUser.canPinMessages" type="checkbox" />
              <span><b>频道置顶管理</b><small>可以管理频道置顶内容。</small></span>
            </label>
          </section>

          <p v-if="createError" class="admin-operation-error" role="alert">{{ createError }}</p>
          <footer class="admin-account-action-bar">
            <button type="button" class="mini-btn secondary" :disabled="creating" @click="cancelCreate">取消</button>
            <button type="submit" class="primary-btn" :disabled="creating">
              {{ creating ? "正在创建…" : "创建用户" }}
            </button>
          </footer>
        </form>

        <div
          v-else-if="selectedAccount && accountEdits[selectedAccount.id]"
          class="admin-account-details-view"
        >
          <div class="admin-account-detail-heading">
            <label class="avatar admin-account-detail-avatar upload-avatar-trigger">
              <img v-if="avatarUrl(selectedAccount.avatarPath)" :src="avatarUrl(selectedAccount.avatarPath)" alt="" />
              <span v-else>{{ avatarText(selectedAccount.displayName) }}</span>
              <span class="admin-account-avatar-action">
                <Camera :size="13" />
              </span>
              <input
                class="hidden"
                type="file"
                accept="image/*"
                :disabled="avatarUploadingAccountId !== null"
                :aria-label="`上传 ${selectedAccount.displayName} 的头像`"
                @change="uploadAccountAvatar(selectedAccount, $event)"
              />
            </label>
            <div>
              <strong>{{ selectedAccount.displayName }}</strong>
              <small>@{{ selectedAccount.username }}</small>
              <span v-if="selectedAccount.id === store.account?.id" class="admin-current-account-pill">当前账号</span>
            </div>
            <span v-if="avatarUploadingAccountId === selectedAccount.id" class="admin-account-avatar-status" role="status">
              头像上传中…
            </span>
          </div>
          <p v-if="avatarError" class="admin-operation-error" role="alert">{{ avatarError }}</p>

          <section class="admin-account-section">
            <div class="admin-account-section-heading">
              <b>基本资料</b>
              <small>用户名不可修改。</small>
            </div>
            <label class="admin-account-field">
              <span>昵称</span>
              <input
                v-model="accountEdits[selectedAccount.id].displayName"
                type="text"
                maxlength="80"
                placeholder="昵称"
              />
              <small>最长 80 个字符。</small>
            </label>
            <div class="admin-account-readonly-field">
              <span>用户名</span>
              <strong>@{{ selectedAccount.username }}</strong>
            </div>
          </section>

          <section class="admin-account-section">
            <div class="admin-account-section-heading">
              <b>权限</b>
              <small>更改会在保存后生效。</small>
            </div>
            <label class="admin-account-permission">
              <input
                v-model="accountEdits[selectedAccount.id].isAdmin"
                type="checkbox"
                :disabled="adminPermissionLocked(selectedAccount)"
              />
              <span>
                <b>管理员</b>
                <small>{{ adminPermissionLocked(selectedAccount) ? "当前账号或最后一个管理员不能取消此权限。" : "可以进入管理后台并管理账号。" }}</small>
              </span>
            </label>
            <label class="admin-account-permission">
              <input v-model="accountEdits[selectedAccount.id].canPinMessages" type="checkbox" />
              <span><b>频道置顶管理</b><small>可以管理频道置顶内容。</small></span>
            </label>
          </section>

          <section class="admin-account-section">
            <div class="admin-account-section-heading security">
              <div><b>安全</b><small>重置密码会撤销该用户的其他登录会话。</small></div>
              <button type="button" class="mini-btn secondary" @click="togglePasswordReset">
                <KeyRound :size="15" />{{ passwordOpen ? "收起" : "重置密码" }}
              </button>
            </div>
            <div v-if="passwordOpen" class="admin-password-reset">
              <label class="admin-account-field">
                <span>新密码</span>
                <input
                  v-model="newPassword"
                  type="password"
                  autocomplete="new-password"
                  maxlength="128"
                  :aria-invalid="Boolean(passwordFieldErrors.password)"
                />
                <small>长度 10–128 位。</small>
                <em v-if="passwordFieldErrors.password" class="admin-field-error" role="alert">
                  {{ passwordFieldErrors.password }}
                </em>
              </label>
              <label class="admin-account-field">
                <span>再次输入新密码</span>
                <input
                  v-model="confirmPassword"
                  type="password"
                  autocomplete="new-password"
                  maxlength="128"
                  :aria-invalid="Boolean(passwordFieldErrors.confirmation)"
                />
                <em v-if="passwordFieldErrors.confirmation" class="admin-field-error" role="alert">
                  {{ passwordFieldErrors.confirmation }}
                </em>
              </label>
              <p v-if="passwordError" class="admin-operation-error" role="alert">{{ passwordError }}</p>
              <button
                type="button"
                class="mini-btn"
                :disabled="resettingPasswordAccountId !== null"
                @click="handlePasswordReset"
              >
                {{ resettingPasswordAccountId === selectedAccount.id ? "正在重置…" : "确认重置密码" }}
              </button>
            </div>
          </section>

          <section class="admin-account-section danger">
            <div class="admin-account-section-heading">
              <b>危险操作</b>
              <small>删除后账号无法恢复，历史消息仍会保留。</small>
            </div>
            <div class="admin-account-danger-row">
              <div>
                <strong>删除 {{ selectedAccount.displayName }}（@{{ selectedAccount.username }}）</strong>
                <small>{{ deleteDisabledReason(selectedAccount) || "删除前会再次确认账号身份。" }}</small>
              </div>
              <button
                type="button"
                class="mini-btn danger-action"
                :disabled="!canDeleteAccount(selectedAccount) || deletingAccountId !== null"
                @click="handleDelete(selectedAccount)"
              >
                <Trash2 :size="15" />
                {{ deletingAccountId === selectedAccount.id ? "正在删除…" : "删除用户" }}
              </button>
            </div>
            <p v-if="deleteError" class="admin-operation-error" role="alert">{{ deleteError }}</p>
          </section>

          <p v-if="saveError" class="admin-operation-error" role="alert">{{ saveError }}</p>
          <footer class="admin-account-action-bar">
            <span class="admin-account-save-summary"><ShieldCheck :size="16" />一次只保存当前用户</span>
            <button
              type="button"
              class="primary-btn"
              :disabled="savingAccountId !== null"
              @click="updateAccount(selectedAccount)"
            >
              {{ savingAccountId === selectedAccount.id ? "正在保存…" : "保存修改" }}
            </button>
          </footer>
        </div>

        <div v-else class="admin-account-empty-detail">
          <ShieldCheck :size="28" />
          <strong>选择一个用户</strong>
          <small>从左侧列表选择用户查看资料和权限。</small>
        </div>
      </main>
    </div>
  </section>
</template>
