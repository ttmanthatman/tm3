import { ref } from "vue";
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
}

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

function emptyNewAdminAccount(): NewAdminAccount {
  return { username: "", displayName: "", password: "" };
}

export function useAdminAccounts(options: UseAdminAccountsOptions) {
  const accounts = ref<AccountDTO[]>([]);
  const accountEdits = ref<Record<number, AdminAccountEdit>>({});
  const newUser = ref<NewAdminAccount>(emptyNewAdminAccount());
  const loading = ref(false);
  const error = ref("");
  const message = ref("");

  function setMessage(nextMessage: string) {
    message.value = nextMessage;
    options.onMessage(nextMessage);
  }

  function replaceAccounts(nextAccounts: AccountDTO[]) {
    accounts.value = nextAccounts;
    accountEdits.value = createAdminAccountEdits(nextAccounts);
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
      error.value = loadError instanceof Error ? loadError.message : "页面加载失败，请稍后重试";
    } finally {
      loading.value = false;
    }
  }

  async function addUser() {
    setMessage("");
    await api("/api/admin/accounts", { method: "POST", body: JSON.stringify(newUser.value) });
    newUser.value = emptyNewAdminAccount();
    const result = await fetchAccounts();
    replaceAccounts(result.accounts);
    setMessage("用户已添加");
  }

  async function updateAccount(account: AccountDTO) {
    const edit = accountEdits.value[account.id];
    if (!edit) return;
    const result = await api<{ account: AccountDTO }>(`/api/admin/accounts/${account.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: edit.displayName,
        isAdmin: edit.isAdmin,
        canPinMessages: edit.canPinMessages,
        password: edit.password || undefined
      })
    });
    const index = accounts.value.findIndex((row) => row.id === account.id);
    if (index >= 0) accounts.value[index] = result.account;
    if (options.currentAccountId() === result.account.id) options.onCurrentAccountUpdated(result.account);
    accountEdits.value = createAdminAccountEdits(accounts.value);
    setMessage("用户资料已更新");
  }

  function canDeleteAccount(account: AccountDTO) {
    return canDeleteAdminAccount(options.currentAccountId(), account.id);
  }

  async function deleteAccount(account: AccountDTO) {
    if (!canDeleteAccount(account)) {
      alert("不能删除当前登录的管理员账号");
      return;
    }
    if (!confirm(adminAccountDeleteConfirmation(account))) return;
    await api(`/api/admin/accounts/${account.id}`, { method: "DELETE" });
    replaceAccounts(accounts.value.filter((row) => row.id !== account.id));
    setMessage(`用户“${account.displayName}”已删除`);
  }

  async function uploadAccountAvatar(account: AccountDTO, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/admin/accounts/${account.id}/avatar`, {
      method: "POST",
      headers: authHeaders(),
      body: form
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: "头像上传失败" }));
      alert(result.message || "头像上传失败");
      return;
    }
    const result = (await response.json()) as { account: AccountDTO };
    const index = accounts.value.findIndex((row) => row.id === account.id);
    if (index >= 0) accounts.value[index] = result.account;
    if (options.currentAccountId() === result.account.id) options.onCurrentAccountUpdated(result.account);
    setMessage("头像已更新");
  }

  return {
    accounts,
    accountEdits,
    newUser,
    loading,
    error,
    message,
    loadAccounts,
    addUser,
    updateAccount,
    canDeleteAccount,
    deleteAccount,
    uploadAccountAvatar
  };
}
