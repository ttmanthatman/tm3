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

function createComposerHarness(sendResult: () => Promise<{ ok: true } | { ok: false; reason: "timeout"; message: string }> = async () => ({ ok: true })) {
  const sent: unknown[] = [];
  const gracePrefills: string[] = [];
  const input = ref("");
  const composerCaret = ref(0);
  const panel = ref<"voice" | "more" | null>(null);
  const recording = ref(false);
  const file = ref<File | null>(null);
  let starts = 0;
  let stops = 0;
  const listenMusicMentions = ref<MusicTrackDTO[]>([]);
  const messageSendStatus = ref("");
  const composer = useComposer({
    input,
    composerFocused: ref(false),
    selectedMusicMention: ref<MusicTrackDTO | null>(null),
    listenMusicMentions,
    composerCaret,
    composerSuggestionIndex: ref(0),
    composerSuggestionSuppressed: ref(false),
    replyTo: ref<MessageDTO | null>(null),
    musicMentionToken: ref<ComposerMentionToken | null>(null),
    composerInput: ref<HTMLTextAreaElement | null>(null),
    composerPanel: panel,
    messageSendPending: ref(false),
    messageSendStatus,
    clearMessageSendStatus: () => undefined,
    sendMessage: async (payload: unknown) => {
      sent.push(payload);
      return sendResult();
    },
    openGraceComposer: (prefill: string) => {
      gracePrefills.push(prefill);
    },
    prayerComposerPhoto: ref<File | null>(null),
    uploadPrayerImage: async () => 0,
    clearPrayerComposerPhoto: () => undefined,
    isRecording: recording,
    startRecording: async () => { starts++; recording.value = true; },
    stopRecording: () => { stops++; recording.value = false; file.value = new File(["voice"], "voice.m4a"); },
    audioFile: file,
    sortedMusicTracks: () => [],
    chooseActiveSuggestion: () => undefined
  });
  return { composer, input, composerCaret, sent, gracePrefills, panel, recording, file, listenMusicMentions, messageSendStatus, starts: () => starts, stops: () => stops };
}

test("/听 parses as a listen draft and appears in the slash suggestions", () => {
  const { composer, input, composerCaret } = createComposerHarness();
  assert.equal(composer.parseComposerText("/听 诗篇23 @@奇异恩典").type, "listen");
  assert.equal(composer.parseComposerText("/听 诗篇23 @@奇异恩典").content, "诗篇23 @@奇异恩典");
  input.value = "/听";
  composerCaret.value = 2;
  assert.ok(composer.matchingSlashCommands.value.some((item) => item.kind === "listen" && item.command === "/听"));
  assert.equal(composer.listenComposerActive.value, true);
  input.value = "普通消息";
  assert.equal(composer.listenComposerActive.value, false);
});

test("sendText turns a /听 draft into a text message carrying an ordered listen_playlist payload", async () => {
  const { composer, input, sent, listenMusicMentions } = createComposerHarness();
  const { useChatStore } = await import("../../store");
  useChatStore().currentChannelId = 7;
  const grace = { id: 7, title: "奇异恩典" } as MusicTrackDTO;
  listenMusicMentions.value = [grace];
  input.value = "/听 睡前听 诗篇23 @@奇异恩典 约翰福音3:16";
  await composer.sendText();
  assert.equal(sent.length, 1);
  const payload = sent[0] as { type: string; content: string; payload: { kind: string; items: unknown[]; note?: string } };
  assert.equal(payload.type, "text");
  assert.equal(payload.content, "一起听：诗篇23 · ♪奇异恩典 · 约翰福音3:16\n睡前听");
  assert.deepEqual(payload.payload, {
    kind: "listen_playlist",
    items: [
      { kind: "scripture", reference: "诗篇23" },
      { kind: "track", trackId: 7 },
      { kind: "scripture", reference: "约翰福音3:16" }
    ],
    note: "睡前听"
  });
  assert.equal(input.value, "");
  assert.deepEqual(listenMusicMentions.value, []);
});

test("an empty /听 draft is refused with a hint instead of being sent", async () => {
  const { composer, input, sent, messageSendStatus } = createComposerHarness();
  const { useChatStore } = await import("../../store");
  useChatStore().currentChannelId = 7;
  input.value = "/听 今晚一起听吧";
  await composer.sendText();
  assert.equal(sent.length, 0);
  assert.match(messageSendStatus.value, /经文|@@/);
  assert.equal(input.value, "/听 今晚一起听吧");
});

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

test("sending preserves a final-space assistant opt-out after plain text or slash command normalization", async () => {
  const { useChatStore } = await import("../../store");
  useChatStore().currentChannelId = 7;
  for (const draft of ["@所罗没门 为什么？ ", "/Markdown @所罗没门 为什么？ ", "/闪动 为什么？\u00a0", "/听 诗篇23 "]) {
    const { composer, input, sent } = createComposerHarness();
    input.value = draft;
    await composer.sendText();
    assert.equal(sent.length, 1, draft);
    const message = sent[0] as { content: string; payload?: Record<string, unknown> };
    assert.equal(message.content.endsWith(" "), true, draft);
    assert.equal(message.payload?.aiActivationSuppressed, undefined);
  }
});

test("an unconfirmed send reuses its request id when the user retries", async () => {
  let calls = 0;
  const { composer, input, sent } = createComposerHarness(async () => {
    calls += 1;
    return calls === 1 ? { ok: false, reason: "timeout", message: "未确认" } : { ok: true };
  });
  const { useChatStore } = await import("../../store");
  const store = useChatStore();
  store.currentChannelId = 7;
  store.account = { id: 1, actorId: 2 } as typeof store.account;
  input.value = "平安";
  await composer.sendText();
  assert.equal(composer.unconfirmedSends.value.length, 1);
  assert.equal(input.value, "平安");
  await composer.sendText();
  assert.equal(sent.length, 2);
  assert.equal((sent[0] as { clientRequestId: string }).clientRequestId, (sent[1] as { clientRequestId: string }).clientRequestId);
  assert.equal(composer.unconfirmedSends.value.length, 0);
  assert.equal(input.value, "");
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


test("microphone starts once, stops into a retained preview, and closes the empty panel after deletion", async () => {
  const h = createComposerHarness();
  await h.composer.toggleVoicePanel();
  assert.equal(h.starts(), 1);
  assert.equal(h.recording.value, true);
  await h.composer.toggleVoicePanel();
  assert.equal(h.stops(), 1);
  assert.ok(h.file.value);
  assert.equal(h.panel.value, "voice");
  await h.composer.toggleVoicePanel();
  assert.equal(h.starts(), 1);
  assert.equal(h.panel.value, "voice");
  h.file.value = null;
  await h.composer.toggleVoicePanel();
  assert.equal(h.panel.value, null);
  assert.equal(h.starts(), 1);
  await h.composer.toggleVoicePanel();
  assert.equal(h.starts(), 2);
});

test("opening a retained preview never starts a replacement recording", async () => {
  const h = createComposerHarness();
  h.file.value = new File(["saved"], "voice.m4a");
  await h.composer.toggleVoicePanel();
  assert.equal(h.panel.value, "voice");
  assert.equal(h.starts(), 0);
});
