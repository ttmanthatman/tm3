import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";
import type { VoiceTranscriptWord } from "../shared/types.js";
import type { MimoAsrConfig } from "./mimoAsr.js";

// Keys are sent only to the documented Beijing endpoints, never arbitrary hosts.
export function paraformerEndpoint(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "wss:" || url.username || url.password || url.port || url.search || url.hash
    || url.pathname !== "/api-ws/v1/inference"
    || !(url.hostname === "dashscope.aliyuncs.com" || /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname))) {
    throw new Error("请填写阿里云北京地域的 Paraformer WebSocket 地址");
  }
  return url.href;
}

const wordSchema = z.object({
  text: z.string(), punctuation: z.string().optional(),
  begin_time: z.number().finite().nonnegative(), end_time: z.number().finite().nonnegative()
}).refine((word) => word.end_time >= word.begin_time);
const sentenceSchema = z.object({
  text: z.string(), begin_time: z.number().finite().nonnegative(),
  end_time: z.number().finite().nonnegative().nullable(),
  sentence_end: z.boolean(), heartbeat: z.boolean().optional(),
  words: z.array(wordSchema)
});
const eventSchema = z.object({
  header: z.object({ event: z.string(), task_id: z.string() }),
  payload: z.object({ output: z.object({ sentence: z.unknown().optional() }).optional() }).optional()
});

export type ParaformerSocket = Pick<WebSocket, "on" | "send" | "close" | "terminate">;
export type ParaformerSocketFactory = (url: string, apiKey: string) => ParaformerSocket;

function handshakeError(status: number | undefined, body = ""): Error {
  if (status === 403) {
    try {
      const denied = z.object({ code: z.literal("AccessDenied"), message: z.literal("IP access denied by API-Key restriction.") }).safeParse(JSON.parse(body));
      if (denied.success) return new Error("Paraformer 访问被拒绝（HTTP 403）：API Key 的 IP 白名单未允许当前服务器，请在百炼控制台添加服务器公网出口 IP");
    } catch {
      // Non-JSON upstream responses still use the safe status-only diagnostic.
    }
  }
  switch (status) {
    case 401: return new Error("Paraformer 鉴权失败（HTTP 401），请使用有效的阿里云百炼北京地域 API Key，并确认已保存");
    case 403: return new Error("Paraformer 访问被拒绝（HTTP 403），请检查 API Key 所属地域、业务空间和模型访问权限");
    case 429: return new Error("Paraformer 请求受限（HTTP 429），请检查调用额度或稍后重试");
    default: return new Error(`Paraformer 服务连接被拒绝${status ? `（HTTP ${status}）` : ""}，请稍后重试`);
  }
}

function connectionError(error: Error & { code?: string }): Error {
  if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") return new Error("Paraformer 域名解析失败，请检查服务器 DNS 和出站网络");
  if (error.code === "ETIMEDOUT" || error.message === "Opening handshake has timed out") return new Error("Paraformer 连接超时，请检查服务器出站网络或稍后重试");
  if (["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(error.code || "")) {
    return new Error("Paraformer TLS 证书校验失败，请检查服务器时间和可信证书配置");
  }
  return new Error("Paraformer 网络连接失败，请检查服务器出站网络或稍后重试");
}

export async function transcribeParaformerWav(
  audioDataUrl: string,
  config: MimoAsrConfig,
  options: { socketFactory?: ParaformerSocketFactory; timeoutMs?: number } = {}
): Promise<{ transcript: string; transcriptWords: VoiceTranscriptWord[] }> {
  const endpoint = paraformerEndpoint(config.settings.baseUrl);
  if (config.settings.model !== "paraformer-realtime-v2") throw new Error("不支持的 Paraformer 模型");
  if (!/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(audioDataUrl)) throw new Error("Paraformer 音频格式无效");
  const audio = Buffer.from(audioDataUrl.slice(audioDataUrl.indexOf(",") + 1), "base64");
  const taskId = randomUUID();
  const factory: ParaformerSocketFactory = options.socketFactory || ((url, apiKey) => new WebSocket(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    handshakeTimeout: 20_000,
    maxPayload: 4 * 1024 * 1024,
    followRedirects: false
  }));
  return new Promise((resolve, reject) => {
    const socket = factory(endpoint, config.apiKey);
    const sentences = new Map<number, z.infer<typeof sentenceSchema>>();
    let settled = false;
    let started = false;
    let finishedSending = false;
    let offset = 0;
    const timeout = setTimeout(() => fail(new Error("Paraformer 识别超时，请稍后重试")), options.timeoutMs ?? 180_000);
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.terminate();
      reject(error);
    }
    function sendNext() {
      if (settled) return;
      if (offset >= audio.length) {
        finishedSending = true;
        socket.send(JSON.stringify({ header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } }),
          (error) => { if (error) fail(new Error("Paraformer 音频发送失败")); });
        return;
      }
      const chunk = audio.subarray(offset, offset + 32 * 1024);
      offset += chunk.length;
      // One outstanding frame at a time bounds the socket buffer for long files.
      socket.send(chunk, (error) => {
        if (error) fail(new Error("Paraformer 音频发送失败"));
        else setImmediate(sendNext);
      });
    }
    socket.on("open", () => {
      socket.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: { task_group: "audio", task: "asr", function: "recognition", model: config.settings.model,
          parameters: { format: "wav", sample_rate: 16000,
            ...(config.settings.language === "auto" ? {} : { language_hints: [config.settings.language] }) }, input: {} }
      }), (error) => { if (error) fail(new Error("Paraformer 任务启动失败")); });
    });
    socket.on("message", (data) => {
      if (settled) return;
      try {
        const event = eventSchema.parse(JSON.parse(data.toString()));
        if (event.header.task_id !== taskId) throw new Error("task mismatch");
        switch (event.header.event) {
          case "task-started":
            if (!started) { started = true; sendNext(); }
            break;
          case "result-generated": {
            const raw = event.payload?.output?.sentence;
            const status = z.object({ heartbeat: z.boolean().optional(), sentence_end: z.boolean().optional() }).parse(raw);
            if (status.heartbeat || !status.sentence_end) break;
            const sentence = sentenceSchema.parse(raw);
            if (sentence.text.trim() && !sentence.words.length) throw new Error("missing word timestamps");
            if (!sentence.heartbeat && sentence.sentence_end) sentences.set(sentence.begin_time, sentence);
            break;
          }
          case "task-failed":
            fail(new Error("Paraformer 识别失败，请检查 API Key、额度和模型权限"));
            break;
          case "task-finished": {
            if (!finishedSending) throw new Error("unfinished upload");
            const ordered = [...sentences.values()].sort((a, b) => a.begin_time - b.begin_time);
            const transcriptWords = ordered.flatMap((sentence) => {
              let cursor = 0;
              return sentence.words.map((word) => {
                const token = word.text + (word.punctuation || "");
                const position = sentence.text.indexOf(token, cursor);
                const gap = position >= cursor ? sentence.text.slice(cursor, position) : "";
                if (position >= cursor) cursor = position + token.length;
                // Preserve spaces between English words without inventing timings.
                return { text: (gap.trim() ? "" : gap) + token, beginMs: word.begin_time, endMs: word.end_time };
              });
            });
            const transcript = transcriptWords.map((word) => word.text).join("").trim();
            if (!transcript || !transcriptWords.length) throw new Error("missing transcript timestamps");
            settled = true;
            clearTimeout(timeout);
            socket.close();
            resolve({ transcript, transcriptWords });
            break;
          }
        }
      } catch {
        fail(new Error("Paraformer 返回的文字或时间戳无效"));
      }
    });
    // Match only documented diagnostic text; never expose raw upstream bodies,
    // headers or errors, which may include credentials or infrastructure details.
    socket.on("unexpected-response", (_request, response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > 8192) { fail(handshakeError(response.statusCode)); return; }
        chunks.push(chunk);
      });
      response.on("end", () => fail(handshakeError(response.statusCode, Buffer.concat(chunks).toString("utf8"))));
      response.on("error", () => fail(handshakeError(response.statusCode)));
      response.on("aborted", () => fail(handshakeError(response.statusCode)));
    });
    socket.on("error", (error) => fail(connectionError(error)));
    socket.on("close", () => { if (!settled) fail(new Error("Paraformer 连接中断，请稍后重试")); });
  });
}
