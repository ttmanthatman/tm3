/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { MessageDTO, MusicTrackDTO } from "@shared/types";
import { useComposer, type ComposerMentionToken } from "./useComposer";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
});

setActivePinia(createPinia());

function createComposerHarness() {
  const sent: unknown[] = [];
  const gracePrefills: string[] = [];
  const input = ref("");
  const composerCaret = ref(0);
  const composer = useComposer({
    input,
    composerFocused: ref(false),
    selectedMusicMention: ref<MusicTrackDTO | null>(null),
    composerCaret,
    composerSuggestionIndex: ref(0),
    composerSuggestionSuppressed: ref(false),
    replyTo: ref<MessageDTO | null>(null),
    musicMentionToken: ref<ComposerMentionToken | null>(null),
    composerInput: ref<HTMLTextAreaElement | null>(null),
    composerPanel: ref<"voice" | "more" | null>(null),
    messageSendPending: ref(false),
    messageSendStatus: ref(""),
    clearMessageSendStatus: () => undefined,
    sendMessage: async (payload: unknown) => {
      sent.push(payload);
      return { ok: true as const };
    },
    openGraceComposer: (prefill: string) => {
      gracePrefills.push(prefill);
    },
    prayerComposerPhoto: ref<File | null>(null),
    uploadPrayerImage: async () => 0,
    clearPrayerComposerPhoto: () => undefined,
    isRecording: ref(false),
    startRecording: async () => undefined,
    stopRecording: () => undefined,
    audioFile: ref<File | null>(null),
    sortedMusicTracks: () => [],
    chooseActiveSuggestion: () => undefined
  });
  return { composer, input, composerCaret, sent, gracePrefills };
}

test("parseComposerText recognizes /恩典 with and without inline content", () => {
  const { composer } = createComposerHarness();
  assert.deepEqual(composer.parseComposerText("/恩典"), {
    content: "",
    effect: undefined,
    type: "grace",
    contentFormat: undefined
  });
  assert.deepEqual(composer.parseComposerText("/恩典 今天路上很顺利"), {
    content: "今天路上很顺利",
    effect: undefined,
    type: "grace",
    contentFormat: undefined
  });
  assert.equal(composer.parseComposerText("/恩典\n第一行\n第二行").content, "第一行\n第二行");
});

test("the slash suggestion menu offers /恩典 as a grace command", () => {
  const { composer, input, composerCaret } = createComposerHarness();
  input.value = "/";
  composerCaret.value = 1;
  const grace = composer.matchingSlashCommands.value.find((item) => item.command === "/恩典");
  assert.ok(grace, "expected /恩典 in the root slash suggestions");
  assert.equal(grace.kind, "grace");
  input.value = "/恩";
  composerCaret.value = 2;
  assert.ok(composer.matchingSlashCommands.value.some((item) => item.command === "/恩典"));
});

test("sendText opens the grace composer instead of sending a text message", async () => {
  const { composer, input, sent, gracePrefills } = createComposerHarness();
  input.value = "/恩典 谢谢今天的平安";
  await composer.sendText();
  assert.deepEqual(gracePrefills, ["谢谢今天的平安"]);
  assert.equal(sent.length, 0);
  assert.equal(input.value, "");
});

test("sendText keeps plain text on the normal send path", async () => {
  const { composer, input, sent, gracePrefills } = createComposerHarness();
  const { useChatStore } = await import("../../store");
  useChatStore().currentChannelId = 7;
  input.value = "普通消息";
  await composer.sendText();
  assert.equal(sent.length, 1);
  assert.deepEqual(gracePrefills, []);
});

test("the grace subchannel opens the grace composer for typed text", async () => {
  const { composer, input, sent, gracePrefills } = createComposerHarness();
  const { useChatStore } = await import("../../store");
  const store = useChatStore();
  store.currentChannelId = 7;
  store.graceOnly = true;
  try {
    input.value = "今天顺利回家";
    await composer.sendText();
    assert.deepEqual(gracePrefills, ["今天顺利回家"]);
    assert.equal(sent.length, 0);
  } finally {
    store.graceOnly = false;
  }
});
