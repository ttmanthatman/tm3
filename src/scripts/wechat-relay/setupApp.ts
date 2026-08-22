import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseRelayEnvironment,
  resolveRelaySetupInput,
  type RelaySetupConnection,
  type RelaySetupInput
} from "./setupConfig.js";

const ENVIRONMENT_PATH = "/etc/wechat-relay.env";
const MAX_REQUEST_BYTES = 16_384;

export interface RelaySetupServerDependencies {
  existingEnvironment?: string;
  validateConnection?: (connection: RelaySetupConnection) => Promise<void>;
  applyConnection?: (connection: RelaySetupConnection) => Promise<void>;
  onConnected?: (connection: RelaySetupConnection) => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "连接失败，请检查输入后重试";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  })[character] || character);
}

function readExistingEnvironment() {
  try {
    return fs.readFileSync(ENVIRONMENT_PATH, "utf8");
  } catch {
    return "";
  }
}

function setupPage(nonce: string, baseUrl: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>微信转发连接设置</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Noto Sans CJK SC", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6f3; color: #18211a; }
    main { width: min(680px, calc(100% - 32px)); margin: 24px auto; padding: 30px; border: 1px solid #d8dfd8; border-radius: 18px; background: white; box-shadow: 0 18px 50px #18211a12; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .lead { margin: 0 0 24px; color: #647067; line-height: 1.6; }
    label { display: block; margin: 18px 0 7px; font-weight: 650; }
    textarea, input[type="url"], input[type="password"], input[type="text"] { width: 100%; border: 1px solid #cdd5ce; border-radius: 10px; padding: 12px 13px; font: inherit; background: #fff; }
    textarea { min-height: 104px; resize: vertical; font-family: ui-monospace, monospace; }
    textarea:focus, input:focus { outline: 3px solid #20ad4925; border-color: #20ad49; }
    .hint { margin: 7px 0 0; color: #778078; font-size: 14px; line-height: 1.5; }
    .row { display: flex; align-items: center; gap: 9px; margin-top: 9px; font-size: 14px; color: #59645b; }
    .actions { display: flex; gap: 10px; margin-top: 24px; }
    button { border: 0; border-radius: 10px; padding: 12px 22px; font: inherit; font-weight: 700; cursor: pointer; }
    button[type="submit"] { background: #18ad3d; color: white; }
    button.secondary { background: #edf1ed; color: #344038; }
    button:disabled { opacity: .55; cursor: wait; }
    #status { display: none; margin-top: 18px; padding: 13px 15px; border-radius: 10px; line-height: 1.55; white-space: pre-wrap; }
    #status.busy { display: block; background: #f2f5f2; color: #4c574e; }
    #status.error { display: block; background: #fff1ed; color: #a43a1f; }
    #status.success { display: block; background: #eaf8ea; color: #14752d; }
  </style>
</head>
<body>
  <main>
    <h1>微信转发连接设置</h1>
    <p class="lead">在生产聊天室的“微信通知转发”页面点“复制 NAS 配置”，粘贴到这里，然后连接。官方微信仍需在本虚拟机里保持登录。</p>
    <form id="setup-form">
      <label for="connection">粘贴 NAS 配置（推荐）</label>
      <textarea id="connection" autocomplete="off" spellcheck="false" placeholder="RELAY_BASE_URL=https://…&#10;RELAY_AGENT_TOKEN=…"></textarea>
      <p class="hint">也可以只粘贴令牌，再在下面填写聊天室地址。</p>

      <label for="base-url">聊天室地址</label>
      <input id="base-url" type="url" inputmode="url" value="${escapeHtml(baseUrl)}" placeholder="https://liao.example.com" autocomplete="url">

      <label for="token">设备令牌</label>
      <input id="token" type="password" autocomplete="off" placeholder="聊天室生成的设备令牌">
      <label class="row"><input id="show-token" type="checkbox">显示令牌</label>

      <div class="actions">
        <button id="connect" type="submit">验证并连接</button>
        <button id="close" class="secondary" type="button">关闭</button>
      </div>
      <div id="status" role="status" aria-live="polite"></div>
    </form>
  </main>
  <script nonce="${nonce}">
    const form = document.querySelector("#setup-form");
    const pasted = document.querySelector("#connection");
    const baseUrl = document.querySelector("#base-url");
    const token = document.querySelector("#token");
    const showToken = document.querySelector("#show-token");
    const connect = document.querySelector("#connect");
    const status = document.querySelector("#status");

    function show(kind, message) {
      status.className = kind;
      status.textContent = message;
    }

    function importPastedConfiguration() {
      const values = {};
      for (const line of pasted.value.split(/\\r?\\n/)) {
        const match = line.match(/^\\s*(?:export\\s+)?(RELAY_BASE_URL|RELAY_AGENT_TOKEN)\\s*=\\s*(.*?)\\s*$/);
        if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\\1$/, "$2");
      }
      if (values.RELAY_BASE_URL) baseUrl.value = values.RELAY_BASE_URL;
      if (values.RELAY_AGENT_TOKEN) token.value = values.RELAY_AGENT_TOKEN;
    }

    pasted.addEventListener("input", importPastedConfiguration);
    showToken.addEventListener("change", () => { token.type = showToken.checked ? "text" : "password"; });
    document.querySelector("#close").addEventListener("click", async () => {
      try { await fetch("close", { method: "POST" }); } finally { window.close(); }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      connect.disabled = true;
      show("busy", "正在验证生产聊天室和设备令牌…");
      try {
        const response = await fetch("connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionText: pasted.value, baseUrl: baseUrl.value, token: token.value })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "连接失败");
        pasted.value = "";
        token.value = "";
        show("success", "连接成功。微信转发服务已经切换到该聊天室。\\n\\n请确认本虚拟机中的官方微信已登录，然后回到聊天室等待“NAS 微信在线”。本窗口会在 30 秒后自动关闭。");
      } catch (error) {
        show("error", error instanceof Error ? error.message : "连接失败，请重试");
        connect.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) throw new Error("输入内容过长");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("输入格式不正确");
  }
}

function sendJson(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export async function validateRelayConnection(connection: RelaySetupConnection) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${connection.baseUrl}/api/wechat-relay/agent/config`, {
      headers: { authorization: `Bearer ${connection.token}` },
      redirect: "error",
      signal: controller.signal
    });
    if (response.status === 401) throw new Error("设备令牌无效，请从生产聊天室重新复制 NAS 配置");
    if (response.status === 503) throw new Error("生产聊天室尚未保存设备令牌");
    if (!response.ok) throw new Error(`生产聊天室验证失败（HTTP ${response.status}）`);
    const payload = await response.json() as { config?: unknown };
    if (!payload?.config || typeof payload.config !== "object") throw new Error("生产聊天室返回了无法识别的响应");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("连接生产聊天室超时，请检查虚拟机网络");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function applyRelayConnectionWithPkexec(connection: RelaySetupConnection) {
  return new Promise<void>((resolve, reject) => {
    const helperPath = fileURLToPath(new URL("./setupHelper.js", import.meta.url));
    const child = spawn("/usr/bin/pkexec", [process.execPath, helperPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString("utf8")}`.slice(-16_384);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.stdin.on("error", () => {
      // The close/error handlers below report authorization or helper failures.
    });
    child.once("error", () => finish(new Error("无法启动虚拟机管理员授权，请确认已安装 pkexec/policykit-1")));
    child.once("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim()) as { success?: boolean };
          if (result.success) return finish();
        } catch {
          // Fall through to the safe generic error below.
        }
      }
      if (code === 126 || code === 127) return finish(new Error("管理员授权已取消，配置没有改变"));
      finish(new Error(stderr.trim() || "保存配置或重启微信转发服务失败，原配置已恢复"));
    });
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("等待管理员授权超时，配置没有改变"));
    }, 90_000);
    child.stdin.end(JSON.stringify({ baseUrl: connection.baseUrl, token: connection.token }));
  });
}

export function createRelaySetupServer(dependencies: RelaySetupServerDependencies = {}) {
  const secret = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(18).toString("base64");
  const existingEnvironment = dependencies.existingEnvironment ?? readExistingEnvironment();
  const currentBaseUrl = parseRelayEnvironment(existingEnvironment).get("RELAY_BASE_URL") || "";
  const validateConnection = dependencies.validateConnection || validateRelayConnection;
  const applyConnection = dependencies.applyConnection || applyRelayConnectionWithPkexec;

  const server = http.createServer(async (request, response) => {
    const address = server.address();
    if (!address || typeof address === "string") return sendJson(response, 503, { success: false, message: "设置程序尚未就绪" });
    const origin = `http://127.0.0.1:${address.port}`;
    if (request.headers.host !== `127.0.0.1:${address.port}`) return sendJson(response, 403, { success: false, message: "拒绝非本机访问" });
    const requestUrl = new URL(request.url || "/", origin);
    const pagePath = `/${secret}/`;

    if (request.method === "GET" && requestUrl.pathname === pagePath) {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      });
      return response.end(setupPage(nonce, currentBaseUrl));
    }

    const isProtectedPost = request.method === "POST"
      && (requestUrl.pathname === `${pagePath}connect` || requestUrl.pathname === `${pagePath}close`);
    if (isProtectedPost && request.headers.origin !== origin) {
      return sendJson(response, 403, { success: false, message: "拒绝非本机页面请求" });
    }
    if (request.method === "POST" && requestUrl.pathname === `${pagePath}close`) {
      sendJson(response, 200, { success: true });
      return setImmediate(() => server.close());
    }
    if (request.method === "POST" && requestUrl.pathname === `${pagePath}connect`) {
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object") throw new Error("输入格式不正确");
        const value = body as RelaySetupInput;
        const connection = resolveRelaySetupInput({
          connectionText: typeof value.connectionText === "string" ? value.connectionText : "",
          baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
          token: typeof value.token === "string" ? value.token : ""
        }, existingEnvironment);
        await validateConnection(connection);
        await applyConnection(connection);
        dependencies.onConnected?.(connection);
        return sendJson(response, 200, { success: true, baseUrl: connection.baseUrl });
      } catch (error) {
        return sendJson(response, 400, { success: false, message: errorMessage(error) });
      }
    }
    sendJson(response, 404, { success: false, message: "页面不存在" });
  });

  return { server, secret };
}

export async function runRelaySetupApp() {
  let closeTimer: NodeJS.Timeout | undefined;
  let exitCode = 0;
  const { server, secret } = createRelaySetupServer({
    onConnected: () => {
      closeTimer = setTimeout(() => server.close(), 30_000);
      closeTimer.unref();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法启动本机设置页面");
  const url = `http://127.0.0.1:${address.port}/${secret}/`;
  const browser = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  browser.once("error", () => {
    exitCode = 1;
    console.error("无法打开浏览器，请确认虚拟机已安装 xdg-utils");
    server.close();
  });
  browser.unref();
  console.log(`微信转发连接设置已打开：${url}`);

  const idleTimer = setTimeout(() => server.close(), 15 * 60_000);
  idleTimer.unref();
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
  await new Promise<void>((resolve) => server.once("close", resolve));
  clearTimeout(idleTimer);
  if (closeTimer) clearTimeout(closeTimer);
  return exitCode;
}
