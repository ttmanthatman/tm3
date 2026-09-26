import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import type { StoryDTO } from "@shared/stories";
import type { ChannelDTO, MessageDTO } from "@shared/types";
import { forwardTargetChannels } from "../../messageForward";
import { forwardStoryGrace } from "./storyClient";

interface StoryGraceForwardOptions {
  channels(): ChannelDTO[];
  currentChannelId(): number | null;
  onForwarded(message: MessageDTO): void;
  forward?: typeof forwardStoryGrace;
}

export function useStoryGraceForward(options: StoryGraceForwardOptions) {
  const forwardOpen = ref(false);
  const forwardBusy = ref(false);
  const forwardError = ref("");
  const story = ref<StoryDTO | null>(null);
  const channelId = ref<number | null>(null);
  const result = ref<MessageDTO | null>(null);
  const targetChannels = computed(() => forwardTargetChannels(options.channels()));
  const canSubmit = computed(() => !!story.value && !forwardBusy.value && !result.value && targetChannels.value.some((channel) => channel.id === channelId.value));
  const targetName = computed(() => options.channels().find((channel) => channel.id === (result.value?.channelId ?? channelId.value))?.name || "目标聊天室");
  let attempt: { storyId: number; channelId: number; requestId: string } | null = null;
  let controller: AbortController | null = null;
  let disposed = false;

  function open(source: StoryDTO) {
    if (forwardBusy.value) return;
    story.value = source;
    channelId.value = targetChannels.value.some((channel) => channel.id === options.currentChannelId()) ? options.currentChannelId() : null;
    result.value = null;
    attempt = null;
    forwardError.value = "";
    forwardOpen.value = true;
  }
  function close() {
    if (forwardBusy.value) return;
    forwardOpen.value = false;
    story.value = null;
    result.value = null;
    attempt = null;
  }
  async function submit() {
    if (!canSubmit.value || !story.value || !channelId.value) return;
    const storyId = story.value.id;
    const target = channelId.value;
    if (!attempt || attempt.storyId !== storyId || attempt.channelId !== target) attempt = { storyId, channelId: target, requestId: crypto.randomUUID() };
    forwardBusy.value = true;
    forwardError.value = "";
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 120_000);
    try {
      const response = await (options.forward || forwardStoryGrace)(storyId, target, attempt.requestId, request.signal);
      if (disposed || request.signal.aborted) return;
      result.value = response.message;
      options.onForwarded(response.message);
    } catch (error) {
      if (!disposed) forwardError.value = request.signal.aborted ? "转发超时，内容已保留。请重试，同一次转发不会重复生成卡片。" : error instanceof Error ? error.message : "转发失败，请重试";
    } finally {
      clearTimeout(timeout);
      if (controller === request) { controller = null; forwardBusy.value = false; }
    }
  }
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; controller?.abort(); });
  return { forwardOpen, forwardBusy, forwardError, story, channelId, result, targetChannels, targetName, canSubmit, open, close, submit };
}
