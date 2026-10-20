import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { bibleActivityAccountLabel, pushBibleActivity, recentBibleActivity } from "../bibleActivityLog.js";

// 圣经使用日志路由：客户端上报「打开圣经」，/log 输出一个极简后台页（按需访问，无鉴权）。
// 「听圣经」不在这里上报——章节流媒体请求在 bibleAudio.ts 里服务端直接记录，无法漏记。

interface AuthedRequest extends FastifyRequest {
  auth: { accountId: number; isAdmin: boolean };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function formatTime(at: number) {
  return new Date(at).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function renderLogPage() {
  const rows = recentBibleActivity()
    .map((entry) => `<tr><td>${escapeHtml(formatTime(entry.at))}</td><td>${escapeHtml(entry.account)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.detail)}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>圣经使用日志</title>
<style>
  body { margin: 0; padding: 16px; font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f6f2ea; color: #3f3227; }
  h1 { margin: 0 0 4px; font-size: 17px; }
  p { margin: 0 0 12px; color: #8b7259; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #fffdf7; box-shadow: 0 4px 16px rgba(74, 52, 29, .08); }
  th, td { padding: 6px 10px; border-bottom: 1px solid rgba(203, 184, 155, .45); text-align: left; white-space: nowrap; }
  th { position: sticky; top: 0; background: #f0e7d6; font-size: 12px; color: #6d5135; }
  td:last-child { white-space: normal; min-width: 240px; }
  td:nth-child(1) { color: #8b7259; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1>圣经使用日志</h1>
<p>最近 ${recentBibleActivity().length} 条（内存留存 ${500} 条，服务重启后清空；每 10 秒自动刷新）</p>
<table>
<thead><tr><th>时间</th><th>成员</th><th>行为</th><th>详情</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="4" style="color:#8b7259">暂无记录</td></tr>'}
</tbody>
</table>
</body>
</html>`;
}

export function registerBibleActivityLogRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; requireAuth: preHandlerHookHandler }) {
  const { prisma, requireAuth } = deps;

  app.post("/api/bible/activity", { preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({
        action: z.enum(["open"]),
        detail: z.string().max(60).optional()
      })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "无效的日志事件" });
    const account = await bibleActivityAccountLabel(prisma, (request as AuthedRequest).auth.accountId);
    pushBibleActivity("打开圣经", body.data.detail || "", account);
    return { success: true };
  });

  app.get("/log", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    reply.type("text/html; charset=utf-8");
    return renderLogPage();
  });
}
