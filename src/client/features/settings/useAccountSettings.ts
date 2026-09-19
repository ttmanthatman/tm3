import { ref } from "vue";
import type { AccountDTO } from "@shared/types";
import type { StoryGender } from "@shared/stories";
import { api } from "../../api";
import { useChatStore } from "../../store";

interface UseAccountSettingsOptions {
  onDeleted: () => void | Promise<void>;
}

export function useAccountSettings(options: UseAccountSettingsOptions) {
  const store = useChatStore();
  const accountDisplayName = ref("");
  const accountGender = ref<StoryGender>("unspecified");
  const accountCurrentPassword = ref("");
  const accountNewPassword = ref("");
  const accountConfirmPassword = ref("");
  const accountDeletePassword = ref("");
  const accountAvatarBusy = ref(false);
  const accountProfileBusy = ref(false);
  const accountPasswordBusy = ref(false);
  const accountDeleteBusy = ref(false);
  const accountProfileMsg = ref("");
  const accountPasswordMsg = ref("");
  const accountDeleteMsg = ref("");

  function syncAccountSettings() {
    accountDisplayName.value = store.account?.displayName || "";
    accountGender.value = store.account?.gender || "unspecified";
    accountCurrentPassword.value = "";
    accountNewPassword.value = "";
    accountConfirmPassword.value = "";
    accountDeletePassword.value = "";
    accountProfileMsg.value = "";
    accountPasswordMsg.value = "";
    accountDeleteMsg.value = "";
  }

  async function uploadOwnAvatar(event: Event) {
    const inputElement = event.target as HTMLInputElement;
    const file = inputElement.files?.[0];
    if (!file) return;
    accountAvatarBusy.value = true;
    accountProfileMsg.value = "";
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ success: true; account: AccountDTO }>("/api/me/avatar", {
        method: "POST",
        body: form
      });
      store.account = result.account;
      accountProfileMsg.value = "头像已更新";
    } catch (error) {
      accountProfileMsg.value = error instanceof Error ? error.message : "头像更新失败";
    } finally {
      accountAvatarBusy.value = false;
      inputElement.value = "";
    }
  }

  async function saveOwnProfile() {
    const nextDisplayName = accountDisplayName.value.trim();
    if (!nextDisplayName) {
      accountProfileMsg.value = "请输入昵称";
      return;
    }
    accountProfileBusy.value = true;
    accountProfileMsg.value = "";
    try {
      const result = await api<{ success: true; account: AccountDTO }>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: nextDisplayName, gender: accountGender.value })
      });
      store.account = result.account;
      accountDisplayName.value = result.account.displayName;
      accountProfileMsg.value = "个人资料已保存";
    } catch (error) {
      accountProfileMsg.value = error instanceof Error ? error.message : "昵称保存失败";
    } finally {
      accountProfileBusy.value = false;
    }
  }

  async function changeOwnPassword() {
    if (accountNewPassword.value.length < 10) {
      accountPasswordMsg.value = "新密码至少需要 10 位";
      return;
    }
    if (accountNewPassword.value !== accountConfirmPassword.value) {
      accountPasswordMsg.value = "两次输入的新密码不一致";
      return;
    }
    accountPasswordBusy.value = true;
    accountPasswordMsg.value = "";
    try {
      await api<{ success: true }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          oldPassword: accountCurrentPassword.value,
          newPassword: accountNewPassword.value
        })
      });
      accountCurrentPassword.value = "";
      accountNewPassword.value = "";
      accountConfirmPassword.value = "";
      accountPasswordMsg.value = "密码已修改，其他设备已退出登录";
    } catch (error) {
      accountPasswordMsg.value = error instanceof Error ? error.message : "密码修改失败";
    } finally {
      accountPasswordBusy.value = false;
    }
  }

  async function deleteOwnAccount() {
    if (!accountDeletePassword.value) {
      accountDeleteMsg.value = "请输入当前密码";
      return;
    }
    if (!window.confirm("确定永久删除账号吗？账号数据无法恢复，历史消息会显示为“已注销用户”。"))
      return;
    accountDeleteBusy.value = true;
    accountDeleteMsg.value = "";
    try {
      await api<{ success: true }>("/api/me/account", {
        method: "DELETE",
        body: JSON.stringify({ password: accountDeletePassword.value })
      });
      await options.onDeleted();
    } catch (error) {
      accountDeleteMsg.value = error instanceof Error ? error.message : "账号删除失败";
    } finally {
      accountDeleteBusy.value = false;
    }
  }

  return {
    accountDisplayName,
    accountGender,
    accountCurrentPassword,
    accountNewPassword,
    accountConfirmPassword,
    accountDeletePassword,
    accountAvatarBusy,
    accountProfileBusy,
    accountPasswordBusy,
    accountDeleteBusy,
    accountProfileMsg,
    accountPasswordMsg,
    accountDeleteMsg,
    syncAccountSettings,
    uploadOwnAvatar,
    saveOwnProfile,
    changeOwnPassword,
    deleteOwnAccount
  };
}

export type AccountSettings = ReturnType<typeof useAccountSettings>;
