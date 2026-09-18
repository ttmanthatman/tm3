import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Prisma, type Message, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { MessageDTO } from "../../shared/types.js";
import type { MimoAsrService } from "../mimoAsr.js";
import { UPLOAD_DIR } from "../storageDirs.js";

export type TranscribeAuthContext = {
  accountId: number;
  isAdmin: boolean;
};

type AuthedTranscribeRequest = FastifyRequest & { auth: TranscribeAuthContext };

export type TranscribeRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  io: { to(room: string): { emit(event: string, payload: unknown): unknown } };
  asr: MimoAsrService;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  isVoiceMessage(message: Pick<Message, "type" | "fileName" | "payload">): boolean;
  convertVoiceToWavDataUrl?(inputPath: string): Promise<string>;
};

export class AsrAudioTooLongError extends Error {
  constructor() {
    super("voice audio exceeds ASR size limit");
  }
}

const ASR_WAV_BYTE_LIMIT = 25 * 1024 * 1024;

function transcodeToWav16k(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", outputPath], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let errorText = "";
    ffmpeg.stderr.on("data", (chunk) => {
      errorText += String(chunk).slice(0, 2000);
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorText || `ffmpeg exited ${code}`));
    });
  });
}

// MiMo 只接受 mp3/wav，存储的语音是 m4a，先转成 16kHz 单声道 wav 再 base64。
export async function voiceFileToWavDataUrl(inputPath: string): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tm3-asr-"));
  const wavPath = path.join(tempDir, "voice.wav");
  try {
    await transcodeToWav16k(inputPath, wavPath);
    const stat = await fs.promises.stat(wavPath);
    if (stat.size > ASR_WAV_BYTE_LIMIT) throw new AsrAudioTooLongError();
    const buffer = await fs.promises.readFile(wavPath);
    return `data:audio/wav;base64,${buffer.toString("base64")}`;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

function voicePayloadRaw(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function voiceTranscript(input: unknown) {
  const transcript = voicePayloadRaw(input).transcript;
  return typeof transcript === "string" ? transcript.trim() : "";
}

function voiceTranscriptAt(input: unknown) {
  const transcriptAt = voicePayloadRaw(input).transcriptAt;
  return typeof transcriptAt === "string" ? transcriptAt : "";
}

export function registerTranscribeRoutes(app: FastifyInstance, deps: TranscribeRouteDependencies) {
  const { prisma, requireAuth, io, asr, canAccessChannel, hydrateMessage, isVoiceMessage } = deps;
  const convertVoiceToWavDataUrl = deps.convertVoiceToWavDataUrl || voiceFileToWavDataUrl;

  app.get("/api/asr/capability", { preHandler: requireAuth }, async () => {
    const config = await asr.loadAsrConfig();
    return { enabled: !!config };
  });

  app.post(
    "/api/messages/:id/transcribe",
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = (request as AuthedTranscribeRequest).auth;
      const messageId = Number((request.params as { id: string }).id);
      if (!Number.isInteger(messageId) || messageId <= 0) return reply.code(404).send({ success: false, message: "消息不存在" });
      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return reply.code(404).send({ success: false, message: "消息不存在" });
      if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此语音" });
      if (!isVoiceMessage(message)) return reply.code(400).send({ success: false, message: "该消息不是语音消息" });
      const existingTranscript = voiceTranscript(message.payload);
      if (existingTranscript) {
        return {
          success: true,
          transcript: existingTranscript,
          transcriptAt: voiceTranscriptAt(message.payload),
          cached: true
        };
      }
      const config = await asr.loadAsrConfig();
      if (!config) {
        return reply.code(409).send({ success: false, message: auth.isAdmin ? "语音识别尚未配置，请前往 /ai-settings 填写 ASR API Key。" : "暂时还不能识别语音，请稍后再试。" });
      }
      if (!message.filePath) return reply.code(404).send({ success: false, message: "语音文件不存在" });
      const inputPath = path.join(UPLOAD_DIR, path.basename(message.filePath));
      if (!fs.existsSync(inputPath)) return reply.code(404).send({ success: false, message: "语音文件不存在" });
      let audioDataUrl = "";
      try {
        audioDataUrl = await convertVoiceToWavDataUrl(inputPath);
      } catch (error) {
        if (error instanceof AsrAudioTooLongError) return reply.code(413).send({ success: false, message: "语音太长，无法识别" });
        request.log.warn({ error, messageId }, "voice transcode for ASR failed");
        return reply.code(502).send({ success: false, message: "语音转码失败，请稍后再试" });
      }
      try {
        const transcript = await asr.transcribeWavDataUrl(audioDataUrl);
        const transcriptAt = new Date().toISOString();
        const payload = {
          ...voicePayloadRaw(message.payload),
          kind: "voice",
          transcript,
          transcriptAt
        };
        await prisma.message.update({ where: { id: message.id }, data: { payload: payload as Prisma.InputJsonObject } });
        const dto = await hydrateMessage(message.id, auth.accountId);
        if (dto) io.to(`ch:${message.channelId}`).emit("message:updated", dto);
        return { success: true, transcript, transcriptAt, cached: false };
      } catch (error) {
        request.log.warn({ error, messageId }, "voice transcription failed");
        return reply.code(502).send({ success: false, message: auth.isAdmin ? `语音识别失败：${String(error instanceof Error ? error.message : error).slice(0, 200)}` : "识别失败，可以稍后重试。" });
      }
    }
  );
}
