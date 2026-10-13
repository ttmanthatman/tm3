import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { paraformerEndpoint, transcribeParaformerWav, type ParaformerSocket } from "./paraformerAsr.js";

const config = { apiKey: "fake-key", settings: { enabled: true, apiKeyConfigured: true,
  baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference", model: "paraformer-realtime-v2", language: "zh" as const } };
const audio = "data:audio/wav;base64," + Buffer.from("fake wav bytes").toString("base64");

test("only official secure endpoints accept the key", () => {
  assert.equal(paraformerEndpoint(config.settings.baseUrl), config.settings.baseUrl);
  assert.match(paraformerEndpoint("wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"), /workspace-1/);
  for (const url of ["ws://dashscope.aliyuncs.com/api-ws/v1/inference", "wss://localhost/api-ws/v1/inference",
    "wss://dashscope.aliyuncs.com.evil.test/api-ws/v1/inference", "wss://user:pass@dashscope.aliyuncs.com/api-ws/v1/inference",
    "wss://dashscope.aliyuncs.com/api-ws/v1/inference?key=x"]) assert.throws(() => paraformerEndpoint(url));
});

async function harness(action: "success" | "english" | "failure" | "invalid" | "close" | "timeout" | "unauthorized" | "forbidden" | "ip-denied" | "rate-limited" | "unavailable") {
  const rejection = { unauthorized: 401, forbidden: 403, "ip-denied": 403, "rate-limited": 429, unavailable: 503 };
  const status = action in rejection ? rejection[action as keyof typeof rejection] : undefined;
  const rejectionBody = action === "ip-denied"
    ? JSON.stringify({ code: "AccessDenied", message: "IP access denied by API-Key restriction.", privateKey: "fake-key" })
    : "private upstream details";
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0,
    ...(status ? { verifyClient: (_info: unknown, done: (valid: boolean, code?: number, message?: string) => void) => done(false, status, rejectionBody) } : {})
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let taskId = "";
  const frames: Buffer[] = [];
  let run: Record<string, unknown> | undefined;
  let authorization: string | undefined;
  server.on("connection", (socket, request) => {
    authorization = request.headers.authorization;
    const event = (name: string, sentence?: unknown) => socket.send(JSON.stringify({
      header: { event: name, task_id: taskId }, payload: sentence ? { output: { sentence } } : {}
    }));
    socket.on("message", (data, binary) => {
      if (binary) { frames.push(Buffer.from(data as Buffer)); return; }
      const message = JSON.parse(data.toString());
      taskId = message.header.task_id;
      if (message.header.action === "run-task") {
        run = message;
        if (action === "timeout") return;
        if (action === "close") { socket.close(); return; }
        event("task-started");
        return;
      }
      if (action === "failure") { event("task-failed"); return; }
      // Heartbeats and revisable partial sentences must never be persisted.
      event("result-generated", { heartbeat: true });
      event("result-generated", { sentence_end: false, text: "暂定", end_time: null });
      event("result-generated", action === "english"
        ? { begin_time: 300, end_time: 1000, text: "Hello world.", sentence_end: true, words: [
          { text: "Hello", begin_time: 300, end_time: 600 }, { text: "world", punctuation: ".", begin_time: 700, end_time: 1000 }
        ] }
        : { begin_time: 300, end_time: null, text: "你好。", sentence_end: true,
          words: [{ text: "你好", punctuation: "。", begin_time: action === "invalid" ? -1 : 300, end_time: 700 }] });
      event("task-finished");
    });
  });
  try {
    const result = await transcribeParaformerWav(audio, config, {
      socketFactory: (_url, key) => new WebSocket(`ws://127.0.0.1:${address.port}`, { headers: { Authorization: `Bearer ${key}` } }),
      timeoutMs: action === "timeout" ? 100 : 3000
    });
    assert.equal(authorization, "Bearer fake-key");
    assert.equal(Buffer.concat(frames).toString(), "fake wav bytes");
    assert.equal((run?.payload as { parameters: { format: string } }).parameters.format, "wav");
    return result;
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
test("WebSocket task uploads binary WAV and saves only finalized word timestamps", async () => {
  assert.deepEqual(await harness("success"), { transcript: "你好。", transcriptWords: [{ text: "你好。", beginMs: 300, endMs: 700 }] });
});
test("English subtitles keep word spacing and the original timestamps", async () => {
  assert.deepEqual(await harness("english"), { transcript: "Hello world.", transcriptWords: [
    { text: "Hello", beginMs: 300, endMs: 600 }, { text: " world.", beginMs: 700, endMs: 1000 }
  ] });
});
test("failure, malformed timestamps, disconnect and timeout reject and release the socket", async () => {
  for (const scenario of ["failure", "invalid", "close", "timeout"] as const) await assert.rejects(() => harness(scenario), /Paraformer/);
});

test("handshake rejections distinguish authentication, permissions, limits and availability without exposing upstream details", async () => {
  for (const [scenario, expected] of [
    ["unauthorized", /HTTP 401.*北京/], ["forbidden", /HTTP 403.*权限/], ["ip-denied", /HTTP 403.*IP 白名单.*公网出口 IP/],
    ["rate-limited", /HTTP 429.*稍后重试/], ["unavailable", /HTTP 503.*稍后重试/]
  ] as const) {
    await assert.rejects(() => harness(scenario), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /private upstream details|fake-key/);
      return true;
    });
  }
});

test("DNS, TLS and timeout errors remain actionable without echoing raw errors or secrets", async () => {
  for (const [code, message, expected] of [
    ["ENOTFOUND", "private upstream details fake-key", /域名解析失败/],
    ["CERT_HAS_EXPIRED", "private upstream details fake-key", /TLS 证书校验失败/],
    ["ETIMEDOUT", "private upstream details fake-key", /连接超时/],
    [undefined, "Opening handshake has timed out", /连接超时/],
    ["ECONNRESET", "private upstream details fake-key", /网络连接失败/]
  ] as const) {
    let terminated = 0;
    await assert.rejects(() => transcribeParaformerWav(audio, config, {
      socketFactory: () => {
        const socket = Object.assign(new EventEmitter(), {
          send() {}, close() {}, terminate() { terminated++; }
        });
        queueMicrotask(() => socket.emit("error", Object.assign(new Error(message), { code })));
        return socket as unknown as ParaformerSocket;
      }, timeoutMs: 1000
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /private upstream details|fake-key/);
      return true;
    });
    assert.equal(terminated, 1);
  }
});
