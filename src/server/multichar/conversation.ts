import type { AiConversationConfig, AiConversationStatus } from "../../shared/aiConversation.js";

export interface ConversationTurn { actorId: number; messages: { role: "system" | "user" | "assistant"; content: string }[]; model?: string; provider?: import("../../shared/aiProviders.js").AiProvider; thinkingEnabled?: boolean }
interface Dependencies {
  prepare(channelId: number, characterId: number, config: AiConversationConfig): Promise<ConversationTurn>;
  generate(turn: ConversationTurn, signal: AbortSignal): Promise<string>;
  publish(channelId: number, actorId: number, content: string): Promise<unknown>;
}
interface Session {
  config: AiConversationConfig; status: AiConversationStatus; activeSince: number; elapsedMs: number;
  timer?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>;
  controller?: AbortController; inFlight?: Promise<void>;
}

export function createConversationController(deps: Dependencies) {
  const sessions = new Map<number, Session>();
  function elapsed(session: Session) { return session.elapsedMs + (session.status.state === "running" ? Date.now() - session.activeSince : 0); }
  function halt(session: Session, state: AiConversationStatus["state"], reason: string) {
    session.elapsedMs = elapsed(session);
    session.status.state = state;
    session.status.reason = reason;
    clearTimeout(session.timer); clearTimeout(session.deadline); session.controller?.abort();
  }
  function exhausted(session: Session) {
    if (session.status.messages >= session.config.maxMessages) return "已达到发言条数上限";
    if (session.status.contextChars >= session.config.maxContextChars) return "已达到累计上下文字符上限";
    if (elapsed(session) >= session.config.maxDurationSeconds * 1000) return "已达到运行时间上限";
    return "";
  }
  async function turn(channelId: number, session: Session) {
    const controller = new AbortController(); session.controller = controller;
    try {
      const prepared = await deps.prepare(channelId, session.config.characterIds[session.status.messages % session.config.characterIds.length], session.config);
      if (session.status.state !== "running") return;
      const reason = exhausted(session);
      if (reason) { halt(session, "completed", reason); return; }
      const chars = prepared.messages.reduce((sum, message) => sum + message.content.length, 0);
      if (session.status.contextChars + chars > session.config.maxContextChars) { halt(session, "completed", "剩余上下文预算不足以生成下一条"); return; }
      session.status.contextChars += chars;
      const content = await deps.generate(prepared, controller.signal);
      if (controller.signal.aborted || session.status.state !== "running") return;
      const after = exhausted(session);
      // A request that exactly uses the context budget may publish its response.
      if (after && after !== "已达到累计上下文字符上限") { halt(session, "completed", after); return; }
      // Refresh membership and enablement after the network request before writing.
      await deps.prepare(channelId, session.config.characterIds[session.status.messages % session.config.characterIds.length], session.config);
      if (controller.signal.aborted || session.status.state !== "running") return;
      if (elapsed(session) >= session.config.maxDurationSeconds * 1000) { halt(session, "completed", "已达到运行时间上限"); return; }
      if (!content.trim()) throw new Error("AI 返回空内容");
      await deps.publish(channelId, prepared.actorId, content.trim());
      session.status.messages++;
      if (session.status.state !== "running") return;
      const done = exhausted(session);
      if (done) halt(session, "completed", done);
    } catch {
      if (session.status.state === "running") halt(session, "error", "对话已停止：请检查角色权限、启用状态和模型接入配置");
    } finally {
      session.controller = undefined;
    }
  }
  function schedule(channelId: number, session: Session, delay = 0) {
    session.timer = setTimeout(() => {
      const pending = turn(channelId, session);
      session.inFlight = pending;
      void pending.finally(() => {
        session.inFlight = undefined;
        if (session.status.state === "running") schedule(channelId, session, session.config.intervalSeconds * 1000);
      });
    }, delay);
  }
  function activate(channelId: number, session: Session) {
    session.status.state = "running"; session.status.reason = ""; session.activeSince = Date.now();
    session.deadline = setTimeout(() => halt(session, "completed", "已达到运行时间上限"), Math.max(0, session.config.maxDurationSeconds * 1000 - session.elapsedMs));
    schedule(channelId, session);
  }
  async function control(channelId: number, action: "pause" | "resume" | "stop") {
    const session = sessions.get(channelId);
    if (!session) return;
    if (action === "resume") {
      if (session.status.state !== "paused") return;
      await session.inFlight;
      if (session.status.state === "paused") activate(channelId, session);
      return;
    }
    if (action === "pause" && session.status.state !== "running") return;
    halt(session, action === "pause" ? "paused" : "stopped", action === "pause" ? "已暂停" : "已终止");
    await session.inFlight;
  }
  async function start(channelId: number, config: AiConversationConfig) {
    await control(channelId, "stop");
    const session: Session = { config: structuredClone(config), status: { state: "running", messages: 0, contextChars: 0, elapsedSeconds: 0, reason: "" }, activeSince: Date.now(), elapsedMs: 0 };
    sessions.set(channelId, session); activate(channelId, session);
  }
  function status(channelId: number): AiConversationStatus {
    const session = sessions.get(channelId);
    return session ? { ...session.status, elapsedSeconds: Math.floor(elapsed(session) / 1000) } : { state: "idle", messages: 0, contextChars: 0, elapsedSeconds: 0, reason: "" };
  }
  async function stopAll() { await Promise.all([...sessions.keys()].map((id) => control(id, "stop"))); sessions.clear(); }
  return { start, control, status, stopAll, allStatus: () => [...sessions.keys()].map((channelId) => ({ channelId, ...status(channelId), running: status(channelId).state === "running" })) };
}
