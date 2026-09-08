import { computed, nextTick, watch, type Ref } from "vue";
import {
  ArrowDown,
  CloudRain,
  Droplet,
  FileText,
  HeartHandshake,
  Mic,
  Plane,
  Sparkles,
  Vibrate,
  WandSparkles
} from "lucide-vue-next";
import type { MessageDTO, MessageEffect, MessageEffectPayload, MusicTrackDTO } from "@shared/types";
import {
  composerDraftAfterSend,
  isComposerSendKey,
  isTouchDevice,
  type MessageSendResult
} from "../../messageSending";
import { useChatStore } from "../../store";

type IconComponent = typeof Sparkles;
const effectCommands: Array<{ command: string; effect: MessageEffect; label: string; hint: string; icon: IconComponent }> = [
  { command: "/闪动", effect: "flash", label: "闪动", hint: "气泡持续换色", icon: Sparkles },
  { command: "/流光", effect: "shine", label: "流光", hint: "文字金属反光", icon: WandSparkles },
  { command: "/震动", effect: "shake", label: "震动", hint: "气泡持续颤抖", icon: Vibrate },
  { command: "/飞机", effect: "fly", label: "飞机", hint: "文字横向循环飞行", icon: Plane },
  { command: "/水滴", effect: "drip", label: "水滴", hint: "液滴下落并撞出水花", icon: Droplet },
  { command: "/下雨", effect: "rain", label: "下雨", hint: "聊天室下 15 秒大雨", icon: CloudRain },
  { command: "/哎呀", effect: "oops", label: "哎呀", hint: "点一下，文字会随机掉下来", icon: ArrowDown }
];
const prayerCommand = { command: "/代祷", label: "代祷", hint: "生成频道代祷卡片", icon: HeartHandshake };
const sermonRequestCommand = { command: "/申请演讲", label: "申请演讲", hint: "生成讲道权限申请卡", icon: Mic };
const markdownCommand = { command: "/Markdown", label: "Markdown", hint: "本条消息按 Markdown 渲染", icon: FileText };
export type SlashCommandSuggestion =
  | { kind: "prayer"; command: string; label: string; hint: string; icon: IconComponent }
  | { kind: "sermonRequest"; command: string; label: string; hint: string; icon: IconComponent }
  | { kind: "format"; command: string; label: string; hint: string; icon: IconComponent }
  | ({ kind: "effect" } & (typeof effectCommands)[number]);

export type ComposerParseResult = { content: string; effect?: MessageEffect; type?: "text" | "prayer" | "sermon_request"; contentFormat?: "markdown" };
export type ComposerMentionToken = { start: number; end: number; query: string };

export function messageEffect(message: MessageDTO): MessageEffect | null {
  const payload = message.payload as MessageEffectPayload | undefined;
  const effect = payload?.effect;
  return effect && effectCommands.some((item) => item.effect === effect) ? effect : null;
}

interface UseComposerOptions {
  input: Ref<string>;
  composerFocused: Ref<boolean>;
  selectedMusicMention: Ref<MusicTrackDTO | null>;
  composerCaret: Ref<number>;
  composerSuggestionIndex: Ref<number>;
  composerSuggestionSuppressed: Ref<boolean>;
  replyTo: Ref<MessageDTO | null>;
  musicMentionToken: Ref<ComposerMentionToken | null>;
  composerInput: Ref<HTMLTextAreaElement | null>;
  composerPanel: Ref<"voice" | "more" | null>;
  messageSendPending: Ref<boolean>;
  messageSendStatus: Ref<string>;
  clearMessageSendStatus: () => void;
  sendMessage: (payload: unknown) => Promise<MessageSendResult>;
  prayerComposerPhoto: Ref<File | null>;
  uploadPrayerImage: (file: File, channelId: number) => Promise<number>;
  clearPrayerComposerPhoto: () => void;
  isRecording: Ref<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  audioFile: Ref<File | null>;
  sortedMusicTracks: () => MusicTrackDTO[];
  chooseActiveSuggestion: () => void;
}

export function useComposer(options: UseComposerOptions) {
  const store = useChatStore();
  const input = options.input;
  const composerFocused = options.composerFocused;
  const selectedMusicMention = options.selectedMusicMention;
  const composerCaret = options.composerCaret;
  const composerSuggestionIndex = options.composerSuggestionIndex;
  const composerSuggestionSuppressed = options.composerSuggestionSuppressed;
  const replyTo = options.replyTo;
  const musicMentionToken = options.musicMentionToken;
  let lastTypingEmitAt = 0;

  function consumeLeadingCommand(value: string, command: string) {
    if (value === command) return "";
    if (value.startsWith(`${command} `) || value.startsWith(`${command}\n`)) return value.slice(command.length).trim();
    return null;
  }

  function parseComposerText(value: string): ComposerParseResult {
    let content = value.trim();
    let effect: MessageEffect | undefined;
    let type: "text" | "prayer" | "sermon_request" | undefined;
    let contentFormat: "markdown" | undefined;
    let consumed = true;

    while (consumed) {
      consumed = false;
      const markdownContent = consumeLeadingCommand(content, markdownCommand.command);
      if (markdownContent !== null) {
        contentFormat = "markdown";
        content = markdownContent;
        consumed = true;
        continue;
      }
      const prayerContent = consumeLeadingCommand(content, prayerCommand.command);
      if (prayerContent !== null) {
        type = "prayer";
        content = prayerContent;
        consumed = true;
        continue;
      }
      const sermonRequestContent = consumeLeadingCommand(content, sermonRequestCommand.command);
      if (sermonRequestContent !== null) {
        type = "sermon_request";
        content = sermonRequestContent;
        consumed = true;
        continue;
      }
      for (const command of effectCommands) {
        const effectContent = consumeLeadingCommand(content, command.command);
        if (effectContent === null) continue;
        effect = command.effect;
        if (!type) type = "text";
        content = effectContent;
        consumed = true;
        break;
      }
    }

    return { content, effect, type, contentFormat };
  }

  function mentionTokenAtCursor(value: string, caret: number) {
    const beforeCursor = value.slice(0, caret);
    const match = beforeCursor.match(/(^|[\s，。！？、,.!?:;；：])@([^\s@，。！？、,.!?:;；：]*)$/);
    if (!match) return null;
    return {
      start: beforeCursor.length - match[2].length - 1,
      end: caret,
      query: match[2]
    };
  }

  function slashCommandTokenAtCursor(value: string, caret: number) {
    const beforeCursor = value.slice(0, caret);
    const firstLine = beforeCursor.split(/\r?\n/, 1)[0] || "";
    if (firstLine === "/" || /^\/[^\s/]*$/.test(firstLine)) {
      return { kind: "root" as const, start: 0, end: caret, query: firstLine };
    }
    const prayerEffectMatch = beforeCursor.match(/^\/代祷\s+(\/[^\s/]*)$/);
    if (prayerEffectMatch) {
      return {
        kind: "prayer-effect" as const,
        start: beforeCursor.length - prayerEffectMatch[1].length,
        end: caret,
        query: prayerEffectMatch[1]
      };
    }
    return null;
  }

  const slashCommandToken = computed(() => slashCommandTokenAtCursor(input.value, composerCaret.value));
  const matchingSlashCommands = computed<SlashCommandSuggestion[]>(() => {
    const token = slashCommandToken.value;
    if (!token) return [];
    if (token.kind === "prayer-effect") {
      return [
        { ...markdownCommand, kind: "format" as const },
        ...effectCommands.map((item) => ({ ...item, kind: "effect" as const }))
      ].filter((item) => item.command.toLowerCase().startsWith(token.query.toLowerCase()));
    }
    return [
      { ...markdownCommand, kind: "format" as const },
      { ...prayerCommand, kind: "prayer" as const },
      { ...sermonRequestCommand, kind: "sermonRequest" as const },
      ...effectCommands.map((item) => ({ ...item, kind: "effect" as const }))
    ].filter((item) => item.command.toLowerCase().startsWith(token.query.toLowerCase()));
  });
  const mentionToken = computed(() => mentionTokenAtCursor(input.value, composerCaret.value));
  const matchingMentionMembers = computed(() => {
    const token = mentionToken.value;
    if (!token) return [];
    const query = token.query.trim().toLowerCase();
    return store.members.filter((member) => {
      if (!member.displayName.trim()) return false;
      if (!query) return true;
      return member.displayName.toLowerCase().includes(query) || (member.username || "").toLowerCase().includes(query);
    });
  });
  const matchingMusicMentionTracks = computed(() => {
    const token = musicMentionToken.value;
    if (!token) return [];
    const query = token.query.trim().toLowerCase();
    if (!query) return options.sortedMusicTracks();
    return options.sortedMusicTracks().filter((track) => track.title.toLowerCase().includes(query) || track.fileName.toLowerCase().includes(query));
  });
  const activeComposerSuggestionKind = computed<"music" | "mention" | "effect" | null>(() => {
    if (matchingMusicMentionTracks.value.length > 0) return "music";
    if (matchingMentionMembers.value.length > 0) return "mention";
    if (matchingSlashCommands.value.length > 0) return "effect";
    return null;
  });
  const composerSuggestionCount = computed(() =>
    activeComposerSuggestionKind.value === "music"
      ? matchingMusicMentionTracks.value.length
      : activeComposerSuggestionKind.value === "mention"
        ? matchingMentionMembers.value.length
        : matchingSlashCommands.value.length
  );
  const showComposerSuggestionMenu = computed(() => !composerSuggestionSuppressed.value && !!activeComposerSuggestionKind.value && composerSuggestionCount.value > 0);
  watch(composerSuggestionCount, (count) => {
    if (composerSuggestionIndex.value >= count) composerSuggestionIndex.value = 0;
  });
  const canSendText = computed(() => {
    return !!selectedMusicMention.value || !!parseComposerText(input.value).content;
  });
  const socketReadyToSend = computed(() => store.connectionState === "connected" && store.socket?.connected === true);
  const composerSendStatus = computed(() => {
    if (options.messageSendPending.value) return "正在发送…";
    if (canSendText.value && !socketReadyToSend.value) {
      return store.connectionState === "connecting" ? "正在连接……" : "连接恢复后再发送";
    }
    return options.messageSendStatus.value;
  });
  const composerSendState = computed(() => {
    if (options.messageSendPending.value) return "pending";
    if (canSendText.value && !socketReadyToSend.value) return "retry";
    return options.messageSendStatus.value ? "failed" : undefined;
  });
  watch(
    () => store.connectionState,
    (state) => {
      if (state === "connected" && options.messageSendStatus.value === "连接恢复后再发送") options.clearMessageSendStatus();
    }
  );

  function syncComposerCaret() {
    const el = options.composerInput.value;
    composerCaret.value = el?.selectionStart ?? input.value.length;
  }

  function chooseSlashCommand(item: SlashCommandSuggestion) {
    const token = slashCommandToken.value;
    const command = item.command;
    const start = token?.start ?? 0;
    const end = token?.end ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${command} ${input.value.slice(end)}`;
    options.composerPanel.value = null;
    composerSuggestionSuppressed.value = true;
    nextTick(() => {
      options.composerInput.value?.focus();
      const cursor = start + command.length + 1;
      options.composerInput.value?.setSelectionRange(cursor, cursor);
      syncComposerCaret();
    });
  }

  function startPrayerComposer() {
    input.value = "/代祷 ";
    options.composerPanel.value = null;
    nextTick(() => {
      options.composerInput.value?.focus();
      options.composerInput.value?.setSelectionRange(input.value.length, input.value.length);
      syncComposerCaret();
    });
  }

  function chooseMentionSuggestion(member: { displayName: string }) {
    const token = mentionToken.value;
    const mention = `@${member.displayName} `;
    const start = token?.start ?? input.value.length;
    const end = token?.end ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${mention}${input.value.slice(end)}`;
    options.composerPanel.value = null;
    composerSuggestionSuppressed.value = true;
    nextTick(() => {
      options.composerInput.value?.focus();
      const cursor = start + mention.length;
      options.composerInput.value?.setSelectionRange(cursor, cursor);
      syncComposerCaret();
    });
  }

  function removeMusicMention() {
    const marker = selectedMusicMention.value ? `@@${selectedMusicMention.value.title}` : "";
    if (marker) input.value = input.value.replace(marker, "").replace(/[ \t]{2,}/g, " ").trim();
    selectedMusicMention.value = null;
    nextTick(() => options.composerInput.value?.focus());
  }

  async function sendText() {
    const parsed = parseComposerText(input.value);
    const musicMention = selectedMusicMention.value;
    const content = parsed.content || (musicMention ? `提及歌曲：${musicMention.title}` : "");
    if (!content || !store.currentChannelId) return;
    const originalInput = input.value;
    const originalMusicMention = musicMention;
    const originalReply = replyTo.value;
    const messageType = musicMention ? "text" : parsed.type || (store.prayerOnly ? "prayer" : "text");
    let prayerImageMessageId: number | null = null;
    if (messageType === "prayer" && options.prayerComposerPhoto.value) {
      try {
        prayerImageMessageId = await options.uploadPrayerImage(options.prayerComposerPhoto.value, store.currentChannelId);
      } catch (error) {
        alert(error instanceof Error ? error.message : "照片上传失败");
        return;
      }
    }
    const messagePayload = {
      ...(messageType === "prayer" ? { kind: "prayer", status: "active" } : {}),
      ...(messageType === "sermon_request" ? { note: content } : {}),
      ...(parsed.effect ? { effect: parsed.effect } : {}),
      ...(parsed.contentFormat ? { contentFormat: parsed.contentFormat } : {}),
      ...(musicMention ? { musicTrackId: musicMention.id } : {}),
      ...(prayerImageMessageId ? { imageMessageId: prayerImageMessageId } : {})
    };
    const payload = {
      channelId: store.currentChannelId,
      content,
      type: messageType,
      payload: Object.keys(messagePayload).length ? messagePayload : undefined,
      replyToId: originalReply?.id || null
    };
    const result = await options.sendMessage(payload);
    const submittedComposerIsCurrent =
      input.value === originalInput &&
      selectedMusicMention.value === originalMusicMention &&
      replyTo.value === originalReply;
    if (!submittedComposerIsCurrent) return;
    input.value = composerDraftAfterSend(result, originalInput, input.value);
    if (!result.ok) return;
    selectedMusicMention.value = null;
    replyTo.value = null;
    if (prayerImageMessageId) options.clearPrayerComposerPhoto();
  }

  function toggleMorePanel() {
    if (options.isRecording.value) return;
    options.composerPanel.value = options.composerPanel.value === "more" ? null : "more";
  }

  async function toggleVoicePanel() {
    if (options.isRecording.value) {
      options.stopRecording();
      return;
    }
    if (options.composerPanel.value !== "voice") {
      options.composerPanel.value = "voice";
      await options.startRecording();
      return;
    }
    if (!options.audioFile.value) {
      await options.startRecording();
    }
  }

  function onInput() {
    syncComposerCaret();
    composerSuggestionIndex.value = 0;
    composerSuggestionSuppressed.value = false;
    if (!store.currentChannelId) return;
    // Throttle typing signals to one per window; the server also debounces.
    const now = Date.now();
    if (now - lastTypingEmitAt < 3000) return;
    lastTypingEmitAt = now;
    store.socket?.emit("message:typing", { channelId: store.currentChannelId, state: "start" });
  }

  function onKeydown(event: KeyboardEvent) {
    if (showComposerSuggestionMenu.value) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const count = composerSuggestionCount.value;
        composerSuggestionIndex.value = count ? (composerSuggestionIndex.value + direction + count) % count : 0;
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey && !event.isComposing) || event.key === "Tab") {
        event.preventDefault();
        options.chooseActiveSuggestion();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        composerSuggestionSuppressed.value = true;
        return;
      }
    }
    if (isComposerSendKey(event) && !isTouchDevice()) {
      event.preventDefault();
      void sendText();
    }
  }

  function pickReply(message: MessageDTO) {
    replyTo.value = message;
  }

  return {
    slashCommandToken,
    matchingSlashCommands,
    mentionToken,
    matchingMentionMembers,
    matchingMusicMentionTracks,
    activeComposerSuggestionKind,
    composerSuggestionCount,
    showComposerSuggestionMenu,
    canSendText,
    socketReadyToSend,
    composerSendStatus,
    composerSendState,
    parseComposerText,
    syncComposerCaret,
    chooseSlashCommand,
    startPrayerComposer,
    chooseMentionSuggestion,
    removeMusicMention,
    sendText,
    toggleMorePanel,
    toggleVoicePanel,
    onInput,
    onKeydown,
    pickReply,
    messageEffect
  };
}
