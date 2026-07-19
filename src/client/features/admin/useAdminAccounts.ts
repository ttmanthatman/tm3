import { computed, ref } from "vue";
import type { AccountDTO } from "@shared/types";
import { api, authHeaders } from "../../api";

export interface AdminAccountEdit {
  displayName: string;
  isAdmin: boolean;
  canPinMessages: boolean;
  password: string;
}

export interface NewAdminAccount {
  username: string;
  displayName: string;
  password: string;
  isAdmin: boolean;
  canPinMessages: boolean;
}

export type NewAdminAccountField = "username" | "displayName" | "password";
export type NewAdminAccountErrors = Partial<Record<NewAdminAccountField, string>>;

interface UseAdminAccountsOptions {
  currentAccountId: () => number | null;
  onCurrentAccountUpdated: (account: AccountDTO) => void;
  onMessage: (message: string) => void;
}

export function createAdminAccountEdit(account: AccountDTO): AdminAccountEdit {
  return {
    displayName: account.displayName,
    isAdmin: account.isAdmin,
    canPinMessages: account.canPinMessages,
    password: ""
  };
}

export function createAdminAccountEdits(accounts: AccountDTO[]): Record<number, AdminAccountEdit> {
  return Object.fromEntries(accounts.map((account) => [account.id, createAdminAccountEdit(account)]));
}

export function canDeleteAdminAccount(currentAccountId: number | null, accountId: number): boolean {
  return currentAccountId !== accountId;
}

export function adminAccountDeleteConfirmation(account: Pick<AccountDTO, "displayName" | "username">): string {
  return `警告：确定删除用户“${account.displayName}”（@${account.username}）吗？\n\n该用户将无法再登录，个人收藏、会话和频道成员关系会被永久删除；历史消息会保留并标记为“已删除用户”。此操作无法撤销。`;
}

export function emptyNewAdminAccount(): NewAdminAccount {
  return {
    username: "",
    displayName: "",
    password: "",
    isAdmin: false,
    canPinMessages: false
  };
}

export function validateNewAdminAccount(account: NewAdminAccount): NewAdminAccountErrors {
  const errors: NewAdminAccountErrors = {};
  if (!account.username) {
    errors.username = "用户名不能为空";
  } else if (account.username.length < 2 || account.username.length > 40) {
    errors.username = "用户名长度必须为 2–40 位";
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(account.username)) {
    errors.username = "用户名只能包含英文字母、数字、下划线、点和短横线";
  }

  if (!account.displayName.trim()) {
    errors.displayName = "显示名不能为空";
  } else if (account.displayName.trim().length > 80) {
    errors.displayName = "显示名最长 80 个字符";
  }

  if (account.password.length < 10 || account.password.length > 128) {
    errors.password = "密码长度必须为 10–128 位";
  }
  return errors;
}

function operationError(error: unknown, fallback: string) {
  if (error instanceof TypeError) return "网络连接失败，请检查网络后重试";
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useAdminAccounts(options: UseAdminAccountsOptions) {
  const accounts = ref<AccountDTO[]>([]);
  const accountEdits = ref<Record<number, AdminAccountEdit>>({});
  const newUser = ref<NewAdminAccount>(emptyNewAdminAccount());
  const query = ref("");
  const selectedAccountId = ref<number | null>(null);
  const loading = ref(false);
  const error = ref("");
  const message = ref("");
  const creating = ref(false);
  const createError = ref("");
  const createFieldErrors = ref<NewAdminAccountErrors>({});
  const savingAccountId = ref<number | null>(null);
  const saveError = ref("");
  const deletingAccountId = ref<number | null>(null);
  const deleteError = ref("");
  const avatarUploadingAccountId = ref<number | null>(null);
  const avatarError = ref("");
  const resettingPasswordAccountId = ref<number | null>(null);
  const passwordError = ref("");
  const passwordFieldErrors = ref<{ password?: string; confirmation?: string }>({});

  const filteredAccounts = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase();
    if (!normalized) return accounts.value;
    return accounts.value.filter((account) =>
      account.displayName.toLocaleLowerCase().includes(normalized) ||
      account.username.toLocaleLowerCase().includes(normalized)
    );
  });
  const selectedAccount = computed(() =>
    accounts.value.find((account) => account.id === selectedAccountId.value) || null
  );

  function setMessage(nextMessage: string) {
    message.value = nextMessage;
    options.onMessage(nextMessage);
  }

  function clearMessage() {
    setMessage("");
  }

  function clearActionErrors() {
    saveError.value = "";
    deleteError.value = "";
    avatarError.value = "";
    passwordError.value = "";
    passwordFieldErrors.value = {};
  }

  function resetCreateForm() {
    newUser.value = emptyNewAdminAccount();
    createError.value = "";
    createFieldErrors.value = {};
  }

  function selectAccount(accountId: number) {
    selectedAccountId.value = accountId;
    clearActionErrors();
  }

  function replaceAccounts(nextAccounts: AccountDTO[]) {
    const previousEdits = accountEdits.value;
    accounts.value = nextAccounts;
    accountEdits.value = Object.fromEntries(
      nextAccounts.map((account) => [
        account.id,
        previousEdits[account.id] || createAdminAccountEdit(account)
      ])
    );
    if (
      selectedAccountId.value === null ||
      !nextAccounts.some((account) => account.id === selectedAccountId.value)
    ) {
      selectedAccountId.value = nextAccounts[0]?.id ?? null;
    }
  }

  function replaceAccount(updated: AccountDTO) {
    const index = accounts.value.findIndex((account) => account.id === updated.id);
    if (index >= 0) accounts.value[index] = updated;
    else accounts.value.push(updated);
    accountEdits.value[updated.id] = createAdminAccountEdit(updated);
    if (options.currentAccountId() === updated.id) options.onCurrentAccountUpdated(updated);
  }

  async function fetchAccounts() {
    return api<{ accounts: AccountDTO[] }>("/api/admin/accounts");
  }

  async function loadAccounts() {
    loading.value = true;
    error.value = "";
    try {
      const result = await fetchAccounts();
      replaceAccounts(result.accounts);
    } catch (loadError) {
      error.value = operationError(loadError, "页面加载失败，请稍后重试");
    } finally {
      loading.value = false;
    }
  }

  async function addUser(): Promise<boolean> {
    if (creating.value) return false;
    createError.value = "";
    setMessage("");
    const validationErrors = validateNewAdminAccount(newUser.value);
    createFieldErrors.value = validationErrors;
    if (Object.keys(validationErrors).length) return false;

    creating.value = true;
    try {
      const result = await api<{ success: boolean; account: AccountDTO }>("/api/admin/accounts", {
        method: "POST",
        body: JSON.stringify({
          ...newUser.value,
          displayName: newUser.value.displayName.trim()
        })
      });
      replaceAccount(result.account);
      selectedAccountId.value = result.account.id;
      newUser.value = emptyNewAdminAccount();
      createFieldErrors.value = {};
      setMessage("用户已创建");
      return true;
    } catch (creationError) {
      createError.value = operationError(creationError, "创建用户失败，请稍后重试");
      return false;
    } finally {
      creating.value = false;
    }
  }

  async function updateAccount(account: AccountDTO): Promise<boolean> {
    if (savingAccountId.value !== null) return false;
    const edit = accountEdits.value[account.id];
    if (!edit) return false;
    saveError.value = "";
    setMessage("");
    const displayName = edit.displayName.trim();
    if (!displayName) {
      saveError.value = "昵称不能为空";
      return false;
    }
    if (displayName.length > 80) {
      saveError.value = "昵称最长 80 个字符";
      return false;
    }
    savingAccountId.value = account.id;
    try {
      const result = await api<{ account: AccountDTO }>(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          isAdmin: edit.isAdmin,
          canPinMessages: edit.canPinMessages
        })
      });
      replaceAccount(result.account);
      setMessage("用户资料已更新");
      return true;
    } catch (updateError) {
      saveError.value = operationError(updateError, "保存用户资料失败，请稍后重试");
      return false;
    } finally {
      savingAccountId.value = null;
    }
  }

  function isLastAdministrator(account: AccountDTO) {
    return account.isAdmin && accounts.value.filter((candidate) => candidate.isAdmin).length <= 1;
  }

  function canDeleteAccount(account: AccountDTO) {
    return canDeleteAdminAccount(options.currentAccountId(), account.id) && !isLastAdministrator(account);
  }

  function deleteDisabledReason(account: AccountDTO) {
    if (options.currentAccountId() === account.id) return "不能删除当前登录账号";
    if (isLastAdministrator(account)) return "不能删除最后一个管理员";
    return "";
  }

  function adminPermissionLocked(account: AccountDTO) {
    return account.isAdmin && (
      options.currentAccountId() === account.id ||
      isLastAdministrator(account)
    );
  }

  async function deleteAccount(account: AccountDTO): Promise<boolean> {
    deleteError.value = "";
    setMessage("");
    if (!canDeleteAccount(account)) {
      deleteError.value = deleteDisabledReason(account);
      return false;
    }
    if (!confirm(adminAccountDeleteConfirmation(account))) return false;
    if (deletingAccountId.value !== null) return false;

    deletingAccountId.value = account.id;
    const deletedIndex = accounts.value.findIndex((row) => row.id === account.id);
    try {
      await api(`/api/admin/accounts/${account.id}`, { method: "DELETE" });
      const remaining = accounts.value.filter((row) => row.id !== account.id);
      accounts.value = remaining;
      delete accountEdits.value[account.id];
      selectedAccountId.value = remaining[Math.min(deletedIndex, remaining.length - 1)]?.id ?? null;
      setMessage(`用户“${account.displayName}”已删除`);
      return true;
    } catch (deletionError) {
      deleteError.value = operationError(deletionError, "删除用户失败，请稍后重试");
      return false;
    } finally {
      deletingAccountId.value = null;
    }
  }

  async function resetPassword(
    account: AccountDTO,
    password: string,
    confirmation: string
  ): Promise<boolean> {
    if (resettingPasswordAccountId.value !== null) return false;
    passwordError.value = "";
    passwordFieldErrors.value = {};
    if (password.length < 10 || password.length > 128) {
      passwordFieldErrors.value.password = "密码长度必须为 10–128 位";
    }
    if (!confirmation) {
      passwordFieldErrors.value.confirmation = "请再次输入新密码";
    } else if (password !== confirmation) {
      passwordFieldErrors.value.confirmation = "两次输入的密码不一致";
    }
    if (Object.keys(passwordFieldErrors.value).length) return false;

    resettingPasswordAccountId.value = account.id;
    setMessage("");
    try {
      const result = await api<{ account: AccountDTO }>(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password })
      });
      replaceAccount(result.account);
      setMessage("密码已重置");
      return true;
    } catch (resetError) {
      passwordError.value = operationError(resetError, "重置密码失败，请稍后重试");
      return false;
    } finally {
      resettingPasswordAccountId.value = null;
    }
  }

  async function uploadAccountAvatar(account: AccountDTO, event: Event): Promise<boolean> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || avatarUploadingAccountId.value !== null) return false;
    const form = new FormData();
    form.append("file", file);
    avatarError.value = "";
    avatarUploadingAccountId.value = account.id;
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${account.id}/avatar`, {
        method: "POST",
        headers: authHeaders(),
        body: form
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: "头像上传失败" })) as { message?: string };
        throw new Error(result.message || "头像上传失败");
      }
      const result = (await response.json()) as { account: AccountDTO };
      replaceAccount(result.account);
      setMessage("头像已更新");
      return true;
    } catch (uploadError) {
      avatarError.value = operationError(uploadError, "头像上传失败，请稍后重试");
      return false;
    } finally {
      avatarUploadingAccountId.value = null;
    }
  }

  return {
    accounts,
    filteredAccounts,
    selectedAccount,
    selectedAccountId,
    accountEdits,
    newUser,
    query,
    loading,
    error,
    message,
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
  };
}
