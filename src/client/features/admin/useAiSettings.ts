import { ref, type Ref } from "vue";
import type { AiRoleDTO, AiSettingsDTO } from "@shared/types";
import { api, authHeaders } from "../../api";
import { useChatStore } from "../../store";

interface UseAiSettingsOptions {
  showAdmin: Ref<boolean>;
  isLogRoute: Ref<boolean>;
  adminMsg: Ref<string>;
  saveReadPosition: () => void;
}

export function useAiSettings(options: UseAiSettingsOptions) {
  const store = useChatStore();
  const isAiSettingsRoute = ref(window.location.pathname === "/ai-settings");
  const newVirtual = ref({
    username: "",
    displayName: "",
    model: "",
    thinkingEnabled: false,
    persona: "",
    shortTermMemory: "",
    midTermMemory: "",
    longTermMemory: "",
    channelIds: [] as number[],
    enabled: true
  });
  const virtuals = ref<any[]>([]);
  const mcStatus = ref<any | null>(null);
  const mcSelectedChannelId = ref<number | null>(null);
  const mcSelectedCharacterIds = ref<number[]>([]);
  const mcBusy = ref(false);
  const mcMsg = ref("");
  const aiSettings = ref<AiSettingsDTO | null>(null);
  const aiSettingsEdit = ref({
    enabled: true,
    apiKey: "",
    clearApiKey: false,
    promptCommand: "",
    aiRoles: [] as AiRoleDTO[],
    cardCooldownSeconds: 30,
    userLimitPerMinute: 3,
    maxSuccessPerMessage: 7
  });
  const aiSettingsBusy = ref(false);
  const aiSettingsMsg = ref("");
  const aiSettingsShowAdvanced = ref(false);
  const aiSettingsTab = ref<"llm" | "virtuals" | "verses">("llm");

  async function openAiSettingsPage(tab: "llm" | "virtuals" | "verses" = "llm") {
    if (!store.account?.isAdmin) return;
    options.saveReadPosition();
    options.showAdmin.value = false;
    options.isLogRoute.value = false;
    isAiSettingsRoute.value = true;
    aiSettingsTab.value = tab;
    window.history.pushState({}, "", "/ai-settings");
    await loadAiSettings();
    if (tab === "virtuals") await loadVirtualCharacters().catch(() => undefined);
  }

  function syncAiSettingsEdit(settings: AiSettingsDTO) {
    aiSettings.value = settings;
    aiSettingsEdit.value = {
      enabled: settings.enabled,
      apiKey: "",
      clearApiKey: false,
      promptCommand: settings.promptCommand,
      aiRoles: (settings.aiRoles || []).map((role) => ({
        ...role,
        model: role.model || "",
        thinkingEnabled: !!role.thinkingEnabled,
        shortTermMemory: role.shortTermMemory || "",
        midTermMemory: role.midTermMemory || "",
        longTermMemory: role.longTermMemory || "",
        channelIds: role.channelIds || [],
        contextTurnLimit: role.contextTurnLimit || (role.username === "ai_slmm" ? 10 : undefined),
        contextWindowMinutes: role.contextWindowMinutes || (role.username === "ai_slmm" ? 10 : undefined)
      })),
      cardCooldownSeconds: settings.cardCooldownSeconds,
      userLimitPerMinute: settings.userLimitPerMinute,
      maxSuccessPerMessage: settings.maxSuccessPerMessage
    };
  }

  function aiRoleHint(role: AiRoleDTO) {
    if (role.username === "ai_slmm") return "普通聊天里检测到问句后自动触发，并把原消息交给这个角色回复。";
    if (role.username === "why_assistant") return "私聊里的研究话题引导助手。";
    return "AI 角色";
  }

  function aiRoleForCharacter(character: any) {
    const username = character?.actor?.username || "";
    return aiSettingsEdit.value.aiRoles.find((role) => role.username === username) || null;
  }

  function virtualConfig(character: any) {
    const raw = character?.config && typeof character.config === "object" && !Array.isArray(character.config) ? character.config : {};
    const profile = raw.profile && typeof raw.profile === "object" && !Array.isArray(raw.profile) ? raw.profile : {};
    const manualMemory = raw.manualMemory && typeof raw.manualMemory === "object" && !Array.isArray(raw.manualMemory) ? raw.manualMemory : {};
    const generation = raw.generation && typeof raw.generation === "object" && !Array.isArray(raw.generation) ? raw.generation : {};
    const multichar = raw.multichar && typeof raw.multichar === "object" && !Array.isArray(raw.multichar) ? raw.multichar : {};
    const modelHints = multichar.modelHints && typeof multichar.modelHints === "object" && !Array.isArray(multichar.modelHints) ? multichar.modelHints : {};
    return {
      ...raw,
      profile: {
        ...profile,
        name: String(profile.name || character?.actor?.displayName || ""),
        persona: String(profile.persona || ""),
        speakingStyle: String(profile.speakingStyle || "像微信群里的真人，简短自然")
      },
      manualMemory: {
        ...manualMemory,
        shortTerm: String(manualMemory.shortTerm || ""),
        midTerm: String(manualMemory.midTerm || ""),
        longTerm: String(manualMemory.longTerm || "")
      },
      generation: {
        ...generation,
        model: String(generation.model || modelHints.mainModel || ""),
        thinkingEnabled: !!generation.thinkingEnabled
      },
      activationJudgePrompt: String(raw.activationJudgePrompt || ""),
      channels: Array.isArray(raw.channels) ? raw.channels.map(Number).filter(Number.isFinite) : []
    };
  }

  function buildVirtualConfig(
    displayName: string,
    persona: string,
    channelIds: number[],
    existing?: any,
    activationJudgePrompt?: string,
    model?: string,
    thinkingEnabled?: boolean,
    manualMemory?: { shortTerm?: string; midTerm?: string; longTerm?: string }
  ) {
    const base = existing ? virtualConfig(existing) : {};
    const profile = base.profile && typeof base.profile === "object" && !Array.isArray(base.profile) ? base.profile : {};
    const multichar = (base as any).multichar && typeof (base as any).multichar === "object" && !Array.isArray((base as any).multichar) ? (base as any).multichar : {};
    const bio = multichar.bio && typeof multichar.bio === "object" && !Array.isArray(multichar.bio) ? multichar.bio : {};
    const basics = bio.basics && typeof bio.basics === "object" && !Array.isArray(bio.basics) ? bio.basics : {};
    const generation = (base as any).generation && typeof (base as any).generation === "object" && !Array.isArray((base as any).generation) ? (base as any).generation : {};
    const existingManualMemory = (base as any).manualMemory && typeof (base as any).manualMemory === "object" && !Array.isArray((base as any).manualMemory) ? (base as any).manualMemory : {};
    const modelHints = multichar.modelHints && typeof multichar.modelHints === "object" && !Array.isArray(multichar.modelHints) ? { ...multichar.modelHints } : {};
    const modelValue = String(model ?? generation.model ?? modelHints.mainModel ?? "").trim();
    if (modelValue) modelHints.mainModel = modelValue;
    else delete modelHints.mainModel;
    return {
      ...base,
      profile: {
        ...profile,
        name: displayName,
        persona,
        speakingStyle: String((profile as any).speakingStyle || "像微信群里的真人，简短自然")
      },
      activationJudgePrompt: activationJudgePrompt ?? String((base as any).activationJudgePrompt || ""),
      manualMemory: {
        ...existingManualMemory,
        shortTerm: String(manualMemory?.shortTerm ?? existingManualMemory.shortTerm ?? ""),
        midTerm: String(manualMemory?.midTerm ?? existingManualMemory.midTerm ?? ""),
        longTerm: String(manualMemory?.longTerm ?? existingManualMemory.longTerm ?? "")
      },
      generation: {
        ...generation,
        model: modelValue,
        thinkingEnabled: !!(thinkingEnabled ?? generation.thinkingEnabled)
      },
      multichar: {
        ...multichar,
        bio: {
          ...bio,
          basics: {
            ...basics,
            name: displayName,
            identity: persona || String((basics as any).identity || "")
          }
        },
        emotionBaseline: String(multichar.emotionBaseline || "平静中性"),
        modelHints
      },
      channels: [...new Set(channelIds.map(Number).filter(Number.isFinite))]
    };
  }

  function virtualPersona(character: any) {
    const role = aiRoleForCharacter(character);
    if (role) return role.promptCommand || "";
    return virtualConfig(character).profile.persona;
  }

  function virtualManualMemory(character: any) {
    const role = aiRoleForCharacter(character);
    if (role) {
      return {
        shortTerm: role.shortTermMemory || "",
        midTerm: role.midTermMemory || "",
        longTerm: role.longTermMemory || ""
      };
    }
    const memory = virtualConfig(character).manualMemory;
    return {
      shortTerm: String(memory.shortTerm || ""),
      midTerm: String(memory.midTerm || ""),
      longTerm: String(memory.longTerm || "")
    };
  }

  function virtualModel(character: any) {
    const role = aiRoleForCharacter(character);
    if (role) return role.model || "";
    return virtualConfig(character).generation.model || "";
  }

  function virtualThinkingEnabled(character: any) {
    const role = aiRoleForCharacter(character);
    if (role) return !!role.thinkingEnabled;
    return !!virtualConfig(character).generation.thinkingEnabled;
  }

  function virtualActivationJudgePrompt(character: any) {
    const role = aiRoleForCharacter(character);
    if (role) return role.activationJudgePrompt || "";
    return virtualConfig(character).activationJudgePrompt;
  }

  function virtualEnabled(character: any) {
    const role = aiRoleForCharacter(character);
    return role ? role.enabled : !!character.enabled;
  }

  function virtualChannelIds(character: any) {
    const role = aiRoleForCharacter(character);
    if (role) return role.channelIds || [];
    return virtualConfig(character).channels;
  }

  function virtualChannelNames(character: any) {
    const ids = new Set(virtualChannelIds(character));
    const names = store.channels.filter((channel) => ids.has(channel.id)).map((channel) => channel.name);
    return names.length ? names.join("、") : "未指定频道";
  }

  function toggleNewVirtualChannel(channelId: number) {
    const ids = new Set(newVirtual.value.channelIds);
    if (ids.has(channelId)) ids.delete(channelId);
    else ids.add(channelId);
    newVirtual.value.channelIds = [...ids];
  }

  async function toggleVirtualChannel(character: any, channelId: number) {
    const ids = new Set<number>(virtualChannelIds(character));
    if (ids.has(channelId)) ids.delete(channelId);
    else ids.add(channelId);
    setVirtualChannelIds(character, [...ids]);
  }

  async function loadVirtualCharacters() {
    virtuals.value = (await api<{ characters: any[] }>("/api/virtual-characters")).characters;
  }

  function setVirtualChannelIds(character: any, channelIds: number[]) {
    const role = aiRoleForCharacter(character);
    if (role) role.channelIds = channelIds;
    character.config = buildVirtualConfig(
      character.actor?.displayName || "",
      virtualPersona(character),
      channelIds,
      character,
      virtualActivationJudgePrompt(character),
      virtualModel(character),
      virtualThinkingEnabled(character),
      virtualManualMemory(character)
    );
  }

  function setVirtualDisplayName(character: any, value: string) {
    character.actor.displayName = value;
    const role = aiRoleForCharacter(character);
    if (role) role.displayName = value;
    character.config = buildVirtualConfig(value, virtualPersona(character), virtualChannelIds(character), character, virtualActivationJudgePrompt(character), virtualModel(character), virtualThinkingEnabled(character), virtualManualMemory(character));
  }

  function setVirtualEnabled(character: any, value: boolean) {
    character.enabled = value;
    const role = aiRoleForCharacter(character);
    if (role) role.enabled = value;
  }

  function setVirtualPersona(character: any, value: string) {
    const role = aiRoleForCharacter(character);
    if (role) role.promptCommand = value;
    character.config = buildVirtualConfig(character.actor?.displayName || "", value, virtualChannelIds(character), character, virtualActivationJudgePrompt(character), virtualModel(character), virtualThinkingEnabled(character), virtualManualMemory(character));
  }

  function setVirtualModel(character: any, value: string) {
    const role = aiRoleForCharacter(character);
    if (role) role.model = value;
    character.config = buildVirtualConfig(character.actor?.displayName || "", virtualPersona(character), virtualChannelIds(character), character, virtualActivationJudgePrompt(character), value, virtualThinkingEnabled(character), virtualManualMemory(character));
  }

  function setVirtualThinkingEnabled(character: any, value: boolean) {
    const role = aiRoleForCharacter(character);
    if (role) role.thinkingEnabled = value;
    character.config = buildVirtualConfig(character.actor?.displayName || "", virtualPersona(character), virtualChannelIds(character), character, virtualActivationJudgePrompt(character), virtualModel(character), value, virtualManualMemory(character));
  }

  function setVirtualActivationJudgePrompt(character: any, value: string) {
    const role = aiRoleForCharacter(character);
    if (role) role.activationJudgePrompt = value;
    character.config = buildVirtualConfig(character.actor?.displayName || "", virtualPersona(character), virtualChannelIds(character), character, value, virtualModel(character), virtualThinkingEnabled(character), virtualManualMemory(character));
  }

  function setVirtualManualMemory(character: any, key: "shortTerm" | "midTerm" | "longTerm", value: string) {
    const role = aiRoleForCharacter(character);
    if (role) {
      if (key === "shortTerm") role.shortTermMemory = value;
      if (key === "midTerm") role.midTermMemory = value;
      if (key === "longTerm") role.longTermMemory = value;
    }
    const memory = virtualManualMemory(character);
    memory[key] = value;
    character.config = buildVirtualConfig(
      character.actor?.displayName || "",
      virtualPersona(character),
      virtualChannelIds(character),
      character,
      virtualActivationJudgePrompt(character),
      virtualModel(character),
      virtualThinkingEnabled(character),
      memory
    );
  }

  async function updateVirtual(character: any, patch: { displayName?: string; persona?: string; channelIds?: number[]; enabled?: boolean; activationJudgePrompt?: string; model?: string; thinkingEnabled?: boolean; manualMemory?: { shortTerm?: string; midTerm?: string; longTerm?: string } }) {
    const role = aiRoleForCharacter(character);
    const displayName = (patch.displayName ?? character.actor?.displayName ?? "").trim();
    if (!displayName) return;
    const enabled = patch.enabled ?? virtualEnabled(character);
    const persona = patch.persona ?? virtualPersona(character);
    const activationJudgePrompt = patch.activationJudgePrompt ?? virtualActivationJudgePrompt(character);
    const model = patch.model ?? virtualModel(character);
    const thinkingEnabled = patch.thinkingEnabled ?? virtualThinkingEnabled(character);
    const manualMemory = patch.manualMemory ?? virtualManualMemory(character);
    if (role) {
      role.displayName = displayName;
      role.enabled = enabled;
      role.promptCommand = persona;
      role.activationJudgePrompt = activationJudgePrompt;
      role.model = model;
      role.thinkingEnabled = thinkingEnabled;
      role.shortTermMemory = manualMemory.shortTerm || "";
      role.midTermMemory = manualMemory.midTerm || "";
      role.longTermMemory = manualMemory.longTerm || "";
      role.channelIds = patch.channelIds ?? virtualChannelIds(character);
    }
    await api(`/api/virtual-characters/${character.id}`, {
      method: "PUT",
      body: JSON.stringify({
        displayName,
        enabled,
        config: buildVirtualConfig(displayName, persona, patch.channelIds ?? virtualChannelIds(character), character, activationJudgePrompt, model, thinkingEnabled, manualMemory)
      })
    });
    await loadVirtualCharacters();
    aiSettingsMsg.value = "虚拟角色已保存";
  }

  async function saveVirtualCharacter(character: any, reload = true) {
    const role = aiRoleForCharacter(character);
    const displayName = String(character.actor?.displayName || "").trim();
    if (!displayName) return;
    await updateVirtual(character, {
      displayName,
      enabled: virtualEnabled(character),
      persona: virtualPersona(character),
      channelIds: virtualChannelIds(character),
      activationJudgePrompt: virtualActivationJudgePrompt(character),
      model: virtualModel(character),
      thinkingEnabled: virtualThinkingEnabled(character),
      manualMemory: virtualManualMemory(character)
    });
    if (role) await saveAiSettings();
    if (reload) await loadVirtualCharacters();
  }

  async function saveAllVirtualCharacters() {
    for (const character of virtuals.value) {
      const role = aiRoleForCharacter(character);
      if (role) continue;
      await api(`/api/virtual-characters/${character.id}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: String(character.actor?.displayName || "").trim(),
          enabled: virtualEnabled(character),
          config: buildVirtualConfig(
            String(character.actor?.displayName || "").trim(),
            virtualPersona(character),
            virtualChannelIds(character),
            character,
            virtualActivationJudgePrompt(character),
            virtualModel(character),
            virtualThinkingEnabled(character),
            virtualManualMemory(character)
          )
        })
      });
    }
  }

  async function uploadVirtualAvatar(character: any, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/virtual-characters/${character.id}/avatar`, { method: "POST", headers: authHeaders(), body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: "头像上传失败" }));
      alert(result.message || "头像上传失败");
      return;
    }
    await loadVirtualCharacters();
    syncAiSettingsEdit(await api<AiSettingsDTO>("/api/admin/ai-settings"));
    aiSettingsMsg.value = "头像已更新";
  }

  async function uploadAiRoleAvatar(role: AiRoleDTO, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/admin/ai-roles/${encodeURIComponent(role.username)}/avatar`, { method: "POST", headers: authHeaders(), body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: "头像上传失败" }));
      alert(result.message || "头像上传失败");
      return;
    }
    const result = (await response.json()) as { role: AiRoleDTO };
    const index = aiSettingsEdit.value.aiRoles.findIndex((item) => item.username === role.username);
    if (index >= 0) aiSettingsEdit.value.aiRoles[index] = { ...aiSettingsEdit.value.aiRoles[index], avatarPath: result.role.avatarPath };
    aiSettingsMsg.value = "AI 角色头像已更新";
  }

  async function loadAiSettings() {
    if (!store.account?.isAdmin) return;
    aiSettingsBusy.value = true;
    aiSettingsMsg.value = "";
    try {
      syncAiSettingsEdit(await api<AiSettingsDTO>("/api/admin/ai-settings"));
    } catch (error) {
      aiSettingsMsg.value = error instanceof Error ? error.message : "AI 设置加载失败";
    } finally {
      aiSettingsBusy.value = false;
    }
  }

  async function saveAiSettings() {
    if (!store.account?.isAdmin) return;
    aiSettingsBusy.value = true;
    aiSettingsMsg.value = "";
    try {
      if (virtuals.value.length) await saveAllVirtualCharacters();
      const payload = {
        enabled: aiSettingsEdit.value.enabled,
        apiKey: aiSettingsEdit.value.apiKey.trim() || undefined,
        clearApiKey: aiSettingsEdit.value.clearApiKey,
        promptCommand: aiSettingsEdit.value.promptCommand,
        aiRoles: aiSettingsEdit.value.aiRoles.map((role) => ({
          username: role.username,
          displayName: role.displayName,
          enabled: role.enabled,
          model: role.model || "",
          thinkingEnabled: !!role.thinkingEnabled,
          promptCommand: role.promptCommand,
          shortTermMemory: role.shortTermMemory || "",
          midTermMemory: role.midTermMemory || "",
          longTermMemory: role.longTermMemory || "",
          channelIds: role.channelIds || [],
          activationJudgePrompt: role.activationJudgePrompt,
          webSearchEnabled: role.webSearchEnabled,
          questionTriggerEnabled: role.questionTriggerEnabled,
          contextTurnLimit: Number(role.contextTurnLimit || 10),
          contextWindowMinutes: Number(role.contextWindowMinutes || 10)
        })),
        cardCooldownSeconds: Number(aiSettingsEdit.value.cardCooldownSeconds),
        userLimitPerMinute: Number(aiSettingsEdit.value.userLimitPerMinute),
        maxSuccessPerMessage: Number(aiSettingsEdit.value.maxSuccessPerMessage)
      };
      syncAiSettingsEdit(await api<AiSettingsDTO>("/api/admin/ai-settings", { method: "POST", body: JSON.stringify(payload) }));
      if (virtuals.value.length) await loadVirtualCharacters();
      aiSettingsMsg.value = "AI 设置已保存";
    } catch (error) {
      aiSettingsMsg.value = error instanceof Error ? error.message : "AI 设置保存失败";
    } finally {
      aiSettingsBusy.value = false;
    }
  }

  async function loadMcStatus() {
    try {
      const result = await api<{ sessions: any[] }>("/api/admin/multichar/status");
      if (result.sessions && result.sessions.length > 0) {
        mcStatus.value = result.sessions[0];
        mcSelectedChannelId.value = result.sessions[0].channelId ?? null;
      } else {
        mcStatus.value = null;
      }
    } catch { mcStatus.value = null; }
  }

  async function startMultichar() {
    if (!mcSelectedChannelId.value || mcSelectedCharacterIds.value.length === 0) {
      mcMsg.value = "请选择频道和至少一个角色";
      return;
    }
    mcBusy.value = true;
    mcMsg.value = "";
    try {
      const result = await api<{ session: any }>("/api/admin/multichar/start", {
        method: "POST",
        body: JSON.stringify({
          channelId: mcSelectedChannelId.value,
          characterIds: mcSelectedCharacterIds.value,
        }),
      });
      mcStatus.value = result.session;
      mcMsg.value = "已启动";
    } catch (e: any) {
      mcMsg.value = e?.message || "启动失败";
    } finally {
      mcBusy.value = false;
    }
  }

  async function stopMultichar() {
    if (!mcSelectedChannelId.value) return;
    mcBusy.value = true;
    try {
      await api("/api/admin/multichar/stop", {
        method: "POST",
        body: JSON.stringify({ channelId: mcSelectedChannelId.value }),
      });
      mcStatus.value = null;
      mcMsg.value = "已停止";
    } catch (e: any) {
      mcMsg.value = e?.message || "停止失败";
    } finally {
      mcBusy.value = false;
    }
  }

  function toggleMcCharacter(id: number) {
    const idx = mcSelectedCharacterIds.value.indexOf(id);
    if (idx >= 0) mcSelectedCharacterIds.value.splice(idx, 1);
    else mcSelectedCharacterIds.value.push(id);
  }

  async function addVirtual() {
    await api("/api/virtual-characters", {
      method: "POST",
      body: JSON.stringify({
        username: newVirtual.value.username.trim(),
        displayName: newVirtual.value.displayName.trim(),
        enabled: newVirtual.value.enabled,
        config: buildVirtualConfig(
          newVirtual.value.displayName.trim(),
          newVirtual.value.persona.trim(),
          newVirtual.value.channelIds,
          undefined,
          "",
          newVirtual.value.model.trim(),
          newVirtual.value.thinkingEnabled,
          {
            shortTerm: newVirtual.value.shortTermMemory,
            midTerm: newVirtual.value.midTermMemory,
            longTerm: newVirtual.value.longTermMemory
          }
        )
      })
    });
    newVirtual.value = {
      username: "",
      displayName: "",
      model: "",
      thinkingEnabled: false,
      persona: "",
      shortTermMemory: "",
      midTermMemory: "",
      longTermMemory: "",
      channelIds: [],
      enabled: true
    };
    await loadVirtualCharacters();
    options.adminMsg.value = "虚拟角色已创建";
    aiSettingsMsg.value = "虚拟角色已创建";
  }

  async function toggleVirtual(character: any) {
    await api(`/api/virtual-characters/${character.id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !character.enabled })
    });
    await loadVirtualCharacters();
  }

  return {
    isAiSettingsRoute,
    newVirtual,
    virtuals,
    mcStatus,
    mcSelectedChannelId,
    mcSelectedCharacterIds,
    mcBusy,
    mcMsg,
    aiSettings,
    aiSettingsEdit,
    aiSettingsBusy,
    aiSettingsMsg,
    aiSettingsShowAdvanced,
    aiSettingsTab,
    openAiSettingsPage,
    syncAiSettingsEdit,
    aiRoleHint,
    aiRoleForCharacter,
    virtualConfig,
    buildVirtualConfig,
    virtualPersona,
    virtualManualMemory,
    virtualModel,
    virtualThinkingEnabled,
    virtualActivationJudgePrompt,
    virtualEnabled,
    virtualChannelIds,
    virtualChannelNames,
    toggleNewVirtualChannel,
    toggleVirtualChannel,
    loadVirtualCharacters,
    setVirtualChannelIds,
    setVirtualDisplayName,
    setVirtualEnabled,
    setVirtualPersona,
    setVirtualModel,
    setVirtualThinkingEnabled,
    setVirtualActivationJudgePrompt,
    setVirtualManualMemory,
    updateVirtual,
    saveVirtualCharacter,
    saveAllVirtualCharacters,
    uploadVirtualAvatar,
    uploadAiRoleAvatar,
    loadAiSettings,
    saveAiSettings,
    loadMcStatus,
    startMultichar,
    stopMultichar,
    toggleMcCharacter,
    addVirtual,
    toggleVirtual
  };
}
