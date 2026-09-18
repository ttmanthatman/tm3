/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "@shared/types";
import { gracePayload, graceSubmissionReady, useGrace, type GraceUploadOptions } from "./useGrace";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
});

function graceMessage(id = 55): MessageDTO {
  return {
    id,
    channelId: 9,
    sender: { id: 3, kind: "human", username: "reader", displayName: "读者", avatarPath: null },
    content: "谢谢今天的平安",
    type: "grace",
    payload: { kind: "grace" },
    createdAt: "2026-09-17T08:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

interface GraceHarness {
  grace: ReturnType<typeof useGrace>;
  uploads: Array<{ file: File; options?: GraceUploadOptions }>;
  submitted: MessageDTO[];
  notices: string[];
  updated: MessageDTO[];
  deleted: number[];
  scrolls: boolean[];
  requests: Array<{ url: string; init?: RequestInit }>;
}

function createGraceHarness(options: { uploadSucceeds?: boolean } = {}): GraceHarness {
  const uploads: GraceHarness["uploads"] = [];
  const submitted: MessageDTO[] = [];
  const notices: string[] = [];
  const updated: MessageDTO[] = [];
  const deleted: number[] = [];
  const scrolls: boolean[] = [];
  const requests: GraceHarness["requests"] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target.endsWith("/api/grace")) return Promise.resolve(jsonResponse({ success: true, message: graceMessage() }));
    if (target.endsWith("/grateful")) return Promise.resolve(jsonResponse({ success: true, message: graceMessage(56) }));
    if (target.endsWith("/grace-update")) return Promise.resolve(jsonResponse({ success: true, message: graceMessage(57) }));
    if (target.endsWith("/grace") && init?.method === "DELETE") return Promise.resolve(jsonResponse({ success: true, deleted: 1 }));
    return Promise.resolve(jsonResponse({ message: "not found" }, 404));
  }) as typeof fetch;
  const grace = useGrace({
    uploadFile: async (file, uploadOptions) => {
      uploads.push({ file, options: uploadOptions });
      return options.uploadSucceeds === false
        ? { success: false, duplicate: false, skipped: false }
        : { success: true, duplicate: false, skipped: false, messageId: 77 };
    },
    currentChannelId: () => 9,
    onSubmitted: (message) => submitted.push(message),
    onUpdated: (message) => updated.push(message),
    onDeleted: () => { deleted.push(1); },
    scrollBottom: (smooth) => scrolls.push(!!smooth),
    notify: (text) => notices.push(text)
  });
  // 测试结束后恢复 fetch（node:test 串行执行本文件用例）。
  test.after(() => {
    globalThis.fetch = originalFetch;
  });
  return { grace, uploads, submitted, notices, updated, deleted, scrolls, requests };
}

test("graceSubmissionReady requires text or voice but accepts voice-only", () => {
  assert.equal(graceSubmissionReady("", false), false);
  assert.equal(graceSubmissionReady("   ", false), false);
  assert.equal(graceSubmissionReady(" 谢谢 ", false), true);
  assert.equal(graceSubmissionReady("", true), true);
});

test("gracePayload normalizes loose payload values and interaction defaults", () => {
  const message = { ...graceMessage(), payload: { kind: "grace", voiceMessageId: "5", imageMessageId: 0 } };
  const payload = gracePayload(message);
  assert.equal(payload.voiceMessageId, 5);
  assert.equal(payload.imageMessageId, null);
  assert.equal(payload.gratitudeCount, 0);
  assert.equal(payload.currentUserGrateful, false);
  assert.deepEqual(payload.gratefulBy, []);
  assert.deepEqual(payload.aiSuggestions, []);
});

test("empty grace submission is rejected before any network request", async () => {
  const { grace, requests } = createGraceHarness();
  grace.openGraceComposer();
  await grace.submitGrace();
  assert.equal(requests.length, 0);
  assert.ok(grace.graceError.value.includes("文字") || grace.graceError.value.includes("语音"));
  assert.equal(grace.graceComposerOpen.value, true);
});

test("text-only grace submission posts a card to the current channel without navigating", async () => {
  const { grace, uploads, submitted, notices, requests } = createGraceHarness();
  grace.openGraceComposer("谢谢今天的平安");
  await grace.submitGrace();

  const gracePost = requests.find((request) => request.url.endsWith("/api/grace") && request.init?.method === "POST");
  assert.ok(gracePost, "expected POST /api/grace");
  assert.deepEqual(JSON.parse(String(gracePost.init?.body)), { channelId: 9, content: "谢谢今天的平安" });
  assert.equal(uploads.length, 0);
  assert.deepEqual(submitted.map((message) => message.id), [55]);
  assert.deepEqual(notices, ["恩典卡片已发送"]);
  assert.equal(grace.graceComposerOpen.value, false);
  assert.equal(grace.graceError.value, "");
});

test("voice-only grace submission uploads through the shared voice upload channel", async () => {
  const { grace, uploads, submitted, requests } = createGraceHarness();
  grace.openGraceComposer();
  grace.audioFile.value = new File([new Blob(["audio"])], "语音消息-1.m4a", { type: "audio/mp4" });
  grace.audioPreviewDurationMs.value = 1200;
  grace.audioPreviewWaveform.value = [0.5, 0.8];
  await grace.submitGrace();

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options?.voice, true);
  assert.equal(uploads[0].options?.channelId, 9);
  assert.equal(uploads[0].options?.durationMs, 1200);
  const gracePost = requests.find((request) => request.url.endsWith("/api/grace") && request.init?.method === "POST");
  assert.ok(gracePost);
  assert.deepEqual(JSON.parse(String(gracePost.init?.body)), { channelId: 9, voiceMessageId: 77 });
  assert.deepEqual(submitted.map((message) => message.id), [55]);
});

test("a failed voice upload keeps the composer open with an inline error", async () => {
  const { grace, submitted, requests } = createGraceHarness({ uploadSucceeds: false });
  grace.openGraceComposer();
  grace.audioFile.value = new File([new Blob(["audio"])], "语音消息-2.m4a", { type: "audio/mp4" });
  await grace.submitGrace();

  assert.ok(grace.graceError.value.includes("语音上传失败"));
  assert.equal(grace.graceComposerOpen.value, true);
  assert.equal(submitted.length, 0);
  assert.equal(requests.some((request) => request.url.endsWith("/api/grace") && request.init?.method === "POST"), false);
});

test("gratitude records against the grace card and replaces the rendered message", async () => {
  const { grace, updated, requests } = createGraceHarness();
  await grace.markGraceGrateful(graceMessage());
  assert.equal(requests.at(-1)?.url.endsWith("/api/messages/55/grateful"), true);
  assert.equal(requests.at(-1)?.init?.method, "POST");
  assert.deepEqual(updated.map((message) => message.id), [56]);
});

test("updating a testimony reuses the update editor flow and appends the pushed card", async () => {
  const { grace, submitted, scrolls, requests } = createGraceHarness();
  grace.openGraceUpdateEditor(graceMessage());
  grace.graceUpdateContent.value = "后来身体恢复了";
  await grace.publishGraceUpdate();

  const update = requests.find((request) => request.url.endsWith("/api/messages/55/grace-update"));
  assert.ok(update);
  assert.equal(update.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(update.init?.body)), { content: "后来身体恢复了", imageMessageId: null });
  assert.deepEqual(submitted.map((message) => message.id), [57]);
  assert.deepEqual(scrolls, [true]);
  assert.equal(grace.pendingGraceUpdate.value, null);
});
