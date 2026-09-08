import { ref } from "vue";
import { useChatStore } from "../../store";

export function useAccountSettings() {
  const store = useChatStore();
  const accountDisplayName = ref("");
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
    accountCurrentPassword.value = "";
    accountNewPassword.value = "";
    accountConfirmPassword.value = "";
    accountDeletePassword.value = "";
    accountProfileMsg.value = "";
    accountPasswordMsg.value = "";
    accountDeleteMsg.value = "";
  }

  return {
    accountDisplayName,
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
    syncAccountSettings
  };
}

export type AccountSettings = ReturnType<typeof useAccountSettings>;
