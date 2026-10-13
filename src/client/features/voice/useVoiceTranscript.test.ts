/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import type { MessageDTO } from "@shared/types";
import { canShowTranscriptChip, invalidateAsrCapability, useVoiceTranscript, voiceTranscript } from "./useVoiceTranscript";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
});

function voiceMessage(payload: unknown, overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: 31,
    channelId: 9,
    sender: { id: 3, kind: "human", username: "reader", displayName: "读者", avatarPath: null },
    content: "",
    type: "file",
    payload,
    fileName: "语音消息-1.m4a",
    createdAt: "2026-09-17T08:00:00.000Z",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("voiceTranscript only reads transcripts from voice payloads", () => {
  assert.equal(voiceTranscript(voiceMessage({ kind: "voice", transcript: "你好" })), "你好");
  assert.equal(voiceTranscript(voiceMessage({ kind: "voice" })), "");
  assert.equal(voiceTranscript(voiceMessage({ kind: "audio", transcript: "音乐" })), "");
  assert.equal(voiceTranscript(voiceMessage(undefined)), "");
});

test("canShowTranscriptChip requires capability, a voice payload, and no transcript", () => {
  const voice = voiceMessage({ kind: "voice" });
  assert.equal(canShowTranscriptChip(null, voice), false);
  assert.equal(canShowTranscriptChip(false, voice), false);
  assert.equal(canShowTranscriptChip(true, voice), true);
  assert.equal(canShowTranscriptChip(true, voiceMessage({ kind: "voice", transcript: "已有" })), false);
  assert.equal(canShowTranscriptChip(true, voiceMessage({ kind: "audio" })), false);
});

test("a successful transcription patches the store message payload", async () => {
  setActivePinia(createPinia());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    assert.equal(String(url), "/api/messages/31/transcribe");
    return Promise.resolve(jsonResponse({ transcript: "识别出的文字", transcriptAt: "2026-09-18T01:02:03.000Z", cached: false }));
  }) as typeof fetch;
  try {
    const { useChatStore } = await import("../../store");
    const store = useChatStore();
    store.currentChannelId = 9;
    const transcript = useVoiceTranscript();
    transcript.asrCapability.value = true;
    const message = voiceMessage({ kind: "voice" });
    await transcript.transcribeVoice(message);
    const stored = store.messages.find((row) => row.id === 31);
    assert.ok(stored, "expected the message to be stored");
    assert.equal((stored.payload as { transcript?: string }).transcript, "识别出的文字");
    assert.equal((stored.payload as { transcriptAt?: string }).transcriptAt, "2026-09-18T01:02:03.000Z");
    assert.equal(transcript.isTranscriptBusy(message), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a 409 response hides the chip for the rest of the session", async () => {
  setActivePinia(createPinia());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(jsonResponse({ message: "未配置语音识别" }, 409))) as typeof fetch;
  try {
    const transcript = useVoiceTranscript();
    transcript.asrCapability.value = true;
    const message = voiceMessage({ kind: "voice" });
    await transcript.transcribeVoice(message);
    assert.equal(transcript.asrCapability.value, false);
    assert.equal(transcript.transcriptNotice.value, "未配置语音识别");
    assert.equal(canShowTranscriptChip(transcript.asrCapability.value, message), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Paraformer upgrade requests timestamps and keeps the reusable word timing in the store", async () => {
  setActivePinia(createPinia());
  const originalFetch = globalThis.fetch;
  const words = [{ text: "字幕", beginMs: 100, endMs: 800 }];
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(JSON.parse(String(init?.body)).timestamps, true);
    return Promise.resolve(jsonResponse({ transcript: "字幕", transcriptWords: words, transcriptProvider: "paraformer" }));
  }) as typeof fetch;
  try {
    const { useChatStore } = await import("../../store");
    const store = useChatStore();
    store.currentChannelId = 9;
    const transcript = useVoiceTranscript();
    transcript.asrCapability.value = true;
    transcript.asrTimestamps.value = true;
    const message = voiceMessage({ kind: "voice", transcript: "旧文字" });
    assert.equal(canShowTranscriptChip(true, message, true), true);
    await transcript.transcribeVoice(message);
    const stored = store.messages.find((row) => row.id === message.id)!;
    assert.deepEqual((stored.payload as { transcriptWords: unknown }).transcriptWords, words);
    assert.equal(canShowTranscriptChip(true, stored, true), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a delayed capability response cannot overwrite an administrator's new selection", async () => {
  setActivePinia(createPinia());
  const originalFetch = globalThis.fetch;
  const responses: Array<(response: Response) => void> = [];
  globalThis.fetch = (() => new Promise<Response>((resolve) => responses.push(resolve))) as typeof fetch;
  try {
    const transcript = useVoiceTranscript();
    transcript.asrCapability.value = null;
    const oldRequest = transcript.ensureAsrCapability();
    invalidateAsrCapability();
    const newRequest = transcript.ensureAsrCapability();
    responses[1](jsonResponse({ enabled: false, timestamps: false }));
    await newRequest;
    responses[0](jsonResponse({ enabled: true, timestamps: true }));
    await oldRequest;
    assert.equal(transcript.asrCapability.value, false);
    assert.equal(transcript.asrTimestamps.value, false);
  } finally { globalThis.fetch = originalFetch; }
});
