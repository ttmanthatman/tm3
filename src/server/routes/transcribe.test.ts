import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Message, PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import type { MimoAsrService } from "../mimoAsr.js";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-transcribe-test-"));
process.env.STORAGE_ROOT = storageRoot;
fs.mkdirSync(path.join(storageRoot, "uploads"), { recursive: true });
fs.writeFileSync(path.join(storageRoot, "uploads", "voice-1.m4a"), Buffer.from("fake-m4a"));

const { registerTranscribeRoutes } = await import("./transcribe.js");

type MessageStub = {
  id: number;
  channelId: number;
  type: string;
  fileName: string | null;
  filePath: string | null;
  payload: unknown;
};

function voiceMessageStub(overrides: Partial<MessageStub> = {}): MessageStub {
  return {
    id: 42,
    channelId: 7,
    type: "file",
    fileName: "voice.m4a",
    filePath: "voice-1.m4a",
    payload: { kind: "voice", durationMs: 1200 },
    ...overrides
  };
}

function createHarness(options: { asrConfigured?: boolean; canAccess?: boolean; isAdmin?: boolean; message?: MessageStub | null } = {}) {
  const message = options.message === undefined ? voiceMessageStub() : options.message;
  const messageUpdates: Array<{ id: number; payload: unknown }> = [];
  const prisma = {
    message: {
      findUnique: async ({ where }: { where: { id: number } }) => (message && where.id === message.id ? message : null),
      update: async ({ where, data }: { where: { id: number }; data: { payload: unknown } }) => {
        messageUpdates.push({ id: where.id, payload: data.payload });
        if (message && where.id === message.id) message.payload = data.payload;
        return message;
      }
    }
  } as unknown as PrismaClient;

  const transcribeCalls: string[] = [];
  const asr: MimoAsrService = {
    loadAsrConfig: async () =>
      options.asrConfigured === false
        ? null
        : { settings: { enabled: true, apiKeyConfigured: true, baseUrl: "https://asr.test/v1", model: "mimo-v2.5-asr", language: "auto" }, apiKey: "sk-fake" },
    transcribeWavDataUrl: async (audioDataUrl: string) => {
      transcribeCalls.push(audioDataUrl);
      return "这是识别结果";
    }
  };

  const emissions: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emissions.push({ room, event, payload });
      }
    })
  };

  const requireAuth = async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { auth: { accountId: number; isAdmin: boolean } }).auth = { accountId: 2, isAdmin: !!options.isAdmin };
  };

  const app = Fastify();
  registerTranscribeRoutes(app, {
    prisma,
    requireAuth,
    io,
    asr,
    canAccessChannel: async () => options.canAccess !== false,
    hydrateMessage: async (id) => ({ id, channelId: 7 }) as MessageDTO,
    isVoiceMessage: (candidate: Pick<Message, "type" | "fileName" | "payload">) => {
      const payload = candidate.payload as { kind?: unknown } | null;
      return candidate.type === "file" && payload?.kind === "voice" && /\.(webm|mp3|m4a|wav|ogg|aac|mp4)$/i.test(candidate.fileName || "");
    },
    convertVoiceToWavDataUrl: async () => "data:audio/wav;base64,QUJD"
  });
  return { app, messageUpdates, transcribeCalls, emissions };
}

test("transcribe success: merges transcript into the payload and broadcasts the update", async () => {
  const { app, messageUpdates, transcribeCalls, emissions } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/42/transcribe" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { success: true, transcript: "这是识别结果" });
    assert.deepEqual(transcribeCalls, ["data:audio/wav;base64,QUJD"]);
    assert.equal(messageUpdates.length, 1);
    const payload = messageUpdates[0].payload as Record<string, unknown>;
    assert.equal(payload.kind, "voice");
    assert.equal(payload.durationMs, 1200);
    assert.equal(payload.transcript, "这是识别结果");
    assert.equal(typeof payload.transcriptAt, "string");
    assert.deepEqual(
      emissions.map((entry) => [entry.room, entry.event]),
      [["ch:7", "message:updated"]]
    );
  } finally {
    await app.close();
  }
});

test("transcribe is idempotent when a transcript already exists", async () => {
  const { app, transcribeCalls } = createHarness({
    message: voiceMessageStub({ payload: { kind: "voice", transcript: "已有文字", transcriptAt: "2026-09-17T00:00:00.000Z" } })
  });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/42/transcribe" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { success: true, transcript: "已有文字" });
    assert.equal(transcribeCalls.length, 0);
  } finally {
    await app.close();
  }
});

test("transcribe returns 409 when ASR is not configured", async () => {
  const { app, transcribeCalls } = createHarness({ asrConfigured: false });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/42/transcribe" });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().success, false);
    assert.equal(transcribeCalls.length, 0);
  } finally {
    await app.close();
  }
});

test("transcribe returns 400 for non-voice messages", async () => {
  const { app } = createHarness({ message: voiceMessageStub({ type: "text", fileName: null, filePath: null, payload: null }) });
  await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/messages/42/transcribe" });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().success, false);
  } finally {
    await app.close();
  }
});

test("transcribe returns 404 for unknown messages and 403 for non-members", async () => {
  const missing = createHarness({ message: null });
  await missing.app.ready();
  try {
    const response = await missing.app.inject({ method: "POST", url: "/api/messages/42/transcribe" });
    assert.equal(response.statusCode, 404);
  } finally {
    await missing.app.close();
  }
  const forbidden = createHarness({ canAccess: false });
  await forbidden.app.ready();
  try {
    const response = await forbidden.app.inject({ method: "POST", url: "/api/messages/42/transcribe" });
    assert.equal(response.statusCode, 403);
  } finally {
    await forbidden.app.close();
  }
});

test("capability endpoint reflects ASR configuration", async () => {
  const configured = createHarness();
  await configured.app.ready();
  try {
    const response = await configured.app.inject({ method: "GET", url: "/api/asr/capability" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { enabled: true });
  } finally {
    await configured.app.close();
  }
  const unconfigured = createHarness({ asrConfigured: false });
  await unconfigured.app.ready();
  try {
    const response = await unconfigured.app.inject({ method: "GET", url: "/api/asr/capability" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { enabled: false });
  } finally {
    await unconfigured.app.close();
  }
});
