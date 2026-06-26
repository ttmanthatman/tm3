import type { MulticharDeps, CharacterConfig, StageSnapshot, SnapshotMessage } from "./types.js";
import type { Stage } from "./stage.js";
import type { Memory } from "./memory.js";
import type { AiClient } from "./ai.js";
import type { UrgeEvaluator } from "./urge.js";
import type { ImpressionManager } from "./impression.js";
import type { EmotionManager } from "./emotion.js";

export interface CharacterRuntime {
  characterId: number;
  actorId: number;
  name: string;
  config: CharacterConfig;
}

export function createCharacterEngine(
  deps: MulticharDeps,
  stage: Stage,
  memory: Memory,
  ai: AiClient,
  urgeEvaluator: UrgeEvaluator,
  impression: ImpressionManager,
  emotion: EmotionManager,
  runtime: CharacterRuntime
) {
  let running = false;
  let urgeTimer: ReturnType<typeof setTimeout> | null = null;
  let driftTimer: ReturnType<typeof setInterval> | null = null;
  let channelId: number | null = null;
  let lastSpeakVersion: number = 0;
  let lastSpeakTurnIndex: number = 0;
  let lastSpeakWallClock: Date | null = null;
  let lastUrgeAt: Date | null = null;
  let urgeEvaluations = 0;
  let messagesSpoken = 0;
  let generating = false;

  function parseConfig(rawConfig: unknown): CharacterConfig {
    const c = (rawConfig ?? {}) as Record<string, unknown>;
    const mc = (c.multichar ?? {}) as Record<string, unknown>;
    return {
      bio: (mc.bio as CharacterConfig["bio"]) ?? null,
      emotionBaseline: String(mc.emotionBaseline ?? "平静中性"),
      modelHints: mc.modelHints as CharacterConfig["modelHints"] | undefined,
    };
  }

  function loadConfig(): CharacterConfig {
    return parseConfig(runtime.config);
  }

  async function getInStageCharacters(chId: number): Promise<{ actorId: number; characterId: number; name: string; actorIds: number[] }> {
    const characters = await deps.prisma.virtualCharacter.findMany({
      where: { enabled: true },
      include: { actor: true },
    });
    const active = characters.filter((c: any) => c.actor.status === "active");
    return {
      actorId: runtime.actorId,
      characterId: runtime.characterId,
      name: runtime.name,
      actorIds: active.map((c: any) => c.actorId),
    };
  }

  function extractTopicKeywords(messages: SnapshotMessage[]): string[] {
    if (messages.length === 0) return [];
    const recent = messages.slice(-5);
    const text = recent.map((m) => m.content).join(" ");
    const stopwords = new Set(["的", "了", "是", "在", "我", "你", "他", "她", "这", "那", "就", "都", "也", "和", "与", "但", "不", "有", "没", "说", "想", "做", "看", "给", "对", "为", "什么", "怎么", "可以", "应该", "觉得", "认为", "因为", "所以", "如果", "虽然", "但是"]);
    const words = text.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || [];
    const freq = new Map<string, number>();
    for (const w of words) {
      if (stopwords.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  }

  function buildBioText(config: CharacterConfig): string {
    const bio = config.bio;
    if (!bio) return `${runtime.name}，${config.emotionBaseline}`;
    const lines: string[] = [];
    if (bio.basics?.name || bio.basics?.identity) {
      lines.push(`${bio.basics.name ?? runtime.name}${bio.basics.age ? `，${bio.basics.age}岁` : ""}，${bio.basics.identity ?? ""}`);
    }
    if (bio.background?.keyExperiences?.length) {
      lines.push(`经历：${bio.background.keyExperiences.join("；")}`);
    }
    if (bio.values?.coreBeliefs?.length) {
      lines.push(`信条：${bio.values.coreBeliefs.join("；")}`);
    }
    if (bio.personality?.thinkingStyle) lines.push(`思维：${bio.personality.thinkingStyle}`);
    if (bio.personality?.communicationStyle) lines.push(`说话：${bio.personality.communicationStyle}`);
    if (bio.personality?.emotionalPattern) lines.push(`情绪：${bio.personality.emotionalPattern}`);
    if (bio.expertise?.strengths?.length) lines.push(`擅长：${bio.expertise.strengths.join("，")}`);
    if (bio.expertise?.knowledgeBoundaries?.length) lines.push(`不擅长：${bio.expertise.knowledgeBoundaries.join("，")}`);
    if (bio.interpersonal?.conflictStyle) lines.push(`冲突风格：${bio.interpersonal.conflictStyle}`);
    if (bio.voice?.catchphrases?.length) lines.push(`口头禅：${bio.voice.catchphrases.join("，")}`);
    return lines.join("\n") || `${runtime.name}，${config.emotionBaseline}`;
  }

  async function generateUtterance(snapshot: StageSnapshot, config: CharacterConfig): Promise<string> {
    const recalled = await memory.recall(
      runtime.characterId,
      extractTopicKeywords(snapshot.messages),
      snapshot.messages.map((m: SnapshotMessage) => m.speakerActorId)
    );

    const inStageOthers = snapshot.messages
      .map((m: SnapshotMessage) => ({ actorId: m.speakerActorId, name: m.speakerName }))
      .filter((m: { actorId: number; name: string }, i: number, arr: { actorId: number; name: string }[]) => arr.findIndex((x: { actorId: number; name: string }) => x.actorId === m.actorId) === i && m.actorId !== runtime.actorId);

    const impressionLines = inStageOthers
      .map((o: { actorId: number; name: string }) => {
        const imp = recalled.impressions.get(o.actorId);
        return imp ? `- ${o.name}：${imp}` : `- ${o.name}：（还没有形成印象）`;
      })
      .join("\n");

    const recentText = snapshot.messages.length > 0
      ? snapshot.messages.map((m: SnapshotMessage) => `[第${m.turnIndex}轮 ${m.wallClock.toISOString().slice(11, 16)}] ${m.speakerName}: ${m.content}`).join("\n")
      : "（还没有人说话）";

    const now = new Date();
    const turnsSince = lastSpeakTurnIndex > 0 ? (snapshot.messages[snapshot.messages.length - 1]?.turnIndex ?? 0) - lastSpeakTurnIndex : 0;
    const minutesSince = lastSpeakWallClock ? Math.round((now.getTime() - lastSpeakWallClock.getTime()) / 60000) : 0;
    const lastMessage = snapshot.messages[snapshot.messages.length - 1];
    const silenceSeconds = lastMessage ? Math.round((now.getTime() - lastMessage.wallClock.getTime()) / 1000) : 999;

    const systemPrompt = `你是以下这个人。完全融入这个人格发言。

${buildBioText(config)}

你的情绪基线：${config.emotionBaseline}
你现在的情绪：${recalled.emotion ?? config.emotionBaseline}

你的记忆：
长期判断：
${recalled.longTerm.map((l: string) => `- ${l}`).join("\n") || "-（暂无）"}

近期情景：
${recalled.midTerm.map((m: string) => `- ${m}`).join("\n") || "-（暂无）"}

你对在场者的印象：
${impressionLines || "-（暂无）"}

要求：
1. 完全融入人格，用你的语言指纹说话
2. 你的印象和情绪会自然影响你的语气和立场
3. 只输出发言内容本身，不要"XX说："之类前缀
4. 如果觉得现在没什么可说的，输出 [PASS]`;

    const userPrompt = `当前对话（你开口时能看到的所有信息，version ≤ ${snapshot.readFromVersion}。期间别人可能说了新话，但你此刻基于这些回应）：

${recentText}

时间信息：
- 你距离上次发言过了 ${turnsSince} 轮（约 ${minutesSince} 分钟）${turnsSince > 10 ? "，你最近说得少" : ""}
- 全场最近一次发言在 ${silenceSeconds} 秒前${silenceSeconds > 120 ? "，有点冷场" : ""}

以 ${runtime.name} 的身份发言：`;

    return ai.callMainModel(systemPrompt, userPrompt, config.modelHints?.mainModel);
  }

  async function tick() {
    if (!running || !channelId || generating) {
      scheduleNextUrge();
      return;
    }

    const config = loadConfig();
    lastUrgeAt = new Date();
    urgeEvaluations++;

    try {
      const readFromVersion = await stage.latestVersion(channelId);
      const snapshot = await stage.getSnapshot(channelId, readFromVersion, 8);

      const now = new Date();
      const lastMsg = snapshot.messages[snapshot.messages.length - 1];
      const silenceSeconds = lastMsg ? Math.round((now.getTime() - lastMsg.wallClock.getTime()) / 1000) : 999;
      const currentTurn = snapshot.messages[snapshot.messages.length - 1]?.turnIndex ?? 0;
      const turnsSinceLastSpeak = lastSpeakTurnIndex > 0 ? currentTurn - lastSpeakTurnIndex : currentTurn;

      const emotionState = await emotion.getEmotion(runtime.characterId);

      const urgeResult = await urgeEvaluator.evaluate({
        characterName: runtime.name,
        config,
        recentMessages: snapshot.messages,
        emotion: emotionState,
        turnsSinceLastSpeak,
        silenceSeconds,
        myActorId: runtime.actorId,
        model: config.modelHints?.urgeModel,
      });

      if (!urgeResult.wantToSpeak) {
        scheduleNextUrge();
        return;
      }

      generating = true;

      const fullSnapshot = await stage.getSnapshot(channelId, readFromVersion, 30);
      const utterance = await generateUtterance(fullSnapshot, config);

      if (utterance.trim() === "[PASS]" || !utterance.trim()) {
        generating = false;
        scheduleNextUrge();
        return;
      }

      const turnIndex = (await stage.getRecentTurnIndex(channelId)) + 1;
      const { version } = await stage.append(
        deps,
        channelId,
        runtime.actorId,
        utterance.trim(),
        readFromVersion,
        turnIndex,
        { urgeReason: urgeResult.reason, urgency: urgeResult.urgency }
      );

      lastSpeakVersion = version;
      lastSpeakTurnIndex = turnIndex;
      lastSpeakWallClock = new Date();
      messagesSpoken++;

      void memory.appendShortTerm(
        runtime.characterId,
        runtime.actorId,
        runtime.name,
        utterance.trim(),
        version,
        turnIndex,
        new Date()
      );

      const allChars = await deps.prisma.virtualCharacter.findMany({
        where: { enabled: true },
        include: { actor: true },
      });
      const listenerIds = allChars.filter((c: any) => c.id !== runtime.characterId && c.actor.status === "active").map((c: any) => c.id);
      const listenerNames = new Map<number, string>();
      for (const c of allChars as any[]) listenerNames.set(c.id, c.actor.displayName);

      void impression.updateForSpeaker(
        runtime.characterId,
        runtime.actorId,
        runtime.name,
        utterance.trim(),
        listenerIds,
        listenerNames,
        config.modelHints?.impressionModel
      );

      void emotion.updateEmotion(
        runtime.characterId,
        runtime.name,
        config.emotionBaseline,
        `你刚在对话中发了言，表达了你的观点`,
        config.modelHints?.impressionModel
      );

    } catch (err) {
      deps.log("error", `角色引擎异常: ${runtime.name}`, err);
    } finally {
      generating = false;
    }

    scheduleNextUrge();
  }

  function scheduleNextUrge() {
    if (!running) return;
    const interval = 5000 + Math.random() * 4000;
    urgeTimer = setTimeout(() => void tick(), interval);
  }

  function start(chId: number) {
    if (running) return;
    channelId = chId;
    running = true;
    lastSpeakVersion = 0;
    lastSpeakTurnIndex = 0;
    lastSpeakWallClock = null;
    urgeEvaluations = 0;
    messagesSpoken = 0;
    deps.log("info", `角色引擎启动: ${runtime.name} (channel ${chId})`);

    driftTimer = setInterval(async () => {
      if (!running) return;
      const config = loadConfig();
      try {
        await emotion.driftTowardBaseline(runtime.characterId, runtime.name, config.emotionBaseline, config.modelHints?.impressionModel);
      } catch (err) {
        deps.log("warn", `情绪回归异常: ${runtime.name}`, err);
      }
    }, 5 * 60 * 1000);

    scheduleNextUrge();
  }

  function stop() {
    running = false;
    if (urgeTimer) { clearTimeout(urgeTimer); urgeTimer = null; }
    if (driftTimer) { clearInterval(driftTimer); driftTimer = null; }
    deps.log("info", `角色引擎停止: ${runtime.name}`);
  }

  function getStatus() {
    return {
      characterId: runtime.characterId,
      characterName: runtime.name,
      running,
      channelId,
      lastUrgeAt: lastUrgeAt?.toISOString() ?? null,
      lastSpeakAt: lastSpeakWallClock?.toISOString() ?? null,
      turnsSinceLastSpeak: lastSpeakTurnIndex,
      urgeEvaluations,
      messagesSpoken,
    };
  }

  return { start, stop, getStatus, runtime };
}

export type CharacterEngine = ReturnType<typeof createCharacterEngine>;
