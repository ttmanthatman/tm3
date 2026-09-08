import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import type { AccountDTO, ActorDTO, ChannelDTO, MessageDTO } from "@shared/types";
import { api, authHeaders } from "../../api";
import { useChatStore } from "../../store";
import {
  canEditChannel,
  canLeaveChannel,
  canManageChannelMembers,
  canOpenChannelSettings,
  canSubmitChannelDraft,
  createChannelDraft,
  normalizeChannelDraft
} from "../../channelManagement";
import {
  canRemoveChannelMember,
  channelOwnershipSuccessors,
  isCurrentAccountChannelOwner
} from "../../memberManagement";

type MemberActionTarget = {
  id: number;
  accountId?: number;
  characterId?: number;
  kind: string;
  username?: string;
  displayName: string;
  avatarPath?: string | null;
  role?: string;
  membershipRole?: string | null;
  isSiteAdmin?: boolean;
};

type MemberPickerCandidate = {
  id: number;
  accountId?: number;
  characterId?: number;
  kind: "human" | "virtual";
  username: string;
  displayName: string;
  avatarPath?: string | null;
};

interface UseChannelManagementOptions {
  input: Ref<string>;
  composerInput: Ref<HTMLTextAreaElement | null>;
  showMembers: Ref<boolean>;
  showChannels: Ref<boolean>;
  membersCollapsed: Ref<boolean>;
  showChatToolsMenu: Ref<boolean>;
  showAdmin: Ref<boolean>;
  adminMsg: Ref<string>;
  pendingChain: Ref<MessageDTO | null>;
  isAdmin: ComputedRef<boolean>;
  currentChannel: ComputedRef<ChannelDTO | null>;
  positionPromptNearEvent: (event: MouseEvent | PointerEvent | undefined, size: { width: number; height: number }) => { x: number; y: number };
  replaceChannelSnapshot: (channel?: ChannelDTO | null, options?: { addToStore?: boolean; addToAdmin?: boolean }) => void;
  saveReadPosition: () => void;
  switchVisibleChannel: (channelId: number) => Promise<void>;
  restoreSavedReadPosition: () => Promise<void>;
  restoreChatSurface: () => Promise<void>;
  scrollBottom: (smooth?: boolean) => void;
}

export function useChannelManagement(options: UseChannelManagementOptions) {
  const store = useChatStore();
  const selectedMember = ref<MemberActionTarget | null>(null);
  const memberPaneChannelOverride = ref<ChannelDTO | null>(null);
  const managedMembers = ref<MemberActionTarget[]>([]);
  const memberRemoveMode = ref(false);
  const memberPickerOpen = ref(false);
  const memberPickerChannel = ref<ChannelDTO | null>(null);
  const memberPickerCandidates = ref<MemberPickerCandidate[]>([]);
  const memberPickerSelectedIds = ref<string[]>([]);
  const memberPickerBusy = ref(false);
  const memberManageMsg = ref("");
  const ownerTransferOpen = ref(false);
  const ownerTransferChannel = ref<ChannelDTO | null>(null);
  const ownerTransferSuccessorId = ref<number | null>(null);
  const ownerTransferBusy = ref(false);
  const ownerTransferMsg = ref("");
  const showChannelEditor = ref(false);
  const channelEditorMode = ref<"create" | "edit">("create");
  const channelEditorChannel = ref<ChannelDTO | null>(null);
  const channelEditorDraft = ref(createChannelDraft());
  const channelEditorBusy = ref(false);
  const channelEditorMsg = ref("");
  const channelNameSuggestions = ref<string[]>([]);
  const channelNameSuggestionBusy = ref(false);
  const pendingCloseChannel = ref<ChannelDTO | null>(null);
  const pendingLeaveChannel = ref<ChannelDTO | null>(null);
  const channelLeaveBusy = ref(false);
  const channelLeaveMsg = ref("");
  const memberPromptPosition = ref({ x: 0, y: 0 });

  const memberPromptStyle = computed(() => ({
    left: `${memberPromptPosition.value.x}px`,
    top: `${memberPromptPosition.value.y}px`
  }));

  const canDeleteCurrentChannel = computed(() => !!options.currentChannel.value?.canManage && options.currentChannel.value.kind !== "music" && !options.currentChannel.value.isDefault && !options.currentChannel.value.directKey);
  const activeMemberPaneChannel = computed(() => memberPaneChannelOverride.value || options.currentChannel.value);
  const activeMemberPaneMembers = computed(() => (memberPaneChannelOverride.value ? managedMembers.value : store.members));
  const canManageActiveMembers = computed(() => {
    const channel = activeMemberPaneChannel.value;
    return channel?.kind !== "music" && canManageChannelMembers(channel);
  });
  const ownerTransferCandidates = computed(() => channelOwnershipSuccessors(activeMemberPaneMembers.value, store.account?.id));
  const memberPaneTitle = computed(() => (memberPaneChannelOverride.value ? "成员管理" : "成员"));
  const memberPaneSubtitle = computed(() => activeMemberPaneChannel.value?.name || "");
  const memberPickerTitle = computed(() => (memberPickerChannel.value ? `添加到 ${memberPickerChannel.value.name}` : "添加成员"));
  const channelEditorTitle = computed(() => (channelEditorMode.value === "create" ? "创建频道" : "频道设置"));
  const channelEditorSubtitle = computed(() => (channelEditorMode.value === "create" ? "创建后可立即添加成员" : channelEditorChannel.value?.name || ""));
  const isTwoPersonDirectEditor = computed(() => {
    const channel = channelEditorChannel.value;
    return channelEditorMode.value === "edit" && channel?.kind === "direct" && !channel.directKey?.startsWith("virtual:") && channel.memberCount === 2;
  });
  const isGroupDirectEditor = computed(() => {
    const channel = channelEditorChannel.value;
    return channelEditorMode.value === "edit" && channel?.kind === "direct" && !channel.directKey?.startsWith("virtual:") && channel.memberCount > 2;
  });

  watch(memberRemoveMode, () => {
    selectedMember.value = null;
  });

  function mentionMember(member: { displayName: string }) {
    const mention = `@${member.displayName} `;
    const el = options.composerInput.value;
    if (!el) {
      options.input.value = `${options.input.value}${mention}`;
      return;
    }
    const start = el.selectionStart ?? options.input.value.length;
    const end = el.selectionEnd ?? options.input.value.length;
    options.input.value = `${options.input.value.slice(0, start)}${mention}${options.input.value.slice(end)}`;
    nextTick(() => {
      el.focus();
      const cursor = start + mention.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function openMemberActions(member: MemberActionTarget, event?: MouseEvent) {
    memberPromptPosition.value = options.positionPromptNearEvent(event, { width: 178, height: 52 });
    selectedMember.value = member;
    options.pendingChain.value = null;
  }

  function openSenderActions(sender: ActorDTO, event?: MouseEvent) {
    const member = store.members.find((row) => row.kind === sender.kind && row.username === sender.username);
    if (member) {
      openMemberActions(member, event);
      return;
    }
    const online = store.online.find((user) => user.actorId === sender.id);
    openMemberActions({
      id: sender.id,
      accountId: sender.kind === "virtual" ? undefined : online?.accountId,
      kind: sender.kind,
      username: sender.username,
      displayName: sender.displayName,
      avatarPath: sender.avatarPath
    }, event);
  }

  function mentionSelectedMember() {
    if (!selectedMember.value) return;
    mentionMember(selectedMember.value);
    selectedMember.value = null;
    options.showMembers.value = false;
  }

  async function startPrivateChat(member: MemberActionTarget) {
    if (member.kind !== "virtual" && (!member.accountId || member.accountId === store.account?.id)) return;
    const result =
      member.kind === "virtual"
        ? await api<{ channel: ChannelDTO }>("/api/direct-virtual-channels", { method: "POST", body: JSON.stringify({ username: member.username }) })
        : await api<{ channel: ChannelDTO }>("/api/direct-channels", { method: "POST", body: JSON.stringify({ accountId: member.accountId }) });
    selectedMember.value = null;
    options.showMembers.value = false;
    if (result.channel && !store.channels.some((channel) => channel.id === result.channel.id)) {
      store.channels = [result.channel, ...store.channels];
    }
    options.saveReadPosition();
    await options.switchVisibleChannel(result.channel.id);
    await nextTick();
    await options.restoreSavedReadPosition();
  }

  function resetChannelEditorDraft() {
    channelEditorDraft.value = createChannelDraft();
  }

  function openCreateChannelEditor() {
    channelEditorMode.value = "create";
    channelEditorChannel.value = null;
    resetChannelEditorDraft();
    channelEditorMsg.value = "";
    channelNameSuggestions.value = [];
    showChannelEditor.value = true;
  }

  function openEditChannelEditor(channel: ChannelDTO) {
    if (!canOpenChannelSettings(channel)) return;
    channelEditorMode.value = "edit";
    channelEditorChannel.value = channel;
    channelEditorDraft.value = {
      name: channel.name,
      description: channel.description || "",
      isPrivate: channel.isPrivate,
      listColor: channel.listColor || "#e8f4ec",
      useListColor: !!channel.listColor
    };
    channelEditorMsg.value = "";
    channelNameSuggestions.value = [];
    showChannelEditor.value = true;
  }

  function closeChannelEditor() {
    if (channelEditorBusy.value) return;
    showChannelEditor.value = false;
    channelEditorMsg.value = "";
    channelNameSuggestions.value = [];
  }

  async function requestDirectChatNameSuggestions() {
    const channel = channelEditorChannel.value;
    if (!channel || !isGroupDirectEditor.value || channelNameSuggestionBusy.value) return;
    channelNameSuggestionBusy.value = true;
    channelEditorMsg.value = "";
    try {
      const result = await api<{ suggestions: string[] }>(`/api/channels/${channel.id}/name-suggestions`, { method: "POST" });
      channelNameSuggestions.value = result.suggestions;
    } catch (error) {
      channelEditorMsg.value = error instanceof Error ? error.message : "暂时想不到新名字，请稍后再试";
    } finally {
      channelNameSuggestionBusy.value = false;
    }
  }

  async function openChannelEditorMembers() {
    const channel = channelEditorChannel.value;
    if (!channel || !canEditChannel(channel)) return;
    showChannelEditor.value = false;
    options.showChannels.value = false;
    await openAdminChannelMembers(channel);
  }

  async function saveChannelEditor() {
    if (channelEditorMode.value === "edit" && !canEditChannel(channelEditorChannel.value)) return;
    const draft = normalizeChannelDraft(channelEditorDraft.value);
    if (!canSubmitChannelDraft(channelEditorDraft.value, channelEditorBusy.value)) {
      channelEditorMsg.value = "请输入频道名";
      return;
    }
    channelEditorBusy.value = true;
    channelEditorMsg.value = "";
    try {
      if (channelEditorMode.value === "create") {
        const result = await api<{ channel: ChannelDTO }>("/api/channels", {
          method: "POST",
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
            isPrivate: draft.isPrivate,
            listColor: draft.listColor
          })
        });
        options.replaceChannelSnapshot(result.channel, { addToStore: true, addToAdmin: options.isAdmin.value });
        showChannelEditor.value = false;
        options.showChannels.value = false;
        await options.switchVisibleChannel(result.channel.id);
        options.membersCollapsed.value = false;
        options.showMembers.value = true;
        await nextTick();
        if (result.channel.isPrivate) await openMemberPicker(result.channel);
        return;
      }
      const channel = channelEditorChannel.value;
      if (!channel) return;
      const result = await api<{ channel: ChannelDTO }>(`/api/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          listColor: draft.listColor
        })
      });
      options.replaceChannelSnapshot(result.channel);
      channelEditorChannel.value = result.channel;
      showChannelEditor.value = false;
      options.adminMsg.value = "频道已更新";
    } catch (error) {
      channelEditorMsg.value = error instanceof Error ? error.message : "频道保存失败";
    } finally {
      channelEditorBusy.value = false;
    }
  }

  async function uploadChannelEditorIcon(event: Event) {
    const channel = channelEditorChannel.value;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!channel || !file) return;
    channelEditorBusy.value = true;
    channelEditorMsg.value = "";
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/channels/${channel.id}/icon`, { method: "POST", headers: authHeaders(), body: form });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: "频道图标上传失败" }));
        throw new Error(result.message || "频道图标上传失败");
      }
      const result = (await response.json()) as { channel: ChannelDTO };
      options.replaceChannelSnapshot(result.channel);
      channelEditorChannel.value = result.channel;
      channelEditorMsg.value = "频道图标已更新";
    } catch (error) {
      channelEditorMsg.value = error instanceof Error ? error.message : "频道图标上传失败";
    } finally {
      channelEditorBusy.value = false;
    }
  }

  function toggleCurrentMemberPane() {
    options.showChatToolsMenu.value = false;
    selectedMember.value = null;
    if (memberPaneChannelOverride.value) {
      memberPaneChannelOverride.value = null;
      managedMembers.value = [];
    }
    memberRemoveMode.value = false;
    memberManageMsg.value = "";
    options.membersCollapsed.value = false;
    options.showMembers.value = !options.showMembers.value;
  }

  async function refreshMembersForChannel(channelId: number) {
    const rows = await store.loadMembers(channelId);
    if (memberPaneChannelOverride.value?.id === channelId) managedMembers.value = rows;
    return rows;
  }

  async function openAdminChannelMembers(channel: ChannelDTO) {
    memberPaneChannelOverride.value = channel;
    managedMembers.value = [];
    memberRemoveMode.value = false;
    memberManageMsg.value = "";
    options.showAdmin.value = false;
    options.membersCollapsed.value = false;
    options.showMembers.value = true;
    managedMembers.value = await store.loadMembers(channel.id);
    await options.restoreChatSurface();
  }

  function canRemoveMemberFromActive(member: MemberActionTarget) {
    return canRemoveChannelMember(member, { canManage: canManageActiveMembers.value, currentAccountId: store.account?.id });
  }

  async function openMemberPicker(channel = activeMemberPaneChannel.value) {
    if (!channel || !canManageChannelMembers(channel)) return;
    selectedMember.value = null;
    memberPickerChannel.value = channel;
    memberPickerOpen.value = true;
    memberPickerSelectedIds.value = [];
    memberPickerCandidates.value = [];
    memberPickerBusy.value = true;
    memberManageMsg.value = "";
    try {
      const result = await api<{ accounts: AccountDTO[]; virtuals: MemberPickerCandidate[] }>(`/api/channels/${channel.id}/member-candidates`);
      memberPickerCandidates.value = [
        ...result.accounts.map((account) => ({
          id: account.id,
          accountId: account.id,
          kind: "human" as const,
          username: account.username,
          displayName: account.displayName,
          avatarPath: account.avatarPath
        })),
        ...(result.virtuals || [])
      ];
    } catch (error) {
      memberManageMsg.value = error instanceof Error ? error.message : "成员候选加载失败";
    } finally {
      memberPickerBusy.value = false;
    }
  }

  function closeMemberPicker() {
    memberPickerOpen.value = false;
    memberPickerChannel.value = null;
    memberPickerCandidates.value = [];
    memberPickerSelectedIds.value = [];
  }

  function memberPickerCandidateKey(candidate: MemberPickerCandidate) {
    return candidate.kind === "virtual" ? `virtual:${candidate.characterId}` : `human:${candidate.accountId}`;
  }

  function toggleMemberPickerAccount(candidate: MemberPickerCandidate) {
    const key = memberPickerCandidateKey(candidate);
    memberPickerSelectedIds.value = memberPickerSelectedIds.value.includes(key)
      ? memberPickerSelectedIds.value.filter((id) => id !== key)
      : [...memberPickerSelectedIds.value, key];
  }

  async function addSelectedMembers() {
    const channel = memberPickerChannel.value;
    const selectedCandidates = memberPickerCandidates.value.filter((candidate) => memberPickerSelectedIds.value.includes(memberPickerCandidateKey(candidate)));
    const accountIds = selectedCandidates.flatMap((candidate) => candidate.accountId ? [candidate.accountId] : []);
    const virtualCharacterIds = selectedCandidates.flatMap((candidate) => candidate.characterId ? [candidate.characterId] : []);
    if (!channel || (!accountIds.length && !virtualCharacterIds.length)) return;
    memberPickerBusy.value = true;
    try {
      const result = await api<{ channel: ChannelDTO; added: number }>(`/api/channels/${channel.id}/members`, {
        method: "POST",
        body: JSON.stringify({ accountIds, virtualCharacterIds })
      });
      options.replaceChannelSnapshot(result.channel);
      await refreshMembersForChannel(channel.id);
      memberManageMsg.value = `已添加 ${result.added} 人`;
      closeMemberPicker();
    } catch (error) {
      memberManageMsg.value = error instanceof Error ? error.message : "添加成员失败";
    } finally {
      memberPickerBusy.value = false;
    }
  }

  async function removeMemberFromActive(member: MemberActionTarget) {
    const channel = activeMemberPaneChannel.value;
    if (!channel || !canRemoveMemberFromActive(member)) return;
    if (!confirm(`从“${channel.name}”移除 ${member.displayName}？`)) return;
    try {
      const endpoint = member.kind === "virtual"
        ? `/api/channels/${channel.id}/virtual-members/${member.characterId}`
        : `/api/channels/${channel.id}/members/${member.accountId}`;
      const result = await api<{ channel: ChannelDTO }>(endpoint, { method: "DELETE" });
      options.replaceChannelSnapshot(result.channel);
      await refreshMembersForChannel(channel.id);
      memberManageMsg.value = `已移除 ${member.displayName}`;
      if (!activeMemberPaneMembers.value.some(canRemoveMemberFromActive)) memberRemoveMode.value = false;
    } catch (error) {
      memberManageMsg.value = error instanceof Error ? error.message : "移除成员失败";
    }
  }

  function openOwnerTransfer(channel = activeMemberPaneChannel.value) {
    if (!channel || !canLeaveChannel(channel) || !isCurrentAccountChannelOwner(activeMemberPaneMembers.value, store.account?.id)) return;
    selectedMember.value = null;
    ownerTransferChannel.value = channel;
    ownerTransferSuccessorId.value = null;
    ownerTransferMsg.value = "";
    ownerTransferOpen.value = true;
  }

  function closeOwnerTransfer() {
    if (ownerTransferBusy.value) return;
    ownerTransferOpen.value = false;
    ownerTransferChannel.value = null;
    ownerTransferSuccessorId.value = null;
    ownerTransferMsg.value = "";
    if (!options.showMembers.value) {
      memberPaneChannelOverride.value = null;
      managedMembers.value = [];
    }
  }

  async function transferOwnedChannelAndLeave() {
    const channel = ownerTransferChannel.value;
    const successorAccountId = ownerTransferSuccessorId.value;
    if (!channel || !successorAccountId || ownerTransferBusy.value) return;
    const leavingCurrentChannel = store.currentChannelId === channel.id;
    const fallbackChannelId = leavingCurrentChannel ? store.previousChannelId : store.currentChannelId;
    ownerTransferBusy.value = true;
    ownerTransferMsg.value = "";
    try {
      await api(`/api/channels/${channel.id}/leave`, {
        method: "POST",
        body: JSON.stringify({ successorAccountId })
      });
      ownerTransferOpen.value = false;
      ownerTransferChannel.value = null;
      ownerTransferSuccessorId.value = null;
      memberRemoveMode.value = false;
      memberPaneChannelOverride.value = null;
      managedMembers.value = [];
      options.showMembers.value = false;
      await store.loadChannels(fallbackChannelId);
      if (leavingCurrentChannel) {
        await nextTick();
        options.scrollBottom(false);
      }
    } catch (error) {
      ownerTransferMsg.value = error instanceof Error ? error.message : "频道移交失败";
    } finally {
      ownerTransferBusy.value = false;
    }
  }

  async function requestLeaveChannel(channel = channelEditorChannel.value) {
    if (!channel || !canLeaveChannel(channel) || channelLeaveBusy.value) return;
    channelLeaveBusy.value = true;
    channelLeaveMsg.value = "";
    try {
      const members = await store.loadMembers(channel.id);
      showChannelEditor.value = false;
      if (isCurrentAccountChannelOwner(members, store.account?.id)) {
        memberPaneChannelOverride.value = channel;
        managedMembers.value = members;
        openOwnerTransfer(channel);
        return;
      }
      pendingLeaveChannel.value = channel;
    } catch (error) {
      channelEditorMsg.value = error instanceof Error ? error.message : "频道成员加载失败";
      showChannelEditor.value = true;
    } finally {
      channelLeaveBusy.value = false;
    }
  }

  async function leavePendingChannel() {
    const channel = pendingLeaveChannel.value;
    if (!channel || channelLeaveBusy.value) return;
    const leavingCurrentChannel = store.currentChannelId === channel.id;
    const fallbackChannelId = leavingCurrentChannel ? store.previousChannelId : store.currentChannelId;
    channelLeaveBusy.value = true;
    channelLeaveMsg.value = "";
    try {
      await api(`/api/channels/${channel.id}/leave`, { method: "POST", body: JSON.stringify({}) });
      pendingLeaveChannel.value = null;
      await store.loadChannels(fallbackChannelId);
      if (leavingCurrentChannel) {
        await nextTick();
        options.scrollBottom(false);
      }
    } catch (error) {
      channelLeaveMsg.value = error instanceof Error ? error.message : "退出频道失败";
    } finally {
      channelLeaveBusy.value = false;
    }
  }

  function requestCloseChannel() {
    if (!options.currentChannel.value?.directKey) return;
    pendingCloseChannel.value = options.currentChannel.value;
  }

  async function closePendingChannel() {
    const channel = pendingCloseChannel.value;
    if (!channel) return;
    const fallbackChannelId = store.previousChannelId;
    await api(`/api/channels/${channel.id}/membership`, { method: "DELETE" });
    pendingCloseChannel.value = null;
    await store.loadChannels(fallbackChannelId);
    await nextTick();
    options.scrollBottom(false);
  }

  return {
    selectedMember,
    memberPaneChannelOverride,
    managedMembers,
    memberRemoveMode,
    memberPickerOpen,
    memberPickerChannel,
    memberPickerCandidates,
    memberPickerSelectedIds,
    memberPickerBusy,
    memberManageMsg,
    ownerTransferOpen,
    ownerTransferChannel,
    ownerTransferSuccessorId,
    ownerTransferBusy,
    ownerTransferMsg,
    showChannelEditor,
    channelEditorMode,
    channelEditorChannel,
    channelEditorDraft,
    channelEditorBusy,
    channelEditorMsg,
    channelNameSuggestions,
    channelNameSuggestionBusy,
    pendingCloseChannel,
    pendingLeaveChannel,
    channelLeaveBusy,
    channelLeaveMsg,
    memberPromptPosition,
    memberPromptStyle,
    canDeleteCurrentChannel,
    activeMemberPaneChannel,
    activeMemberPaneMembers,
    canManageActiveMembers,
    ownerTransferCandidates,
    memberPaneTitle,
    memberPaneSubtitle,
    memberPickerTitle,
    channelEditorTitle,
    channelEditorSubtitle,
    isTwoPersonDirectEditor,
    isGroupDirectEditor,
    mentionMember,
    openMemberActions,
    openSenderActions,
    mentionSelectedMember,
    startPrivateChat,
    resetChannelEditorDraft,
    openCreateChannelEditor,
    openEditChannelEditor,
    closeChannelEditor,
    requestDirectChatNameSuggestions,
    openChannelEditorMembers,
    saveChannelEditor,
    uploadChannelEditorIcon,
    toggleCurrentMemberPane,
    refreshMembersForChannel,
    openAdminChannelMembers,
    canRemoveMemberFromActive,
    openMemberPicker,
    closeMemberPicker,
    memberPickerCandidateKey,
    toggleMemberPickerAccount,
    addSelectedMembers,
    removeMemberFromActive,
    openOwnerTransfer,
    closeOwnerTransfer,
    transferOwnedChannelAndLeave,
    requestLeaveChannel,
    leavePendingChannel,
    requestCloseChannel,
    closePendingChannel
  };
}
